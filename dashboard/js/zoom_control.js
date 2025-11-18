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
        const display = document.getElementById('zoom-display');
        if (display) display.textContent = `${Math.round(currentZoom * 100)}%`;
    }

    function changeZoom(delta) {
        applyZoom(currentZoom + delta);
    }

    window.addEventListener('DOMContentLoaded', () => {
        applyZoom(currentZoom);

        const header = document.getElementById('board-tools');
        if (!header) return;

        const wrap = document.createElement('div');
        wrap.className = 'zoom-controls d-flex align-items-center gap-1 ms-3';
        wrap.innerHTML = `
            <button id="zoom-out" class="btn btn-sm btn-outline-secondary">-</button>
            <span id="zoom-display" class="text-muted small">${Math.round(currentZoom * 100)}%</span>
            <button id="zoom-in" class="btn btn-sm btn-outline-secondary">+</button>
        `;

        header.appendChild(wrap);

        document.getElementById('zoom-in').addEventListener('click', () => changeZoom(STEP));
        document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-STEP));
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
