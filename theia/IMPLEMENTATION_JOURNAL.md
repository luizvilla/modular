# Theia Migration — Implementation Journal

Running log of environment issues, dependency quirks, and non-obvious decisions encountered during the migration. Add entries as new issues appear.

---

## Phase 0 — Feasibility Spike

### Node 18 build-time shim (`globalThis.File` / `globalThis.Blob`)

**File:** `applications/electron/scripts/node-compat.js`

`@theia/cli`'s build step references `globalThis.File` and `globalThis.Blob`, which became globals only in Node 21. On Node 18 the build exits immediately without them.

The shim is required via `NODE_OPTIONS=--require=./scripts/node-compat.js` in the `build` script. It is a no-op on Node 20+ and can be removed once the build environment is upgraded.

**Resolution:** Build-time shim in place. Track and remove when CI / developer machines are on Node 20 LTS.

---

### `libxkbfile-dev` is a required system library

`native-keymap` (a core Theia dependency for keyboard input in the Electron shell) compiles a native C++ addon that links against `libxkbfile`. Without the development headers the compile step fails during `npm install`.

On Ubuntu / Debian:

```bash
sudo apt-get install -y libxkbfile-dev
```

This is a one-time system setup step. It must be documented in any developer onboarding guide and added to CI machine provisioning.

**Resolution:** Manually installed. Not yet in any setup script — add before onboarding a second developer.

---

## Phase 1 — Product Bootstrap

### `@vscode/ripgrep` 1.18.0 breaks `@theia/native-webpack-plugin`

**File:** `package.json` (`overrides` field)

Theia's webpack plugin copies the ripgrep binary at build time by resolving `@vscode/ripgrep/bin/rg`. In `@vscode/ripgrep` 1.18.0 the binary moved to platform-specific sub-packages (`@vscode/ripgrep-linux-x64`, etc.) and the `exports` field in `package.json` no longer exposes `./bin/rg`. The webpack plugin has no knowledge of this layout change and fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

**Workaround:** Root `package.json` pins `@vscode/ripgrep` to `1.15.14` via `overrides`. This version has the binary at the expected path. The `@theia/application-manager` webpack generator is also patched in-place to force `ripgrep: false` as a belt-and-suspenders guard.

**Resolution:** Pinned. Watch for a Theia release that updates `@theia/native-webpack-plugin` to handle the 1.18+ layout; remove the override and patch when it lands.

---

### Electron version is determined by `@theia/electron`, not by the developer

`@theia/electron` exports an `electronRange` value that `@theia/application-manager` checks on every build. If the `electron` devDependency in `applications/electron/package.json` does not satisfy that range, the manager overwrites the field and aborts with "Updated dependencies, please run install again."

For Theia 1.71.1 the required version is `39.8.7`. Specifying any other range (e.g. `^34.0.0`) triggers the overwrite loop.

**Resolution:** Pin `"electron": "39.8.7"` exactly in `applications/electron/package.json`. Do not update independently of Theia; upgrade both together.

---

### `ELECTRON_RUN_AS_NODE=1` is set by VS Code in the shell environment

VS Code sets `ELECTRON_RUN_AS_NODE=1` in all terminal sessions it spawns, causing the Electron binary to behave as a plain Node.js runtime. In that mode `require('electron')` is not a built-in and `app` is `undefined`, crashing the Electron main process immediately.

**Resolution:** The `start` script in `applications/electron/package.json` explicitly unsets the variable:

```json
"start": "unset ELECTRON_RUN_AS_NODE && electron ."
```

This must stay in the script permanently for any developer running from VS Code or Claude Code.

---

### `FileDialogService` is bound by `@theia/filesystem`'s auto-loaded file-dialog module

`@theia/filesystem/package.json` lists three separate `theiaExtensions` entries: the main browser module, a download module, and `lib/browser/file-dialog/file-dialog-module`. All three are loaded automatically by Theia's application manager when `@theia/filesystem` appears in `dependencies`. Importantly, Electron targets also auto-load `lib/electron-browser/file-dialog/electron-file-dialog-module`, which replaces the default dialog implementation with native OS file pickers.

Because `FileDialogService` is already bound by those auto-loaded modules, it can be injected directly into any Theia extension without declaring an additional binding. Adding a second `bind(FileDialogService)` in the extension's own `ContainerModule` would throw a duplicate-binding error.

**Resolution:** Declare `@inject(FileDialogService)` on the widget class only; add the import from `@theia/filesystem/lib/browser/file-dialog/file-dialog-service`. No extra DI binding is needed.

---

### Dashboard-to-Theia postMessage bridge for cross-frame save and open

The embedded dashboard runs in an `<iframe>` that is same-origin with the Theia frontend (`http://localhost:{port}` in both cases), but direct DOM access across frames is fragile and timing-dependent. The cleaner approach is a `postMessage` bridge:

- **Save**: The Theia widget sends `{ type: 'modular:requestSave' }` to the iframe. The shim's `window.addEventListener('message', …)` handler calls `window.freeboard.serialize()` and posts `{ type: 'modular:saveData', json }` back to the parent. The widget receives this, shows Theia's `FileDialogService.showSaveDialog`, and POSTs the JSON to `POST /modular/dashboard-file` on the backend.

- **Open from dashboard UI**: The shim's `window.api.dashboard.openDashboardDialog` posts `{ type: 'modular:openDialog' }` to the parent and awaits a Promise that resolves when the parent posts back `{ type: 'modular:dialogResult', _role: 'openDialog', url }`. The parent shows Theia's `FileDialogService.showOpenDialog`, converts the selected path to the `/modular/dashboard-file?path=…` backend URL, and sends it back. The dashboard then fetches the file via `files.readText(url)`.

- **Open from Theia command**: The Theia widget calls `showOpenDialog` directly, sets `this.currentFileUri`, and calls `this.update()`. The `iframeSrc` getter recomputes to `…/dashboard.html#source=…/dashboard-file?path=…`, causing the iframe to reload from the new file.

**Important**: The `#source=` hash value must NOT be `encodeURIComponent`-encoded — Freeboard reads it raw via `window.location.hash`. The path component inside the `?path=` query string must be `encodeURIComponent`-encoded so the backend receives the correct absolute path.

---

### Relative backend URLs do not work in the Electron renderer

In the browser target Theia serves the frontend from the same HTTP server as the backend, so relative paths like `/modular/probe.json` resolve correctly. In the Electron target the renderer runs under a custom protocol (`file://` or `theia-app://`) and relative `fetch` calls and iframe `src` values do not route to the backend HTTP server.

Theia's `Endpoint` class (`@theia/core/lib/browser/endpoint`) handles this correctly: when the renderer protocol is `file:`, it reads the backend port from the `?port=` search parameter that the Electron main process injects into the frontend URL, and constructs `http://localhost:{port}/...` URLs automatically.

**Resolution:** All backend URLs in frontend code use `new Endpoint({ path: '...' }).getRestUrl().toString()` instead of bare relative strings. This works in both browser and Electron targets without branching.
