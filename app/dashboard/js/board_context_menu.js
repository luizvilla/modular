(function () {
    // Milestones 1 & 2 of docs/GUI/02-navigation_overhaul.md: right-click
    // radial menus at the chrome level (dashboard and pane), one level up
    // from the per-widget radials piloted on time_plot_uplot.
    //
    // Event layering (Design Principle 6): a widget's own contextmenu zone
    // (e.g. time_plot_uplot's chartHost handler) is bound directly on that
    // widget's DOM and calls stopPropagation() -- the event never reaches
    // this file's handlers for widgets that have adopted the radial pattern.
    // For widgets that haven't (yet), this file's pane-level handler
    // explicitly ignores clicks landing inside `.sub-section` (an existing
    // widget) rather than treating that as empty pane space; the
    // dashboard-level handler likewise ignores clicks landing inside any
    // pane `<li>` at all, so right-clicking a plain widget never falls
    // through to "Add Pane / Add Datasource".

    function buildDatasourceTypeItems() {
        const types = (window.freeboard && freeboard.getDatasourcePluginTypes) ? freeboard.getDatasourcePluginTypes() : {};
        return Object.keys(types).sort().map((typeName) => {
            const plugin = types[typeName];
            return {
                id: typeName,
                label: plugin.display_name || typeName,
                onSelect: () => freeboard.openAddDatasourceEditor(typeName)
            };
        });
    }

    function buildDashboardMenuRoot() {
        return [
            {
                id: 'pane', label: 'Pane',
                items: [
                    { id: 'add-pane', label: '+ Add Pane', onSelect: () => freeboard.getLiveModel().createPane() }
                ]
            },
            { id: 'datasource', label: 'Datasource', items: buildDatasourceTypeItems() }
        ];
    }

    function buildWidgetCategoryMenuRoot(paneViewModel) {
        const groups = (window.freeboard && freeboard.getCategorizedWidgetPlugins) ? freeboard.getCategorizedWidgetPlugins() : [];
        return groups.map((group) => ({
            id: group.category, label: group.category,
            items: group.plugins.map((plugin) => ({
                id: plugin.type_name, label: plugin.display_name || plugin.type_name,
                onSelect: () => freeboard.openAddWidgetEditor(paneViewModel, plugin.type_name)
            }))
        }));
    }

    function bind() {
        if (!window.RadialContextMenu || !window.freeboard) return;
        const $board = $('#board-content');
        if (!$board.length) return;

        // Pane-level (Milestone 2): right-click empty space inside a pane's
        // widget list -> category-grouped quick-add. Bound as a delegated
        // handler on '.widget-sort-section' (the class ko.bindingHandlers.pane
        // adds to each pane's <section data-bind="foreach: widgets">), which
        // jQuery dispatches before the plain dashboard-level handler below.
        $board.on('contextmenu', '.widget-sort-section', function (e) {
            if ($(e.target).closest('.sub-section').length) return;
            const paneEl = $(this).closest('li')[0];
            const paneViewModel = paneEl && window.ko ? ko.dataFor(paneEl) : null;
            if (!paneViewModel) return;
            e.preventDefault();
            e.stopPropagation();
            window.RadialContextMenu.show({ x: e.clientX, y: e.clientY, root: buildWidgetCategoryMenuRoot(paneViewModel) });
        });

        // Dashboard-level (Milestone 1): right-click empty board space ->
        // Add Pane / Add Datasource.
        $board.on('contextmenu', function (e) {
            if ($(e.target).closest('#board-content li').length) return;
            e.preventDefault();
            window.RadialContextMenu.show({ x: e.clientX, y: e.clientY, root: buildDashboardMenuRoot() });
        });
    }

    $(bind);
})();
