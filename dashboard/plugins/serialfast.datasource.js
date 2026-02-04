(function () {
    const api = window.api || null;
    const serialApi = api && api.serial ? api.serial : null;
    const ipcRenderer = !api && window.require ? window.require('electron')?.ipcRenderer : null;
    function FastFrameDatasource(settings, updateCallback) {
        let currentSettings = settings;
        let timer = null;
        // Pause handling to release the serial port on demand.
        const isPaused = () => !!(currentSettings && currentSettings.paused);

        async function closePort() {
            if (!currentSettings?.portPath) return;
            try {
                if (serialApi && serialApi.closePort) {
                    await serialApi.closePort(currentSettings.portPath);
                } else if (ipcRenderer) {
                    await ipcRenderer.invoke('close-serial-port', { path: currentSettings.portPath });
                }
            } catch (e) {
                console.warn('Close serial failed:', e?.message || e);
            }
        }

        async function openPort() {
            if (isPaused()) return;
            try {
                const payload = {
                    path: currentSettings.portPath,
                    baudRate: currentSettings.baudRate,
                    separator: currentSettings.separator,
                    eol: currentSettings.eol,
                    type: 'fast_frame_datasource'
                };
                if (serialApi && serialApi.openPort) {
                    await serialApi.openPort(payload);
                } else if (ipcRenderer) {
                    await ipcRenderer.invoke('open-serial-port', payload);
                }
            } catch (e) {
                console.error('Open serial failed:', e.message);
            }
        }

        async function pollFrame() {
            if (isPaused()) return;
            try {
                const data = serialApi && serialApi.getFastDataset
                    ? await serialApi.getFastDataset(currentSettings.portPath)
                    : await ipcRenderer.invoke('get-fast-dataset', { path: currentSettings.portPath });
                if (data && Array.isArray(data.timestamps)) {
                    updateCallback(data);
                }
            } catch (e) {
                console.error('Failed to fetch fast frame:', e);
            }
        }

        function stopTimer() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }

        function updateTimer() {
            stopTimer();
            if (isPaused()) return;
            let interval = parseFloat(currentSettings.refresh);
            if (isNaN(interval) || interval < 50) interval = 1000;
            timer = setInterval(pollFrame, interval);
        }

        this.updateNow = pollFrame;

        this.onDispose = function () {
            stopTimer();
        };

        this.onSettingsChanged = function (newSettings) {
            currentSettings = newSettings;
            if (isPaused()) {
                stopTimer();
                closePort();
                return;
            }
            updateTimer();
            openPort();
        };

        if (!isPaused()) {
            updateTimer();
            openPort();
        }
    }

    async function register() {
        let portOptions = [];
        if (serialApi || ipcRenderer) {
            try {
                const ports = serialApi && serialApi.listPorts
                    ? await serialApi.listPorts()
                    : await ipcRenderer.invoke('get-serial-ports');
                portOptions = ports.map(p => ({ name: p.name, value: p.value }));
            } catch (e) {
                console.error('Failed to list serial ports', e);
            }
        }

        freeboard.loadDatasourcePlugin({
            type_name: 'fast_frame_datasource',
            display_name: 'Fast Serial Frame',
            description: 'Parse fast record frames from serial',
            settings: [
                {
                    name: 'portPath',
                    display_name: 'Port',
                    type: 'option',
                    options: portOptions,
                    default_value: portOptions.length ? portOptions[0].value : ''
                },
                { name: 'baudRate', display_name: 'Baud Rate', type: 'number', default_value: 115200 },
                { name: 'separator', display_name: 'Separator', type: 'text', default_value: ':' },
                { name: 'eol', display_name: 'End of Line', type: 'text', default_value: '\r\n' },
                { name: 'refresh', display_name: 'Refresh Every', type: 'number', suffix: 'ms', default_value: 1000 }
            ],
            newInstance: function (settings, newInstanceCallback, updateCallback) {
                newInstanceCallback(new FastFrameDatasource(settings, updateCallback));
            }
        });
    }

    register();
}());
