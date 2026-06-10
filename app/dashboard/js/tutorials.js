(function () {
    const tutorialsApi = window.api && window.api.tutorials ? window.api.tutorials : null;
    const extensionsApi = window.api && window.api.extensions ? window.api.extensions : null;
    const pathsApi = window.api && window.api.paths ? window.api.paths : null;

    if (!tutorialsApi || !extensionsApi) {
        return;
    }

    const BLANK_TUTORIAL_DASHBOARD = {
        version: 1,
        allow_edit: true,
        plugins: [],
        panes: [],
        datasources: [],
        columns: 3
    };
    const TUTORIAL_COMPLETION_STORAGE_KEY = 'tutorial_completion_state_v1';

    const FOCUS_RESOLVERS = {
        'header.addPane': () => document.querySelector('#add-pane'),
        'side.addDatasource': () => document.querySelector('#side-tab-datasources .table-operation'),
        'pane.first.addWidget': () => {
            const pane = document.querySelector('.gridster > ul > li, .gs_w');
            return pane ? pane.querySelector('.pane-tools li[title="Add widget"]') : null;
        },
        'modal.datasourcePicker.signalGenerator': () => document.querySelector('#modal_overlay .datasource-tile[data-type="signal_generator_datasource"]'),
        'modal.widgetPicker.timePlot': () => document.querySelector('#modal_overlay .widget-tile[data-type="time_plot_uplot"]'),
        'modal.widgetPicker.xyPlot': () => document.querySelector('#modal_overlay .widget-tile[data-type="xy_plot_uplot"]'),
        'modal.widgetPicker.xySourceManager': () => document.querySelector('#modal_overlay .widget-tile[data-type="xy_plot_source_manager"]'),
        'modal.timePlotEditor': () => document.querySelector('#modal_overlay .integrated-plot-editor'),
        'modal.xyPlotEditor': () => document.querySelector('#modal_overlay .integrated-plot-editor'),
        'modal.fastFrameEditor': () => document.querySelector('#modal_overlay .integrated-plot-editor'),
        'modal.widgetPicker.fastFrame': () => document.querySelector('#modal_overlay .widget-tile[data-type="fast_frame_plot"]'),
        'modal.fftSpectrumEditor': () => document.querySelector('#modal_overlay .integrated-plot-editor'),
        'modal.widgetPicker.fftSpectrum': () => document.querySelector('#modal_overlay .widget-tile[data-type="fft_spectrum_plot"]'),
        'modal.gaugeEditor': () => document.querySelector('#modal_overlay .integrated-plot-editor'),
        'modal.widgetPicker.verticalGauge': () => document.querySelector('#modal_overlay .widget-tile[data-type="vertical_gauge"]'),
        'widget.gauge.offsetControl': () => document.querySelector('.gauge-family-host .gauge-offset-control'),
        'modal.widgetPicker.flasher': () => document.querySelector('#modal_overlay .widget-tile[data-type="serial_flasher"]'),
        'modal.widgetPicker.commandSender': () => document.querySelector('#modal_overlay .widget-tile[data-type="serial_command_buttons"]'),
        'modal.widgetPicker.csvRecorder': () => document.querySelector('#modal_overlay .widget-tile[data-type="serial_csv_recorder"]'),
        'widget.flasher.startBtn': () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Start Flash') || null,
        'widget.csvRecorder.startBtn': () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Start Record' || b.textContent.trim() === 'Stop Record') || null,
        'widget.xySourceManager.apply': () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Apply to XY Plot') || null,
        'doc.uploadFirmware': () => document.querySelector('#doc-upload-firmware-btn'),
        'doc.loadDashboard': () => document.querySelector('#doc-load-dashboard-btn'),
        'twist.powerOn': () => Array.from(document.querySelectorAll('.btn-outline-success')).find((b) => b.textContent.trim() === 'POWER ON') || null,
        'twist.leg1Toggle': () => resolveTwistToggle('LEG1', 'LEG'),
        'twist.driver1Toggle': () => resolveTwistToggle('LEG1', 'DRIVER'),
        'twist.leg1DutyRow': () => resolveTwistDutyRow('LEG1')
    };

    function resolveTwistToggle(legLabel, actionLabel) {
        const badges = Array.from(document.querySelectorAll('.badge.bg-light')).filter((b) => b.textContent.trim() === legLabel);
        for (const badge of badges) {
            const grid = badge.parentElement && badge.parentElement.querySelector('.twist-toggle-grid');
            if (!grid) continue;
            const found = Array.from(grid.querySelectorAll('.twist-toggle-item')).find((item) => {
                const label = item.querySelector('.input-group-text');
                return label && label.textContent.trim() === actionLabel;
            });
            if (found) return found;
        }
        return null;
    }

    function resolveTwistDutyRow(legLabel) {
        const badges = Array.from(document.querySelectorAll('.badge.bg-light'));
        for (const badge of badges) {
            if (badge.textContent.trim() !== legLabel) continue;
            const section = badge.parentElement;
            if (!section) continue;
            const found = Array.from(section.querySelectorAll('.twist-setpoints')).find((row) => {
                const label = row.querySelector('.input-group-text');
                return label && label.textContent.trim() === 'Duty';
            });
            if (found) return found;
        }
        return null;
    }

    const state = {
        tutorialsById: new Map(),
        dashboardWelcomeEntries: [],
        sessionsByTabId: new Map(),
        activeSessionTabId: null,
        welcomeRoot: null,
        welcomeTitle: null,
        welcomeInstructions: null,
        welcomeActions: null,
        welcomeDismissButton: null,
        dismissedWelcomeIds: new Set(),
        completedTutorials: {},
        root: null,
        progressBar: null,
        title: null,
        subtitle: null,
        status: null,
        illustration: null,
        instructions: null,
        previousButton: null,
        nextButton: null,
        skipButton: null,
        exitButton: null,
        lastFocusedElement: null,
        initialized: false,
        bootstrapLoaded: false,
        launchTimestamps: new Map(),
        unbindActiveChange: null,
        mutationObserver: null
    };

    function readValue(value) {
        return typeof value === 'function' ? value() : value;
    }

    function cloneBlankDashboard() {
        return JSON.parse(JSON.stringify(BLANK_TUTORIAL_DASHBOARD));
    }

    function normalizeStoredTutorialCompletion(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const result = {};
        Object.entries(raw).forEach(([tutorialId, value]) => {
            if (!tutorialId) return;
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            const completedAt = typeof value.completedAt === 'string' && value.completedAt.trim()
                ? value.completedAt.trim()
                : null;
            if (!completedAt) return;
            result[tutorialId] = { completedAt };
        });
        return result;
    }

    function loadTutorialCompletionState() {
        try {
            const raw = localStorage.getItem(TUTORIAL_COMPLETION_STORAGE_KEY);
            state.completedTutorials = normalizeStoredTutorialCompletion(JSON.parse(raw || '{}'));
        } catch {
            state.completedTutorials = {};
        }
    }

    function saveTutorialCompletionState() {
        try {
            localStorage.setItem(TUTORIAL_COMPLETION_STORAGE_KEY, JSON.stringify(state.completedTutorials));
        } catch {}
    }

    function isTutorialCompleted(tutorialId) {
        return !!state.completedTutorials[String(tutorialId || '').trim()];
    }

    function markTutorialCompleted(tutorialId) {
        const normalizedId = String(tutorialId || '').trim();
        if (!normalizedId || isTutorialCompleted(normalizedId)) return;
        state.completedTutorials[normalizedId] = {
            completedAt: new Date().toISOString()
        };
        saveTutorialCompletionState();
    }

    function safeParseJson(value) {
        if (!value) return null;
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
        if (typeof value !== 'string') return null;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitFor(predicate, timeoutMs) {
        const timeout = Number(timeoutMs) || 10000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const value = predicate();
            if (value) return value;
            await wait(25);
        }
        return null;
    }

    function renderMarkdown(markdown) {
        if (window.marked && typeof window.marked.parse === 'function') {
            return window.marked.parse(markdown || '');
        }
        return String(markdown || '')
            .split('\n')
            .map((line) => `<p>${line}</p>`)
            .join('');
    }

    function tutorialLabel(tutorial) {
        return `Tutorial: ${tutorial.title}`;
    }

    function isDefaultDashboardTab(tab) {
        return !!(tab && tab.id === 'dashboard' && tab.type === 'dashboard' && !(tab.meta && tab.meta.tutorial));
    }

    function setHighlight(element) {
        if (state.lastFocusedElement && state.lastFocusedElement !== element) {
            state.lastFocusedElement.classList.remove('tutorial-focus-target');
        }
        state.lastFocusedElement = element || null;
        if (element) {
            element.classList.add('tutorial-focus-target');
        }
    }

    function clearHighlight() {
        if (state.lastFocusedElement) {
            state.lastFocusedElement.classList.remove('tutorial-focus-target');
            state.lastFocusedElement = null;
        }
    }

    function getActiveTabSnapshot() {
        return window.dashboardTabs && typeof window.dashboardTabs.getActive === 'function'
            ? window.dashboardTabs.getActive()
            : null;
    }

    function getActiveSession() {
        return state.activeSessionTabId ? state.sessionsByTabId.get(state.activeSessionTabId) || null : null;
    }

    function getLiveModel() {
        return window.freeboard && typeof window.freeboard.getLiveModel === 'function'
            ? window.freeboard.getLiveModel()
            : null;
    }

    function collectModelSnapshot() {
        const model = getLiveModel();
        if (!model || typeof model.panes !== 'function' || typeof model.datasources !== 'function') {
            return {
                panes: [],
                datasources: [],
                widgets: []
            };
        }
        const panes = Array.isArray(model.panes()) ? model.panes() : [];
        const datasources = Array.isArray(model.datasources()) ? model.datasources() : [];
        const widgets = [];
        panes.forEach((pane) => {
            const paneWidgets = typeof pane.widgets === 'function' ? pane.widgets() : [];
            paneWidgets.forEach((widget) => widgets.push(widget));
        });
        return { panes, datasources, widgets };
    }

    function findTutorialById(id) {
        return state.tutorialsById.get(String(id || '').trim()) || null;
    }

    function normalizeSeriesDefs(widget) {
        if (!widget || typeof widget.settings !== 'function') return [];
        const settings = widget.settings() || {};
        const parsed = safeParseJson(settings.seriesDefs);
        return Array.isArray(parsed) ? parsed : [];
    }

    function completionSatisfied(step) {
        if (!step || !step.completion) return false;
        const completion = step.completion;
        if (completion.kind === 'manual') {
            return true;
        }

        const snapshot = collectModelSnapshot();
        if (completion.kind === 'pane_count_at_least') {
            return snapshot.panes.length >= (completion.count || 1);
        }

        if (completion.kind === 'datasource_type_exists') {
            const required = completion.count || 1;
            const found = snapshot.datasources.filter((datasource) => readValue(datasource.type) === completion.datasourceType).length;
            return found >= required;
        }

        if (completion.kind === 'widget_type_exists') {
            return snapshot.widgets.some((widget) => readValue(widget.type) === completion.widgetType);
        }

        if (completion.kind === 'xy_plot_sources_bound') {
            const sgNames = new Set(
                snapshot.datasources
                    .filter((datasource) => readValue(datasource.type) === 'signal_generator_datasource')
                    .map((datasource) => String(readValue(datasource.name) || '').trim())
                    .filter(Boolean)
            );
            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'xy_plot_uplot') return false;
                const settings = typeof widget.settings === 'function' ? widget.settings() : (widget.settings || {});
                const xRaw = typeof settings.xSourceDef === 'function' ? settings.xSourceDef() : settings.xSourceDef;
                const yRaw = typeof settings.ySourceDef === 'function' ? settings.ySourceDef() : settings.ySourceDef;
                let xDef = xRaw;
                let yDef = yRaw;
                try {
                    if (typeof xRaw === 'string' && xRaw.trim().startsWith('{')) xDef = JSON.parse(xRaw);
                    if (typeof yRaw === 'string' && yRaw.trim().startsWith('{')) yDef = JSON.parse(yRaw);
                } catch {}
                if (!xDef || typeof xDef !== 'object' || !yDef || typeof yDef !== 'object') return false;
                const xDs = String(xDef.ds || '').trim();
                const yDs = String(yDef.ds || '').trim();
                return xDs && yDs && sgNames.has(xDs) && sgNames.has(yDs);
            });
        }

        if (completion.kind === 'fast_frame_plot_configured') {
            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'fast_frame_plot') return false;
                const settings = typeof widget.settings === 'function' ? widget.settings() : (widget.settings || {});
                const csvPath = typeof settings.csvPath === 'string' ? settings.csvPath.trim() : '';
                const defs = Array.isArray(settings.seriesDefs) ? settings.seriesDefs : [];
                return !!(csvPath && defs.length > 0);
            });
        }

        if (completion.kind === 'fft_spectrum_configured') {
            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'fft_spectrum_plot') return false;
                const settings = typeof widget.settings === 'function' ? widget.settings() : (widget.settings || {});
                const csvPath = typeof settings.csvPath === 'string' ? settings.csvPath.trim() : '';
                const defs = Array.isArray(settings.channelDefs) ? settings.channelDefs : [];
                return !!(csvPath && defs.length > 0);
            });
        }

        if (completion.kind === 'gauge_source_bound') {
            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'vertical_gauge') return false;
                const settings = typeof widget.settings === 'function' ? widget.settings() : (widget.settings || {});
                const sourceDef = settings.sourceDef;
                return !!(sourceDef && typeof sourceDef.ds === 'string' && sourceDef.ds.trim());
            });
        }

        if (completion.kind === 'gauge_runtime_offset_adjusted') {
            const offsetEl = document.querySelector('.gauge-family-host .gauge-offset-value');
            if (!offsetEl) return false;
            const val = parseFloat(offsetEl.textContent || '0');
            return !isNaN(val) && val !== 0;
        }

        if (completion.kind === 'serialport_datasource_connected') {
            return snapshot.datasources.some((datasource) => {
                if (readValue(datasource.type) !== 'serialport_datasource') return false;
                const settings = typeof datasource.settings === 'function' ? datasource.settings() : (datasource.settings || {});
                const portPath = typeof settings.portPath === 'string' ? settings.portPath.trim() : '';
                return !!portPath;
            });
        }

        if (completion.kind === 'flash_completed') {
            return !!window._tutorialFlashCompleted;
        }

        if (completion.kind === 'serial_command_buttons_configured') {
            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'serial_command_buttons') return false;
                const settings = typeof widget.settings === 'function' ? widget.settings() : (widget.settings || {});
                const ds = typeof settings.datasource === 'string' ? settings.datasource.trim() : '';
                if (!ds) return false;
                const buttons = safeParseJson(settings.buttons);
                const arr = Array.isArray(buttons) ? buttons : [];
                return arr.some((btn) => {
                    return btn && typeof btn.label === 'string' && btn.label.trim() &&
                           typeof btn.command === 'string' && btn.command.trim();
                });
            });
        }

        if (completion.kind === 'serial_csv_recorder_started') {
            return Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Stop Record');
        }

        if (completion.kind === 'time_plot_series_bound') {
            const signalGeneratorNames = new Set(
                snapshot.datasources
                    .filter((datasource) => readValue(datasource.type) === 'signal_generator_datasource')
                    .map((datasource) => String(readValue(datasource.name) || '').trim())
                    .filter(Boolean)
            );

            return snapshot.widgets.some((widget) => {
                if (readValue(widget.type) !== 'time_plot_uplot') return false;
                const defs = normalizeSeriesDefs(widget);
                return defs.some((def) => {
                    const direct = def && typeof def === 'object' ? String(def.ds || '').trim() : '';
                    const sourceA = def && def.a && typeof def.a === 'object' ? String(def.a.ds || '').trim() : '';
                    return (direct && signalGeneratorNames.has(direct)) || (sourceA && signalGeneratorNames.has(sourceA));
                });
            });
        }

        return false;
    }

    function markStepComplete(session, stepId) {
        if (!session || !stepId) return;
        session.completedStepIds.add(stepId);
    }

    function isStepComplete(session, step) {
        if (!session || !step) return false;
        if (session.completedStepIds.has(step.id)) return true;
        if (!session.isVisible) return false;
        if (!completionSatisfied(step)) return false;
        markStepComplete(session, step.id);
        return true;
    }

    function currentStep(session) {
        return session && session.tutorial && session.tutorial.steps[session.stepIndex]
            ? session.tutorial.steps[session.stepIndex]
            : null;
    }

    function tutorialIsActuallyComplete(tutorial) {
        if (!tutorial || !Array.isArray(tutorial.steps) || !tutorial.steps.length) return false;
        return tutorial.steps.every((step) => completionSatisfied(step));
    }

    function persistTutorialCompletionIfEligible(session) {
        if (!session || !session.tutorial || !session.isVisible) return;
        const lastIndex = session.tutorial.steps.length - 1;
        if (session.stepIndex < lastIndex) return;
        if (!tutorialIsActuallyComplete(session.tutorial)) return;
        markTutorialCompleted(session.tutorial.id);
    }

    function resolveIllustrationUrl(step) {
        if (!step || !step.illustrationPath) return '';
        return pathsApi && typeof pathsApi.toFileUrl === 'function'
            ? pathsApi.toFileUrl(step.illustrationPath)
            : step.illustrationPath;
    }

    function resolveFocusElement(session, step) {
        if (!session || !step || !step.focusKey) return null;

        if (['create-datasource', 'create-first-datasource', 'create-second-datasource'].includes(step.id)) {
            const modal = document.querySelector('#modal_overlay');
            if (modal) {
                const sgTile = modal.querySelector('.datasource-tile[data-type="signal_generator_datasource"]');
                if (sgTile) return sgTile;
                const nameInput = modal.querySelector('.form-row input');
                if (nameInput) return nameInput;
            }
            return FOCUS_RESOLVERS['side.addDatasource']();
        }

        if (step.id === 'add-time-plot-widget') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.timePlot']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'add-xy-plot-widget') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.xyPlot']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'add-fast-frame-widget') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.fastFrame']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'configure-channels') {
            const modal = FOCUS_RESOLVERS['modal.fastFrameEditor']();
            if (modal) return modal;
            const pane = document.querySelector('.gridster > ul > li, .gs_w');
            return pane ? (pane.querySelector('.sub-section-tools .tool-edit') || null) : null;
        }

        if (step.id === 'add-fft-widget') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.fftSpectrum']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'configure-fft-channels') {
            const modal = FOCUS_RESOLVERS['modal.fftSpectrumEditor']();
            if (modal) return modal;
            const pane = document.querySelector('.gridster > ul > li, .gs_w');
            return pane ? (pane.querySelector('.sub-section-tools .tool-edit') || null) : null;
        }

        if (step.id === 'add-gauge-widget') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.verticalGauge']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'configure-gauge') {
            const modal = FOCUS_RESOLVERS['modal.gaugeEditor']();
            if (modal) return modal;
            const pane = document.querySelector('.gridster > ul > li, .gs_w');
            return pane ? (pane.querySelector('.sub-section-tools .tool-edit') || null) : null;
        }

        if (step.id === 'adjust-offset') {
            return FOCUS_RESOLVERS['widget.gauge.offsetControl']();
        }

        if (step.id === 'add-flasher') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.flasher']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'flash-firmware') {
            return FOCUS_RESOLVERS['widget.flasher.startBtn']();
        }

        if (step.id === 'add-command-sender') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.commandSender']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'add-csv-recorder') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.csvRecorder']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        if (step.id === 'start-recording') {
            return FOCUS_RESOLVERS['widget.csvRecorder.startBtn']();
        }

        if (step.id === 'add-xy-source-manager') {
            const tile = FOCUS_RESOLVERS['modal.widgetPicker.xySourceManager']();
            if (tile) return tile;
            return FOCUS_RESOLVERS['pane.first.addWidget']();
        }

        const resolver = FOCUS_RESOLVERS[step.focusKey];
        return typeof resolver === 'function' ? resolver() : null;
    }

    function setWelcomeVisible(visible) {
        if (!state.welcomeRoot) return;
        state.welcomeRoot.hidden = !visible;
        state.welcomeRoot.classList.toggle('is-hidden', !visible);
    }

    function getStartupWelcomeEntry() {
        return state.dashboardWelcomeEntries.find((entry) => (
            entry && entry.trigger === 'startup' && entry.showWhen === 'empty_default_dashboard'
        )) || null;
    }

    function hasVisibleTutorialSession() {
        return Array.from(state.sessionsByTabId.values()).some((session) => !session.dismissed && session.isVisible);
    }

    function isCurrentDashboardEmpty() {
        const snapshot = collectModelSnapshot();
        return snapshot.panes.length === 0 && snapshot.datasources.length === 0 && snapshot.widgets.length === 0;
    }

    function openTutorialFromWelcome(tutorialId) {
        handleOpenRequest({ id: tutorialId }).catch((err) => {
            console.error('[tutorials] welcome launch failed', err);
        });
    }

    function renderWelcomeAction(entry, action) {
        const button = document.createElement('button');
        const tutorial = findTutorialById(action.tutorialId);
        const completed = isTutorialCompleted(action.tutorialId);

        button.type = 'button';
        button.className = 'tutorial-welcome-action';
        if (completed) button.classList.add('is-complete');
        if (!tutorial) button.classList.add('is-unavailable');
        button.disabled = !tutorial;
        button.innerHTML = `
            <span class="tutorial-welcome-action-header">
                <span class="tutorial-welcome-action-label">${action.label}</span>
                ${completed ? '<span class="tutorial-welcome-action-state">Completed</span>' : ''}
            </span>
            ${action.description ? `<span class="tutorial-welcome-action-description">${action.description}</span>` : ''}
        `;
        if (tutorial) {
            button.addEventListener('click', () => openTutorialFromWelcome(action.tutorialId));
        }
        state.welcomeActions.appendChild(button);
    }

    function renderWelcome() {
        if (!state.welcomeRoot) return;
        const entry = getStartupWelcomeEntry();
        const active = getActiveTabSnapshot();
        const shouldShow = !!entry
            && !state.dismissedWelcomeIds.has(entry.id)
            && isDefaultDashboardTab(active)
            && !hasVisibleTutorialSession()
            && isCurrentDashboardEmpty();

        if (!shouldShow) {
            setWelcomeVisible(false);
            return;
        }

        setWelcomeVisible(true);
        state.welcomeRoot.dataset.welcomeId = entry.id;
        state.welcomeTitle.textContent = entry.title;
        state.welcomeInstructions.innerHTML = renderMarkdown(entry.markdown);
        state.welcomeActions.replaceChildren();
        entry.actions.forEach((action) => renderWelcomeAction(entry, action));
    }

    function dismissWelcome() {
        const entry = getStartupWelcomeEntry();
        if (!entry) return;
        state.dismissedWelcomeIds.add(entry.id);
        renderWelcome();
    }

    function setRootVisible(visible) {
        if (!state.root) return;
        state.root.hidden = !visible;
        state.root.classList.toggle('is-hidden', !visible);
    }

    function ensureEditingEnabled() {
        if (!window.freeboard || typeof window.freeboard.setEditing !== 'function') return;
        if (typeof window.freeboard.isEditing === 'function' && window.freeboard.isEditing()) return;
        window.freeboard.setEditing(true, false);
    }

    function updateFocus(session, step) {
        if (!session || !session.isVisible) {
            clearHighlight();
            return;
        }
        const element = resolveFocusElement(session, step);
        setHighlight(element);
    }

    function updateStatusLine(session, step, complete) {
        if (!state.status || !session || !step) return;
        const stepNumber = session.stepIndex + 1;
        const stepCount = session.tutorial.steps.length;
        if (step.completion && step.completion.kind === 'manual') {
            state.status.textContent = `Step ${stepNumber} of ${stepCount}`;
            return;
        }
        state.status.textContent = complete
            ? `Step ${stepNumber} of ${stepCount} - complete`
            : `Step ${stepNumber} of ${stepCount} - waiting for action`;
    }

    let _renderingSession = false;

    function renderSession() {
        if (_renderingSession) return;
        _renderingSession = true;
        try {
            const session = getActiveSession();
            if (!session || session.dismissed || !session.isVisible) {
                setRootVisible(false);
                clearHighlight();
                return;
            }

            const step = currentStep(session);
            if (!step) {
                setRootVisible(false);
                clearHighlight();
                return;
            }

            const complete = isStepComplete(session, step);
            setRootVisible(true);
            state.root.dataset.tutorialId = session.tutorial.id;
            state.progressBar.style.width = `${((session.stepIndex + 1) / session.tutorial.steps.length) * 100}%`;
            state.title.textContent = session.tutorial.title;
            state.subtitle.textContent = step.title;
            updateStatusLine(session, step, complete);

            const illustrationUrl = resolveIllustrationUrl(step);
            if (illustrationUrl) {
                state.illustration.src = illustrationUrl;
                state.illustration.hidden = false;
            } else {
                state.illustration.hidden = true;
                state.illustration.removeAttribute('src');
            }

            state.instructions.innerHTML = renderMarkdown(step.markdown);

            state.previousButton.disabled = session.stepIndex === 0;
            state.nextButton.disabled = !complete;
            state.nextButton.textContent = session.stepIndex === session.tutorial.steps.length - 1 ? 'Done' : 'Next';
            state.skipButton.textContent = session.stepIndex === session.tutorial.steps.length - 1 ? 'Close' : 'Skip';

            persistTutorialCompletionIfEligible(session);
            updateFocus(session, step);
        } finally {
            _renderingSession = false;
            renderWelcome();
        }
    }

    function evaluateActiveSession() {
        const session = getActiveSession();
        if (!session || session.dismissed) {
            renderSession();
            return;
        }
        if (!isOverlaySession(session)) {
            ensureEditingEnabled();
        }
        const step = currentStep(session);
        if (step && step.autoAdvance && session.isVisible &&
                isStepComplete(session, step) &&
                session.stepIndex < session.tutorial.steps.length - 1) {
            moveToStep(session, session.stepIndex + 1);
            return;
        }
        renderSession();
    }

    function isOverlaySession(session) {
        return !!(session && !session.dismissed && session.tutorial && session.tutorial.overlayMode);
    }

    function syncActiveSession() {
        const active = getActiveTabSnapshot();

        let overlaySession = null;
        state.sessionsByTabId.forEach((session) => {
            if (isOverlaySession(session)) overlaySession = session;
        });

        state.sessionsByTabId.forEach((session) => {
            session.isVisible = isOverlaySession(session) || (!!active && active.id === session.tabId);
        });

        if (overlaySession) {
            state.activeSessionTabId = overlaySession.tabId;
        } else {
            state.activeSessionTabId = active && state.sessionsByTabId.has(active.id) ? active.id : null;
            if (state.activeSessionTabId) {
                ensureEditingEnabled();
            }
        }
        renderSession();
    }

    function executeStepActions(session, step) {
        if (!step || !Array.isArray(step.actions) || !step.actions.length) return;
        const tutorial = session && session.tutorial;
        step.actions.forEach((action) => {
            if (action.kind === 'apply_tutorial_csv') {
                const csvPath = tutorial && tutorial.resources && typeof tutorial.resources.csv === 'string'
                    ? tutorial.resources.csv
                    : '';
                if (csvPath) {
                    window._tutorialPendingCsv = csvPath;
                }
            }
            if (action.kind === 'apply_tutorial_firmware') {
                const firmwarePath = tutorial && tutorial.resources && typeof tutorial.resources.firmware === 'string'
                    ? tutorial.resources.firmware
                    : '';
                if (firmwarePath) {
                    window._tutorialPendingFirmware = firmwarePath;
                }
                window._tutorialFlashCompleted = false;
            }
        });
    }

    function moveToStep(session, nextIndex) {
        if (!session) return;
        const maxIndex = session.tutorial.steps.length - 1;
        session.stepIndex = Math.max(0, Math.min(maxIndex, nextIndex));
        executeStepActions(session, session.tutorial.steps[session.stepIndex]);
        renderSession();
    }

    function advanceStep() {
        const session = getActiveSession();
        const step = currentStep(session);
        if (!session || !step) return;
        if (!isStepComplete(session, step)) return;
        if (session.stepIndex >= session.tutorial.steps.length - 1) {
            session.dismissed = true;
            syncActiveSession();
            return;
        }
        moveToStep(session, session.stepIndex + 1);
    }

    function goBack() {
        const session = getActiveSession();
        if (!session || session.stepIndex <= 0) return;
        moveToStep(session, session.stepIndex - 1);
    }

    function skipStep() {
        const session = getActiveSession();
        const step = currentStep(session);
        if (!session || !step) return;
        markStepComplete(session, step.id);
        if (session.stepIndex >= session.tutorial.steps.length - 1) {
            session.dismissed = true;
            syncActiveSession();
            return;
        }
        moveToStep(session, session.stepIndex + 1);
    }

    function exitTutorial() {
        const session = getActiveSession();
        if (!session) return;
        session.dismissed = true;
        syncActiveSession();
    }

    function createUi() {
        if (state.root) return;

        const style = document.createElement('style');
        style.textContent = `
            #tutorial-stepper {
                position: fixed;
                top: 88px;
                right: 24px;
                width: min(360px, calc(100vw - 32px));
                z-index: 3200;
                pointer-events: none;
                font-family: "Segoe UI", Arial, sans-serif;
            }
            #tutorial-stepper.is-hidden {
                display: none;
            }
            #tutorial-stepper .tutorial-card {
                pointer-events: auto;
                background: rgba(17, 24, 34, 0.96);
                border: 1px solid rgba(118, 147, 180, 0.45);
                border-radius: 18px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
                overflow: hidden;
                color: #eef4fb;
            }
            #tutorial-stepper .tutorial-progress {
                height: 6px;
                background: rgba(255, 255, 255, 0.08);
            }
            #tutorial-stepper .tutorial-progress > div {
                height: 100%;
                width: 0;
                background: linear-gradient(90deg, #58b368, #86d993);
                transition: width 160ms ease;
            }
            #tutorial-stepper .tutorial-body {
                display: flex;
                flex-direction: column;
                gap: 14px;
                padding: 16px;
            }
            #tutorial-stepper .tutorial-header {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            #tutorial-stepper .tutorial-title {
                font-size: 11px;
                letter-spacing: 0.12em;
                text-transform: uppercase;
                color: #91abc6;
            }
            #tutorial-stepper .tutorial-subtitle {
                font-size: 20px;
                line-height: 1.2;
                font-weight: 600;
            }
            #tutorial-stepper .tutorial-status {
                font-size: 12px;
                color: #c3d4e7;
            }
            #tutorial-stepper .tutorial-illustration {
                width: 100%;
                max-height: 170px;
                object-fit: cover;
                border-radius: 12px;
                border: 1px solid rgba(145, 171, 198, 0.25);
                background: rgba(0, 0, 0, 0.15);
            }
            #tutorial-stepper .tutorial-instructions {
                font-size: 14px;
                line-height: 1.5;
                color: #eef4fb;
            }
            #tutorial-stepper .tutorial-instructions p:last-child,
            #tutorial-stepper .tutorial-instructions ul:last-child {
                margin-bottom: 0;
            }
            #tutorial-stepper .tutorial-instructions ul {
                padding-left: 18px;
                margin-bottom: 12px;
            }
            #tutorial-stepper .tutorial-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            #tutorial-stepper .tutorial-actions button {
                border: 1px solid rgba(145, 171, 198, 0.35);
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.04);
                color: #eef4fb;
                padding: 8px 12px;
                font-size: 13px;
                cursor: pointer;
            }
            #tutorial-stepper .tutorial-actions button.primary {
                background: #58b368;
                border-color: #58b368;
                color: #0f1a13;
                font-weight: 600;
            }
            #tutorial-stepper .tutorial-actions button:disabled {
                opacity: 0.45;
                cursor: default;
            }
            .tutorial-focus-target {
                position: relative;
                z-index: 3150 !important;
                outline: 3px solid #86d993 !important;
                outline-offset: 3px;
                box-shadow: 0 0 0 6px rgba(134, 217, 147, 0.18) !important;
            }
            #tutorial-welcome {
                position: fixed;
                inset: 120px 24px 40px;
                z-index: 2800;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                pointer-events: none;
            }
            #tutorial-welcome.is-hidden {
                display: none;
            }
            #tutorial-welcome .tutorial-welcome-card {
                width: min(680px, calc(100vw - 48px));
                max-height: 100%;
                display: flex;
                flex-direction: column;
                pointer-events: auto;
                background:
                    radial-gradient(circle at top right, rgba(88, 179, 104, 0.14), transparent 34%),
                    linear-gradient(180deg, rgba(17, 24, 34, 0.96), rgba(15, 21, 30, 0.98));
                border: 1px solid rgba(118, 147, 180, 0.35);
                border-radius: 24px;
                box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
                color: #eef4fb;
                overflow: hidden;
            }
            #tutorial-welcome .tutorial-welcome-body {
                display: flex;
                flex-direction: column;
                gap: 18px;
                padding: 24px;
                flex: 1;
                min-height: 0;
                overflow-y: auto;
            }
            #tutorial-welcome .tutorial-welcome-kicker {
                font-size: 11px;
                letter-spacing: 0.16em;
                text-transform: uppercase;
                color: #91abc6;
            }
            #tutorial-welcome .tutorial-welcome-title {
                margin: 6px 0 0;
                font-size: 32px;
                line-height: 1.1;
                font-weight: 600;
            }
            #tutorial-welcome .tutorial-welcome-markdown {
                font-size: 15px;
                line-height: 1.6;
                color: #dbe7f5;
            }
            #tutorial-welcome .tutorial-welcome-markdown p:last-child,
            #tutorial-welcome .tutorial-welcome-markdown ul:last-child {
                margin-bottom: 0;
            }
            #tutorial-welcome .tutorial-welcome-actions {
                display: grid;
                gap: 12px;
            }
            #tutorial-welcome .tutorial-welcome-action {
                display: flex;
                flex-direction: column;
                gap: 6px;
                align-items: flex-start;
                width: 100%;
                padding: 16px 18px;
                border-radius: 16px;
                border: 1px solid rgba(134, 217, 147, 0.35);
                background: rgba(88, 179, 104, 0.1);
                color: #eef4fb;
                cursor: pointer;
                text-align: left;
                transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
            }
            #tutorial-welcome .tutorial-welcome-action:hover {
                transform: translateY(-1px);
                border-color: rgba(134, 217, 147, 0.6);
                background: rgba(88, 179, 104, 0.16);
            }
            #tutorial-welcome .tutorial-welcome-action.is-complete {
                border-color: rgba(145, 171, 198, 0.28);
                background: rgba(145, 171, 198, 0.1);
                color: #d9e2ec;
            }
            #tutorial-welcome .tutorial-welcome-action.is-complete:hover {
                border-color: rgba(145, 171, 198, 0.45);
                background: rgba(145, 171, 198, 0.14);
            }
            #tutorial-welcome .tutorial-welcome-action.is-unavailable {
                opacity: 0.55;
                cursor: default;
            }
            #tutorial-welcome .tutorial-welcome-action-header {
                display: flex;
                gap: 10px;
                align-items: center;
                width: 100%;
                justify-content: space-between;
            }
            #tutorial-welcome .tutorial-welcome-action-label {
                font-size: 18px;
                font-weight: 600;
            }
            #tutorial-welcome .tutorial-welcome-action-state {
                padding: 3px 8px;
                border-radius: 999px;
                background: rgba(145, 171, 198, 0.18);
                color: #c8d6e6;
                font-size: 11px;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            #tutorial-welcome .tutorial-welcome-action-description {
                font-size: 13px;
                line-height: 1.45;
                color: #c7d4e4;
            }
            #tutorial-welcome .tutorial-welcome-footer {
                display: flex;
                justify-content: flex-end;
            }
            #tutorial-welcome .tutorial-welcome-dismiss {
                border: 1px solid rgba(145, 171, 198, 0.35);
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.04);
                color: #eef4fb;
                padding: 8px 12px;
                font-size: 13px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);

        const welcomeRoot = document.createElement('aside');
        welcomeRoot.id = 'tutorial-welcome';
        welcomeRoot.hidden = true;
        welcomeRoot.className = 'is-hidden';
        welcomeRoot.innerHTML = `
            <div class="tutorial-welcome-card">
                <div class="tutorial-welcome-body">
                    <div class="tutorial-welcome-header">
                        <div class="tutorial-welcome-kicker">Getting Started</div>
                        <h2 class="tutorial-welcome-title"></h2>
                    </div>
                    <div class="tutorial-welcome-markdown"></div>
                    <div class="tutorial-welcome-actions"></div>
                    <div class="tutorial-welcome-footer">
                        <button type="button" class="tutorial-welcome-dismiss">Hide</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(welcomeRoot);

        const root = document.createElement('aside');
        root.id = 'tutorial-stepper';
        root.hidden = true;
        root.className = 'is-hidden';
        root.innerHTML = `
            <div class="tutorial-card">
                <div class="tutorial-progress"><div></div></div>
                <div class="tutorial-body">
                    <div class="tutorial-header">
                        <div class="tutorial-title"></div>
                        <div class="tutorial-subtitle"></div>
                        <div class="tutorial-status"></div>
                    </div>
                    <img class="tutorial-illustration" alt="Tutorial illustration">
                    <div class="tutorial-instructions"></div>
                    <div class="tutorial-actions">
                        <button type="button" data-action="back">Back</button>
                        <button type="button" class="primary" data-action="next">Next</button>
                        <button type="button" data-action="skip">Skip</button>
                        <button type="button" data-action="exit">Exit</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        state.welcomeRoot = welcomeRoot;
        state.welcomeTitle = welcomeRoot.querySelector('.tutorial-welcome-title');
        state.welcomeInstructions = welcomeRoot.querySelector('.tutorial-welcome-markdown');
        state.welcomeActions = welcomeRoot.querySelector('.tutorial-welcome-actions');
        state.welcomeDismissButton = welcomeRoot.querySelector('.tutorial-welcome-dismiss');
        state.root = root;
        state.progressBar = root.querySelector('.tutorial-progress > div');
        state.title = root.querySelector('.tutorial-title');
        state.subtitle = root.querySelector('.tutorial-subtitle');
        state.status = root.querySelector('.tutorial-status');
        state.illustration = root.querySelector('.tutorial-illustration');
        state.instructions = root.querySelector('.tutorial-instructions');
        state.previousButton = root.querySelector('[data-action="back"]');
        state.nextButton = root.querySelector('[data-action="next"]');
        state.skipButton = root.querySelector('[data-action="skip"]');
        state.exitButton = root.querySelector('[data-action="exit"]');

        state.previousButton.addEventListener('click', goBack);
        state.nextButton.addEventListener('click', advanceStep);
        state.skipButton.addEventListener('click', skipStep);
        state.exitButton.addEventListener('click', exitTutorial);
        state.welcomeDismissButton.addEventListener('click', dismissWelcome);
    }

    async function loadBootstrap() {
        if (state.bootstrapLoaded) return;
        const bootstrap = await extensionsApi.getBootstrap();
        const tutorials = Array.isArray(bootstrap && bootstrap.tutorials) ? bootstrap.tutorials : [];
        tutorials.forEach((tutorial) => {
            if (tutorial && tutorial.id) {
                state.tutorialsById.set(tutorial.id, tutorial);
            }
        });
        state.dashboardWelcomeEntries = Array.isArray(bootstrap && bootstrap.dashboardWelcomeEntries)
            ? bootstrap.dashboardWelcomeEntries.slice()
            : [];
        loadTutorialCompletionState();
        state.bootstrapLoaded = true;
    }

    async function openTutorialSession(tutorial) {
        const tabsApi = window.dashboardTabs;
        if (!tabsApi || typeof tabsApi.openNew !== 'function') {
            console.warn('[tutorials] dashboardTabs.openNew unavailable');
            return;
        }

        const tabId = await tabsApi.openNew({
            label: tutorialLabel(tutorial),
            initialData: cloneBlankDashboard(),
            meta: {
                tutorial: true,
                tutorialId: tutorial.id
            }
        });

        await waitFor(() => {
            const active = getActiveTabSnapshot();
            return active && active.id === tabId;
        }, 10000);

        if (!tutorial.overlayMode) {
            ensureEditingEnabled();
        }

        const session = {
            tabId,
            tutorial,
            stepIndex: 0,
            completedStepIds: new Set(),
            dismissed: false,
            isVisible: true
        };

        state.sessionsByTabId.set(tabId, session);
        state.activeSessionTabId = tabId;
        syncActiveSession();
        evaluateActiveSession();
    }

    async function handleOpenRequest(payload) {
        await loadBootstrap();
        const requestId = String(payload && payload.id || '').trim();
        if (!requestId) return;

        const now = Date.now();
        const lastLaunch = state.launchTimestamps.get(requestId) || 0;
        if (now - lastLaunch < 250) {
            return;
        }
        state.launchTimestamps.set(requestId, now);

        const tutorial = findTutorialById(requestId);
        if (!tutorial) {
            console.warn(`[tutorials] Unknown tutorial id "${requestId}"`);
            return;
        }

        await openTutorialSession(tutorial);
    }

    function bindRuntimeListeners() {
        if (state.initialized) return;
        state.initialized = true;

        if (window.freeboard && typeof window.freeboard.on === 'function') {
            window.freeboard.on('config_updated', () => {
                evaluateActiveSession();
            });
            window.freeboard.on('dashboard_loaded', () => {
                evaluateActiveSession();
            });
        }

        if (window.dashboardTabs && typeof window.dashboardTabs.onActiveChange === 'function') {
            state.unbindActiveChange = window.dashboardTabs.onActiveChange(() => {
                syncActiveSession();
                evaluateActiveSession();
            });
        }

        let _observerRenderHandle = null;
        state.mutationObserver = new MutationObserver((mutations) => {
            if (mutations.every((mutation) => {
                const target = mutation.target;
                return !!(
                    (state.root && state.root.contains(target))
                    || (state.welcomeRoot && state.welcomeRoot.contains(target))
                );
            })) return;
            if (_observerRenderHandle !== null) return;
            _observerRenderHandle = setTimeout(() => {
                _observerRenderHandle = null;
                evaluateActiveSession();
            }, 0);
        });
        state.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        const flashApi = window.api && window.api.flash;
        if (flashApi && typeof flashApi.onComplete === 'function') {
            flashApi.onComplete(() => {
                window._tutorialFlashCompleted = true;
                evaluateActiveSession();
            });
        }
    }

    async function init() {
        await waitFor(() => window.dashboardTabs && window.freeboard, 10000);
        createUi();
        await loadBootstrap();
        bindRuntimeListeners();

        const pending = await tutorialsApi.getPendingOpen().catch(() => null);
        tutorialsApi.onOpen((payload) => {
            handleOpenRequest(payload).catch((err) => {
                console.error('[tutorials] open request failed', err);
            });
        });
        tutorialsApi.notifyReady();

        if (pending) {
            await handleOpenRequest(pending);
        } else {
            syncActiveSession();
        }
    }

    init().catch((err) => {
        console.error('[tutorials] initialization failed', err);
    });
})();
