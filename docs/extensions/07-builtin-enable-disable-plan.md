# Step 7 - Built-in Extension Enable / Disable Plan

## Summary
- Allow built-in (source-loaded) extensions to be toggled on and off from the Extension Manager.
- Persist the override in the same `state.json` file already used for installed bundles.
- Lock the `core` extension permanently so it can never be disabled from the UI.
- Make the manager UI the single place to control all extension enabled states, regardless of source.

## Why This Step Exists
- Step 6 added the Extension Manager and a working install/uninstall flow for external bundles.
- Built-in extensions (`owntech`, `thingset`) appear in the manager but their toggle buttons are absent — the manager is read-only for the built-in section, which makes it feel incomplete.
- The `extensions-manager-enable` / `extensions-manager-disable` IPC handlers currently reject any id that is not in `state.json`, which silently blocks built-in toggles even if the UI tried to call them.
- Environment variable overrides (`MODULAR_EXTENSION_OWNTECH`, `ENABLE_THINGSET`) work for CI and developer flags but are not a suitable runtime control for end users.

## Goals
- Persist per-extension enabled/disabled overrides for built-in extensions in `state.json`.
- Feed those overrides into `resolveEnabled()` so the runtime respects them at the next boot.
- Accept built-in extension ids in the enable/disable IPC handlers.
- Show toggle buttons on built-in rows in the Extension Manager (except `core`).
- Keep `core` always enabled and visually locked.

## Non-Goals
- Do not add live-reload or hot-swap; the "restart required" contract is unchanged.
- Do not change the installable bundle format or install/uninstall flows from Step 6.
- Do not add network distribution or remote extension sources.
- Do not change how environment variable flags interact with `resolveEnabled()` — env vars continue to win above persisted state.

## Read First
- `app/extensions/runtime.js` — `resolveEnabled()` (line 137), `readInstalledState()` (line 419), `buildExtensionRuntime()` (line 699 for how state is currently consumed)
- `app/main.js` — `readManagerState()` (line 322), `extensions-manager-enable` (line 399), `extensions-manager-disable` (line 408)
- `app/dashboard/js/extension_manager.js` — `renderBuiltinEntry()` (line 88), `renderInstalledEntry()` (line 25)
- `tests/unit/extensions_runtime.test.js`
- `tests/e2e/electron-smoke.spec.js`

## Dependencies
- Requires Step 6 to be complete and merged. `state.json` format and the manager IPC layer must already exist.

## Core Versus Extension Boundary

### Core Should Own
- The `state.json` schema and the rules for reading and writing it.
- The `resolveEnabled()` priority chain: env override → persisted state → `enabledByDefault`.
- Enforcing that `core` cannot be disabled.
- The IPC handlers for enable/disable.

### Extensions Should Own
- Their `enabledByDefault` manifest field (the fallback when no override exists).

## State JSON Schema Change

The current format stores installed-bundle entries keyed by id:

```json
{
  "test-bundle": { "enabled": true, "version": "1.0.0" }
}
```

Built-in entries do not carry a version in `state.json` (the app ships them). A built-in override looks the same except `version` is absent:

```json
{
  "owntech": { "enabled": false },
  "test-bundle": { "enabled": true, "version": "1.0.0" }
}
```

No schema migration is needed — the only change is that the write path now accepts built-in ids without rejecting them for missing a `version` field, and the read path treats a missing entry as "use manifest default" for both source-loaded and installed extensions.

## Implementation Changes

### 1. Thread Persisted State Through `resolveEnabled()`

**File:** `app/extensions/runtime.js`

Currently `resolveEnabled(manifest, env)` checks env vars then falls back to `manifest.enabledByDefault`. Add a third parameter `persistedState` (the parsed `state.json` object, defaults to `{}`).

New priority chain:
1. `core` → always `true`, return early.
2. `env[MODULAR_EXTENSION_<ID>]` override → wins if set.
3. `persistedState[id]?.enabled` (if the key exists) → wins if defined.
4. `manifest.enabledByDefault` → fallback.

Inside `buildExtensionRuntime()`, read `state.json` once before the source-loaded extension loop and pass it to every `resolveEnabled()` call. The installed-bundle loop already reads `state.json` separately; unify both reads into one call at the top.

### 2. Accept Built-in Ids In Enable / Disable IPC Handlers

**File:** `app/main.js`

The `extensions-manager-enable` and `extensions-manager-disable` handlers currently return an error if `state[id]` does not exist:

```javascript
if (!state[id]) return { ok: false, error: `Extension ${id} is not installed` };
```

Change the guard to reject only the `core` id, and create a new entry for any other id:

```javascript
if (id === 'core') return { ok: false, error: 'The core extension cannot be disabled' };
if (!state[id]) state[id] = {};
state[id].enabled = true;  // or false for disable
writeManagerState(state);
return { ok: true, requiresRestart: true };
```

No change to the install / uninstall / list handlers is required.

### 3. Add Toggle Buttons To Built-in Rows In The Manager UI

**File:** `app/dashboard/js/extension_manager.js`

`renderBuiltinEntry(ext)` currently renders a read-only row. Add the same Enable/Disable toggle button that installed entries have, but omit the Uninstall button.

- If `ext.id === 'core'`, keep the row fully read-only and add a locked badge or tooltip.
- Otherwise: add a single toggle button that calls `manager.enable(ext.id)` or `manager.disable(ext.id)` and refreshes the list on success.

The `renderInstalledEntry` pattern can be reused for the toggle button wiring — extract a small shared helper or inline the same logic.

## Test Plan

### Unit Tests (`tests/unit/extensions_runtime.test.js`)
- `runBuiltinOverrideEnable()` — write a `state.json` that disables `owntech`, call `buildExtensionRuntime()`, confirm `owntech` is disabled in inventory.
- `runBuiltinOverrideDisable()` — write a `state.json` that enables `owntech` when env flag is absent; confirm it appears enabled.
- `runEnvVarWinsOverPersistedState()` — write `state.json` enabled, set `MODULAR_EXTENSION_OWNTECH=0` in env, confirm env wins.
- `runCoreAlwaysEnabled()` — write `state.json` with `{ core: { enabled: false } }`, confirm `core` is still `enabled: true` in inventory.

### E2E Smoke (`tests/e2e/electron-smoke.spec.js`)
- Extend the existing "extension runtime boots cleanly with owntech and thingset disabled" test to also confirm that `managerList` reflects the disabled state in the manager list (i.e., `enabled: false` appears in the manager list for those ids).

### E2E Widget Picker / Integration (optional)
- If the widget picker test already covers the case where owntech widgets appear, add a short assertion that disabling owntech via `state.json` before launch causes those widgets to be absent.

## Acceptance Criteria
- Toggling a built-in extension off in the manager and restarting hides its widgets, datasources, and menu contributions.
- Toggling it back on and restarting restores them.
- The `core` extension has no toggle button and cannot be disabled by any manager operation.
- Environment variable overrides continue to override persisted state (useful for CI).
- No new top-level files or modules are required — all changes land in the three files listed above plus tests.

## Risks
- If `resolveEnabled()` receives a stale `state.json` snapshot (read before the file is updated by the manager), the state at next boot will reflect the last write correctly since the file is always re-read on startup. No in-process race exists.
- Writing a built-in entry into `state.json` without a `version` field is intentional. Any future consumer of `state.json` must treat `version` as optional.

## Commit Sequence

1. `docs(extensions): add step 7 built-in enable/disable plan`
   - Create this markdown plan.

2. `feat(runtime): thread persisted state through resolveEnabled for source-loaded extensions`
   - Update `resolveEnabled()` signature and priority chain in `runtime.js`.
   - Unify the two `state.json` reads in `buildExtensionRuntime()` into one.

3. `feat(extension-manager): accept built-in ids in enable/disable IPC handlers`
   - Remove the "not installed" guard for built-in ids in `main.js`.
   - Enforce `core` lock.

4. `feat(extension-manager): add toggle buttons to built-in rows`
   - Extend `renderBuiltinEntry()` in `extension_manager.js` with a toggle button.
   - Keep `core` row read-only.

5. `test(extensions): cover built-in enable/disable persistence and manager parity`
   - Add the four new unit tests.
   - Extend smoke assertions.
