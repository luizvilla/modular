(function () {
    'use strict';

    if (typeof freeboard === 'undefined') {
        console.warn('[test-bundle] freeboard not available — widget skipped');
        return;
    }

    freeboard.loadDatasourcePlugin({
        type_name: 'test_bundle_datasource',
        display_name: 'Test Bundle Source',
        description: 'Minimal datasource from an installed test bundle.',
        settings: [
            { name: 'value', display_name: 'Value', type: 'text', default_value: '42' }
        ],
        newInstance: function (settings, newInstanceCallback, updateCallback) {
            var instance = {
                updateNow: function () {
                    updateCallback({ value: Number(settings.value) || 0 });
                },
                onDispose: function () {}
            };
            newInstanceCallback(instance);
        }
    });

    freeboard.loadWidgetPlugin({
        type_name: 'test_bundle_widget',
        display_name: 'Test Bundle Widget',
        description: 'Minimal widget loaded from an installed bundle — proves the install pipeline works.',
        fill_size: false,
        settings: [
            { name: 'label', display_name: 'Label', type: 'text', default_value: 'Installed Bundle' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new TestBundleWidget(settings));
        }
    });

    function TestBundleWidget(settings) {
        var el = document.createElement('div');
        el.style.cssText = 'padding:12px;text-align:center;color:#a0c4a0;font-size:13px;';
        el.innerHTML = '<div style="font-size:24px;margin-bottom:6px;">📦</div>' +
                       '<div><strong>' + (settings.label || 'Installed Bundle') + '</strong></div>' +
                       '<div style="color:#666;font-size:11px;margin-top:4px;">test-bundle v1.0.0</div>';

        this.render = function (container) { container.appendChild(el); };
        this.getHeight = function () { return 2; };
        this.onSettingsChanged = function (newSettings) {
            el.querySelector('strong').textContent = newSettings.label || 'Installed Bundle';
        };
        this.onCalculatedValueChanged = function () {};
        this.onDispose = function () {};
    }
})();
