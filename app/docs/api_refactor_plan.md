# API Refactor Plan - Inventory and Mapping

Goal: move all renderer Node/Electron usage behind a preload API (`window.api`)
<!-- Paths updated after runtime move into app/. -->
so widgets/tabs are pure frontend and privileged work stays in `app/main.js`.

## Renderer back-end touchpoints to remove

### Direct Node/Electron usage in renderer
- `app/dashboard/js/tabs.js`: `window.require('electron'|'fs'|'path'|'url')`
- `app/dashboard/js/dashboard_control.js`: `require('electron')`, `require('fs')`
- `app/dashboard/js/activity_toasts.js`: `window.require('electron')`
- `app/dashboard/examples/example_viewer.js`: `require('electron')`, `require('fs')`
- Many plugins/widgets use `window.require('electron').ipcRenderer`

### Renderer file system access
- `app/dashboard/js/tabs.js`: `fs.promises.readdir`, `fs.promises.readFile`
- `app/dashboard/js/dashboard_control.js`: `fs.promises.readFile`
- `app/dashboard/examples/example_viewer.js`: `fs.promises.readdir`, `fs.promises.readFile`

### Renderer IPC usage (selected)
- `tabs.js`: `get-serial-ports`, `load-dashboard-from-path`, `start-flash`,
  `get-pending-example-tab`, `open-example-tab` events, `undock-doc-tab`
- `dashboard_control.js`: `show-open-dashboard`, `menu-load-dashboard`,
  `menu-save-dashboard`, `load-dashboard-from-path`, `renderer-log`
- `example_viewer.js`: `get-serial-ports`, `load-dashboard-from-path`,
  `start-flash`, `flash-progress`, `flash-complete`, `example-select`

## Main-process IPC channels (source of truth)

From `app/main.js` (inventory, 2026-02-04):
- UI/menu: `show-open-dashboard`, `renderer-log`, `load-dashboard-from-path`,
  `get-pending-example-tab`, `open-example-tab` (send), `undock-doc-tab`,
  `example-active-id`
- Serial: `get-serial-ports`, `open-serial-port`, `close-serial-port`,
  `reopen-serial-port`, `release-serial-port`, `is-serial-port-open`,
  `write-serial-port`, `get-serial-buffer`, `get-terminal-buffer`,
  `get-fast-dataset`, `flush-serial-buffers`, `get-serial-headers`,
  `set-serial-headers`, `get-serial-colors`, `set-serial-colors`,
  `start-csv-record`, `stop-csv-record`, `save-fast-csv`
- Flashing: `choose-firmware-file`, `start-flash`, `cancel-flash`,
  `start-flash-can`, `cancel-flash-can`
- ThingSet serial: `ts-serial-detect`, `ts-serial-tree`,
  `ts-serial-get-value`, `ts-serial-set-value`, `ts-serial-create`,
  `ts-serial-delete`, `ts-serial-exec`
- CAN/ThingSet CAN: `can-open`, `can-close`, `can-scan-nodes`,
  `can-build-trees`, `can-aggregate-start`, `can-aggregate-stop`,
  `can-aggregate-set-debug`, `can-aggregate-snapshot`, `can-setup-linux`,
  `can-is-up`, `get-can-interfaces`, `get-thingset-nodes`,
  `ts-get`, `ts-fetch`, `ts-update`, `ts-create`, `ts-delete`, `ts-exec`,
  `ts-paths-for-ids`, `ts-ids-for-paths`

## Proposed preload API surface (draft)

Expose a small `window.api` grouped by domain:
- `window.api.docs`
  - `listExamples(baseDir)`
  - `readMarkdown(path)`
- `window.api.dashboard`
  - `openDashboardDialog()`
  - `loadDashboardFromPath(path)`
  - `onMenuLoadDashboard(cb)`
  - `onMenuSaveDashboard(cb)`
- `window.api.serial`
  - `listPorts()`
  - `openPort(payload)`
  - `closePort(path)`
  - `reopenPort(path)`
  - `isOpen(path)`
  - `write(path, data)`
  - `getBuffer(path)`
  - `getTerminalBuffer(path)`
  - `getFastDataset(path)`
  - `getHeaders(path, type)`
  - `setHeaders(path, headers, type)`
  - `getColors(path, type)`
  - `setColors(path, colors, type)`
  - `flush(path)`
  - `startCsvRecord(payload)`
  - `stopCsvRecord(path)`
  - `saveFastCsv(payload)`
- `window.api.flash`
  - `chooseFirmwareFile()`
  - `startFlash(payload)`
  - `cancelFlash()`
  - `startFlashCan(payload)`
  - `cancelFlashCan()`
  - `onFlashProgress(cb)`
  - `onFlashComplete(cb)`
- `window.api.thingsetSerial`
  - `detect(payload)`
  - `tree(payload)`
  - `getValue(payload)`
  - `setValue(payload)`
  - `create(payload)`
  - `delete(payload)`
  - `exec(payload)`
- `window.api.can`
  - `open(payload)`
  - `close(payload)`
  - `scanNodes(payload)`
  - `buildTrees(payload)`
  - `aggregateStart(payload)`
  - `aggregateStop(payload)`
  - `aggregateSetDebug(payload)`
  - `aggregateSnapshot(payload)`
  - `setupLinux()`
  - `isUp(payload)`
  - `getInterfaces()`
  - `getThingSetNodes()`
- `window.api.thingset`
  - `get(payload)`, `fetch(payload)`, `update(payload)`,
    `create(payload)`, `delete(payload)`, `exec(payload)`,
    `pathsForIds(payload)`, `idsForPaths(payload)`
- `window.api.examples`
  - `openExampleTab(id)` (send)
  - `onOpenExampleTab(cb)` (listen)
  - `setActiveExampleId(id)` (send)
  - `onExampleSelect(cb)` (listen)
  - `getPendingExampleTab()`
  - `onDockPreview(cb)` (listen)
  - `undockDocTab(id)` (send)

## Migration order (commit-level)
1. Preload + strict webPreferences behind a shim.
2. Add IPC parity layer.
3. Move core UI (tabs/control/toasts/example_viewer).
4. Move datasources (serialfast/serialowntech/thingset/can).
5. Move widgets (serial*, ts*, uplot/vertical_gauge).
6. Remove shim + lock down.
