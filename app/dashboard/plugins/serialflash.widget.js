(function () {
    freeboard.loadWidgetPlugin({
        type_name: 'serial_flasher',
        display_name: 'Firmware Flasher',
        description: 'Flash firmware to a device over serial using mcumgr',
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
            this.flashApi = window.api && window.api.flash ? window.api.flash : null;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.canApi = window.api && window.api.can ? window.api.can : null;
            this.ipc = (!this.flashApi && !this.serialApi && !this.canApi && window.require)
                ? window.require('electron')?.ipcRenderer
                : null;
            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto"></div>');
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
            // Progress bar moved to Activity Center. Keep a collapsible log.
            this.logToggle = $('<button class="btn btn-outline-secondary btn-sm">Show log</button>');
            this.logArea = $('<textarea class="form-control bg-dark text-light" readonly style="flex:1; display:none;"></textarea>');
            this._progressListener = (_e, m) => this._onProgress(m);
            this._completeListener = () => this._onComplete();
            this._progressUnsub = null;
        }

        render(el) {
            this._refreshPorts();
            this._refreshCan();
            this._refreshNodes();
            this.refreshBtn.on('click', () => this._refreshPorts());
            this.refreshCanBtn.on('click', () => this._refreshCan());
            this.refreshNodeBtn.on('click', () => this._refreshNodes(true));
            $(el).append(this.container);
            const modeRow = $('<div class="input-group input-group-sm mb-1 align-items-center"></div>');
            modeRow.append('<span class="input-group-text">Mode</span>');
            const modeBtns = $('<div class="btn-group" role="group"></div>');
            modeBtns.append(this.btnSerial, this.btnCan);
            modeRow.append(modeBtns);

            const portRow = $('<div class="input-group input-group-sm mb-1"></div>');
            portRow.append('<span class="input-group-text">Serial Port</span>', this.portSelect, this.refreshBtn);

            const canRow = $('<div class="input-group input-group-sm mb-1"></div>');
            canRow.append('<span class="input-group-text">CAN Interface</span>', this.canSelect, this.refreshCanBtn);

            const nodeRow = $('<div class="input-group input-group-sm mb-1 align-items-center"></div>');
            nodeRow.append('<span class="input-group-text">Target Node</span>', this.nodeSelect, this.refreshNodeBtn, this.flashModeBtn);

            const fileRow = $('<div class="input-group input-group-sm mb-1"></div>');
            fileRow.append(this.fileBtn, this.fileLabel);
            this.container.append(modeRow, portRow, canRow, nodeRow, fileRow, this.startBtn, this.cancelBtn, this.logToggle, this.logArea);

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
        }

        async _refreshPorts() {
            if (!this.serialApi && !this.ipc) return;
            const ports = this.serialApi && this.serialApi.listPorts
                ? await this.serialApi.listPorts()
                : await this.ipc.invoke('get-serial-ports');
            this.portSelect.empty();
            ports.forEach(p => {
                this.portSelect.append(`<option value="${p.value}">${p.name}</option>`);
            });
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
            this.logArea.val(this.logArea.val() + message + '\n');
            this.logArea.scrollTop(this.logArea[0].scrollHeight);
        }

        _onComplete() {
            this.startBtn.show();
            this.cancelBtn.hide();
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

        getHeight() { return 5; }
    }
})();
