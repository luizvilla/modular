(function () {
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.0;
    const STEP = 0.1;
    let currentZoom = Number(localStorage.getItem('dashboard_zoom') || 1.0);

    function clamp(value) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    function applyZoom(value) {
        currentZoom = clamp(value);
        if (window.api && window.api.zoom) window.api.zoom.setFactor(currentZoom);
        localStorage.setItem('dashboard_zoom', currentZoom.toString());
        document.dispatchEvent(new CustomEvent('dashboard-zoom-changed', { detail: { factor: currentZoom } }));
    }

    function changeZoom(delta) {
        applyZoom(currentZoom + delta);
    }

    window.dashboardZoom = {
        zoomIn:     () => changeZoom(STEP),
        zoomOut:    () => changeZoom(-STEP),
        reset:      () => applyZoom(1.0),
        getCurrent: () => currentZoom,
    };

    // ── Ctrl + scroll wheel zoom ──────────────────────────────────────────────
    window.addEventListener('wheel', (evt) => {
        if (!evt.ctrlKey) return;
        evt.preventDefault();
        changeZoom(evt.deltaY < 0 ? STEP : -STEP);
    }, { passive: false });

    // ── Right-click drag pan ──────────────────────────────────────────────────
    let _panning   = false;
    let _panStartX = 0, _panStartY = 0;
    let _panScrollX = 0, _panScrollY = 0;

    document.addEventListener('mousedown', (evt) => {
        if (evt.button !== 2) return;
        _panning    = true;
        _panStartX  = evt.clientX;
        _panStartY  = evt.clientY;
        _panScrollX = window.scrollX;
        _panScrollY = window.scrollY;
        document.body.classList.add('is-panning');
        evt.preventDefault();
    });

    document.addEventListener('mousemove', (evt) => {
        if (!_panning) return;
        window.scrollTo(
            _panScrollX - (evt.clientX - _panStartX),
            _panScrollY - (evt.clientY - _panStartY)
        );
    });

    document.addEventListener('mouseup', (evt) => {
        if (evt.button !== 2 || !_panning) return;
        _panning = false;
        document.body.classList.remove('is-panning');
    });

    // Suppress the browser context menu — right-click is reserved for pan.
    document.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
    });

    // ── Button and keyboard wiring ────────────────────────────────────────────
    function initZoomUI() {
        applyZoom(currentZoom);

        const zoomInBtn  = document.getElementById('zoom-in-btn');
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const zoomLabel  = document.getElementById('zoom-level-label');

        if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => changeZoom(STEP));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => changeZoom(-STEP));
        if (zoomLabel)  zoomLabel.addEventListener('dblclick', () => applyZoom(1.0));

        function updateZoomUI() {
            if (zoomLabel)  zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
            if (zoomInBtn)  zoomInBtn.disabled  = currentZoom >= MAX_ZOOM;
            if (zoomOutBtn) zoomOutBtn.disabled = currentZoom <= MIN_ZOOM;
        }

        document.addEventListener('dashboard-zoom-changed', updateZoomUI);
        updateZoomUI();
    }

    // Script may load after DOMContentLoaded has fired (placed at bottom of body).
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initZoomUI);
    } else {
        initZoomUI();
    }

    window.addEventListener('keydown', (evt) => {
        if (!evt.ctrlKey) return;
        if (evt.key === '=' || evt.key === '+') {
            changeZoom(STEP);
            evt.preventDefault();
        } else if (evt.key === '-') {
            changeZoom(-STEP);
            evt.preventDefault();
        } else if (evt.key === '0') {
            applyZoom(1.0);
            evt.preventDefault();
        }
    });
})();
