(function () {
    const gaugeFamily = window.ModularGaugeFamily;

    freeboard.loadWidgetPlugin({
        type_name: 'horizontal_gauge',
        display_name: 'Horizontal Gauge',
        description: 'Single-channel horizontal gauge with integrated source, zone, and alarm controls',
        icon: gaugeFamily && gaugeFamily.getTypeMeta ? gaugeFamily.getTypeMeta('horizontal_gauge').icon : 'grip-lines',
        category: 'Plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new gaugeFamily.SingleValueGaugeWidget('horizontal_gauge', settings));
        }
    });
}());
