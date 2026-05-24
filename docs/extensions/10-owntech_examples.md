# Step 10 — OwnTech Examples Extension Split Plan

## Summary

Split the current OwnTech extension into two built-in extensions:

- `owntech` for OwnTech widgets and renderer-side integration
- `owntech-examples` for OwnTech example docs, dashboards, binaries, and menu entries

At the same time, simplify the top-level app menu so it becomes:

- `File`
- `Edit`
- `Widget Extensions`
- `OwnTech Examples`
- `Courseware`

Inside `Widget Extensions`, list the widget help menus in this order:

- `Modular Core Widgets`
- `OwnTech Widgets`
- `Thingset Widgets`

This makes widget documentation, practical examples, and courseware clearly separate concepts in the UI.

## Why This Step Exists

- The current `owntech` extension mixes two different concerns:
  - OwnTech widget/runtime features
  - OwnTech practical examples
- The current top-level `Extensions` menu is too generic and does not tell the user whether they are opening:
  - widget documentation
  - examples
  - lab content
- `Courseware` is already moving toward a dedicated extension and dedicated menu, so examples should follow the same direction.
- Splitting examples into their own extension makes the system easier to understand and easier to maintain.

## Target Architecture

### `owntech`

`owntech` remains responsible for:

- OwnTech renderer scripts
- OwnTech widget documentation
- OwnTech-specific widget/runtime capabilities

`owntech` must stop owning:

- `exampleRoots`
- example menu structure
- the `examples` capability

### `owntech-examples`

Create a new built-in extension:

```text
app/extensions/owntech-examples/
  manifest.json
  main.js
  dashboard/docs/examples/...
  dashboard/dashboards/...
  dashboard/binaries/...
```

`owntech-examples` becomes responsible for:

- example discovery via `exampleRoots`
- example markdown
- example dashboards
- example binaries
- the top-level `OwnTech Examples` menu

## Menu Target

The app menu should be reordered to:

1. `File`
2. `Edit`
3. `Widget Extensions`
4. `OwnTech Examples`
5. `Courseware`

### `Widget Extensions`

This menu should contain exactly these extension-scoped widget sections:

- `Modular Core Widgets`
- `OwnTech Widgets`
- `Thingset Widgets`

Each submenu continues to expose widget documentation entries grouped by category.

### `OwnTech Examples`

This becomes a dedicated top-level menu built only from the `owntech-examples` extension.

It should reuse the current recursive example tree behavior so the existing example structure remains intact.

### `Courseware`

`Courseware` remains a dedicated top-level menu owned by the `courseware` extension.

## Extension Changes

### 1. Create `owntech-examples`

Add:

- `app/extensions/owntech-examples/manifest.json`
- `app/extensions/owntech-examples/main.js`

The manifest should declare:

- `id: "owntech-examples"`
- `displayName: "OwnTech Examples"`
- `enabledByDefault: true`
- `capabilities: ["examples"]`
- `exampleRoots`

Recommended `exampleRoots`:

```json
[
  {
    "path": "dashboard/docs/examples",
    "dashboardRoot": "dashboard/dashboards",
    "firmwareRoot": "dashboard/binaries"
  }
]
```

### 2. Move OwnTech example assets

Move the current OwnTech example content from `app/extensions/owntech/...` into `app/extensions/owntech-examples/...`:

- markdown docs
- dashboard JSON files
- firmware binaries

The internal folder layout should stay the same so example ids remain stable.

### 3. Shrink `owntech`

Update [app/extensions/owntech/manifest.json](/home/luiz-villa/code/modular/app/extensions/owntech/manifest.json):

- remove `exampleRoots`
- remove `examples` from `capabilities`

`owntech` should remain focused on widgets and OwnTech runtime integration.

## Main Process Changes

Refactor [app/main.js](/home/luiz-villa/code/modular/app/main.js) so top-level menus are no longer built around one generic `Extensions` menu.

### Replace `Extensions`

Remove the top-level `Extensions` menu and replace it with:

- `Widget Extensions`
- `OwnTech Examples`
- `Courseware`

### Widget menu builder

Replace the current generic extension-doc menu builder with a widget-specific builder that:

- inspects `bootstrap.widgetDocs`
- groups entries by `extensionId`
- renders top-level submenu labels in the required order:
  - `Modular Core Widgets`
  - `OwnTech Widgets`
  - `Thingset Widgets`

### Examples menu builder

Keep the existing example tree logic, but scope it to the new `owntech-examples` extension only.

That logic should populate the top-level `OwnTech Examples` menu directly.

## Runtime Changes

No new contribution type is required for the initial split.

The existing runtime support in [app/extensions/runtime.js](/home/luiz-villa/code/modular/app/extensions/runtime.js) already supports:

- `widgetDocs`
- `exampleRoots`

The main change is extension ownership:

- `owntech` no longer contributes `exampleRoots`
- `owntech-examples` becomes the only contributor of OwnTech examples

## Dependency Handling

OwnTech examples likely depend on OwnTech widgets being available so their dashboards render correctly.

Recommended follow-up addition:

- manifest-level soft dependency support, for example `requiresExtensions: ["owntech"]`

Expected behavior:

- if `owntech` is disabled, `OwnTech Examples` should be hidden or disabled
- examples should not appear when their required widget extension is unavailable

This dependency support can be implemented either in the same step or immediately after the split.

## Renderer Impact

[app/dashboard/js/tabs.js](/home/luiz-villa/code/modular/app/dashboard/js/tabs.js) and [app/preload.js](/home/luiz-villa/code/modular/app/preload.js) should require minimal behavioral change because the example flow is already generic.

The important compatibility rule is:

- example ids must not change

If the relative folder structure under `exampleRoots` is preserved, the current docs tab flow and example window flow should continue to work.

## Implementation Sequence

1. Create `app/extensions/owntech-examples/`.
2. Move OwnTech example docs, dashboards, and binaries into the new extension.
3. Update `owntech-examples/manifest.json` to declare `exampleRoots`.
4. Remove example ownership from `owntech/manifest.json`.
5. Replace the top-level `Extensions` menu with `Widget Extensions`.
6. Add the dedicated top-level `OwnTech Examples` menu.
7. Keep `Courseware` as a separate top-level menu.
8. Add optional dependency gating between `owntech-examples` and `owntech`.

## Test Plan

### Runtime / Bootstrap

- `extensions-list` includes `owntech-examples`
- `owntech` no longer contributes `exampleRoots`
- `owntech-examples` contributes the expected `exampleRoots`
- `bootstrap.exampleRoots` still resolves example content correctly

### Menu

- top-level menu order is exactly:
  - `File`
  - `Edit`
  - `Widget Extensions`
  - `OwnTech Examples`
  - `Courseware`
- `Widget Extensions` contains exactly:
  - `Modular Core Widgets`
  - `OwnTech Widgets`
  - `Thingset Widgets`
- `OwnTech Examples` opens example tabs correctly

### Example Flow

- in-app example tabs still open
- standalone example viewer still opens
- dashboard loading still resolves the moved dashboard JSON files
- firmware upload still resolves the moved binaries

### Dependency Behavior

- disabling `owntech` hides or disables `OwnTech Examples`
- disabling `owntech-examples` removes only the examples menu, not OwnTech widgets

### Regression

- widget docs still work from all three widget extensions
- courseware still works unchanged
- existing example IPC compatibility remains intact

## Non-Goals

- Do not merge examples into `Courseware`
- Do not change widget behavior
- Do not change example ids unless absolutely necessary
- Do not redesign the example tab renderer beyond what is needed for the ownership split

## Commit Sequence

1. `docs(extensions): add step 10 owntech examples split plan`
   - add this plan

2. `feat(extensions): add owntech-examples built-in extension`
   - scaffold the new extension and move example assets

3. `refactor(menu): split widget extensions from owntech examples`
   - replace `Extensions` with `Widget Extensions`
   - add `OwnTech Examples` top-level menu

4. `test(extensions): cover owntech examples split`
   - add runtime, menu, and example-flow regression coverage
