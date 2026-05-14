(function () {
    const gaugeFamily = window.ModularGaugeFamily;

    freeboard.loadWidgetPlugin({
        type_name: 'donut_gauge',
        display_name: 'Donut Gauge',
        description: 'Single-channel donut gauge with integrated source, zone, and alarm controls',
        icon: gaugeFamily && gaugeFamily.getTypeMeta ? gaugeFamily.getTypeMeta('donut_gauge').icon : 'circle-notch',
        category: 'Gauges',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new gaugeFamily.SingleValueGaugeWidget('donut_gauge', settings));
        }
    });
}());
