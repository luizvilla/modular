# Step 8 - Extensions Menu Plan

## Summary
- Replace the separate `Help` and `◎ OwnTech Examples` top-level menus with a single
  `Extensions` menu.
- Organise documentation by extension: each enabled extension gets its own labeled
  submenu containing its widget help and, where applicable, its examples documentation.
- Disabled extensions contribute nothing to the menu; the section disappears automatically.

## Why This Step Exists
- The current layout splits documentation across two unrelated menus (`Help → Widgets`
  for all extensions merged, and `◎ OwnTech Examples` for owntech only).
- Users have no way to know which widgets belong to which extension, and the attribution
  header inside `◎ OwnTech Examples` is a workaround rather than a structural solution.
- As extensions grow, separate top-level entries per extension would overrun the menubar.
  A single `Extensions` menu with one sub-section per extension scales cleanly.

## Target Menu Structure

```
Extensions
├── Core
│   └── Widgets Help  →  [Plots → [Fast Frame Plot, Time Plot, XY Plot, …],
│                          Gauges → [Gauge], …]
├── OwnTech
│   ├── Widgets Help  →  [Control → [Actions Panel, …], …]
│   └── Examples      →  [example-dir-tree…]
└── ThingSet
    └── Widgets Help  →  [ThingSet → [Device UI, Serial Device UI, …]]
```

Rules:
- Extensions are listed in inventory order: `core` first, then `owntech`, then `thingset`,
  then any future extensions alphabetically.
- An extension section appears only when the extension is enabled AND has at least one
  documentation contribution (widget docs or example roots).
- Within each section, `Widgets Help` appears before `Examples`.
- `Widgets Help` expands into a category → widget submenu (same logic as the current
  `buildWidgetDocsMenuItems`, scoped to one extension).
- `Examples` expands into the directory-tree submenu (same logic as the current
  `buildExamplesMenuItems`, scoped to one extension's example roots).
- If an extension has widget docs but no examples, only `Widgets Help` is shown.
- If an extension section ends up empty (edge case: docs roots declared but files missing),
  the section is omitted rather than shown as a dead entry.
- Multiple enabled extensions in one menu are separated by a `{ type: 'separator' }`.

## Goals
- Remove the `Help` top-level menu.
- Remove the `◎ OwnTech Examples` top-level menu (and its hard-coded label).
- Add a single `Extensions` top-level menu populated dynamically from the runtime inventory.
- Each extension section uses the extension's `displayName` (e.g., `Core`, `OwnTech`,
  `ThingSet`) as its group header (a disabled, non-clickable label) followed by its items.

## Non-Goals
- Do not change how widget doc tabs or example tabs are opened (existing `openWidgetDocTab`
  and `openExampleTab` stay untouched).
- Do not change the bootstrap data shape, preload surface, or any IPC handler.
- Do not add search or filtering within the menu — that belongs in the dashboard UI.
- Do not change what documents are indexed — only how they appear in the menu.

## Read First
- `app/main.js` — `buildWidgetDocsMenuItems()` (line 196), `buildExamplesMenuItems()` (line 151),
  `setAppMenu()` (line 421), the current `Help` and `OwnTech Examples` blocks (lines 492–517)
- `app/extensions/runtime.js` — `toInventoryEntry()` (line 567) to confirm `extensionId` is
  available on widgetDocs and exampleRoots entries via the bootstrap

## Dependencies
- Requires Step 7 (built-in enable/disable) to be complete so the inventory reliably reflects
  which extensions are active at menu-build time.

## Implementation Changes

### 1. Add `buildExtensionsMenuItems()`

Replace the two separate builder functions with one that iterates `extensionRuntime.inventory`
in order and builds a per-extension section for each enabled extension that has documentation.

```
function buildExtensionsMenuItems() {
    const sections = [];
    for (const ext of extensionRuntime.inventory) {
        if (!ext.enabled) continue;

        const widgetItems = buildWidgetDocsForExtension(ext.id);
        const exampleItems = buildExamplesForExtension(ext.id);

        if (!widgetItems.length && !exampleItems.length) continue;

        const items = [];
        if (widgetItems.length) items.push({ label: 'Widgets Help', submenu: widgetItems });
        if (exampleItems.length) items.push({ label: 'Examples', submenu: exampleItems });

        if (sections.length) sections.push({ type: 'separator' });
        sections.push({ label: ext.displayName, enabled: false });  // group header
        sections.push(...items);
    }
    return sections.length
        ? sections
        : [{ label: 'No extension documentation found', enabled: false }];
}
```

### 2. Add `buildWidgetDocsForExtension(extensionId)`

Scope `buildWidgetDocsMenuItems` to a single extension by filtering on `extensionId`:

```
function buildWidgetDocsForExtension(extensionId) {
    // Filter widgetDocs to this extension, then apply the existing
    // category grouping and sorting logic.
}
```

### 3. Add `buildExamplesForExtension(extensionId)`

Scope `buildExamplesMenuItems` to a single extension by filtering `exampleRoots` on
`extensionId`:

```
function buildExamplesForExtension(extensionId) {
    const roots = extensionRuntime.bootstrap.exampleRoots.filter(
        (r) => r.extensionId === extensionId
    );
    // Then apply the existing collectReadmesFromRoots + tree-build logic.
}
```

### 4. Update `setAppMenu()`

- Remove the calls to `buildExamplesMenuItems()` and `buildWidgetDocsMenuItems()`.
- Remove the `Help` top-level menu entry.
- Remove the `OwnTech Examples` top-level menu entry (including the attribution header logic).
- Add a single `Extensions` top-level menu entry whose submenu is `buildExtensionsMenuItems()`.

The old builder functions (`buildWidgetDocsMenuItems`, `buildExamplesMenuItems`,
`collectReadmesFromRoots`, `collectReadmes`) can be removed or collapsed into the new helpers.

## Test Plan
- No new IPC surface is introduced, so no preload or unit test changes are needed.
- The existing `electron-smoke.spec.js` assertions on `bootstrap.widgetDocsRoots`,
  `bootstrap.exampleRoots`, and renderer scripts are unaffected (those test data, not menu labels).
- Manual verification: launch the app and confirm:
  - `Extensions` menu appears in the menubar.
  - `Help` and `◎ OwnTech Examples` are gone.
  - Core section shows only core widgets (Fast Frame Plot, Time Plot, XY Plot, Gauge, etc.).
  - OwnTech section shows its widgets and an Examples submenu.
  - ThingSet section shows its widgets.
  - Disabling OwnTech via Extension Manager + restart removes the OwnTech section entirely.

## Acceptance Criteria
- The menubar has exactly one documentation menu named `Extensions`.
- Documentation is grouped by extension with the extension's `displayName` as the header.
- Disabled extensions are absent from the menu.
- Clicking a widget entry opens the widget doc tab; clicking an example entry opens the
  example tab — same behaviour as today.
- No hard-coded extension names remain in the menu-building code (labels come from
  `ext.displayName`; the only new hard-coded string is `'Extensions'` for the menu title).

## Risks
- Electron on Linux does not render disabled menu items as visual section headers;
  the `{ label: ext.displayName, enabled: false }` entry will appear grayed out, which is
  acceptable and consistent with how the attribution header was already rendered.
- If all extensions are disabled (pathological case), the Extensions menu shows the
  "No extension documentation found" placeholder rather than disappearing, since a top-level
  menu with no submenu crashes Electron's menu builder.

## Commit Sequence

1. `docs(extensions): add step 8 extensions menu plan`
   - Create this markdown plan.

2. `feat(menu): replace Help and OwnTech Examples with a unified Extensions menu`
   - Add `buildWidgetDocsForExtension()` and `buildExamplesForExtension()` helpers.
   - Add `buildExtensionsMenuItems()` that iterates the inventory.
   - Update `setAppMenu()` to use the new function.
   - Remove the old `Help` and `OwnTech Examples` menu entries and the now-unused builder
     functions.
