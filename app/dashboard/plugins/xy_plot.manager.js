(function () {
    freeboard.loadWidgetPlugin({
        type_name: "xy_plot_source_manager",
        display_name: "XY Source Manager",
        description: "Configure X and Y sources for a target XY Plot widget",
        settings: [],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new XYPlotSourceManager(settings));
        }
    });

    class XYPlotSourceManager {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2"></div>');
        }

        render(containerElement) {
            this.container.html('<div class="text-muted small">XY source manager scaffold loaded. Source selection will be added in a follow-up commit.</div>');
            $(containerElement).append(this.container);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
        }

        onDispose() {}

        getHeight() {
            return 6;
        }
    }
})();
