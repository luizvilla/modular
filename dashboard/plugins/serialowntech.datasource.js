(function () {
        const ipcRenderer = window.require?.("electron")?.ipcRenderer;
        // Keep a cached, auto-refreshing serial port list for dynamic dropdowns + reconnection.
        const instances = new Set();
        const portPollIntervalMs = 1500;
        let cachedPortOptions = [];
        let lastPortValues = [];
        let portPollTimer = null;

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
                if (!ipcRenderer) return;
                try {
                        const ports = await ipcRenderer.invoke('get-serial-ports');
                        const values = Array.isArray(ports) ? ports.map(normalizePortValue).filter(Boolean) : [];
                        if (!force && portsEqual(values, lastPortValues)) return;
                        lastPortValues = values;
                        cachedPortOptions = values.map((v) => ({ name: v, value: v }));
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
                if (portPollTimer || !ipcRenderer) return;
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

		const eol = unescape(currentSettings.eol || "\\n");
		const sep = currentSettings.separator || ":";

		async function openPort() {
			if (!ipcRenderer) return;
			try {
                                await ipcRenderer.invoke("open-serial-port", {
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
                        if (!ipcRenderer || !currentSettings.portPath) return;
                        if (portSyncInFlight) return portSyncInFlight;
                        portSyncInFlight = (async () => {
                                const path = currentSettings.portPath;
                                const portSet = new Set((portOptions || []).map((p) => normalizePortValue(p)).filter(Boolean));
                                const isOpen = await ipcRenderer.invoke('is-serial-port-open', { path }).catch(() => false);
                                if (!portSet.has(path)) {
                                        if (isOpen) {
                                                await ipcRenderer.invoke('close-serial-port', { path }).catch(() => {});
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
                        try {
                                const data = await ipcRenderer.invoke("get-serial-buffer", { path: currentSettings.portPath });
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
			let interval = parseFloat(currentSettings.refresh);
			if (isNaN(interval) || interval < 50) interval = 1000; // min 50 ms
			timer = setInterval(() => {
				self.updateNow();
			}, interval);
		}

                this.updateNow = async function () {
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
			if (ipcRenderer && currentSettings.portPath) {
				ipcRenderer.invoke("close-serial-port", {
					path: currentSettings.portPath
				}).then(() => {
					console.log("🔌 Serial port closed via IPC.");
				}).catch(err => {
					console.error("❌ Failed to close port:", err);
				});
			}
		};

               this.onSettingsChanged = function (newSettings) {
                       currentSettings = newSettings;
                       updateTimer();
                       openPort();
                       syncPortState(cachedPortOptions);
               };

		stopTimer();
		updateTimer();
		openPort();
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
