(function () {
    freeboard.loadWidgetPlugin({
        type_name: "xy_plot_uplot",
        display_name: "XY Plot widget",
        description: "Realtime X versus Y plot with trailing history",
        external_scripts: [
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js",
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"
        ],
        settings: [
            { name: "title", display_name: "Title", type: "text" },
            { name: "historyLength", display_name: "History Length", type: "number", default_value: 200 },
            { name: "refreshRate", display_name: "Refresh Rate (ms)", type: "number", default_value: 250 },
            { name: "xLabel", display_name: "X Axis Label", type: "text", default_value: "X" },
            { name: "yLabel", display_name: "Y Axis Label", type: "text", default_value: "Y" },
            { name: "xMin", display_name: "X Min", type: "number" },
            { name: "xMax", display_name: "X Max", type: "number" },
            { name: "yMin", display_name: "Y Min", type: "number" },
            { name: "yMax", display_name: "Y Max", type: "number" },
            { name: "helperWidgets", display_name: "Helper Widgets", type: "option", default_value: "source", options: [
                { name: "None", value: "none" },
                { name: "Source Manager", value: "source" }
            ] }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new XYPlotWidget(settings));
        }
    });

    class XYPlotWidget {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="xy-plot-shell h-100 d-flex flex-column gap-2 p-2"></div>');
            this.status = $('<div class="small text-muted">Configure X and Y sources with the XY Source Manager.</div>');
        }

        render(containerElement) {
            this.container.empty().append(this.status);
            $(containerElement).append(this.container);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
        }

        onCalculatedValueChanged() {}

        onDispose() {}

        getHeight() {
            return 8;
        }
    }
})();
