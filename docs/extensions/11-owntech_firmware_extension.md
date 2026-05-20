# Step 11 — OwnTech Firmware Workspace Extension Plan

## Summary

Add a built-in `Firmware Workspace` extension that gives Modular a Monaco-based editor for `Core`, backed by a managed PlatformIO runtime and a managed `clangd` runtime so C/C++ auto-completion and hover tooltips work out of the box.

The first version should:

- open a dedicated firmware editor window, separate from the dashboard DOM
- default to a focused file set: `src/main.cpp`, `src/app.ini`, `platformio.ini`, plus related local headers
- expose an advanced toggle that reveals a broader workspace tree when needed
- support both a managed `Core` copy in app storage and attaching an existing checkout such as `../Core`
- treat completion and hover as required acceptance criteria; definition navigation is enabled when `clangd` provides it but is not the primary v1 success gate

## Why This Step Exists

- Modular already has useful Electron/preload and extension seams, but no firmware authoring surface.
- Monaco can provide a VS Code-like editing experience, but C/C++ completion and hover require a real language backend.
- The current `Core` setup already behaves like a PlatformIO workspace and already produces a compile database under `.pio/build/.../compile_commands.json`, which makes `clangd` integration realistic.
- Managing PlatformIO and `clangd` inside Modular gives a lower-friction first-run experience than requiring the user to preinstall both tools globally.

## Target Architecture

Create a new built-in extension:

```text
app/extensions/owntech-workspace/
  manifest.json
  main.js
  renderer/...
  workspace-template/...
```

This extension becomes responsible for:

- opening the firmware editor window
- provisioning or attaching a `Core` workspace
- managing PlatformIO and `clangd` runtimes under `userData`
- exposing build/upload/indexing actions
- providing Monaco-backed C/C++ completion and hover

## Workspace Model

### Managed workspace

By default, the extension should provision a sanitized `Core` template into app-managed storage:

```text
userData/workspaces/core/
```

The template should exclude:

- `.git`
- `.pio`
- `venv`
- `old`
- other generated or archival directories

### Attached workspace

The extension should also allow attaching an existing local checkout such as `../Core`.

Expected behavior:

- persist the attached workspace path in extension state
- reopen that workspace on next launch
- restrict all editor file access to the active workspace root

### Focused versus advanced view

The first-run view should focus on:

- `src/main.cpp`
- `src/app.ini`
- `platformio.ini`
- nearby local headers if present

An advanced toggle should reveal broader workspace content such as:

- `owntech`
- `zephyr`
- other folders under the active workspace root

## Toolchain Model

### Managed PlatformIO

The extension should manage its own PlatformIO runtime under:

```text
userData/toolchains/platformio/
```

Behavior:

- detect whether the managed runtime is already installed
- if missing, show explicit install UI
- install per-user only
- do not perform silent system-wide installation
- do not require admin privileges for the normal path

### Managed clangd

The extension should manage its own `clangd` runtime under:

```text
userData/toolchains/clangd/
```

Behavior:

- `clangd` is required for v1 completion and hover
- detect/install it with the same explicit managed-runtime approach
- wire Monaco to `clangd` for hover, completion, diagnostics, and best-effort definition navigation

### Linux-first scope

v1 should target Linux first because the current environment and `Core` setup are Linux-based.

## Editor And Build UX

Add a dedicated `Firmware Workspace` BrowserWindow, not a dashboard widget or modal.

The window should contain:

- a file tree
- editor tabs
- a bottom build/output console
- an environment picker
- actions for:
  - `Install Toolchain`
  - `Build`
  - `Upload`
  - `Clean`
  - `Reindex`
  - `Attach Existing Workspace`

PlatformIO behavior:

- parse `platformio.ini` to list environments
- default to `default_envs`
- run build/upload/clean jobs with `cwd` set to the active workspace
- stream stdout/stderr and job state to the UI
- allow cancelling running jobs

## C/C++ Intelligence Behavior

Use `clangd` as the required backend for v1 C/C++ intelligence.

Compile database behavior:

- resolve the selected environment's compile database using the existing `.pio/build/<env>/compile_commands.json` pattern
- if the selected env does not yet have a compile database, prompt for or automatically run an indexing build before enabling full intelligence

Required v1 language features:

- completion
- hover/tooltips
- diagnostics

Best-effort v1 feature:

- definition navigation

## Public API Additions

Extend `app/main.js` and `app/preload.js` with a narrow firmware API surface:

- `window.api.firmwareWorkspace.getState()`
- `window.api.firmwareWorkspace.useManagedWorkspace()`
- `window.api.firmwareWorkspace.attachExistingWorkspace()`
- `window.api.firmwareWorkspace.listFiles()`
- `window.api.firmwareWorkspace.readFile(path)`
- `window.api.firmwareWorkspace.writeFile(path, content)`
- `window.api.firmwareWorkspace.setAdvancedMode(enabled)`
- `window.api.firmwareToolchain.getStatus()`
- `window.api.firmwareToolchain.install()`
- `window.api.firmwareBuild.listEnvs()`
- `window.api.firmwareBuild.selectEnv(env)`
- `window.api.firmwareBuild.build()`
- `window.api.firmwareBuild.upload()`
- `window.api.firmwareBuild.clean()`
- `window.api.firmwareBuild.reindex()`
- `window.api.firmwareBuild.cancel(jobId)`
- `window.api.firmwareBuild.onOutput(cb)`
- `window.api.firmwareBuild.onStateChange(cb)`

## Test Plan

### Unit tests

- detect managed runtime status correctly
- parse `platformio.ini` envs and `default_envs`
- enforce workspace-root-only file access
- resolve compile database path per selected env

### Integration tests

- managed workspace creation installs the sanitized template
- attaching an existing `Core` checkout persists and reopens correctly
- missing compile database triggers indexing/build flow
- toolchain install state transitions and log streaming behave correctly

### Playwright and Electron smoke

- open the firmware workspace window from the app
- switch between focused and advanced mode
- edit `src/main.cpp`, save, reopen, and verify persistence
- verify Monaco hover and completion are available in `main.cpp`
- run build and observe streamed console output and final success/failure state
- verify upload action starts only after toolchain, workspace, and env are valid

### Failure scenarios

- no network during toolchain install
- invalid attached workspace
- missing `platformio.ini`
- build failure and cancelled build
- `clangd` unavailable or compile database generation failure

## Commit Sequence

1. `docs(firmware): add managed firmware workspace architecture plan`
- Add this implementation plan and record the Linux-first, managed-runtime, focused-plus-advanced-toggle decisions.

2. `feat(firmware): add workspace state model and preload API skeleton`
- Add firmware workspace/toolchain/build API stubs in main/preload.
- Add persisted state for active workspace, selected env, and advanced mode.

3. `feat(firmware): add managed workspace provisioning and attach-existing flow`
- Add sanitized managed `Core` template install flow.
- Add existing-checkout attach flow and workspace-root path validation.

4. `feat(firmware): add dedicated firmware window shell with focused file tree`
- Add the BrowserWindow, Monaco host page, file tabs, focused file list, and advanced toggle.
- Wire file read/write to the new firmware workspace API.

5. `feat(firmware): add managed PlatformIO runtime and build console`
- Add toolchain detection and per-user install flow for PlatformIO.
- Add env discovery, build/clean/upload execution, job state, output streaming, and cancellation.

6. `feat(firmware): add clangd-managed C++ intelligence for Monaco`
- Add managed `clangd` install flow.
- Add compile-database resolution, reindex/build prerequisite logic, and Monaco bridge for completion, hover, diagnostics, and definition support.

7. `test(firmware): cover workspace lifecycle and toolchain failure paths`
- Add unit and integration coverage for workspace provisioning, env parsing, root restrictions, compile database handling, and install state transitions.

8. `test(e2e): add firmware workspace Electron smoke coverage`
- Add Playwright coverage for opening the firmware window, editing, completion/hover availability, build execution, advanced mode, and key error paths.

## Assumptions And Defaults

- completion and hover tooltips are mandatory for v1; definition navigation is secondary
- the editor window is a dedicated BrowserWindow, not an embedded dashboard widget or modal
- Modular manages both PlatformIO and `clangd` runtimes in app-owned storage
- v1 is Linux-first because the current environment and `Core` setup are Linux-based
- the default workspace is a managed `Core` copy, but users can attach an existing checkout like `../Core`
- the first-run editor is focused by default and exposes broader `owntech` and `zephyr` content only through an advanced toggle
