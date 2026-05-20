# Step 12 — OwnTech Firmware Workspace Phased Delivery Plan

## Summary

Split the firmware workspace work from step 11 into implementation sessions that can be delivered incrementally without attempting the full feature set in one pass.

The main goal of this phased plan is to:

- land useful value early
- separate low-risk infrastructure work from high-risk toolchain work
- defer the most expensive integration points until the feature already has practical value
- make the feature easier to stop, ship, and resume between sessions

This phased plan assumes:

- step 11 remains the target architecture
- sessions may span more than one coding turn, but each session should still be independently reviewable and testable
- the highest-cost items are managed PlatformIO installation and managed `clangd` integration

## Delivery Strategy

The feature should be built in this order:

1. window and extension shell
2. attach existing `Core` workspace and edit files
3. Monaco editor shell
4. basic build flow using an already-installed local `pio`
5. upload support and minimum coverage
6. managed PlatformIO runtime
7. managed `clangd` and C/C++ intelligence
8. hardening and broader failure-path coverage

This ordering ensures the project becomes useful before the installer and language-server work begins.

## Session 1 — Extension Skeleton And Firmware Window

Goal:

- create the extension shell and a dedicated firmware editor window with no real firmware logic yet

Deliverables:

- add `owntech-workspace` built-in extension manifest and main entry
- add a `Firmware Workspace` menu action or launcher
- open a dedicated BrowserWindow for firmware work
- add preload API stubs for `firmwareWorkspace`, `firmwareToolchain`, and `firmwareBuild`
- render a minimal window shell with placeholder panes:
  - file tree area
  - editor tab area
  - output console area
  - toolbar with disabled actions

Out of scope:

- no Monaco yet
- no file editing
- no PlatformIO
- no `clangd`

Acceptance:

- the window opens reliably
- the preload API exists in the firmware window
- the new extension does not break existing Electron smoke behavior

## Session 2 — Attach Existing Core And Basic File Editing

Goal:

- make the window useful against an existing checkout such as `../Core`

Deliverables:

- add `Attach Existing Workspace` flow
- persist the selected workspace path in user data
- validate and restrict access to the workspace root
- add focused file list support for:
  - `src/main.cpp`
  - `src/app.ini`
  - `platformio.ini`
- add file open, read, edit, and save
- add advanced-mode toggle that reveals a broader workspace tree

Out of scope:

- no managed workspace copy yet
- no build actions
- no language intelligence

Acceptance:

- attach `../Core`
- open and save `src/main.cpp`
- reopen Modular and recover the same attached workspace
- advanced toggle reveals more of the workspace without exposing paths outside the root

## Session 3 — Monaco Integration Without C/C++ Intelligence

Goal:

- replace the plain editor area with Monaco and get a solid editing experience

Deliverables:

- embed Monaco in the firmware window
- add syntax highlighting and normal code editor UX
- add multiple open tabs and dirty-state handling
- keep focused-mode and advanced-mode behavior
- preserve file read/write APIs from session 2

Out of scope:

- no `clangd`
- no completion or hover promises yet
- no build pipeline

Acceptance:

- open `main.cpp` in Monaco
- edit, save, and reopen works
- tabs behave properly
- the firmware window feels stable enough for real editing

## Session 4 — Basic PlatformIO Build Using Existing Local pio

Goal:

- make the feature useful with minimal toolchain scope

Deliverables:

- parse `platformio.ini` and list environments
- default to `default_envs`
- add `Build`, `Clean`, and `Reindex` actions
- run `pio` using an already-installed local CLI only
- stream stdout and stderr into the console pane
- add cancel support for running jobs

Out of scope:

- no managed PlatformIO installer
- no upload yet
- no `clangd` integration yet

Acceptance:

- build the attached `../Core`
- console shows live output
- environment selection works
- failed builds show usable error output

## Session 5 — Upload Support And Minimum Test Coverage

Goal:

- complete the first useful firmware workflow before touching installers or language servers

Deliverables:

- add `Upload` action using existing local `pio`
- reuse the same env selection and console streaming model
- add unit coverage for:
  - env parsing
  - workspace root restriction
  - basic command dispatch
- add focused Electron smoke coverage for:
  - opening the firmware window
  - attaching `Core`
  - editing a file
  - starting a build

Out of scope:

- no managed toolchain installer
- no `clangd` yet

Acceptance:

- build and upload can be triggered from the firmware window
- key flows are covered by at least smoke-level automation
- feature is usable if the machine already has `pio`

## Session 6 — Managed PlatformIO Runtime

Goal:

- remove the dependency on a globally installed `pio`

Deliverables:

- add managed PlatformIO install status detection
- add explicit `Install Toolchain` flow for PlatformIO
- install to app-owned storage under `userData/toolchains/platformio/`
- let build and upload use managed `pio` first, then optionally fall back to system `pio`
- persist installed version and runtime path

Out of scope:

- no `clangd` yet

Acceptance:

- a machine without global `pio` can install and build from Modular
- install state is visible in the UI
- failures are surfaced clearly

## Session 7 — Managed clangd And C/C++ Completion/Hover

Goal:

- add the C/C++ intelligence required for completion and hover

Deliverables:

- add managed `clangd` install flow
- install to `userData/toolchains/clangd/`
- resolve compile database from `.pio/build/<env>/compile_commands.json`
- if missing, require or trigger an indexing build
- bridge Monaco to `clangd` for:
  - completion
  - hover/tooltips
  - diagnostics
- enable best-effort go-to-definition if the bridge is stable

Out of scope:

- deep IDE parity beyond the features above
- full refactor, rename, or references UX unless it comes for free from the bridge

Acceptance:

- `main.cpp` gets meaningful completion
- hover shows symbol and type information
- diagnostics are visible
- compile database generation path is surfaced clearly in the UI

## Session 8 — Hardening And Broader Coverage

Goal:

- make the feature supportable and safer to maintain

Deliverables:

- cover failure paths:
  - invalid workspace
  - no network for installer
  - missing `platformio.ini`
  - build failure
  - compile database missing
  - `clangd` unavailable
- improve UI status and error messaging
- add more end-to-end checks around:
  - advanced mode
  - managed toolchain reuse
  - completion availability after indexing

Acceptance:

- failures degrade cleanly
- the feature is supportable without manual debugging for normal error cases

## Recommended Stop Points

If credits or time are limited, stop after one of these milestones:

- after session 3:
  - useful editor shell
  - no firmware execution yet
- after session 5:
  - real firmware workflow for users who already have `pio`
- after session 7:
  - full value version with completion and hover

## Best Low-Credit MVP

The highest-value low-credit MVP is sessions 1 through 5:

- dedicated firmware window
- attach existing `../Core`
- Monaco editor
- save files
- build and upload using existing `pio`
- minimum smoke coverage

This intentionally defers the two most expensive parts:

- managed PlatformIO installer
- managed `clangd` integration

## Commit Strategy

The phased plan should usually be committed in session-sized slices:

1. `feat(firmware): add workspace window shell and API stubs`
2. `feat(firmware): attach existing Core workspace and file editing`
3. `feat(firmware): embed Monaco editor in firmware workspace`
4. `feat(firmware): add basic PlatformIO build flow using local pio`
5. `test(firmware): add upload support and minimum smoke coverage`
6. `feat(firmware): add managed PlatformIO runtime install flow`
7. `feat(firmware): add clangd-backed completion and hover`
8. `test(firmware): harden failure paths and expand coverage`

## Assumptions And Defaults

- step 11 remains the source-of-truth architecture plan
- Linux remains the first supported platform
- session 7 is the highest-risk integration point
- sessions 1 through 5 are the recommended first ship target when credits are limited
