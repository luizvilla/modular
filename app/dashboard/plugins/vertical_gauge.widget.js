(function () {
    const gaugeFamily = window.ModularGaugeFamily;

    freeboard.loadWidgetPlugin({
        type_name: 'vertical_gauge',
        display_name: 'Vertical Gauge',
        description: 'Single-channel vertical gauge with integrated source, zone, and alarm controls',
        icon: gaugeFamily && gaugeFamily.getTypeMeta ? gaugeFamily.getTypeMeta('vertical_gauge').icon : 'gauge-high',
        category: 'Plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new gaugeFamily.SingleValueGaugeWidget('vertical_gauge', settings));
        }
    });
}());
