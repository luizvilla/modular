(function () {
    function getPlotEditorShared() {
        return window.ModularPlotEditorShared
            || (window.freeboard && typeof window.freeboard.getPlotEditorShared === 'function'
                ? window.freeboard.getPlotEditorShared()
                : null);
    }

    const COLOR_MAP = {
        blue: '#3b82f6',
        green: '#22c55e',
        orange: '#f97316',
        purple: '#a855f7',
        teal: '#14b8a6',
        yellow: '#eab308',
        gray: '#9ca3af',
        white: '#f8fafc'
    };

    const ZONE_COLORS = {
        normal: '#36c2ae',
        warning: '#ffd154',
        critical: '#ff425a'
    };

    const TYPE_META = {
        vertical_gauge: {
            displayName: 'Vertical Gauge',
            icon: 'gauge-high',
            editorTitle: 'Edit vertical_gauge',
            family: 'vertical',
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above'
            }
        },
        horizontal_gauge: {
            displayName: 'Horizontal Gauge',
            icon: 'grip-lines',
            editorTitle: 'Edit horizontal_gauge',
            family: 'horizontal',
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                compactMode: false,
                labelPosition: 'top',
                fillDirection: 'ltr'
            }
        },
        radial_arc_gauge: {
            displayName: 'Radial Arc Gauge',
            icon: 'gauge-high',
            editorTitle: 'Edit radial_arc_gauge',
            family: 'radial_arc',
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                sweepAngle: 180,
                startAnglePreset: 'left',
                centerValueSize: 'large'
            }
        },
        radial_needle_gauge: {
            displayName: 'Radial Needle Gauge',
            icon: 'compass',
            editorTitle: 'Edit radial_needle_gauge',
            family: 'radial_needle',
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                sweepAngle: 180,
                startAnglePreset: 'left',
                centerValueSize: 'large',
                needleStyle: 'classic',
                showHub: true
            }
        },
        donut_gauge: {
            displayName: 'Donut Gauge',
            icon: 'circle-notch',
            editorTitle: 'Edit donut_gauge',
            family: 'donut',
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                ringThickness: 'medium',
                centerValueSize: 'large'
            }
        }
    };

    function resolveSetting(settings, key) {
        const value = settings ? settings[key] : undefined;
        return typeof value === 'function' ? value() : value;
    }

    function parseNumber(value, fallback) {
        const next = Number(value);
        return Number.isFinite(next) ? next : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getTypeMeta(type) {
        return TYPE_META[type] || TYPE_META.vertical_gauge;
    }

    function normalizeSettings(type, rawSettings) {
        const meta = getTypeMeta(type);
        const defaults = meta.defaults || {};
        const resolved = {};
        Object.keys(defaults).forEach((key) => {
            resolved[key] = resolveSetting(rawSettings, key);
        });
        const merged = Object.assign({}, defaults, rawSettings || {}, resolved);
        merged.type = type;
        merged.title = merged.title || meta.displayName;
        merged.min = parseNumber(merged.min, defaults.min || 0);
        merged.max = parseNumber(merged.max, defaults.max || 100);
        if (merged.max === merged.min) merged.max = merged.min + 1;
        merged.refreshRate = Math.max(50, parseNumber(merged.refreshRate, defaults.refreshRate || 500));
        merged.showValue = merged.showValue !== false;
        merged.showMinMax = merged.showMinMax !== false;
        merged.alarmEnabled = !!merged.alarmEnabled;
        merged.alarmDirection = merged.alarmDirection === 'below' ? 'below' : 'above';
        merged.units = merged.units || '';
        merged.barColor = merged.barColor || defaults.barColor || 'blue';
        merged.colorPalette = merged.colorPalette || defaults.colorPalette || 'ColorBlind10';
        merged.warningThreshold = parseFiniteOrUndefined(merged.warningThreshold);
        merged.criticalThreshold = parseFiniteOrUndefined(merged.criticalThreshold);
        return merged;
    }

    function parseFiniteOrUndefined(value) {
        const next = Number(value);
        return Number.isFinite(next) ? next : undefined;
    }

    function resolveBarColor(value) {
        if (typeof value === 'string' && value.startsWith('#')) return value;
        return COLOR_MAP[value] || COLOR_MAP.blue;
    }

    function hasConfiguredZones(settings) {
        return Number.isFinite(settings.warningThreshold) && Number.isFinite(settings.criticalThreshold);
    }

    function normalizeThresholds(settings) {
        if (!hasConfiguredZones(settings)) return null;
        const min = settings.min;
        const max = settings.max;
        const warning = clamp(settings.warningThreshold, min, max);
        const critical = clamp(settings.criticalThreshold, min, max);
        return settings.alarmDirection === 'below'
            ? {
                normalStart: Math.max(warning, critical),
                warningStart: Math.max(Math.min(warning, critical), min),
                criticalStart: min
            }
            : {
                normalStart: min,
                warningStart: Math.min(warning, critical),
                criticalStart: Math.max(warning, critical)
            };
    }

    function buildZoneSegments(settings) {
        const span = settings.max - settings.min || 1;
        const thresholds = normalizeThresholds(settings);
        if (!thresholds) {
            return [{
                start: settings.min,
                end: settings.max,
                color: resolveBarColor(settings.barColor),
                key: 'normal'
            }];
        }

        if (settings.alarmDirection === 'below') {
            return [
                { start: settings.min, end: thresholds.warningStart, color: ZONE_COLORS.critical, key: 'critical' },
                { start: thresholds.warningStart, end: thresholds.normalStart, color: ZONE_COLORS.warning, key: 'warning' },
                { start: thresholds.normalStart, end: settings.max, color: ZONE_COLORS.normal, key: 'normal' }
            ].filter((segment) => segment.end > segment.start && (segment.end - segment.start) / span > 0);
        }

        return [
            { start: settings.min, end: thresholds.warningStart, color: ZONE_COLORS.normal, key: 'normal' },
            { start: thresholds.warningStart, end: thresholds.criticalStart, color: ZONE_COLORS.warning, key: 'warning' },
            { start: thresholds.criticalStart, end: settings.max, color: ZONE_COLORS.critical, key: 'critical' }
        ].filter((segment) => segment.end > segment.start && (segment.end - segment.start) / span > 0);
    }

    function getZoneState(settings, value) {
        if (!hasConfiguredZones(settings)) return 'normal';
        if (settings.alarmDirection === 'below') {
            if (value <= settings.criticalThreshold) return 'critical';
            if (value <= settings.warningThreshold) return 'warning';
            return 'normal';
        }
        if (value >= settings.criticalThreshold) return 'critical';
        if (value >= settings.warningThreshold) return 'warning';
        return 'normal';
    }

    function resolveValueColor(settings, value) {
        const zone = getZoneState(settings, value);
        if (zone === 'warning') return ZONE_COLORS.warning;
        if (zone === 'critical') return ZONE_COLORS.critical;
        if (hasConfiguredZones(settings)) return ZONE_COLORS.normal;
        return resolveBarColor(settings.barColor);
    }

    function toRatio(settings, value) {
        const span = settings.max - settings.min || 1;
        return clamp((value - settings.min) / span, 0, 1);
    }

    function formatValue(value, units) {
        if (value == null || !Number.isFinite(value)) return '--';
        let text;
        if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) text = value.toExponential(2);
        else text = (Math.round(value * 100) / 100).toString();
        return units ? `${text} ${units}` : text;
    }

    function polarToCartesian(cx, cy, radius, angleDeg) {
        const radians = (angleDeg - 90) * Math.PI / 180;
        return {
            x: cx + radius * Math.cos(radians),
            y: cy + radius * Math.sin(radians)
        };
    }

    function describeArcPath(cx, cy, radius, startAngle, endAngle) {
        const start = polarToCartesian(cx, cy, radius, endAngle);
        const end = polarToCartesian(cx, cy, radius, startAngle);
        const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? '1' : '0';
        return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    }

    async function describeSourceSummary(sourceDef) {
        if (!sourceDef || !sourceDef.ds) return 'Configure source.';
        const shared = getPlotEditorShared();
        if (!shared) return sourceDef.ds;
        const dsName = sourceDef.ds;
        const dsType = sourceDef.type || shared.getDatasourceType(dsName) || '';
        let variableLabel = '';
        let deviceLabel = '';

        try {
            const options = await shared.fetchDatasourceVariableOptions(dsName, sourceDef.device || '');
            const match = options.find((option) => String(option.value) === String(sourceDef.var));
            if (match) variableLabel = match.label;
        } catch {}

        if (!variableLabel) {
            if (dsType === 'signal_generator_datasource') variableLabel = 'Signal';
            else if (sourceDef.var != null && dsType === 'can_datasource') variableLabel = String(sourceDef.var);
            else if (sourceDef.var != null) variableLabel = `Channel ${Number(sourceDef.var) + 1}`;
        }

        if (dsType === 'can_datasource') {
            try {
                const devices = await shared.fetchCanDevices(dsName);
                const device = devices.find((entry) => entry.value === sourceDef.device || (sourceDef.device_uid && entry.uid === sourceDef.device_uid));
                deviceLabel = device ? device.label : (sourceDef.device || sourceDef.device_uid || '');
            } catch {}
        }

        if (deviceLabel) return `${dsName} / ${deviceLabel} / ${variableLabel}`;
        return variableLabel ? `${dsName} / ${variableLabel}` : dsName;
    }

    window.ModularGaugeFamily = {
        COLOR_MAP,
        ZONE_COLORS,
        TYPE_META,
        getPlotEditorShared,
        getTypeMeta,
        normalizeSettings,
        parseNumber,
        parseFiniteOrUndefined,
        clamp,
        resolveBarColor,
        hasConfiguredZones,
        normalizeThresholds,
        buildZoneSegments,
        getZoneState,
        resolveValueColor,
        toRatio,
        formatValue,
        polarToCartesian,
        describeArcPath,
        describeSourceSummary
    };
}());
