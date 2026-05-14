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
            height: 4,
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                valueSize: 'small',
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
            height: 3,
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                valueSize: 'small',
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
            height: 4,
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                valueSize: 'small',
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                sweepAngle: 180,
                startAnglePreset: 'left',
                valueSize: 'big'
            }
        },
        radial_needle_gauge: {
            displayName: 'Radial Needle Gauge',
            icon: 'compass',
            editorTitle: 'Edit radial_needle_gauge',
            family: 'radial_needle',
            height: 4,
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                valueSize: 'small',
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                sweepAngle: 180,
                startAnglePreset: 'left',
                valueSize: 'big',
                needleStyle: 'classic',
                showHub: true
            }
        },
        donut_gauge: {
            displayName: 'Donut Gauge',
            icon: 'circle-notch',
            editorTitle: 'Edit donut_gauge',
            family: 'donut',
            height: 4,
            defaults: {
                min: 0,
                max: 100,
                units: '',
                refreshRate: 500,
                showValue: true,
                showMinMax: true,
                valueSize: 'small',
                colorPalette: 'ColorBlind10',
                barColor: 'blue',
                alarmEnabled: false,
                alarmDirection: 'above',
                ringThickness: 'medium',
                valueSize: 'big'
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
        merged.valueSize = normalizeValueSize(merged.valueSize || merged.centerValueSize || defaults.valueSize || 'small');
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
        if (value === '' || value == null) return undefined;
        const next = Number(value);
        return Number.isFinite(next) ? next : undefined;
    }

    function normalizeValueSize(value) {
        if (value === 'large') return 'big';
        return value === 'big' ? 'big' : 'small';
    }

    function resolveBarColor(value) {
        if (typeof value === 'string' && value.startsWith('#')) return value;
        return COLOR_MAP[value] || COLOR_MAP.blue;
    }

    function hasConfiguredZones(settings) {
        return !!settings.alarmEnabled
            && Number.isFinite(settings.warningThreshold)
            && Number.isFinite(settings.criticalThreshold);
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

    function createIpcShim(apiRef) {
        if (!apiRef) return null;
        const serial = apiRef.serial || null;
        const can = apiRef.can || null;
        if (!serial && !can) return null;
        return {
            invoke: async (channel, payload = {}) => {
                switch (channel) {
                    case 'get-serial-buffer':
                        return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
                    case 'get-fast-dataset':
                        return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'can-aggregate-snapshot':
                        return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
                    default:
                        return null;
                }
            }
        };
    }

    function parseSourceDef(raw) {
        let sourceDef = raw;
        if (typeof raw === 'function') sourceDef = raw();
        if (!sourceDef) return null;
        if (typeof sourceDef === 'string') {
            try { sourceDef = JSON.parse(sourceDef); } catch { return null; }
        }
        return sourceDef && typeof sourceDef === 'object' ? sourceDef : null;
    }

    function buildTrackZones(container, settings, orientation) {
        const segments = buildZoneSegments(settings);
        container.empty();
        const span = settings.max - settings.min || 1;
        segments.forEach((segment) => {
            const ratio = clamp((segment.end - segment.start) / span, 0, 1);
            const offset = clamp((segment.start - settings.min) / span, 0, 1);
            const zone = $('<div class="gauge-track__zone"></div>').css('background-color', segment.color);
            if (orientation === 'vertical') {
                zone.css({
                    height: `${(ratio * 100).toFixed(3)}%`,
                    bottom: `${(offset * 100).toFixed(3)}%`
                });
            } else {
                zone.css({
                    width: `${(ratio * 100).toFixed(3)}%`,
                    left: `${(offset * 100).toFixed(3)}%`
                });
            }
            container.append(zone);
        });
    }

    function getArcGeometry(widget) {
        if (widget.family === 'donut') {
            return {
                viewBox: '0 0 220 220',
                centerX: 110,
                centerY: 110,
                radius: 84,
                startAngle: 210,
                endAngle: 510
            };
        }

        const sweepAngle = parseNumber(widget.normalizedSettings.sweepAngle, 180) === 270 ? 270 : 180;
        return {
            viewBox: sweepAngle === 270 ? '0 0 220 200' : '0 0 220 160',
            centerX: 110,
            centerY: sweepAngle === 270 ? 100 : 110,
            radius: 76,
            startAngle: sweepAngle === 270 ? 225 : 270,
            endAngle: sweepAngle === 270 ? 495 : 450
        };
    }

    function createSvg(tag, attrs) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.keys(attrs || {}).forEach((key) => element.setAttribute(key, attrs[key]));
        return $(element);
    }

    function buildArcZones(group, settings, geometry, strokeWidth) {
        group.empty();
        buildZoneSegments(settings).forEach((segment) => {
            const start = geometry.startAngle + (toRatio(settings, segment.start) * (geometry.endAngle - geometry.startAngle));
            const end = geometry.startAngle + (toRatio(settings, segment.end) * (geometry.endAngle - geometry.startAngle));
            group.append(createSvg('path', {
                d: describeArcPath(geometry.centerX, geometry.centerY, geometry.radius, start, end),
                fill: 'none',
                stroke: segment.color,
                'stroke-width': strokeWidth,
                'stroke-linecap': 'butt'
            }));
        });
    }

    function updateArcMask(path, settings, geometry, ratio, strokeWidth) {
        const clamped = clamp(ratio, 0, 1);
        const currentAngle = geometry.startAngle + clamped * (geometry.endAngle - geometry.startAngle);
        if (clamped >= 0.999) {
            path.attr('d', '');
            return;
        }
        path.attr({
            d: describeArcPath(geometry.centerX, geometry.centerY, geometry.radius, currentAngle, geometry.endAngle),
            fill: 'none',
            stroke: 'rgba(17, 24, 39, 0.88)',
            'stroke-width': strokeWidth,
            'stroke-linecap': 'butt'
        });
    }

    const RENDERERS = {
        vertical: {
            build(widget) {
                widget.trackWrapEl = $('<div class="gauge-track-wrap gauge-track-wrap--vertical"></div>');
                widget.trackEl = $('<div class="gauge-track gauge-track--vertical"></div>');
                widget.zoneLayerEl = $('<div class="gauge-track__zones gauge-track__zones--vertical"></div>');
                widget.coverEl = $('<div class="gauge-track__cover gauge-track__cover--vertical"></div>');
                widget.rangeEl = $('<div class="gauge-range gauge-range--vertical"></div>');
                widget.maxEl = $('<div class="gauge-range__label"></div>');
                widget.minEl = $('<div class="gauge-range__label"></div>');
                widget.rangeEl.append(widget.maxEl, widget.minEl);
                widget.trackEl.append(widget.zoneLayerEl, widget.coverEl);
                widget.trackWrapEl.append(widget.trackEl, widget.rangeEl);
                widget.bodyEl.append(widget.trackWrapEl);
                widget.container.append(widget.valueEl);
            },
            applySettings(widget) {
                buildTrackZones(widget.zoneLayerEl, widget.normalizedSettings, 'vertical');
                widget.maxEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.max, widget.normalizedSettings.units) : '');
                widget.minEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.min, widget.normalizedSettings.units) : '');
                widget.rangeEl.toggle(widget.normalizedSettings.showMinMax);
            },
            updateValue(widget, value) {
                widget.coverEl.css('height', `${((1 - toRatio(widget.normalizedSettings, value)) * 100).toFixed(2)}%`);
            }
        },
        horizontal: {
            build(widget) {
                widget.valueStripEl = $('<div class="gauge-horizontal__value-strip"></div>');
                widget.trackEl = $('<div class="gauge-track gauge-track--horizontal"></div>');
                widget.zoneLayerEl = $('<div class="gauge-track__zones gauge-track__zones--horizontal"></div>');
                widget.coverEl = $('<div class="gauge-track__cover gauge-track__cover--horizontal"></div>');
                widget.rangeStripEl = $('<div class="gauge-range gauge-range--horizontal"></div>');
                widget.minEl = $('<div class="gauge-range__label"></div>');
                widget.maxEl = $('<div class="gauge-range__label"></div>');
                widget.rangeStripEl.append(widget.minEl, widget.maxEl);
                widget.trackEl.append(widget.zoneLayerEl, widget.coverEl);
                widget.bodyEl.append(widget.valueStripEl, widget.trackEl, widget.rangeStripEl);
            },
            applySettings(widget) {
                buildTrackZones(widget.zoneLayerEl, widget.normalizedSettings, 'horizontal');
                widget.maxEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.max, widget.normalizedSettings.units) : '');
                widget.minEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.min, widget.normalizedSettings.units) : '');
                widget.rangeStripEl.toggle(widget.normalizedSettings.showMinMax);
                widget.valueStripEl.toggleClass('gauge-horizontal__value-strip--bottom', widget.normalizedSettings.labelPosition === 'bottom');
                widget.container.toggleClass('gauge-family--compact', !!widget.normalizedSettings.compactMode);
            },
            updateValue(widget, value) {
                const ratio = toRatio(widget.normalizedSettings, value);
                if (widget.normalizedSettings.fillDirection === 'rtl') {
                    widget.coverEl.css({ width: `${((1 - ratio) * 100).toFixed(2)}%`, left: '0', right: 'auto' });
                } else {
                    widget.coverEl.css({ width: `${((1 - ratio) * 100).toFixed(2)}%`, right: '0', left: 'auto' });
                }
            }
        },
        radial_arc: {
            build(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl = createSvg('svg', { viewBox: widget.geometry.viewBox, class: 'gauge-radial-svg' });
                widget.zoneGroupEl = createSvg('g', {});
                widget.coverPathEl = createSvg('path', {});
                widget.valueOverlayEl = $('<div class="gauge-radial__value-overlay gauge-radial__value-overlay--arc"></div>');
                widget.valueCenterEl = $('<div class="gauge-radial__value-center"></div>');
                widget.valueOverlayEl.append(widget.valueCenterEl);
                widget.minEl = $('<div class="gauge-range__label"></div>');
                widget.maxEl = $('<div class="gauge-range__label"></div>');
                widget.rangeStripEl = $('<div class="gauge-range gauge-range--horizontal"></div>').append(widget.minEl, widget.maxEl);
                widget.svgEl.append(widget.zoneGroupEl, widget.coverPathEl);
                widget.bodyEl.append($('<div class="gauge-radial__canvas"></div>').append(widget.svgEl, widget.valueOverlayEl), widget.rangeStripEl);
            },
            applySettings(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl.attr('viewBox', widget.geometry.viewBox);
                const strokeWidth = 20;
                buildArcZones(widget.zoneGroupEl, widget.normalizedSettings, widget.geometry, strokeWidth);
                widget.minEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.min, widget.normalizedSettings.units) : '');
                widget.maxEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.max, widget.normalizedSettings.units) : '');
                widget.rangeStripEl.toggle(widget.normalizedSettings.showMinMax);
                widget.valueCenterEl.removeClass('gauge-value--small gauge-value--big')
                    .addClass(widget.normalizedSettings.valueSize === 'big' ? 'gauge-value--big' : 'gauge-value--small');
            },
            updateValue(widget, value) {
                updateArcMask(widget.coverPathEl, widget.normalizedSettings, widget.geometry, toRatio(widget.normalizedSettings, value), 20);
            }
        },
        donut: {
            build(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl = createSvg('svg', { viewBox: widget.geometry.viewBox, class: 'gauge-radial-svg' });
                widget.zoneGroupEl = createSvg('g', {});
                widget.coverPathEl = createSvg('path', {});
                widget.valueOverlayEl = $('<div class="gauge-radial__value-overlay gauge-radial__value-overlay--donut"></div>');
                widget.valueCenterEl = $('<div class="gauge-radial__value-center"></div>');
                widget.valueOverlayEl.append(widget.valueCenterEl);
                widget.minEl = $('<div class="gauge-range__label"></div>');
                widget.maxEl = $('<div class="gauge-range__label"></div>');
                widget.rangeStripEl = $('<div class="gauge-range gauge-range--horizontal"></div>').append(widget.minEl, widget.maxEl);
                widget.svgEl.append(widget.zoneGroupEl, widget.coverPathEl);
                widget.bodyEl.append($('<div class="gauge-radial__canvas"></div>').append(widget.svgEl, widget.valueOverlayEl), widget.rangeStripEl);
            },
            applySettings(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl.attr('viewBox', widget.geometry.viewBox);
                const strokeWidth = widget.normalizedSettings.ringThickness === 'thin' ? 16 : widget.normalizedSettings.ringThickness === 'thick' ? 30 : 22;
                buildArcZones(widget.zoneGroupEl, widget.normalizedSettings, widget.geometry, strokeWidth);
                widget.minEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.min, widget.normalizedSettings.units) : '');
                widget.maxEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.max, widget.normalizedSettings.units) : '');
                widget.rangeStripEl.toggle(widget.normalizedSettings.showMinMax);
                widget.valueCenterEl.removeClass('gauge-value--small gauge-value--big')
                    .addClass(widget.normalizedSettings.valueSize === 'big' ? 'gauge-value--big' : 'gauge-value--small');
                widget._donutStrokeWidth = strokeWidth;
            },
            updateValue(widget, value) {
                updateArcMask(widget.coverPathEl, widget.normalizedSettings, widget.geometry, toRatio(widget.normalizedSettings, value), widget._donutStrokeWidth || 22);
            }
        },
        radial_needle: {
            build(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl = createSvg('svg', { viewBox: widget.geometry.viewBox, class: 'gauge-radial-svg' });
                widget.zoneGroupEl = createSvg('g', {});
                widget.needleEl = createSvg('line', { 'stroke-width': 6, 'stroke-linecap': 'round' });
                widget.hubEl = createSvg('circle', { r: 8 });
                widget.valueOverlayEl = $('<div class="gauge-radial__value-overlay gauge-radial__value-overlay--needle"></div>');
                widget.valueCenterEl = $('<div class="gauge-radial__value-center"></div>');
                widget.valueOverlayEl.append(widget.valueCenterEl);
                widget.minEl = $('<div class="gauge-range__label"></div>');
                widget.maxEl = $('<div class="gauge-range__label"></div>');
                widget.rangeStripEl = $('<div class="gauge-range gauge-range--horizontal"></div>').append(widget.minEl, widget.maxEl);
                widget.svgEl.append(widget.zoneGroupEl, widget.needleEl, widget.hubEl);
                widget.bodyEl.append($('<div class="gauge-radial__canvas"></div>').append(widget.svgEl, widget.valueOverlayEl), widget.rangeStripEl);
            },
            applySettings(widget) {
                widget.geometry = getArcGeometry(widget);
                widget.svgEl.attr('viewBox', widget.geometry.viewBox);
                buildArcZones(widget.zoneGroupEl, widget.normalizedSettings, widget.geometry, 18);
                widget.minEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.min, widget.normalizedSettings.units) : '');
                widget.maxEl.text(widget.normalizedSettings.showMinMax ? formatValue(widget.normalizedSettings.max, widget.normalizedSettings.units) : '');
                widget.rangeStripEl.toggle(widget.normalizedSettings.showMinMax);
                widget.valueCenterEl.removeClass('gauge-value--small gauge-value--big')
                    .addClass(widget.normalizedSettings.valueSize === 'big' ? 'gauge-value--big' : 'gauge-value--small');
                widget.hubEl.attr({
                    cx: widget.geometry.centerX,
                    cy: widget.geometry.centerY,
                    fill: widget.normalizedSettings.showHub === false ? 'transparent' : '#d1d5db'
                });
            },
            updateValue(widget, value) {
                const ratio = toRatio(widget.normalizedSettings, value);
                const angle = widget.geometry.startAngle + ratio * (widget.geometry.endAngle - widget.geometry.startAngle);
                const end = polarToCartesian(widget.geometry.centerX, widget.geometry.centerY, widget.geometry.radius - 18, angle);
                widget.needleEl.attr({
                    x1: widget.geometry.centerX,
                    y1: widget.geometry.centerY,
                    x2: end.x,
                    y2: end.y,
                    stroke: resolveValueColor(widget.normalizedSettings, value)
                });
            }
        }
    };

    class SingleValueGaugeWidget {
        constructor(type, settings) {
            this.type = type;
            this.meta = getTypeMeta(type);
            this.family = this.meta.family;
            this.settings = settings;
            this.shared = getPlotEditorShared();
            this.ipc = createIpcShim(window.api || null);
            this.container = $('<div class="gauge-family"></div>');
            this.titleEl = $('<div class="gauge-family__title"></div>');
            this.summaryEl = $('<div class="gauge-family__summary small text-muted">Configure source.</div>');
            this.sourceSummaryEl = this.summaryEl;
            this.bodyEl = $('<div class="gauge-family__body"></div>');
            this.valueEl = $('<div class="gauge-family__value"></div>');
            this.timer = null;
            this.currentValue = null;
            this._summaryRequestId = 0;
            this.renderer = RENDERERS[this.family] || RENDERERS.vertical;
            this.normalizedSettings = normalizeSettings(type, settings);
            this._built = false;
        }

        render(el) {
            const host = $(el);
            host.addClass('gauge-family-host');
            if (!this._built) {
                this.container.addClass(`gauge-family--${this.family}`);
                this.container.append(this.titleEl, this.summaryEl, this.bodyEl);
                this.renderer.build(this);
                host.append(this.container);
                this._built = true;
            } else {
                host.append(this.container);
            }
            this._applySettings();
            this._refreshSourceSummary();
            this._restartTimer();
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this.normalizedSettings = normalizeSettings(this.type, newSettings);
            this._applySettings();
            this._refreshSourceSummary();
            this._restartTimer();
        }

        onDispose() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        }

        getHeight() {
            return this.meta.height || 4;
        }

        _applySettings() {
            this.normalizedSettings = normalizeSettings(this.type, this.settings);
            this.titleEl.text(this.normalizedSettings.title || this.meta.displayName);
            this.container.toggleClass('gauge-family--show-minmax', this.normalizedSettings.showMinMax);
            this.renderer.applySettings(this);
            this._applyValueDisplay(this.currentValue);
        }

        _applyValueDisplay(value) {
            const showValue = this.normalizedSettings.showValue !== false;
            this.valueEl.toggle(showValue);
            this.valueEl.removeClass('gauge-value--small gauge-value--big')
                .addClass(this.normalizedSettings.valueSize === 'big' ? 'gauge-value--big' : 'gauge-value--small');
            if (!showValue) return;
            const text = value == null ? '--' : formatValue(value, this.normalizedSettings.units);
            this.valueEl.text(text);
            if (this.valueCenterEl) this.valueCenterEl.text(text);
            if (this.valueStripEl) this.valueStripEl.text(text);
        }

        async _refreshSourceSummary() {
            const requestId = ++this._summaryRequestId;
            const sourceDef = this._getSourceDef();
            if (!sourceDef || !sourceDef.ds) {
                this.summaryEl.text('Configure source.');
                return;
            }
            try {
                const label = await describeSourceSummary(sourceDef);
                if (requestId !== this._summaryRequestId) return;
                this.summaryEl.text(label || 'Configure source.');
            } catch {
                if (requestId !== this._summaryRequestId) return;
                this.summaryEl.text(sourceDef.ds || 'Configure source.');
            }
        }

        _restartTimer() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.timer = setInterval(() => this._pollOnce(), this.normalizedSettings.refreshRate);
            this._pollOnce();
        }

        async _pollOnce() {
            const sourceDef = this._getSourceDef();
            if (!sourceDef || !sourceDef.ds) return;
            try {
                const value = await this._readInstantValue(sourceDef);
                if (value != null && Number.isFinite(value)) this._updateValue(value);
            } catch {}
        }

        _updateValue(value) {
            this.currentValue = value;
            this.renderer.updateValue(this, value);
            this._applyValueDisplay(value);
            this._applyAlarmState(value);
        }

        _applyAlarmState(value) {
            if (!this.normalizedSettings.alarmEnabled) {
                this.container.removeClass('gauge-family--alarm');
                return;
            }
            this.container.toggleClass('gauge-family--alarm', getZoneState(this.normalizedSettings, value) === 'critical');
        }

        _getSourceDef() {
            return parseSourceDef(this.settings.sourceDef);
        }

        async _readInstantValue(sourceDef) {
            const shared = this.shared || getPlotEditorShared();
            if (!sourceDef || !sourceDef.ds || !shared || typeof shared.invoke !== 'function') return null;
            if (sourceDef.type === 'serialport_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const path = dsSettings.portPath || sourceDef.ds;
                const arr = await shared.invoke('get-serial-buffer', { path });
                const idx = Number(sourceDef.var);
                return Array.isArray(arr) ? Number(arr[idx]) : null;
            }
            if (sourceDef.type === 'fast_frame_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const path = dsSettings.portPath || sourceDef.ds;
                const data = await shared.invoke('get-fast-dataset', { path });
                const idx = Number(sourceDef.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            }
            if (sourceDef.type === 'can_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const channel = dsSettings.channel || 'can0';
                const snap = await shared.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap && snap.nodes ? snap.nodes : {};
                const resolved = this._resolveDeviceKey(nodes, sourceDef.device, sourceDef.device_uid || sourceDef.deviceUid);
                if (!resolved) return null;
                const flat = nodes[resolved] && nodes[resolved].flat ? nodes[resolved].flat : {};
                return Number(flat[sourceDef.var]);
            }
            if (sourceDef.type === 'signal_generator_datasource') {
                const live = window.freeboard && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
                const data = live && live.datasourceData ? live.datasourceData[sourceDef.ds] : null;
                if (data && data.y1 != null) return Number(data.y1);
                if (data && data.value != null) return Number(data.value);
                return null;
            }
            return null;
        }

        _resolveDeviceKey(nodes, desired, desiredUid) {
            if (!nodes) return null;
            if (desired && nodes[desired]) return desired;
            if (desiredUid) {
                const key = Object.keys(nodes).find((candidate) => nodes[candidate] && nodes[candidate].node_uid === desiredUid);
                if (key) return key;
            }
            return Object.keys(nodes)[0] || null;
        }
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
        describeSourceSummary,
        SingleValueGaugeWidget
    };
}());
