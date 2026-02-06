(function () {
    if (!window.require) return;
    const { webFrame } = window.require('electron') || {};
    if (!webFrame) return;

    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.0;
    const STEP = 0.1;
    let currentZoom = Number(localStorage.getItem('dashboard_zoom') || 1.0);

    function clamp(value) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    function applyZoom(value) {
        currentZoom = clamp(value);
        webFrame.setZoomFactor(currentZoom);
        localStorage.setItem('dashboard_zoom', currentZoom.toString());
        // Zoom percentage display intentionally removed from UI.
    }

    function changeZoom(delta) {
        applyZoom(currentZoom + delta);
    }

    window.addEventListener('DOMContentLoaded', () => {
        applyZoom(currentZoom);

        // Zoom buttons intentionally removed from the main window.
    });

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
