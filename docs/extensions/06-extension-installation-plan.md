# Step 6 - Extension Installation Plan

## Summary
- Define an installable extension bundle format.
- Add a local extension manager that can install, enable, disable, and uninstall extensions from disk.
- Keep local source-loaded development supported for in-repo work.
- Do not require remote download infrastructure in this first pass.

## Why This Step Exists
- Once the ThingSet/CAN boundary (Step 5) is proven, the runtime and metadata contracts are stable enough to support external distribution.
- An installable bundle format allows extensions to live outside the core repo without requiring checked-in compiled output.
- A local manager is the minimal step toward eventual remote distribution without coupling the two problems.

## Goals
- Define a bundle format that includes manifest, main entry, renderer assets, docs, and optional integrity metadata.
- Support two modes: source-loaded (in-repo development) and installed-bundle (external distribution).
- Install bundles into a managed path under `userData`.
- Surface installation state through `window.api.extensions`.

## Non-Goals
- Do not solve trust or sandboxing for arbitrary third-party plugins.
- Do not require or implement remote download infrastructure.
- Do not check compiled extension bundles into the core repo as a permanent policy.

## Read First
- `app/extensions/runtime.js`
- `app/main.js`
- `app/preload.js`
- `docs/extensions/01-core-extension-runtime-plan.md`
- `docs/extensions/05-thingset-can-boundary-plan.md`

## Dependencies
- Requires Step 5 to be complete and stable. The bundle format and manager should not be designed until the local extension boundaries are proven.

## Core Versus Extension Boundary

### Core Should Own
- Extension discovery (source-loaded and installed-bundle paths)
- Bundle loader and integrity check
- Install, enable, disable, and uninstall lifecycle
- `window.api.extensions` surface for manager UI

### Extensions Should Own
- Their own source or built bundle
- Their own versioning and release process

## Implementation Changes

### 1. Define The Bundle Format
- A bundle is a directory or archive containing:
  - `manifest.json`
  - `bundle-main.js` (main-process entry, if any)
  - `renderer/` (renderer scripts and assets)
  - `docs/` and `examples/` (optional)
  - `checksums.json` (optional integrity metadata)
- Install path: `userData/extensions/<id>/<version>/`

### 2. Add Bundle Loader To Runtime
- Extend `buildExtensionRuntime()` to discover installed bundles in addition to source-loaded extensions.
- Validate bundle integrity against `checksums.json` if present.
- Emit warnings for malformed or missing bundles rather than hard-crashing.

### 3. Add Local Extension Manager
- Install a local extension bundle from disk.
- Enable or disable an installed extension.
- Uninstall an extension (remove from managed storage).
- Surface installation state through `window.api.extensions`.
- Keep the manager local-first; network distribution comes later.

### 4. Add Manager UI Surface

- Add an "Extension Manager" item to the app menu under Edit.
- The menu handler sends `mainWindow.webContents.send('open-extension-manager')` via IPC.
- The renderer listens and shows a full-screen modal overlay on top of the dashboard — no new BrowserWindow or HTML page required.
- The modal lists installed extensions with enable/disable/uninstall controls.
- An "Install from file…" button triggers `dialog.showOpenDialog` via IPC to pick a local bundle from disk.
- Reuse existing extension inventory from `window.api.extensions.getBootstrap()` where possible.
- The modal can be promoted to a dedicated BrowserWindow in a later step if the manager outgrows it.

## Source Versus Compiled Output Policy
- During local development, the repo holds source code, not compiled extension bundles.
- For external installation:
  - the extension repo holds source
  - its release process produces an installable built bundle
  - the core app loads that installed bundle from managed storage
- A checked-in `compiled` directory in the core repo should be avoided unless a short-lived bootstrap proves unavoidable.

## Test Plan
- Add focused tests for install and uninstall flows.
- Update `tests/e2e/electron-smoke.spec.js` to assert installed-bundle discovery alongside source-loaded extensions.
- Update `tests/e2e/error-cases.spec.js` for:
  - missing bundle
  - malformed bundle
  - integrity check failure
  - install into a path that already exists

## Acceptance Criteria
- The app can install and enable a local extension bundle from disk.
- Installed bundles are discovered alongside source-loaded extensions at boot.
- The core repo does not need checked-in compiled extension output to keep development working.
- Install, enable, disable, and uninstall operations surface through `window.api.extensions`.

## Risks
- Installer logic can accidentally overreach if it is designed for arbitrary code trust instead of internal controlled extensions.
- Bundle path collisions between source-loaded and installed-bundle modes must be handled explicitly.
- Integrity checks that are too strict will block legitimate developer workflows; too loose and they provide no value.

## Commit Sequence
1. `docs(extensions): add step 6 extension installation plan`
   - Create this markdown plan.
   - Freeze the bundle format and manager scope.

2. `build(extensions): define installable bundle format and managed install path`
   - Add the first bundle schema and loader rules.
   - Extend runtime discovery to cover installed bundles alongside source-loaded extensions.

3. `feat(extension-manager): add local install, enable, disable, and uninstall flows`
   - Surface installed extension state through `window.api.extensions`.

4. `feat(extension-manager): add minimal manager UI`
   - List installed extensions with enable/disable/uninstall controls.

5. `test(extensions): cover install flows, error paths, and smoke regressions`
   - Extend focused Playwright coverage for install/uninstall and boot-time discovery.
