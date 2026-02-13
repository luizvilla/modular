(function () {
        const api = window.api || null;
        const serialApi = api && api.serial ? api.serial : null;
        const ipcRenderer = !api && window.require ? window.require("electron")?.ipcRenderer : null;
        // Add a user-friendly tag for OwnTech devices without duplicating.
        function formatPortLabel(port) {
            if (port === null || port === undefined) return '';
            if (typeof port === 'string') return port;
            const base = String(port.name || port.value || port.path || '');
            if (!port.isOwntech) return base;
            return base.includes('(OwnTech)') ? base : `${base} (OwnTech)`;
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
                        console.error('Failed to refresh serial ports', e);
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
				console.error("Open serial failed:", e.message);
			}
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
                                                await closeSerialPort(path).catch(() => {});
                                        }
                                        return;
                                }
                                if (!isOpen) {
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
                                console.error("Failed to poll serial data:", err);
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

		this.onDispose = function () {
			stopTimer();
                        instances.delete(self);
			if (currentSettings.portPath) {
				closeSerialPort(currentSettings.portPath).then(() => {
					console.log("🔌 Serial port closed via IPC.");
				}).catch(err => {
					console.error("❌ Failed to close port:", err);
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

