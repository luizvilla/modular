# Step 2 - Extension Metadata, Docs, And Discovery Plan

## Summary
- Move widget, docs, picker, menu, and example discovery out of hardcoded core files and into extension-contributed metadata.
- Remove extension-specific taxonomy rules from Freeboard and PluginEditor.
- Make it possible to add a new extension-visible widget family without editing multiple core files by hand.

## Why This Step Exists
- `app/docs/widgets/index.json` is a single core-owned index for both core and extension-specific widgets.
- `app/dashboard/js/freeboard.js` and `app/dashboard/lib/js/freeboard/PluginEditor.js` hardcode:
  - category defaults
  - extension-specific category inference
  - preferred ordering
  - datasource icon mapping
- `app/main.js` builds widget docs and example menus from fixed locations.
- `app/dashboard/js/tabs.js` loads widget docs from one core path and filters only `ThingSet` through a dedicated flag.

## Goals
- Make widget docs, example roots, dashboard roots, categories, icons, and compatibility-only rules extension-contributed.
- Keep the normal user-facing titles and category labels stable.
- Preserve deterministic picker ordering and help menu structure.
- Remove `OwnTech`, `Fast Frame`, and `ThingSet` heuristics from core.

## Non-Goals
- Do not move feature code yet.
- Do not redesign Freeboard UX or the picker UI itself.
- Do not add remote docs loading or network dependency.

## Read First
- `app/docs/widgets/index.json`
- `app/main.js`
- `app/dashboard/js/tabs.js`
- `app/dashboard/js/freeboard.js`
- `app/dashboard/lib/js/freeboard/PluginEditor.js`
- `tests/e2e/widget-picker.spec.js`
- `tests/e2e/tabs-docs.spec.js`
- `tests/e2e/examples-window.spec.js`

## Current Files Expected To Change
- `app/main.js`
- `app/dashboard/js/tabs.js`
- `app/dashboard/js/freeboard.js`
- `app/dashboard/lib/js/freeboard/PluginEditor.js`
- `app/docs/widgets/index.json`
- New per-extension widget docs indices and metadata files

## Desired End State
- Core owns the discovery mechanism.
- Each extension owns its own metadata.
- The picker, widget docs menu, docs tab, and example menus all read the same merged registry.
- Compatibility-only types remain loadable but are hidden from the normal add flow through metadata, not custom code branches.

## Metadata To Move Out Of Core
- Widget title
- Widget category
- Widget icon
- Widget description
- Widget doc path
- Compatibility-only visibility
- Preferred ordering within a category
- Datasource icon mapping
- Example roots
- Dashboard roots

## Methodology To Preserve From Existing Skills
- From `modular-widget-authoring`:
  - Keep widget docs aligned with shipped widget titles and categories.
  - Prefer explicit docs/index entries over name inference.
  - Treat helper-widget visibility as a contract and cover it in regression tests.
- From `modular-playwright-e2e`:
  - Use focused fixtures and deterministic `loadDashboard()` flows for UI validation.
  - Expand test scope only when the touched surface spans multiple workflows.
- From `modular-dashboard-layout`:
  - Keep model-driven state authoritative; do not let DOM-only ordering become a hidden source of truth while refactoring picker behavior.

## Implementation Changes

### 1. Split Widget Docs Metadata By Extension
- Keep one core widget docs fragment for truly vanilla widgets.
- Add one widget docs fragment per extension.
- Merge them through the extension registry before the menu, docs tab, or picker reads them.

### 2. Replace Category Inference With Declared Metadata
- Stop inferring `OwnTech`, `Fast Frame`, or `ThingSet` from type names in core.
- Keep a generic fallback category path only for missing metadata.
- Let manifests or widget docs fragments declare:
  - category
  - icon
  - preferred order
  - visibility

### 3. Move Picker Ordering Rules Out Of `PluginEditor.js`
- Remove hardcoded ranking blocks for `twist_*`, `fast_frame_*`, and `thingset_*`.
- Replace them with a merged metadata structure supplied by the registry.
- Keep stable ordering for:
  - core plot widgets
  - core gauges
  - compatibility-only helper widgets

### 4. Move Datasource Presentation Metadata Out Of Core
- Replace the hardcoded datasource icon map with extension-contributed metadata.
- Keep generic fallback icons in core for unknown datasource types.

### 5. Make Widget Docs And Help Menus Registry-Driven
- Replace direct reads from the single `app/docs/widgets/index.json` path.
- Allow each extension to contribute doc entries under its own root.
- Preserve the current docs tab UI and deep-link behavior.

### 6. Make Example And Dashboard Roots Extension-Contributed
- Allow each extension to declare example roots and optional dashboard roots.
- Keep the current nested menu behavior, but derive its sources from the registry.
- Prepare for later extraction of `TWIST`, `OWNVERTER`, `SPIN`, `Fast Frame`, and `ThingSet` examples.

## Suggested Metadata Structures

### Widget Metadata
- `type`
- `title`
- `category`
- `icon`
- `description`
- `doc`
- `compatibilityOnly`
- `preferredOrder`

### Datasource Metadata
- `type`
- `title`
- `icon`
- `category`
- `preferredOrder`

### Example Metadata
- `id`
- `title`
- `docRoot`
- `dashboardRoot`
- `firmwareRoot`

## Test Plan
- Update `tests/e2e/widget-picker.spec.js` to verify:
  - category titles are registry-driven
  - compatibility-only widgets stay hidden
  - extension categories appear only when their metadata is enabled
- Update `tests/e2e/tabs-docs.spec.js` to verify:
  - widget docs load from merged metadata
  - doc tabs still open by widget type
- Update `tests/e2e/examples-window.spec.js` to verify:
  - example menus still build correctly from contributed roots
  - the menu tree remains deterministic
- Add a focused regression that disables one extension and proves its docs and picker entries disappear cleanly.

## Acceptance Criteria
- Adding a new widget doc entry no longer requires editing a core global index and core picker heuristics.
- Core no longer hardcodes extension-specific category inference or ranking.
- Widget docs, example menus, and picker tiles all derive from the same merged metadata.
- Compatibility-only behavior remains intact.

## Risks
- Merged metadata can create ordering conflicts if two extensions declare the same type or conflicting ranks.
- Missing metadata can lead to generic fallback behavior that hides real mistakes; validation should be strict in development mode.
- Example root merges can produce duplicate IDs if extension namespaces are not explicit.

## Dependencies For Later Steps
- Step 3 depends on this split so `TWIST` docs and picker entries can move without editing core.
- Step 4 depends on this split so `Fast Frame` helper widgets and docs stay self-contained.
- Step 5 depends on this split so `ThingSet` menus and docs can disappear entirely when the extension is not installed.

## Commit Sequence
1. `docs(extensions): add step 2 metadata and discovery plan`
   - Create this markdown plan.
   - Lock down the metadata inventory and commit order.

2. `refactor(widget-docs): split widget docs metadata by extension source`
   - Add merged registry support for widget docs fragments.
   - Keep current docs behavior stable.

3. `refactor(picker): move category, icon, and order data into registry metadata`
   - Remove hardcoded extension-specific ranking and inference from core.
   - Keep deterministic fallback behavior.

4. `refactor(examples): make example and dashboard roots extension-contributed`
   - Replace direct root assumptions with registry merges.
   - Preserve the current nested menus.

5. `chore(metadata): validate extension-contributed widget and datasource metadata`
   - Add development-time validation for duplicate types, invalid doc paths, and conflicting ordering.

6. `test(discovery): cover widget picker, docs tabs, and example menus through merged metadata`
   - Update focused Playwright coverage for picker/docs/example flows.
