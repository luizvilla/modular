# Step 4 - Fast Frame Boundary Plan

> **DEPRECATED** — Fast Frame has been reclassified as a permanent core feature and will not be moved behind an extension boundary. This plan is kept for historical reference only. Do not implement.

## Summary
- Extract fast-frame acquisition, CSV-backed plotting helpers, and related renderer/runtime behavior behind a dedicated extension boundary.
- Keep the serial core generic while preserving the current fast-frame user contract.
- Treat per-port parser state, repeated acquisition behavior, helper-widget spawning, and CSV source modes as non-negotiable compatibility points.

## Why This Step Exists
- `Fast Frame` spans renderer widgets, helper widgets, a dedicated datasource, serial parser state in `main`, preload methods, docs, tests, and fixtures.
- The current implementation is already cohesive enough to become an extension, but the parser and IPC ownership still live inside core serial code.
- This is the first feature family that really tests whether extension boundaries can span `main`, preload, renderer, docs, and tests without weakening behavior.

## Goals
- Move `fast_frame_*` widgets, shared helpers, and docs behind a `fast-frame` extension manifest.
- Move fast-frame-specific serial parsing and status behavior out of core-owned special cases.
- Keep saved dashboards, helper-widget flows, and CSV source mode behavior stable.
- Preserve fast-frame regression methodology already captured in the repo skills and tests.

## Non-Goals
- Do not redesign the fast-frame UI or data model.
- Do not replace helper widgets with a new editor model in this step.
- Do not generalize every serial parser profile in one pass beyond what fast-frame extraction requires.

## Read First
- `app/dashboard/plugins/fast_frame.shared.js`
- `app/dashboard/plugins/fast_frame_control.widget.js`
- `app/dashboard/plugins/fast_frame_plot.widget.js`
- `app/dashboard/plugins/fast_frame_plot_ui.widget.js`
- `app/dashboard/plugins/fast_frame_channel_manager.widget.js`
- `app/dashboard/plugins/serialfast.datasource.js`
- `app/main.js`
- `app/preload.js`
- `app/functional_diagram.md`
- `tests/e2e/fast-frame.spec.js`
- `tests/fixtures/fast_frame_dashboard.json`
- `tests/fixtures/fast_frame_helpers_dashboard.json`

## Current Files Expected To Change
- `app/dashboard/plugins/fast_frame*.js`
- `app/dashboard/plugins/serialfast.datasource.js`
- `app/main.js`
- `app/preload.js`
- `app/docs/widgets/index.json`
- `app/docs/widgets/serial/fast-frame-*`
- `tests/e2e/fast-frame.spec.js`
- `tests/fixtures/fast_frame*.json`

## Core Versus Extension Boundary

### Core Should Own
- Generic serial port lifecycle
- Generic serial buffer access
- Generic file chooser and file write helpers
- Generic runtime diagnostics surface
- Extension registration and preload contribution plumbing

### `fast-frame` Extension Should Own
- `fast_frame_datasource`
- Fast-frame parser profile and status model
- Fast-frame widgets and helper widgets
- Fast-frame CSV source mode logic
- Fast-frame docs and fixtures
- Fast-frame-specific diagnostics and export behavior

## Methodology To Preserve From Existing Skills
- From `modular-fast-frame`:
  - Preserve per-port parser settings and acquisition state unless redesign is explicit.
  - Keep repeated acquisition refresh, variable selection stability, and source mode behavior together.
  - Preserve helper-widget single-instance and no-reload-loop guarantees.
  - Update user-visible docs and widget index whenever the contract changes.
- From `modular-electron-bridge`:
  - Move privileged behavior through `main` and preload rather than renderer-only shortcuts.
  - Keep mock mode behavior aligned with the real API.
- From `modular-playwright-e2e`:
  - Cover helper-widget and fixture-driven flows with focused Playwright specs.

## Implementation Changes

### 1. Introduce A Serial Parser/Profile Hook
- Add a core serial extension point so an extension can register a parser profile or acquisition handler.
- Move fast-frame parsing and status ownership behind that hook instead of hardcoding it in core serial flow.
- Keep compatibility shims during migration so existing renderer callers still function.

### 2. Move Fast-Frame `main` Behavior Behind The Extension
- Register fast-frame-specific open, parse, status, and save logic from the extension `mainEntry`.
- Keep the per-port state model stable.
- Keep explicit status semantics such as:
  - idle
  - waiting
  - receiving
  - complete
  - error

### 3. Move Fast-Frame Preload Surface Behind The Extension
- Prefer a dedicated extension-contributed preload domain such as `window.api.fastFrame`.
- Keep temporary compatibility shims for existing renderer callers if migration cannot be atomic.
- Update mock mode in preload so the fast-frame spec still runs without real hardware.

### 4. Move Renderer Widgets And Shared Helpers
- Register:
  - `fast_frame.shared.js`
  - `fast_frame_control.widget.js`
  - `fast_frame_plot.widget.js`
  - `fast_frame_plot_ui.widget.js`
  - `fast_frame_channel_manager.widget.js`
  - `serialfast.datasource.js`
- Preserve script order so shared helpers load before widgets.

### 5. Move Docs, Fixtures, And Metadata
- Move fast-frame widget docs into extension-owned docs fragments.
- Move test fixtures and example dashboards through extension roots where practical.
- Keep widget types stable for saved dashboards.

## Compatibility Rules
- Existing `fast_frame_*` widget types remain unchanged.
- Existing `fast_frame_datasource` dashboards remain loadable.
- Existing helper-widget behavior stays stable:
  - no duplicate helper spawning
  - no reload loops
  - legacy dashboards with `helperWidgets` disabled keep that behavior

## Test Plan
- Keep `tests/e2e/fast-frame.spec.js` as the primary regression suite.
- Extend smoke coverage if preload domains or boot contracts move.
- Add focused tests for:
  - extension disablement behavior
  - compatibility shims if old preload calls are preserved temporarily
  - fast-frame parser profile registration
- Keep fixtures deterministic and continue using `window.api.files.writeText()` for CSV updates in tests.

## Acceptance Criteria
- Fast-frame code can be enabled or disabled as an extension without changing generic serial core wiring.
- Fast-frame saved dashboards still load when the extension is enabled.
- The existing Playwright fast-frame suite passes with the new extension boundary in place.
- Parser state, timestamps, latest-file mode, and helper-widget guarantees remain intact.

## Risks
- Moving parser ownership can break repeated acquisition or stale status refresh if the core hook is too shallow.
- Preload shims can become permanent clutter if the migration is not closed out deliberately.
- Fixture paths can drift if docs and test assets move before extension roots are stable.

## Dependencies For Later Steps
- Step 5 will reuse the same pattern for extension-owned runtime state and preload domains.
- The final installer story depends on this step proving that a feature family can contribute both `main` and renderer behavior cleanly.

## Commit Sequence
1. `docs(extensions): add step 4 fast-frame boundary plan`
   - Create this markdown plan.
   - Freeze the fast-frame compatibility points before refactoring.

2. `refactor(serial): add extension hook for profile-owned serial parsing`
   - Introduce the core hook required for fast-frame ownership to move out of hardcoded branches.

3. `feat(extension-fast-frame): move fast-frame main runtime behind extension entry`
   - Register parser, status, and export behavior from the extension.

4. `refactor(preload): move fast-frame preload surface to extension domain with temporary shims`
   - Keep current renderer callers working while the extension boundary lands.

5. `feat(extension-fast-frame): move datasource, widgets, and shared helpers behind manifest`
   - Register renderer scripts and keep helper ordering explicit.

6. `chore(fast-frame): move docs, fixtures, and metadata behind extension roots`
   - Preserve widget type names and docs entry titles.

7. `test(fast-frame): lock down parser state, helper widgets, and source mode regressions`
   - Run and extend the focused fast-frame suite plus any required smoke coverage.
