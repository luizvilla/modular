(function () {
        const api = window.api || null;
        const serialApi = api && api.serial ? api.serial : null;
        const ipcRenderer = !api && window.require ? window.require("electron")?.ipcRenderer : null;

        // Mirror serial diagnostics to the main process so they show up in the
        // terminal (VS Code integrated terminal / wherever `npm start` runs),
        // not just the DevTools console.
        function logSerial(level, ...args) {
                if (level === 'error') console.error('[serial]', ...args);
                else if (level === 'warn') console.warn('[serial]', ...args);
                else console.log('[serial]', ...args);
                const message = args.map(a => (a instanceof Error ? a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ');
                if (api && api.logger && api.logger.log) {
                        api.logger.log(level, [`[serial-datasource] ${message}`]);
                } else if (ipcRenderer) {
                        ipcRenderer.send('renderer-log', { level, args: [`[serial-datasource] ${message}`] });
                }
        }

        function formatPortLabel(port) {
            if (port === null || port === undefined) return '';
            if (typeof port === 'string') return port;
            return String(port.name || port.value || port.path || '');
        }


        // Keep a cached, auto-refreshing serial port list for dynamic dropdowns + reconnection.
        const instances = new Set();
        const portPollIntervalMs = 1500;
        let cachedPortOptions = [];
        let lastPortValues = [];
        let portPollTimer = null;

        async function listSerialPorts() {
                if (serialApi && serialApi.listPorts) return serialApi.listPorts();
                if (ipcRenderer) return ipcRenderer.invoke('get-serial-ports');
                return [];
        }

        async function openSerialPort(payload) {
                if (serialApi && serialApi.openPort) return serialApi.openPort(payload);
                if (ipcRenderer) return ipcRenderer.invoke('open-serial-port', payload);
        }

        async function closeSerialPort(path) {
                if (serialApi && serialApi.closePort) return serialApi.closePort(path);
                if (ipcRenderer) return ipcRenderer.invoke('close-serial-port', { path });
        }

        async function isSerialPortOpen(path) {
                if (serialApi && serialApi.isOpen) return serialApi.isOpen(path);
                if (ipcRenderer) return ipcRenderer.invoke('is-serial-port-open', { path });
                return false;
        }

        async function getSerialBuffer(path) {
                if (serialApi && serialApi.getBuffer) return serialApi.getBuffer(path);
                if (ipcRenderer) return ipcRenderer.invoke('get-serial-buffer', { path });
                return [];
        }

        function normalizePortValue(port) {
                return port?.value || port?.path || port?.name || String(port || "");
        }

        function portsEqual(a, b) {
                if (a.length !== b.length) return false;
                for (let i = 0; i < a.length; i++) {
                        if (a[i] !== b[i]) return false;
                }
                return true;
        }

        async function refreshPortCache(force = false) {
                try {
                        const ports = await listSerialPorts();
                        const portOptions = Array.isArray(ports)
                                ? ports.map((p) => ({
                                        name: formatPortLabel(p),
                                        value: normalizePortValue(p),
                                        isOwntech: !!p?.isOwntech
                                }))
                                : [];
                        const values = portOptions.map((p) => p.value).filter(Boolean);
                        if (!force && portsEqual(values, lastPortValues)) return;
                        lastPortValues = values;
                        cachedPortOptions = portOptions;
                        instances.forEach((inst) => {
                                if (inst && typeof inst.onPortListUpdate === 'function') {
                                        inst.onPortListUpdate(cachedPortOptions);
                                }
                        });
                } catch (e) {
                        logSerial('error', 'Failed to refresh serial port list:', e.message || e);
                }
        }

        function startPortPolling() {
                if (portPollTimer || (!serialApi && !ipcRenderer)) return;
                refreshPortCache(true);
                portPollTimer = setInterval(() => refreshPortCache(false), portPollIntervalMs);
        }
        var serialDatasource = function (settings, updateCallback) {
                var self = this;
                var currentSettings = settings;
                var timer;
                // ipcRenderer is defined above
                let latestData = [];
                let portSyncInFlight = null;
                // Pause handling to release the serial port on demand.
                const isPaused = () => !!(currentSettings && currentSettings.paused);

		const eol = unescape(currentSettings.eol || "\\n");
		const sep = currentSettings.separator || ":";

		async function pushDataHeaders() {
                        if (!currentSettings.portPath) return;
                        const raw = currentSettings.dataHeaders;
                        const full = Array.isArray(raw) ? raw.map(s => (s || '').trim()) : [];
                        // Strip trailing empty entries so the widget channel count stays accurate
                        let last = full.length - 1;
                        while (last >= 0 && full[last] === '') last--;
                        const headers = full.slice(0, last + 1);
                        try {
                                if (serialApi && serialApi.setHeaders) {
                                        await serialApi.setHeaders(currentSettings.portPath, headers, 'serialport_datasource');
                                } else if (ipcRenderer) {
                                        await ipcRenderer.invoke('set-serial-headers', {
                                                path: currentSettings.portPath,
                                                headers,
                                                type: 'serialport_datasource'
                                        });
                                }
                        } catch(e) {
                                console.error('Failed to set data headers:', e);
                        }
                }

        async function registerShutdownCommand() {
                        if (!currentSettings.portPath) return;
                        const cmd = (currentSettings.shutdownCommand || '').trim();
                        try {
                                if (serialApi && serialApi.registerSafetyCommand) {
                                        await serialApi.registerSafetyCommand(currentSettings.portPath, cmd || null);
                                } else if (ipcRenderer) {
                                        await ipcRenderer.invoke('register-safety-command', {
                                                path: currentSettings.portPath,
                                                command: cmd
                                        });
                                }
                        } catch (e) {
                                console.error('Failed to register shutdown command:', e);
                        }
                }

	async function openPort() {
                        if (isPaused()) return;
			try {
                                await openSerialPort({
                                        path: currentSettings.portPath,
                                        baudRate: currentSettings.baudRate,
                                        separator: currentSettings.separator,
                                        eol: currentSettings.eol,
                                        type: 'serialport_datasource'
                                });
			} catch (e) {
				logSerial('error', `Open failed for ${currentSettings.portPath} @ ${currentSettings.baudRate}baud —`, e.message || e);
			}
                        await pushDataHeaders();
                        await registerShutdownCommand();
		}

                async function syncPortState(portOptions) {
                        if (!currentSettings.portPath) return;
                        if (isPaused()) return;
                        if (portSyncInFlight) return portSyncInFlight;
                        portSyncInFlight = (async () => {
                                const path = currentSettings.portPath;
                                const portSet = new Set((portOptions || []).map((p) => normalizePortValue(p)).filter(Boolean));
                                const isOpen = await isSerialPortOpen(path).catch(() => false);
                                if (!portSet.has(path)) {
                                        if (isOpen) {
                                                logSerial('warn', `Port ${path} vanished from the OS port list while open — device likely unplugged or lost power. Closing.`);
                                                await closeSerialPort(path).catch(() => {});
                                        }
                                        return;
                                }
                                if (!isOpen) {
                                        logSerial('warn', `Port ${path} is in the OS port list but not open in-app — attempting reopen.`);
                                        await openPort();
                                }
                        })();
                        try {
                                await portSyncInFlight;
                        } finally {
                                portSyncInFlight = null;
                        }
                }

                async function pollData() {
                        if (isPaused()) return;
                        try {
                                const data = await getSerialBuffer(currentSettings.portPath);
                                if (Array.isArray(data)) {
                                        latestData = data;
                                }
                        } catch (err) {
                                logSerial('error', `Failed to poll serial data for ${currentSettings.portPath}:`, err.message || err);
                        }
                }

		function stopTimer() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}

		function updateTimer() {
			stopTimer();
                        if (isPaused()) return;
			let interval = parseFloat(currentSettings.refresh);
			if (isNaN(interval) || interval < 50) interval = 1000; // min 50 ms
			timer = setInterval(() => {
				self.updateNow();
			}, interval);
		}

                this.updateNow = async function () {
                        if (isPaused()) return;
			const date = new Date();
                        await pollData();
                        const data = {
                                numeric_value: date.getTime(),
                                full_string_value: date.toLocaleString()
                        };
                        latestData.forEach((val, idx) => {
                                const key = `y${idx + 1}`;
                                data[key] = val;
                        });
                        updateCallback(data);
                };

                this.onPortListUpdate = function (portOptions) {
                        syncPortState(portOptions);
                };

                // Sends the configured idle/shutdown command (if any), then reboots
                // the MCU for real via mcumgr (see reset-device in main.js) — a true
                // hardware reset, not just an app-level idle command. No-ops if the
                // port isn't currently open.
                this.resetDevice = async function () {
                        const path = currentSettings.portPath;
                        const cmd = (currentSettings.shutdownCommand || '').trim();
                        if (!path) return;
                        try {
                                const open = await isSerialPortOpen(path).catch(() => false);
                                if (!open) {
                                        logSerial('warn', `Reset device skipped — port ${path} is not open.`);
                                        return;
                                }
                                logSerial('log', `Resetting ${path}${cmd ? ` (idle command "${cmd}" first)` : ''}...`);
                                if (serialApi && serialApi.resetDevice) {
                                        await serialApi.resetDevice(path, cmd);
                                } else if (ipcRenderer) {
                                        await ipcRenderer.invoke('reset-device', { path, idleCommand: cmd });
                                }
                                logSerial('log', `Reset command sequence complete for ${path}.`);
                        } catch (e) {
                                logSerial('error', `Failed to reset ${path}:`, e.message || e);
                        }
                };

		this.onDispose = function () {
			stopTimer();
                        instances.delete(self);
			if (currentSettings.portPath) {
				closeSerialPort(currentSettings.portPath).then(() => {
					logSerial('log', `Port ${currentSettings.portPath} closed via IPC (widget disposed).`);
				}).catch(err => {
					logSerial('error', `Failed to close port ${currentSettings.portPath}:`, err.message || err);
				});
			}
		};

               this.onSettingsChanged = function (newSettings) {
                       currentSettings = newSettings;
                       if (isPaused()) {
                               stopTimer();
                               if (currentSettings.portPath) {
                                       closeSerialPort(currentSettings.portPath).catch(() => {});
                               }
                               return;
                       }
                       updateTimer();
                       openPort();
                       syncPortState(cachedPortOptions);
                       pushDataHeaders();
               };

		stopTimer();
                if (!isPaused()) {
		        updateTimer();
		        openPort();
                }
                instances.add(this);
                syncPortState(cachedPortOptions);
	};

        async function registerPlugin() {
                startPortPolling();

freeboard.loadDatasourcePlugin({
                        type_name: "serialport_datasource",
                        display_name: "Serial Port Reader",
                        description: "Reads data from a serial port",
                        settings: [
                                {
                                        name: "portPath",
                                        display_name: "Port",
                                        type: "option",
                                        options: () => cachedPortOptions,
                                        optionsRefreshMs: portPollIntervalMs
                                },
			{
				name: "baudRate",
				display_name: "Baud Rate",
				type: "number",
				default_value: 115200
			},
			{
				name: "separator",
				display_name: "Separator",
				type: "text",
				default_value: ":"
			},
                        {
                                name: "eol",
                                display_name: "End of Line",
                                type: "text",
                                default_value: "\\r\\n"
                        },
                        {
                                name: "shutdownCommand",
                                display_name: "Shutdown Command",
                                description: "Sent to the board when Modular closes (e.g. d_i or i). Leave blank to skip.",
                                type: "text",
                                default_value: ""
                        },
                        {
                                name: "dataHeaders",
                                display_name: "Data Headers",
                                type: "channel_map",
                                channelCount: 8
                        },
                        {
                                name: "refresh",
                                display_name: "Refresh Every",
                                type: "number",
                                suffix: "ms",
				default_value: 1000
			}
		],
                newInstance: function (settings, newInstanceCallback, updateCallback) {
                        newInstanceCallback(new serialDatasource(settings, updateCallback));
                }
        });
        }

        registerPlugin();
}());
