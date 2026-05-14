(function () {
    let gaugeID = 0;

    freeboard.addStyle('.legacy-gauge-widget-wrapper', 'width: 100%; text-align: center;');
    freeboard.addStyle('.legacy-gauge-widget', 'width: 200px; height: 160px; display: inline-block;');

    function LegacyGaugeWidget(settings) {
        const thisGaugeID = `legacy-gauge-${gaugeID++}`;
        const titleElement = $('<h2 class="section-title"></h2>');
        const gaugeElement = $(`<div class="legacy-gauge-widget" id="${thisGaugeID}"></div>`);

        let rendered = false;
        let currentSettings = settings;
        let gaugeObject;

        function createGauge() {
            if (!rendered || typeof JustGage === 'undefined') return;
            gaugeElement.empty();
            gaugeObject = new JustGage({
                id: thisGaugeID,
                value: _.isUndefined(currentSettings.min_value) ? 0 : currentSettings.min_value,
                min: _.isUndefined(currentSettings.min_value) ? 0 : currentSettings.min_value,
                max: _.isUndefined(currentSettings.max_value) ? 0 : currentSettings.max_value,
                label: currentSettings.units,
                showInnerShadow: false,
                valueFontColor: '#d3d4d4'
            });
        }

        this.render = function (element) {
            rendered = true;
            $(element).append(titleElement).append($('<div class="legacy-gauge-widget-wrapper"></div>').append(gaugeElement));
            createGauge();
        };

        this.onSettingsChanged = function (newSettings) {
            if (newSettings.min_value !== currentSettings.min_value || newSettings.max_value !== currentSettings.max_value || newSettings.units !== currentSettings.units) {
                currentSettings = newSettings;
                createGauge();
            } else {
                currentSettings = newSettings;
            }
            titleElement.html(newSettings.title);
        };

        this.onCalculatedValueChanged = function (settingName, newValue) {
            if (settingName === 'value' && !_.isUndefined(gaugeObject)) {
                gaugeObject.refresh(Number(newValue));
            }
        };

        this.onDispose = function () {};
        this.getHeight = function () { return 3; };
        this.onSettingsChanged(settings);
    }

    freeboard.loadWidgetPlugin({
        type_name: 'gauge',
        display_name: 'Gauge',
        description: 'Legacy dial gauge for existing dashboards',
        icon: 'gauge',
        compatibility_only: true,
        category: 'Plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            { name: 'value', display_name: 'Value', type: 'calculated' },
            { name: 'units', display_name: 'Units', type: 'text' },
            { name: 'min_value', display_name: 'Minimum', type: 'text', default_value: 0 },
            { name: 'max_value', display_name: 'Maximum', type: 'text', default_value: 100 }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new LegacyGaugeWidget(settings));
        }
    });
}());
