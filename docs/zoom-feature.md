# Zoom Feature — Dashboard Pane Scale Controls

## Problem

User feedback: on smaller or lower-resolution screens the dashboard panes are too large to comfortably see. A way to shrink or enlarge the dashboard is needed.

The zoom engine already exists. `app/dashboard/js/zoom_control.js` uses Electron's `webFrame.setZoomFactor()` to scale the entire application viewport. It persists the level to `localStorage('dashboard_zoom')` and responds to `Ctrl+=` / `Ctrl+-` / `Ctrl+0`. It never had visible UI buttons (they were removed); keyboard-only zoom is not discoverable.

**Goal**: Surface the existing zoom engine through visible `−` / `100%` / `+` buttons in the top bar, right-to-left next to the theme toggle, always visible regardless of edit mode.

---

## Architecture decision

`webFrame.setZoomFactor` is the right mechanism for this use-case. It scales the whole window — panes, labels, sidebar, icons — uniformly. The grid math already accounts for sub-pixel zoom (`+newCols` offset in `updateGridWidth`), and Electron's zoom triggers a browser resize event so `processResize()` fires automatically.

A CSS `transform: scale()` approach on `#board-content` only was considered and rejected: it leaves the toolbar and sidebar at full size, creates overflow/clip problems on the grid container, and requires manual height compensation because CSS transforms don't affect document flow.

---

## Session 1 — Zoom UI buttons (single-session feature)

### Files

#### 1. `app/dashboard/js/zoom_control.js` — expose API + wire buttons

- Add a `window.dashboardZoom` export so other scripts can call `zoomIn/zoomOut/reset` if needed.
- Dispatch `dashboard-zoom-changed` custom event on every `applyZoom` call so the label can update reactively.
- Wire `#zoom-in-btn`, `#zoom-out-btn`, `#zoom-reset-btn` click handlers inside the existing `DOMContentLoaded` block.
- Update the label and toggle disabled state on each change (disable `+` at MAX_ZOOM, `-` at MIN_ZOOM).

```js
// Inside applyZoom(), after setZoomFactor:
document.dispatchEvent(new CustomEvent('dashboard-zoom-changed', { detail: { factor: currentZoom } }));

// Expose public API for other modules
window.dashboardZoom = { zoomIn: () => changeZoom(STEP), zoomOut: () => changeZoom(-STEP), reset: () => applyZoom(1.0), getCurrent: () => currentZoom };

// Inside DOMContentLoaded:
const zoomInBtn  = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomLabel  = document.getElementById('zoom-level-label');

if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => changeZoom(STEP));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => changeZoom(-STEP));

function updateZoomUI() {
    if (zoomLabel)  zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
    if (zoomInBtn)  zoomInBtn.disabled  = currentZoom >= MAX_ZOOM;
    if (zoomOutBtn) zoomOutBtn.disabled = currentZoom <= MIN_ZOOM;
}

document.addEventListener('dashboard-zoom-changed', updateZoomUI);
updateZoomUI();
```

#### 2. `app/dashboard/index.html` — add zoom control group to header

Place the group immediately before `#theme-toggle` inside `<header id="top-bar">`:

```html
<div id="zoom-controls" title="Zoom (Ctrl+- / Ctrl+=)">
    <button id="zoom-out-btn" aria-label="Zoom out" title="Zoom out (Ctrl+-)">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
    </button>
    <span id="zoom-level-label">100%</span>
    <button id="zoom-in-btn" aria-label="Zoom in" title="Zoom in (Ctrl+=)">
        <i class="fa-solid fa-magnifying-glass-plus"></i>
    </button>
</div>
```

Double-click on the label resets zoom to 100% (handled in JS: `zoomLabel.addEventListener('dblclick', () => applyZoom(1.0))`).

#### 3. `app/dashboard/css/bootstrap-overrides.css` — style the control group

Style to match the existing lock/theme `<button>` pair:

```css
#zoom-controls {
    display: flex;
    align-items: center;
    gap: 2px;
}

#zoom-controls button {
    background: transparent;
    border: none;
    color: #B88F51;
    cursor: pointer;
    padding: 6px 8px;
    font-size: 14px;
    line-height: 1;
    border-radius: 3px;
    transition: background 250ms linear;
}

#zoom-controls button:hover:not(:disabled) {
    background: rgba(75, 75, 75, 1.0);
}

#zoom-controls button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

#zoom-level-label {
    font-size: 11px;
    color: #B88F51;
    min-width: 38px;
    text-align: center;
    font-family: monospace;
    cursor: default;
    user-select: none;
}

#zoom-level-label:hover {
    color: #d4a85a;
    cursor: pointer;
}
```

---

## Behaviour spec

| Action | Result |
|--------|--------|
| Click `−` | Zoom out 10%; button disabled at 50% |
| Click `+` | Zoom in 10%; button disabled at 200% |
| Double-click label | Reset to 100% |
| Ctrl+= / Ctrl+- / Ctrl+0 | Same as clicking buttons; label and disabled state update |
| Page reload | Previous zoom restored from `localStorage('dashboard_zoom')` |

---

## Verification

1. Launch the app — zoom controls appear in the header at `100%`.
2. Click `−` three times — label shows `70%`, panes shrink visibly, grid recalculates columns.
3. Click `+` past two clicks above the initial level — label updates, `+` disables at `200%`.
4. Double-click the label — resets to `100%`.
5. Use Ctrl+- from keyboard — label matches.
6. Reload — zoom is restored to the last saved level.
7. At `50%` the `−` button is disabled; at `200%` the `+` button is disabled.
