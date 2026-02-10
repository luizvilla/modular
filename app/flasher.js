const { SerialPort } = require('serialport');
const { spawn } = require('child_process');

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

    const maxRetries = 8;
    const retryDelayMs = 300;

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

    const startMcumgr = () => {
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
                    progressCallback,
                    code => {
                        if (code !== 0) {
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
                    progressCallback && progressCallback(`${base} Continuing without 1200-baud touch (assuming bootloader is already active).`);
                    setTimeout(() => startMcumgr(), 200);
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
                }, 500);
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
