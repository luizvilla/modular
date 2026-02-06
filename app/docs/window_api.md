# Renderer API (window.api)

This app exposes a preload bridge at `window.api`. Renderer code should use
these methods instead of `window.require` or direct Node/Electron APIs.

## dashboard
- `openDashboardDialog()`
- `loadDashboardFromPath(dashboardPath)`
- `onMenuLoadDashboard(cb)`
- `onMenuSaveDashboard(cb)`
- `onLoadDashboardFromPath(cb)`
- `onShowWidgetCategories(cb)`

## docs
- `listReadmes(baseDir)`
- `readMarkdown(docPath)`

## files
- `readText(filePath)`
- `writeText(filePath, content)`
- `listDir(dirPath)`

## serial
- `listPorts()`
- `openPort(payload)`
- `closePort(path)`
- `reopenPort(path)`
- `releasePort(payload)`
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

## flash
- `chooseFirmwareFile()`
- `startFlash(payload)`
- `cancelFlash()`
- `startFlashCan(payload)`
- `cancelFlashCan()`
- `onProgress(cb)`
- `onComplete(cb)`

## thingsetSerial
- `detect(payload)`
- `tree(payload)`
- `getValue(payload)`
- `setValue(payload)`
- `create(payload)`
- `delete(payload)`
- `exec(payload)`

## can
- `getInterfaces()`
- `getThingSetNodes()`
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

## thingset (CAN)
- `get(payload)`
- `fetch(payload)`
- `update(payload)`
- `create(payload)`
- `delete(payload)`
- `exec(payload)`
- `pathsForIds(payload)`
- `idsForPaths(payload)`

## examples
- `openExampleTab(id)`
- `onOpenExampleTab(cb)`
- `setActiveExampleId(id)`
- `onExampleSelect(cb)`
- `onDockPreview(cb)`
- `undockDocTab(id)`
- `getPendingExampleTab()`

## activity
- `on(cb)`

## logger
- `log(level, args)`

## paths
- `dirname(path)`
- `resolve(...parts)`
- `join(...parts)`
- `relative(from, to)`
- `isAbsolute(path)`
- `sep`
- `cwd()`
- `toFileUrl(path)`
