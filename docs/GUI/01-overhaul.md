# GUI Overhaul Plan

## Context

The application is an Electron 36 app using the Freeboard dashboard framework, Bootstrap 5.3.2 (Darkly dark theme), and Knockout.js for data binding. Key files:

- `app/dashboard/index.html` — main HTML template
- `app/dashboard/css/bootstrap-overrides.css` — header, panel, datasource layout overrides
- `app/dashboard/css/tabs.css` — tab strip and doc panel styling
- `app/dashboard/js/freeboard.js` — Knockout models, datasource list bindings
- `app/dashboard/js/tabs.js` — tab navigation logic
- `app/main.js` — Electron main process (header toggle animation, native theme)

## Target Layout (after overhaul)

```
┌────────────────────────────────────────────────┐
│  [modular]  [New] [Open] [Save] [+Pane] [☀/☾]  │  ← fixed top bar
├──────────┬─────────────────────────────────────┤
│ ▲        │                                     │
│ datasrc  │                                     │
│ list     │         board content               │
│ ──────── │         (gridster panes)             │
│ datasrc  │                                     │
│ details  │                                     │
│ ▼        │                                     │
├──────────┴─────────────────────────────────────┤
│  [Dashboard]  [Examples]  [Courseware]  [Docs]  │  ← tabs at bottom
└────────────────────────────────────────────────┘
```

The left pane has a collapse toggle on its right edge. When collapsed, the board content fills the full width.

---

## Phase 1 — Top Bar: Logo + Buttons in One Row

### Goal
Remove the collapsible header. Place the "modular" brand and all action buttons in a single horizontal toolbar row, flush top of the viewport.

### What changes

**`app/dashboard/index.html`**
- Flatten `#admin-brand-band` + `#board-tools` into a single `#top-bar` flex row.
- Remove `#toggle-header` (the collapse chevron).
- Remove `#admin-workspace` from the header — datasources move to Phase 2.
- Add a `#theme-toggle` button (sun/moon icon) as the rightmost item in `#top-bar`.
- Move `#admin-bar` / `#admin-menu` wrapper to become `#top-bar` directly.

**Resulting HTML skeleton:**
```html
<header id="top-bar">
  <h1 id="board-logo">modular</h1>
  <ul id="board-actions" class="board-toolbar board-toolbar--header">
    <li data-bind="click: newBoard">        <i class="fa fa-file"></i>       </li>
    <li data-bind="click: openBoard">       <i class="fa fa-folder-open"></i></li>
    <li data-bind="click: saveBoard">       <i class="fa fa-floppy-disk"></i></li>
    <li data-bind="click: addPane">         <i class="fa fa-plus"></i>       </li>
    <li id="theme-toggle">                  <i class="fa fa-sun"></i>         </li>
  </ul>
</header>
```

**`app/dashboard/css/bootstrap-overrides.css`**
- Replace `#admin-bar` / `#admin-menu` / `#admin-brand-band` rules with `#top-bar`.
- `#top-bar`: `display:flex; align-items:center; gap:16px; padding:8px 16px; position:fixed; top:0; left:0; right:0; height:var(--topbar-height,52px); z-index:850;`
- `#board-logo`: `margin:0; font-size:1.4rem; flex:0 0 auto;`
- `#board-actions`: `margin-left:8px; flex:0 0 auto;` (buttons stay left of logo, logo first)
- `#theme-toggle`: `margin-left:auto;` (pushes it to the far right)
- Remove all rules for `#toggle-header`, `#admin-menu`, `#admin-brand-band`, `#admin-workspace`, `#datasources` in its current location.

**`app/dashboard/js/freeboard.js`**
- Remove `toggleHeader` / `headerVisible` observable and any animation logic tied to `#main-header` collapse.
- `allow_edit` guard: top bar is always visible; keep it governing only the add/edit/delete actions (not the bar itself).

**`app/main.js`**
- Remove the IPC handler that drives header height animation (lines ~974–986).

---

## Phase 2 — Left Side Pane: Datasources

### Goal
Move the datasource list into a collapsible vertical side pane on the left. The pane is split into two regions: top = datasource list, bottom = selected datasource detail.

### Structure

```
#side-pane (fixed, left, below top bar, above bottom tabs)
├── #side-pane-toggle (button on right edge, collapses/expands)
├── #side-pane-list   (top half — scrollable datasource list)
│   ├── h2 "DATASOURCES"
│   ├── table#datasources-list  (existing Knockout binding)
│   └── span "ADD" button
└── #side-pane-detail (bottom half — detail panel for selected datasource)
    ├── h2 "DETAILS"
    └── #datasource-detail-content (name, settings summary, last updated, pause/refresh/delete toolbar)
```

The pane and board content are siblings in a flex row. When collapsed, `#side-pane` has `width:0; overflow:hidden` and `#board-content` fills the remaining space.

### What changes

**`app/dashboard/index.html`**
- Wrap `#board-content` and a new `#side-pane` in a `#main-area` flex container.
- Cut the datasource table markup from `#admin-workspace` and paste it into `#side-pane-list`.
- Add `#side-pane-detail` below the list with a Knockout `if: selectedDatasource()` binding.
- Add `#side-pane-toggle` button (chevron left/right icon).

**Resulting skeleton:**
```html
<div id="main-area">
  <aside id="side-pane" class="side-pane">
    <button id="side-pane-toggle" aria-label="Toggle datasource pane">
      <i id="side-pane-chevron" class="fa fa-chevron-left"></i>
    </button>
    <div id="side-pane-list">
      <h2 class="title">DATASOURCES</h2>
      <div class="datasource-list-container">
        <!-- existing table#datasources-list markup, unchanged -->
      </div>
      <span class="add-button" data-bind="pluginEditor: {operation:'add',type:'datasource'}">ADD</span>
    </div>
    <div id="side-pane-detail" data-bind="if: selectedDatasource">
      <!-- detail content bound to selectedDatasource() -->
    </div>
  </aside>
  <div id="board-content"></div>
</div>
```

**`app/dashboard/css/bootstrap-overrides.css`** — new rules:
```css
#main-area {
  display: flex;
  flex-direction: row;
  height: calc(100vh - var(--topbar-height) - var(--tabbar-height));
  margin-top: var(--topbar-height);
  margin-bottom: var(--tabbar-height);
}

#side-pane {
  position: relative;
  width: var(--side-pane-width, 280px);
  min-width: 0;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
  border-right: 1px solid rgba(255,255,255,0.08);
}

#side-pane.collapsed { width: 0; }

#side-pane-toggle {
  position: absolute;
  right: -14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  /* pill-shaped toggle button */
}

#side-pane-list {
  flex: 1 1 50%;
  overflow-y: auto;
  padding: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

#side-pane-detail {
  flex: 0 0 50%;
  overflow-y: auto;
  padding: 12px;
}

#board-content {
  flex: 1 1 0;
  overflow-y: auto;
  /* remove any top/bottom margin that compensated for old header */
}
```

**`app/dashboard/js/freeboard.js`**
- Add `selectedDatasource` observable (set when user clicks a datasource row).
- Wire up datasource row click to set `selectedDatasource` and populate the detail panel.
- `#side-pane-toggle` click handler: toggle `.collapsed` class on `#side-pane`, flip chevron direction, persist state to `localStorage`.

**Restore state on load:**
```js
const paneCollapsed = localStorage.getItem('sidePaneCollapsed') === 'true';
document.getElementById('side-pane').classList.toggle('collapsed', paneCollapsed);
```

### Detail panel content
When a datasource is selected, show:
- Name (editable inline or via existing pluginEditor)
- Plugin type (read-only)
- Last updated timestamp
- Settings summary (key/value list rendered from `settings()`)
- Action toolbar: Refresh, Pause/Resume, Edit (opens pluginEditor), Delete

This reuses existing Knockout bindings, just in a new location.

---

## Phase 3 — Tabs at the Bottom

### Goal
Move the tab strip from the top of the viewport to the bottom, above the OS taskbar. The doc panel (Examples, Courseware, Widget Docs) opens upward from the tab bar.

### What changes

**`app/dashboard/css/tabs.css`**
- Change `#app-tabs` from `top:0` to `bottom:0`; keep `position:fixed; left:0; right:0`.
- `--tabbar-height`: already defined; ensure it matches the tabs strip height.
- `.tab-strip`: `flex-direction: row;` (unchanged), but now anchored at bottom.
- `#doc-panel`: change `margin-top` to `margin-bottom: var(--tabbar-height)` and position it above the tab bar:
  - `bottom: var(--tabbar-height); top: var(--topbar-height);`
  - This makes it a full-height overlay above the tab bar when active.

**`app/dashboard/index.html`**
- Move `<div id="app-tabs">` from before `#board-content` to after it (or simply rely on `position:fixed; bottom:0`). No structural move strictly needed if using fixed positioning, but moving it last in the DOM is cleaner and matches visual order.

**`app/dashboard/js/tabs.js`**
- No logic changes needed; the tab switching and doc panel show/hide are position-agnostic.

---

## Phase 4 — Light / Dark Mode

### Goal
Add a toggle in the top bar that switches between the existing dark theme and a new light theme. Preference is persisted across sessions.

### Approach

Use a CSS class on `<html>` (`.theme-light`) to override Bootstrap Darkly CSS custom properties. Dark is the default (no class needed).

**`app/dashboard/css/bootstrap-overrides.css`** — new section:
```css
/* Light theme overrides — applied via <html class="theme-light"> */
html.theme-light {
  --bs-body-bg: #f5f5f5;
  --bs-body-color: #1a1a1a;
  --bs-dark-rgb: 240,240,240;   /* inverts Bootstrap Darkly dark surfaces */
  color-scheme: light;
}

html.theme-light #top-bar       { background: #ffffff; border-bottom: 1px solid #ddd; }
html.theme-light #side-pane     { background: #fafafa; border-color: #ddd; }
html.theme-light .board-toolbar--header li { background: #f0f0f0; border-color: #ccc; color: #333; }
html.theme-light .pane-header   { background: #e8e8e8; }
html.theme-light #app-tabs      { background: #ffffff; border-top: 1px solid #ddd; }
html.theme-light .tab           { color: #444; }
html.theme-light .tab.active    { color: #000; border-bottom: 3px solid #e3b060; }
/* Add more overrides iteratively as visual review reveals gaps */
```

**`app/dashboard/js/freeboard.js`** (or a new `theme.js` module):
```js
const THEME_KEY = 'modular-theme';

function applyTheme(theme) {
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  const icon = document.querySelector('#theme-toggle i');
  if (icon) icon.className = theme === 'light' ? 'fa fa-moon' : 'fa fa-sun';
}

function toggleTheme() {
  const current = localStorage.getItem(THEME_KEY) || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// On load:
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
```

**`app/main.js`** — sync Electron native theme for window chrome:
```js
const { nativeTheme } = require('electron');
ipcMain.on('set-theme', (_, theme) => {
  nativeTheme.themeSource = theme; // 'light' | 'dark'
});
```

Renderer sends `window.electronAPI.setTheme(theme)` via the existing preload bridge after each toggle.

---

## CSS Custom Properties (variables to define once)

Add to `:root` in `bootstrap-overrides.css`:

```css
:root {
  --topbar-height:  52px;
  --tabbar-height:  44px;
  --side-pane-width: 280px;
}
```

These are already partially in place (`--tabs-height`); unify them under the names above.

---

## Implementation Order

| Step | Scope | Effort |
|------|-------|--------|
| 1. CSS variables unification | CSS only | Small |
| 2. Top bar flattening | HTML + CSS + remove JS toggle | Medium |
| 3. Tabs to bottom | CSS only (position change) | Small |
| 4. Left pane scaffold | HTML + CSS | Medium |
| 5. Datasource move into pane | HTML refactor + Knockout wiring | Medium |
| 6. Datasource detail panel | Knockout model + HTML | Medium |
| 7. Side pane collapse logic | JS + CSS | Small |
| 8. Light/dark toggle | CSS overrides + JS | Medium |
| 9. Electron native theme sync | main.js + preload IPC | Small |

Start with steps 1–3 (pure CSS/layout changes with no logic risk) to validate the overall shape before touching the Knockout model.

---

## Commit Pattern

One commit per step. Use Conventional Commits: `type(scope): description`.

Scopes follow the UI area being changed: `layout` for structural/CSS changes, `topbar`, `side-pane`, `tabs`, `theme`.

| Step | Commit message |
|------|----------------|
| 1 | `refactor(layout): unify CSS custom properties for topbar, tabbar, and side-pane widths` |
| 2 | `feat(topbar): flatten logo and actions into a single fixed toolbar row` |
| 3 | `feat(tabs): move tab strip to bottom of viewport` |
| 4 | `feat(side-pane): scaffold collapsible left pane with CSS layout` |
| 5 | `feat(side-pane): move datasource list into left pane` |
| 6 | `feat(side-pane): add datasource detail panel with Knockout binding` |
| 7 | `feat(side-pane): add collapse toggle with localStorage persistence` |
| 8 | `feat(theme): add light/dark toggle with CSS overrides` |
| 9 | `feat(theme): sync light/dark preference to Electron native theme` |

Each step should leave the app in a working, visually consistent state. Never commit a half-wired Knockout binding or a layout that breaks existing widgets. If a step turns out to require more than ~200 lines of diff, split it and number the commit `feat(scope): ... (1/2)` / `(2/2)`.

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `app/dashboard/index.html` | Restructure header, add `#main-area`, `#side-pane`, move datasource markup, move `#app-tabs` to bottom |
| `app/dashboard/css/bootstrap-overrides.css` | Replace header rules, add side-pane rules, add light-theme overrides, add CSS variables |
| `app/dashboard/css/tabs.css` | Reposition `#app-tabs` to bottom, adjust `#doc-panel` to open upward |
| `app/dashboard/js/freeboard.js` | Remove header toggle, add `selectedDatasource` observable, add side-pane collapse logic, add theme toggle handler |
| `app/main.js` | Remove header animation IPC, add `set-theme` IPC handler |
| `app/preload.js` | Expose `setTheme` via existing `electronAPI` bridge |
