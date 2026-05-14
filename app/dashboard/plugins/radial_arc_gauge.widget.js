(function () {
    const gaugeFamily = window.ModularGaugeFamily;

    freeboard.loadWidgetPlugin({
        type_name: 'radial_arc_gauge',
        display_name: 'Radial Arc Gauge',
        description: 'Single-channel radial arc gauge with integrated source, zone, and alarm controls',
        icon: gaugeFamily && gaugeFamily.getTypeMeta ? gaugeFamily.getTypeMeta('radial_arc_gauge').icon : 'gauge-high',
        category: 'Gauges',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new gaugeFamily.SingleValueGaugeWidget('radial_arc_gauge', settings));
        }
    });
}());
