# Step 1 - Core Extension Runtime Plan

## Summary
- Build an in-repo extension runtime before moving any feature family out of core.
- Replace the current static boot assumptions with manifest-driven discovery and registration.
- Keep behavior stable: all current feature areas continue to ship from this repo during this step.
- Treat this step as the foundation for every later split; no feature extraction should begin until this runtime is in place.

## Why This Step Exists
- `app/dashboard/index.html` still hardcodes the renderer plugin script list.
- `app/main.js` still imports and owns all privileged runtimes directly.
- `app/preload.js` still exposes one monolithic `window.api` regardless of which feature families are truly present.
- The current `ENABLE_THINGSET` gate proves optional capability is possible, but it is too narrow and too ad hoc to support a clean core/extensions boundary.

## Goals
- Introduce a formal extension manifest contract for in-repo development.
- Add core-side loaders for `main`, `preload`, and renderer contributions.
- Expose extension inventory and enablement state to the renderer through a narrow preload surface.
- Preserve mock-safe behavior for Electron and Playwright tests.
- Keep current runtime behavior unchanged while replacing the wiring underneath.

## Non-Goals
- Do not move `TWIST`, `Fast Frame`, or `ThingSet` code out of core yet.
- Do not design remote plugin trust or third-party sandboxing.
- Do not add an external installer in this step.
- Do not rewrite widget docs, picker taxonomy, or example menus beyond what is required to bootstrap the runtime.

## Read First
- `app/main.js`
- `app/preload.js`
- `app/dashboard/index.html`
- `app/docs/api_refactor_plan.md`
- `app/docs/window_api.md`
- `tests/e2e/electron-smoke.spec.js`

## Current Files Expected To Change
- `app/main.js`
- `app/preload.js`
- `app/dashboard/index.html`
- `app/docs/window_api.md`
- `tests/e2e/electron-smoke.spec.js`
- New files under `app/extensions/` or `app/runtime/extensions/`

## Proposed Runtime Shape
- Add a manifest per extension, kept in-repo for local development during the refactor.
- Add one loader in `main` that discovers manifests, validates them, computes enablement, and loads extension `main` entrypoints.
- Add one preload registry that exposes:
  - extension inventory
  - extension enablement
  - extension-provided flags
  - extension bootstrap data for the renderer
- Replace the static renderer script array with a bootstrap list derived from core plus enabled extensions.

## Proposed Manifest Fields
- `id`
- `version`
- `apiVersion`
- `displayName`
- `enabledByDefault`
- `mainEntry`
- `rendererScripts`
- `preloadFlags`
- `capabilities`
- `widgetDocsIndex`
- `exampleRoots`
- `dashboardRoots`
- `compatibilityTypes`
- `optionalDependencies`

## Directory Model For This Step
- Keep everything in one repo.
- Use a stable layout such as:

```text
app/extensions/
  core/
    manifest.json
  twist/
    manifest.json
  fast-frame/
    manifest.json
  thingset/
    manifest.json
```

- Allow manifests to point at existing files first; do not force immediate file moves in step 1.

## Methodology To Preserve From Existing Skills
- From `modular-electron-bridge`:
  - Add or adjust the `main` contract first.
  - Expose narrow preload APIs instead of expanding renderer `window.require` usage.
  - Keep mock mode behavior in `app/preload.js` aligned with the real contract.
  - Keep feature flags coherent between `main`, preload, and renderer.
- From `modular-widget-authoring`:
  - Preserve deterministic renderer script ordering while boot moves away from `index.html`.
  - Keep dependency ordering explicit for shared helpers and managers.
- From `modular-playwright-e2e`:
  - Validate through focused Electron smoke coverage first.
  - Preserve mock defaults unless a new test explicitly needs different flags.

## Implementation Changes

### 1. Add Manifest Discovery And Validation
- Create a manifest parser in core.
- Fail closed on malformed manifests, but keep the app booting with a visible log entry.
- Version the manifest contract from day one so future external bundles have a compatibility gate.

### 2. Add A `main`-Process Extension Registry
- Discover manifests before window creation.
- Compute enabled extensions from:
  - default enablement
  - packaged-vs-dev rules
  - explicit environment overrides
- Load each enabled extension `mainEntry` through a controlled registration API.
- Keep extension registration additive; the loader should not require extensions to mutate core globals directly.

### 3. Add A Preload Extension Surface
- Expose `window.api.extensions.list()`.
- Expose `window.api.extensions.isEnabled(id)`.
- Expose `window.api.extensions.getBootstrap()`.
- Expose extension flags through the extension registry, not free-floating globals.
- Keep existing domains such as `serial`, `flash`, and `dashboard` intact during migration.

### 4. Replace The Static Renderer Boot List
- Remove the hardcoded feature-family script list from `app/dashboard/index.html`.
- Load core scripts plus extension-contributed scripts from preload bootstrap data.
- Preserve deterministic order:
  - core shared runtime first
  - core widgets and datasources second
  - extension shared helpers before extension widgets
- Keep boot failure logs clear enough for Playwright and local debugging.

### 5. Normalize Feature Flags
- Convert `ENABLE_THINGSET` into extension enablement or a manifest-derived flag.
- Keep temporary compatibility with the current env var while the migration is underway.
- Make extension enablement available both in dev and packaged builds.

### 6. Add Registration APIs Instead Of Ad Hoc Imports
- Extension `mainEntry` should register:
  - IPC handlers
  - menus
  - storage roots
  - preload domains or flags
  - renderer contributions
- Core should stay in control of lifecycle and error handling.

## Suggested Core Registration Interface
- `registerMainHandlers(factory)`
- `registerPreloadDomain(name, descriptor)`
- `registerRendererScripts(list)`
- `registerWidgetDocsSource(path)`
- `registerExampleRoot(path)`
- `registerDashboardRoot(path)`
- `registerCapability(name, descriptor)`

## Test Plan
- Extend `tests/e2e/electron-smoke.spec.js` to assert:
  - `window.api.extensions` exists
  - extension inventory is reported
  - renderer bootstrap completes
  - no preload/boot errors are introduced
- Extend `tests/e2e/boot.spec.js` or add a focused runtime spec that verifies:
  - enabled extensions load
  - disabled extensions do not contribute renderer scripts
  - invalid manifests fail cleanly without crashing the app

## Acceptance Criteria
- Core can boot from a manifest-driven extension registry while still shipping the same user-visible features.
- `index.html` no longer owns the full feature-family script list.
- `main` can describe loaded extensions without reaching into renderer-only state.
- Preload mock mode stays valid under the new API surface.
- Later steps can move files by changing manifest targets rather than rewriting boot logic again.

## Risks
- Renderer script ordering can regress if shared helpers are not modeled explicitly.
- Preload mocks can drift from the real contract if extension bootstrap is not covered in tests.
- Too much power in extension `mainEntry` can reintroduce hidden coupling; the registration interface must stay narrow.

## Dependencies For Later Steps
- Step 2 depends on this runtime to serve merged metadata.
- Steps 3 through 5 depend on this runtime to move feature families without reworking boot again.

## Commit Sequence
1. `docs(extensions): add step 1 core runtime plan`
   - Create this markdown plan.
   - Freeze the scope and commit ordering before runtime edits begin.

2. `feat(extension-runtime): add manifest schema and discovery`
   - Add manifest files for `core`, `twist`, `fast-frame`, and `thingset`.
   - Add validation and in-repo discovery.

3. `refactor(main): add extension registry and main-entry loading`
   - Introduce the core registration API.
   - Load extension `main` contributions before window creation.

4. `refactor(preload): expose extension inventory and bootstrap contract`
   - Add `window.api.extensions`.
   - Keep current domain APIs intact.

5. `refactor(renderer): replace static feature script boot with registry bootstrap`
   - Move the renderer script list out of `index.html`.
   - Preserve current behavior and ordering.

6. `chore(runtime): normalize enablement flags around extension state`
   - Fold `ENABLE_THINGSET` into the registry while preserving compatibility.
   - Add explicit dev and packaged enablement rules.

7. `test(extension-runtime): cover boot, preload, and inventory behavior`
   - Update smoke tests and focused boot coverage.
   - Lock down failure behavior for malformed or disabled manifests.
