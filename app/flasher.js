const { SerialPort } = require('serialport');
const { spawn } = require('child_process');
const fs = require('fs');

let currentFlashProcess = null;
let aborted = false;

function cleanupCurrentProcess() {
    if (currentFlashProcess && !currentFlashProcess.killed) {
        const sig = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
        currentFlashProcess.kill(sig);
        currentFlashProcess = null;
    }
}

function runMcumgrCommand(mcumgrPath, args, onData, onError, onClose) {
    if (aborted) return null;
    currentFlashProcess = spawn(mcumgrPath, args);
    currentFlashProcess.on('error', err => {
        if (onError) onError(`Process error: ${err.message}`);
    });
    currentFlashProcess.stdout.on('data', d => onData && onData(d.toString()));
    currentFlashProcess.stderr.on('data', d => onError && onError(d.toString()));
    currentFlashProcess.on('close', code => {
        currentFlashProcess = null;
        onClose && onClose(code);
    });
    return currentFlashProcess;
}

function flashFirmware({ comPort, firmwarePath, mcumgrPath }, progressCallback, onDone) {
    aborted = false;
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        onDone && onDone();
    };

    // Validate firmware path early to avoid misleading serial/bootloader errors.
    if (!firmwarePath || !fs.existsSync(firmwarePath)) {
        progressCallback && progressCallback('Error: Firmware file not found. Please reselect the file.');
        finish();
        return;
    }

    const maxRetries = 8;
    const retryDelayMs = 300;
    const bootloaderWaitMs = 1500;
    const maxUploadRetries = 1;

    const shouldRetryTouch = (err) => {
        if (!err) return false;
        const msg = String(err.message || '').toLowerCase();
        if (err.code === 'EBUSY') return true;
        if (msg.includes('resource temporarily unavailable')) return true;
        if (msg.includes('cannot lock port')) return true;
        return false;
    };

    const shouldSkipTouch = (err) => {
        if (!err) return false;
        if (process.platform !== 'win32') return false;
        const msg = String(err.message || '');
        if (msg.includes('SetCommState')) return true;
        if (msg.includes('Unknown error code 433')) return true;
        return false;
    };

    const isTransientUploadError = (msg) => {
        if (!msg) return false;
        const text = String(msg).toLowerCase();
        if (text.includes('the system cannot find the file specified')) return true;
        if (text.includes('cannot open')) return true;
        if (text.includes('could not open')) return true;
        if (text.includes('failed to open')) return true;
        if (text.includes('no such file or directory')) return true;
        return false;
    };

    const startMcumgr = (attempt = 0) => {
        let lastUploadErr = '';
        runMcumgrCommand(
            mcumgrPath,
            ['conn','add','serial','type=serial',`connstring=dev=${comPort},baud=115200,mtu=128`],
            progressCallback,
            progressCallback,
            code => {
                if (code !== 0) {
                    progressCallback && progressCallback('Error: Failed to add connection.');
                    cleanupCurrentProcess();
                    finish();
                    return;
                }
                runMcumgrCommand(
                    mcumgrPath,
                    ['-c','serial','image','upload',firmwarePath],
                    progressCallback,
                    msg => {
                        lastUploadErr = String(msg || '');
                        if (attempt < maxUploadRetries && isTransientUploadError(lastUploadErr)) {
                            // Suppress transient bootloader/port errors to avoid confusing the user.
                            return;
                        }
                        progressCallback && progressCallback(msg);
                    },
                    code => {
                        if (code !== 0) {
                            if (attempt < maxUploadRetries && isTransientUploadError(lastUploadErr)) {
                                // Retry once to allow bootloader port to enumerate after the 1200-baud touch.
                                progressCallback && progressCallback('Device not ready yet. Retrying upload...');
                                cleanupCurrentProcess();
                                setTimeout(() => startMcumgr(attempt + 1), bootloaderWaitMs);
                                return;
                            }
                            progressCallback && progressCallback('Error: Firmware upload failed.');
                            cleanupCurrentProcess();
                            finish();
                            return;
                        }
                        runMcumgrCommand(
                            mcumgrPath,
                            ['-c','serial','reset'],
                            progressCallback,
                            progressCallback,
                            code => {
                                if (code !== 0) {
                                    progressCallback && progressCallback('Error: Reset failed.');
                                } else {
                                    progressCallback && progressCallback('Success: Flashing and reset complete!');
                                }
                                cleanupCurrentProcess();
                                finish();
                            }
                        );
                    }
                );
            }
        );
    };

    const tryTouchPort = (attempt = 0) => {
        if (aborted) return finish();
        const touchPort = new SerialPort({ path: comPort, baudRate: 1200 }, err => {
            if (err) {
                const base = `Error: Could not open port at 1200 baud. ${err.message}`;
                if (shouldRetryTouch(err) && attempt < maxRetries) {
                    progressCallback && progressCallback(`${base} Retrying (${attempt + 1}/${maxRetries})...`);
                    setTimeout(() => tryTouchPort(attempt + 1), retryDelayMs);
                    return;
                }
                if (shouldSkipTouch(err)) {
                    // Suppress 1200-baud touch errors on Windows; many devices don't require this step.
                    setTimeout(() => startMcumgr(), bootloaderWaitMs);
                    return;
                }
                progressCallback && progressCallback(base);
                finish();
                return;
            }
            touchPort.close(closeErr => {
                if (closeErr) {
                    progressCallback && progressCallback(`Error: Failed to close 1200 baud port. ${closeErr.message}`);
                    finish();
                    return;
                }
                progressCallback && progressCallback('Serial port touched at 1200 baud. Waiting for bootloader...');
                setTimeout(() => {
                    startMcumgr();
                }, bootloaderWaitMs);
            });
        });
    };

    tryTouchPort();
}

function cancelFlash() {
    aborted = true;
    if (currentFlashProcess) {
        const sig = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
        currentFlashProcess.kill(sig);
        currentFlashProcess = null;
    }
}

module.exports = { flashFirmware, cancelFlash };
