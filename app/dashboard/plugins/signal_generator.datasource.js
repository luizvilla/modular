(function () {
    const PHASE_EPOCH_SEC = Date.now() / 1000;

    function waveValue(waveform, t, freq, phaseRad, duty) {
        const phase = (freq * t) + (phaseRad / (2 * Math.PI));
        const frac = phase - Math.floor(phase);
        switch (waveform) {
            case 'square':
                return frac < duty ? 1 : -1;
            case 'triangle':
                return frac < 0.5 ? (frac * 4 - 1) : (3 - frac * 4);
            case 'sawtooth':
                return frac * 2 - 1;
            case 'random':
                return (Math.random() * 2 - 1);
            case 'sine':
            default:
                return Math.sin(2 * Math.PI * freq * t + phaseRad);
        }
    }

    function SignalGenerator(settings, updateCallback) {
        let currentSettings = settings;
        let timer = null;

        const restartTimer = () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            let interval = Number(currentSettings.refresh);
            if (!isFinite(interval) || interval < 20) interval = 100;
            timer = setInterval(() => {
                self.updateNow();
            }, interval);
        };

        const self = this;

        this.updateNow = function () {
            const nowSec = Date.now() / 1000;
            const t = nowSec - PHASE_EPOCH_SEC;
            const waveform = currentSettings.waveform || 'sine';
            const freq = Number(currentSettings.frequency) || 0;
            const amp = Number(currentSettings.amplitude) || 0;
            const offset = Number(currentSettings.offset) || 0;
            const phaseDeg = Number(currentSettings.phase) || 0;
            const phaseRad = (phaseDeg * Math.PI) / 180;
            const dutyPct = Number(currentSettings.dutyCycle);
            const duty = isFinite(dutyPct) ? Math.max(0, Math.min(1, dutyPct / 100)) : 0.5;

            const raw = waveValue(waveform, t, freq, phaseRad, duty);
            const value = offset + amp * raw;
            updateCallback({
                numeric_value: nowSec * 1000,
                y1: value,
                value
            });
        };

        this.onSettingsChanged = function (newSettings) {
            currentSettings = newSettings;
            restartTimer();
            self.updateNow();
        };

        this.onDispose = function () {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        };

        this.updateNow();
        restartTimer();
    }

    freeboard.loadDatasourcePlugin({
        type_name: 'signal_generator_datasource',
        display_name: 'Signal Generator',
        description: 'Dummy signal generator for testing (single channel)',
        settings: [
            {
                name: 'waveform',
                display_name: 'Waveform',
                type: 'option',
                default_value: 'sine',
                options: [
                    { name: 'Sine', value: 'sine' },
                    { name: 'Square', value: 'square' },
                    { name: 'Triangle', value: 'triangle' },
                    { name: 'Sawtooth', value: 'sawtooth' },
                    { name: 'Random', value: 'random' }
                ]
            },
            { name: 'amplitude', display_name: 'Amplitude', type: 'number', default_value: 1 },
            { name: 'offset', display_name: 'Offset', type: 'number', default_value: 0 },
            { name: 'frequency', display_name: 'Frequency (Hz)', type: 'number', default_value: 1 },
            { name: 'phase', display_name: 'Phase Shift (deg)', type: 'number', default_value: 0 },
            { name: 'dutyCycle', display_name: 'Duty Cycle (%)', type: 'number', default_value: 50 },
            { name: 'refresh', display_name: 'Refresh Every (ms)', type: 'number', default_value: 100 }
        ],
        newInstance: function (settings, newInstanceCallback, updateCallback) {
            newInstanceCallback(new SignalGenerator(settings, updateCallback));
        }
    });
}());
