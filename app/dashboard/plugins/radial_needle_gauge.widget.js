(function () {
    const gaugeFamily = window.ModularGaugeFamily;

    freeboard.loadWidgetPlugin({
        type_name: 'radial_needle_gauge',
        display_name: 'Radial Needle Gauge',
        description: 'Single-channel radial needle gauge with integrated source, zone, and alarm controls',
        icon: gaugeFamily && gaugeFamily.getTypeMeta ? gaugeFamily.getTypeMeta('radial_needle_gauge').icon : 'compass',
        category: 'Plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new gaugeFamily.SingleValueGaugeWidget('radial_needle_gauge', settings));
        }
    });
}());
