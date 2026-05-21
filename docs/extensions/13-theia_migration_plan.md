# Step 13 — Theia Migration Plan

## Summary

Evaluate and, if justified, migrate Modular from a custom Electron application with a hand-built IDE surface into a custom Theia-based desktop product.

This plan assumes the development goal has changed:

- the editor and workspace experience should become first-class
- completion, hover, navigation, terminals, and project tooling should come from an IDE framework rather than being rebuilt incrementally inside Modular
- Modular should become a domain tool integrated into the IDE, not the other way around

The key architectural shift is:

- current direction: add IDE features into Modular
- proposed direction: use Theia as the host product and add Modular into it

## Why Consider This Direction

- Theia is explicitly designed for building custom cloud and desktop IDEs and tools, including Electron-packaged applications.
- Theia already provides the workbench shell, workspace model, editors, terminals, command palette, layout system, and extension architecture that Modular is currently recreating selectively.
- Theia supports compile-time custom extensions, which is the right model for deep integration of Modular-specific hardware and dashboard behavior.
- Theia can also bundle existing VS Code extensions, which reduces the amount of IDE infrastructure that Modular would otherwise need to own directly.

This direction is worth considering if the long-term priority is:

- strong IDE behavior
- maintainable workspace tooling
- better language support
- a cleaner path for future code-centric features

## Why This Is Not A Small Swap

Moving to Theia does not just replace Monaco or the firmware window.

It changes the host application model:

- current host:
  - Electron main process in `app/main.js`
  - preload bridge in `app/preload.js`
  - dashboard UI rooted in `app/dashboard/`
- proposed host:
  - Theia frontend application
  - Theia backend application
  - custom Theia extensions for Modular services and views

Theia solves the IDE shell problem, but it does not automatically port:

- the Freeboard-based dashboard
- the serial, CAN, and flash bridge
- the current Electron IPC surface
- the current extension runtime and packaging model

Therefore, the correct framing is:

- not a refactor of the firmware extension plan
- a staged migration of the whole product architecture

## Target Product Shape

Build a custom Theia desktop product with Modular contributed as custom Theia extensions.

The resulting product should look conceptually like:

```text
theia-modular/
  applications/
    electron/
  extensions/
    modular-core/
    modular-dashboard/
    modular-hardware/
    modular-firmware/
```

High-level responsibilities:

- `modular-core`
  - branding
  - startup layout
  - commands, menus, toolbar integration
  - product configuration
- `modular-dashboard`
  - dashboard view
  - dashboard lifecycle
  - loading and saving dashboard definitions
  - integration of the existing Freeboard-based UI
- `modular-hardware`
  - serial
  - CAN
  - flashing
  - ThingSet services
  - long-lived backend processes
- `modular-firmware`
  - PlatformIO workflows
  - firmware-oriented commands
  - workspace helpers
  - optional future managed toolchain support

## Recommended Technical Strategy

Use Theia as the base and keep Modular-specific features in Theia extensions.

Do not begin with a full UI rewrite.

Start by embedding the current dashboard into a Theia view and migrating backend services underneath it. This preserves working domain behavior while replacing the product shell around it.

The recommended integration model is:

- Theia frontend extension:
  - contributes a `Modular Dashboard` view
  - contributes toolbar items and commands
  - opens the view in the initial layout
- Theia backend extension:
  - owns hardware and build services
  - exposes JSON-RPC services to the frontend
  - manages long-running runtime state
- Electron packaging:
  - handled by the Theia desktop application structure

## Migration Principles

- do not rewrite the dashboard first
- do not rewrite hardware protocols first
- do not port every widget before proving the host architecture
- keep migration slices reversible until the spike is complete
- prioritize proving integration seams before polishing product UX

## Phase 0 — Feasibility Spike

Goal:

- prove that Theia can host the Modular dashboard and firmware flows without forcing a complete rewrite up front

Deliverables:

- scaffold a minimal Theia desktop application
- add one custom Theia extension named `modular-dashboard`
- contribute a `Modular Dashboard` view to the workbench
- load the current dashboard UI inside that view
- add one backend service that the view can call successfully
- prove one real end-to-end action:
  - load a dashboard file
  - or list serial ports
  - or run a simple firmware command

Out of scope:

- no attempt at full feature parity
- no full widget rewrite
- no full hardware migration
- no packaging polish

Spike success criteria:

- the dashboard can render in a Theia view without broken layout or blocked interaction
- Theia frontend can call a custom backend service successfully
- at least one existing Modular workflow can be reproduced inside the Theia shell
- the team has a clear answer to whether embedding is practical or too fragile

Stop or continue decision:

- continue only if the dashboard embedding and one backend service both work cleanly
- stop if the dashboard cannot coexist with Theia layout semantics without major surgery

## Phase 1 — Product Bootstrap

Goal:

- establish Theia as the desktop host product and define Modular’s extension boundaries

Deliverables:

- choose the product base:
  - minimal generated Theia app
  - or Theia IDE / Blueprint-based desktop product
- define workspaces and package structure
- set up Electron development and packaging scripts
- add product branding and a basic initial layout
- define extension boundaries:
  - dashboard
  - hardware
  - firmware
  - product shell

Acceptance:

- the custom Theia desktop product launches locally
- custom Theia extensions build and load
- the product has a stable initial layout and startup path

## Phase 2 — Dashboard Embedding MVP

Goal:

- make Modular visible and useful inside Theia without rewriting the dashboard stack

Deliverables:

- create a `Modular Dashboard` view contribution
- host the existing dashboard frontend in that view
- add dashboard file open and save commands
- preserve current dashboard JSON behavior
- support at least one representative widget path

Important implementation choice:

- prefer embedding the existing dashboard UI in a dedicated view over rewriting it into native Theia widgets at this stage

Acceptance:

- a dashboard can be opened and rendered inside Theia
- the embedded dashboard remains interactive
- Theia layout persistence does not break the embedded dashboard lifecycle

## Phase 3 — Backend Service Migration

Goal:

- move privileged runtime behavior out of Electron-specific IPC and into Theia backend services

Deliverables:

- define backend services for:
  - serial
  - CAN
  - flashing
  - dashboard file operations
  - firmware build helpers
- expose those services to the frontend via Theia’s service model
- port the current logic from:
  - `app/main.js`
  - `app/preload.js`
  - selected widget and datasource bridge assumptions
- preserve protocol behavior where possible

Out of scope:

- no UI redesign yet
- no complete widget cleanup yet

Acceptance:

- the dashboard no longer depends on the current preload bridge
- at least the core runtime flows work via Theia backend services
- service boundaries are explicit and testable

## Phase 4 — Firmware And IDE Integration

Goal:

- replace the custom firmware window direction with native Theia workbench integration

Deliverables:

- use Theia editors and workspace model for firmware files
- provide commands for:
  - build
  - upload
  - clean
  - reindex
- integrate PlatformIO workflows through backend services
- decide whether managed runtime installation is still necessary once Theia is the host
- evaluate whether existing VS Code / Theia extension support already covers enough of the C/C++ experience

Acceptance:

- firmware editing happens in the main Theia workbench
- Modular-specific build and upload commands work from the IDE
- the old standalone firmware BrowserWindow is no longer the preferred path

## Phase 5 — Product Integration And Hardening

Goal:

- make the Theia-based product coherent enough to replace the current standalone app for daily use

Deliverables:

- align menus, commands, and toolbar actions
- improve persistence and startup behavior
- harden failure handling for hardware and build flows
- validate packaging on the target platform
- document the extension structure and runtime model

Acceptance:

- the product is supportable as a primary development tool
- major workflows no longer depend on the legacy Electron shell

## Phase 6 — Rewrite Or Retire Remaining Legacy Surfaces

Goal:

- decide which remaining pieces should stay embedded and which should become native Theia components

Candidates:

- dashboard shell and paneling
- plugin/editor management surfaces
- example browser
- documentation tabs
- legacy Electron-only menus or windows

Decision criteria:

- keep embedded if the current UI is stable and domain-specific
- rewrite only when native Theia integration materially improves maintainability or UX

## Development Sequence

The migration should be executed in this order:

1. feasibility spike
2. Theia product bootstrap
3. dashboard embedding MVP
4. backend service migration
5. firmware workbench integration
6. hardening and packaging
7. selective native rewrites only where justified

This ordering is important because it avoids paying the rewrite cost before the host-platform decision is validated.

## Recommended First Deliverable

The first serious deliverable should be a one-week spike with a strict objective:

- open Theia
- show `Modular Dashboard`
- load one dashboard
- call one real backend service

If that works, the migration remains alive.

If that does not work cleanly, return to the current Modular-based firmware path and do not keep investing in Theia migration.

## Test Plan

### Spike validation

- verify the Theia product launches in Electron
- verify the custom view appears in the shell
- verify one embedded dashboard loads successfully
- verify one backend call succeeds from the embedded dashboard

### Integration tests

- dashboard open and save through Theia commands
- frontend-to-backend service calls for serial and firmware workflows
- persistence of layout and Modular view state

### Electron end-to-end

- launch the custom Theia desktop product
- open a workspace
- open the Modular dashboard view
- trigger one hardware or firmware flow
- verify no fatal renderer or backend errors

### Regression focus areas

- layout persistence with embedded dashboard content
- startup sequencing of backend services
- path handling for workspace-relative resources
- Linux packaging and native dependency loading

## Commit Sequence

1. `docs(theia): add migration architecture and spike plan`
- Record the migration goal, constraints, and phase structure.

2. `chore(theia): scaffold custom Theia desktop product`
- Add the base Theia application structure and initial build scripts.

3. `feat(theia): add Modular dashboard view contribution`
- Contribute the first custom Theia frontend extension and open the dashboard view.

4. `feat(theia): prove dashboard embedding inside Theia`
- Load the existing dashboard UI in the new view and validate basic rendering.

5. `feat(theia): add first Modular backend service`
- Expose one real service path from backend to frontend and wire it into the embedded dashboard.

6. `feat(theia): migrate core runtime services from Electron bridge`
- Port serial, CAN, flashing, and file operations behind Theia backend services.

7. `feat(theia): integrate firmware workflows into the workbench`
- Replace the standalone firmware surface with Theia-native editing and commands.

8. `test(theia): add Theia Electron smoke and integration coverage`
- Add focused coverage for launch, dashboard view, and one representative flow.

9. `refactor(theia): retire legacy Electron-only surfaces where replaced`
- Remove or demote old host-specific paths only after parity is proven.

## Effort Estimate

Rough order-of-magnitude estimate for one engineer:

- phase 0 spike:
  - `3-7 days`
- MVP Theia product with embedded Modular dashboard:
  - `3-6 weeks`
- usable integrated product with backend migration:
  - `6-10 weeks`
- broader parity migration:
  - `2-4 months`

This is a product migration, not a narrow feature implementation.

## Go / No-Go Criteria

Proceed with the Theia migration only if the spike shows:

- embedding the dashboard is practical
- Theia backend services can own Modular’s privileged runtime behavior cleanly
- the resulting product direction clearly reduces future IDE-related engineering compared to continuing the current path

Do not proceed if the spike shows:

- the dashboard requires near-total rewrite just to render stably
- the hardware and runtime bridge becomes more fragile than the current Electron model
- the migration mainly adds framework complexity without removing enough custom IDE work

## Assumptions And Defaults

- Theia is the host product, not a sidecar window inside the current app
- the dashboard is embedded first and rewritten only selectively later
- hardware and firmware services move to Theia backend extensions rather than staying in a preload-centric Electron bridge
- Linux remains the first supported desktop target
- the spike phase is mandatory before authorizing a full migration
