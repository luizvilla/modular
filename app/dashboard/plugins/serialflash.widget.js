(function () {
    try {
        if (window.localStorage && window.localStorage.getItem('serial_flasher_debug') === '1') {
            console.log('[serial_flasher] plugin script loaded');
        }
    } catch {}
    freeboard.loadWidgetPlugin({
        type_name: 'serial_flasher',
        display_name: 'Serial Firmware Flasher',
        description: 'Flash firmware to a device over serial using mcumgr',
        icon: 'microchip',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new SerialFlasher(settings));
        }
    });

    class SerialFlasher {
        constructor(settings) {
            this.settings = settings;
            this.debug = (window.localStorage && window.localStorage.getItem('serial_flasher_debug') === '1');
            this._log = (...args) => {
                if (this.debug) console.log('[serial_flasher]', ...args);
            };
            this.flashApi = window.api && window.api.flash ? window.api.flash : null;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.canApi = window.api && window.api.can ? window.api.can : null;
            this.ipc = (!this.flashApi && !this.serialApi && !this.canApi && window.require)
                ? window.require('electron')?.ipcRenderer
                : null;
            this.container = $('<div style="display:flex;flex-direction:column;height:100%;gap:8px;"></div>');
            this.controls = $('<div style="display:flex;flex-direction:column;gap:6px;"></div>');
            this.portSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.refreshBtn = $('<button class="btn btn-secondary btn-sm">Refresh</button>');
            this.mode = 'serial'; // 'serial' | 'can'
            this.btnSerial = $('<button class="btn btn-outline-primary btn-sm active">Serial</button>');
            this.btnCan = $('<button class="btn btn-outline-primary btn-sm">CAN</button>');
            this.canSelect = $('<select class="form-select form-select-sm flex-fill" disabled></select>');
            this.refreshCanBtn = $('<button class="btn btn-secondary btn-sm" disabled>Refresh</button>');
            this.nodeSelect = $('<select class="form-select form-select-sm flex-fill" disabled></select>');
            this.refreshNodeBtn = $('<button class="btn btn-secondary btn-sm" disabled>Scan</button>');
            this.flashAllMode = false; // false: single target; true: all nodes
            this.flashModeBtn = $('<button class="btn btn-outline-secondary btn-sm" disabled>Flash all nodes</button>');
            this.fileLabel = $('<input type="text" class="form-control form-control-sm" readonly value="No file selected">');
            this.fileBtn = $('<button class="btn btn-secondary btn-sm">Browse</button>');
            this.selectedFilePath = null;
            this.startBtn = $('<button class="btn btn-primary btn-sm">Flash Firmware</button>');
            this.cancelBtn = $('<button class="btn btn-danger btn-sm" style="display:none;">Cancel</button>');
            this.progressState = $('<small style="color:#9aa4b2;">idle</small>');
            this.progressLabel = $('<div style="font-size:12px;color:#9aa4b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">No upload running</div>');
            this.progressBar = $('<div role="progressbar" style="height:10px;width:0%;background:#2c4cff;color:#fff;font-size:10px;line-height:10px;text-align:center;border-radius:999px;" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>');
            this.progressWrap = $('<div style="height:10px;width:100%;background:#0b0f18;border:1px solid #2a3240;border-radius:999px;overflow:hidden;"></div>').append(this.progressBar);
            // NOTE: Use a div (not section) so Gridster's .gridster section CSS doesn't
            // force absolute positioning and cover the rest of the widget.
            this.progressPanel = $('<div style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid #2a3240;border-radius:8px;background:#0f121b;"></div>');
            this.progressPanel.css('pointer-events', 'none');
            this.progressPanel.append(
                $('<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;"></div>')
                    .append('<strong>Serial DFU</strong>')
                    .append(this.progressState),
                this.progressLabel,
                this.progressWrap
            );
            this.uploadFailed = false;
            // Progress bar moved to Activity Center. Keep a collapsible log.
            this.logToggle = $('<button class="btn btn-outline-secondary btn-sm">Show log</button>');
            this.logArea = $('<textarea class="form-control bg-dark text-light" readonly style="flex:1; display:none;"></textarea>');
            this._progressListener = (_e, m) => this._onProgress(m);
            this._completeListener = () => this._onComplete();
            this._progressUnsub = null;
            this._progressPeak = 0;
        }

        render(el) {
            this._log('render', { hasApi: !!this.flashApi, hasSerial: !!this.serialApi, hasCan: !!this.canApi });
            this._refreshPorts();
            this._refreshCan();
            this._refreshNodes();
            this.refreshBtn.on('click', () => this._refreshPorts());
            this.refreshCanBtn.on('click', () => this._refreshCan());
            this.refreshNodeBtn.on('click', () => this._refreshNodes(true));
            $(el).append(this.container);
            const rowStyle = 'display:flex;align-items:center;gap:6px;';
            const labelStyle = 'min-width:84px;font-size:12px;color:#9aa4b2;';
            const fullSelect = (sel) => sel.css({ width: '100%' });
            const makeRow = (labelText, ...items) => {
                const row = $(`<div style="${rowStyle}"></div>`);
                row.append(`<div style="${labelStyle}">${labelText}</div>`);
                items.forEach(it => row.append(it));
                return row;
            };

            const modeBtns = $('<div class="btn-group" role="group"></div>');
            modeBtns.append(this.btnSerial, this.btnCan);
            const modeRow = makeRow('Mode', modeBtns);

            fullSelect(this.portSelect);
            const portRow = makeRow('Serial Port', this.portSelect, this.refreshBtn);

            fullSelect(this.canSelect);
            const canRow = makeRow('CAN Interface', this.canSelect, this.refreshCanBtn);

            fullSelect(this.nodeSelect);
            const nodeRow = makeRow('Target Node', this.nodeSelect, this.refreshNodeBtn, this.flashModeBtn);

            const fileRow = $('<div style="display:flex;align-items:center;gap:6px;"></div>');
            fileRow.append(this.fileBtn, this.fileLabel);

            const buttonRow = $('<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"></div>');
            buttonRow.append(this.startBtn, this.cancelBtn, this.logToggle);

            this.controls.append(modeRow, portRow, canRow, nodeRow, fileRow, buttonRow, this.logArea);
            this.container.append(this.controls, this.progressPanel);
            this._log('layout appended', {
                controlsChildren: this.controls.children().length,
                containerChildren: this.container.children().length
            });

            // Toggle UI by mode (hide/show rows)
            const updateModeUI = () => {
                const useCan = (this.mode === 'can');
                // Button active state
                this.btnSerial.toggleClass('active', !useCan);
                this.btnCan.toggleClass('active', useCan);
                // Show/Hide relevant rows
                portRow.toggle(!useCan);
                canRow.toggle(useCan);
                nodeRow.toggle(useCan);
                // Also keep controls disabled when hidden for safety
                this.canSelect.prop('disabled', !useCan);
                this.refreshCanBtn.prop('disabled', !useCan);
                this.nodeSelect.prop('disabled', !useCan);
                this.refreshNodeBtn.prop('disabled', !useCan);
                this.flashModeBtn.prop('disabled', !useCan);
                this.portSelect.prop('disabled', useCan);
                this.refreshBtn.prop('disabled', useCan);
            };
            // Mode button handlers
            this.btnSerial.on('click', () => { this.mode = 'serial'; updateModeUI(); });
            this.btnCan.on('click', () => { this.mode = 'can'; updateModeUI(); });
            updateModeUI();

            // Toggle flash mode button
            this._updateFlashModeBtn = () => {
                if (this.flashAllMode) {
                    this.flashModeBtn.text('Flash selected device')
                        .removeClass('btn-outline-secondary').addClass('btn-primary');
                } else {
                    this.flashModeBtn.text('Flash all nodes')
                        .removeClass('btn-primary').addClass('btn-outline-secondary');
                }
            };
            this._updateFlashModeBtn();
            this.flashModeBtn.on('click', () => {
                this.flashAllMode = !this.flashAllMode;
                this._updateFlashModeBtn();
            });

            this.fileBtn.on('click', async () => {
                if (!this.flashApi && !this.ipc) return;
                const chosen = this.flashApi && this.flashApi.chooseFirmwareFile
                    ? await this.flashApi.chooseFirmwareFile()
                    : await this.ipc.invoke('choose-firmware-file');
                if (chosen) {
                    this.selectedFilePath = chosen;
                    const name = this._basename(chosen);
                    this.fileLabel.val(name);
                }
            });
            this.startBtn.on('click', () => this._startFlash());
            this.cancelBtn.on('click', () => this._cancelFlash());

            // Log toggle
            this.logToggle.on('click', () => {
                const vis = this.logArea.is(':visible');
                this.logArea.toggle(!vis);
                this.logToggle.text(vis ? 'Show log' : 'Hide log');
            });

            if (window._tutorialPendingFirmware) {
                this.selectedFilePath = window._tutorialPendingFirmware;
                this.fileLabel.val(this._basename(window._tutorialPendingFirmware));
                window._tutorialPendingFirmware = null;
            }
        }

        _formatPortLabel(port) {
            if (!port) return '';
            return String(port.name || port.value || '');
        }

        async _refreshPorts() {
            if (!this.serialApi && !this.ipc) return;
            const ports = this.serialApi && this.serialApi.listPorts
                ? await this.serialApi.listPorts()
                : await this.ipc.invoke('get-serial-ports');
            this._log('ports', ports);
            const prev = this.portSelect.val();
            this.portSelect.empty();
            ports.forEach(p => {
                const label = this._formatPortLabel(p);
                this.portSelect.append(`<option value="${p.value}">${label}</option>`);
            });
            if (prev) {
                this.portSelect.val(prev);
            }
        }

        async _refreshCan() {
            if (!this.canApi && !this.ipc) return;
            const ifs = this.canApi && this.canApi.getInterfaces
                ? await this.canApi.getInterfaces()
                : await this.ipc.invoke('get-can-interfaces');
            this.canSelect.empty();
            const list = (ifs && ifs.length) ? ifs : [{ name: 'can0', value: 'can0' }];
            list.forEach(i => {
                this.canSelect.append(`<option value="${i.value}">${i.name}</option>`);
            });
            // Default select can0 if present
            const hasCan0 = list.some(i => i.value === 'can0');
            if (hasCan0) this.canSelect.val('can0');
        }

        async _refreshNodes(doScan = false) {
            if (!this.canApi && !this.ipc) return;
            if (doScan) {
                try {
                    const channel = this.canSelect.val() || 'can0';
                    try {
                        if (this.canApi && this.canApi.open) {
                            await this.canApi.open({ channel });
                        } else {
                            await this.ipc.invoke('can-open', { channel });
                        }
                    } catch {}
                    if (this.canApi && this.canApi.scanNodes) {
                        await this.canApi.scanNodes({ channel });
                    } else {
                        await this.ipc.invoke('can-scan-nodes', { channel });
                    }
                } catch (e) {
                    console.warn('CAN scan failed:', e?.message || e);
                }
            }
            const nodes = this.canApi && this.canApi.getThingSetNodes
                ? await this.canApi.getThingSetNodes()
                : await this.ipc.invoke('get-thingset-nodes');
            this.nodeSelect.empty();
            nodes.forEach(n => {
                this.nodeSelect.append(`<option value="${n.value}">${n.name}</option>`);
            });
            const hasNodes = nodes && nodes.length > 0;
            this.flashModeBtn.prop('disabled', !hasNodes);
        }

        _basename(filePath) {
            if (!filePath) return '';
            const parts = String(filePath).split(/[\\/]/);
            return parts[parts.length - 1] || filePath;
        }

        _ensureProgressListener() {
            if (this._progressUnsub) return;
            if (this.flashApi && this.flashApi.onProgress) {
                this._progressUnsub = this.flashApi.onProgress((msg) => this._onProgress(msg));
            } else if (this.ipc) {
                this.ipc.on('flash-progress', this._progressListener);
                this._progressUnsub = () => this.ipc.removeListener('flash-progress', this._progressListener);
            }
        }

        _onFlashCompleteOnce(handler) {
            if (this.flashApi && this.flashApi.onComplete) {
                const off = this.flashApi.onComplete(() => {
                    off();
                    handler();
                });
                return;
            }
            if (this.ipc) {
                const wrapped = () => {
                    this.ipc.removeListener('flash-complete', wrapped);
                    handler();
                };
                this.ipc.on('flash-complete', wrapped);
            }
        }

        _startFlash() {
            this._log('startFlash click', { mode: this.mode, port: this.portSelect.val() });
            const filePath = this.selectedFilePath;
            const useCan = (this.mode === 'can');
            const port = this.portSelect.val();
            const canIf = this.canSelect.val();
            const nodeAddrStr = this.nodeSelect.val();
            const nodeAddr = nodeAddrStr ? parseInt(nodeAddrStr, 10) : NaN;
            const flashAll = !!this.flashAllMode;

            if (!this.flashApi && !this.ipc) {
                this.logArea.val('Error: IPC unavailable.\n').show();
                return;
            }

            if (!filePath || (!useCan && !port) || (useCan && (!canIf || (!flashAll && isNaN(nodeAddr))))) {
                const msg = useCan ? 'Please select a firmware file, a CAN interface, and a target node (or switch to Flash all nodes).' : 'Please select both a firmware file and a port.';
                this.logArea.val(msg + '\n').show();
                return;
            }

            const fName = this._basename(filePath);
            this.logArea.val(`Flashing ${fName}...\n`);
            if (this.logArea.is(':hidden')) this.logToggle.text('Show log');
            this.startBtn.hide();
            this.cancelBtn.show();
            this._resetProgress();
            this.progressLabel.text(`Starting upload to ${useCan ? (this.canSelect.val() || 'CAN') : port}`);
            this.progressState.text('flashing');
            this.selectedFilePath = filePath;
            this._ensureProgressListener();
            if (useCan) {
                if (flashAll) this._startFlashAllCan(canIf, filePath);
                else this._startFlashSingleCan(canIf, filePath, nodeAddr);
            } else {
                if (this.flashApi && this.flashApi.startFlash) {
                    this.flashApi.startFlash({ comPort: port, firmwarePath: filePath });
                } else {
                    this.ipc.invoke('start-flash', { comPort: port, firmwarePath: filePath });
                }
                this._onFlashCompleteOnce(() => this._onComplete());
            }
        }

        _startFlashSingleCan(channel, filePath, nodeAddr) {
            this._onFlashCompleteOnce(() => this._onComplete());
            if (this.flashApi && this.flashApi.startFlashCan) {
                this.flashApi.startFlashCan({ channel, filename: filePath, target: nodeAddr });
            } else if (this.ipc) {
                this.ipc.invoke('start-flash-can', { channel, filename: filePath, target: nodeAddr });
            }
        }

        async _startFlashAllCan(channel, filePath) {
            const nodes = this.canApi && this.canApi.getThingSetNodes
                ? await this.canApi.getThingSetNodes()
                : await this.ipc.invoke('get-thingset-nodes');
            const addrs = (nodes || []).map(n => n.value).filter(v => Number.isFinite(v));
            if (!addrs.length) {
                this.logArea.val(this.logArea.val() + 'No nodes found to flash.\n');
                this._onComplete();
                return;
            }
            this._flashQueue = addrs.slice();
            this._flashingAll = true;
            this._cancelAll = false;

            const next = () => {
                if (this._cancelAll) { this._flashingAll = false; this._onComplete(); return; }
                const addr = this._flashQueue.shift();
                if (typeof addr === 'undefined') { this._flashingAll = false; this._onComplete(); return; }
                const hex = '0x' + addr.toString(16).toUpperCase().padStart(2, '0');
                this.logArea.val(this.logArea.val() + `\n=== Flashing node ${hex} ===\n`);
                this._onFlashCompleteOnce(() => setTimeout(() => next(), 300));
                if (this.flashApi && this.flashApi.startFlashCan) {
                    this.flashApi.startFlashCan({ channel, filename: filePath, target: addr });
                } else if (this.ipc) {
                    this.ipc.invoke('start-flash-can', { channel, filename: filePath, target: addr });
                }
            };
            next();
        }

        _cancelFlash() {
            if (!this.flashApi && !this.ipc) return;
            if (this.mode === 'can') {
                this._cancelAll = true;
                if (this.flashApi && this.flashApi.cancelFlashCan) {
                    this.flashApi.cancelFlashCan();
                } else if (this.ipc) {
                    this.ipc.send('cancel-flash-can');
                }
            }
            else if (this.flashApi && this.flashApi.cancelFlash) {
                this.flashApi.cancelFlash();
            } else if (this.ipc) {
                this.ipc.send('cancel-flash');
            }
            this.logArea.val(this.logArea.val() + 'Flash cancelled by user.\n');
        }

        _onProgress(message) {
            const text = String(message || '');
            this._log('progress', text);
            this.logArea.val(this.logArea.val() + text + '\n');
            this.logArea.scrollTop(this.logArea[0].scrollHeight);
            const pct = this._extractProgressPercent(text);
            if (/error|failed/i.test(text)) {
                this._setFailure(text.trim() || 'Upload failed');
                return;
            }
            if (pct !== null) {
                this._setProgress(Math.round(pct));
            }
        }

        _onComplete() {
            this.startBtn.show();
            this.cancelBtn.hide();
            if (this.uploadFailed) {
                this._setFailure(this.progressLabel.text() || 'Upload failed');
            } else {
                this._setSuccess();
            }
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
        }

        onDispose() {
            if (this._progressUnsub) {
                this._progressUnsub();
                this._progressUnsub = null;
            } else if (this.ipc) {
                this.ipc.removeListener('flash-progress', this._progressListener);
                this.ipc.removeListener('flash-complete', this._completeListener);
            }
        }

        _resetProgress() {
            this.uploadFailed = false;
            this._progressPeak = 0;
            this.progressBar.css('background', '#2c4cff');
            this._setProgress(0, true);
            this.progressState.text('idle');
            this.progressLabel.text('No upload running');
        }

        _setProgress(pct, allowDecrease = false) {
            const val = Math.max(0, Math.min(100, pct));
            if (!allowDecrease && val < this._progressPeak) return;
            this._progressPeak = val;
            this.progressBar.css('width', `${val}%`);
            this.progressBar.attr('aria-valuenow', String(val));
            this.progressBar.text(`${val}%`);
        }

        _extractProgressPercent(text) {
            const matches = String(text || '').match(/(\d{1,3}(?:\.\d+)?)%/g);
            if (!matches || !matches.length) return null;
            let max = null;
            for (const token of matches) {
                const n = parseFloat(String(token).replace('%', ''));
                if (!Number.isFinite(n)) continue;
                if (max === null || n > max) max = n;
            }
            return max;
        }

        _setFailure(message) {
            this.uploadFailed = true;
            this.progressBar.css('background', '#dc3545');
            this.progressState.text('failed');
            this.progressLabel.text(message || 'Upload failed');
        }

        _setSuccess() {
            this.progressBar.css('background', '#198754');
            this.progressState.text('done');
            this.progressLabel.text('Upload complete');
            this._setProgress(100);
        }

        getHeight() { return 7; }
    }
})();
