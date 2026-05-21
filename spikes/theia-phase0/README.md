# Theia Phase 0 Spike

This spike is intentionally isolated from the main Modular app.

Goal:

- prove that a custom Theia desktop application can host a `Modular Dashboard` view
- prove that the view can load the current dashboard UI through a thin compatibility shim
- prove that a custom Theia frontend extension can call one backend service successfully

Planned validation:

1. install dependencies inside `spikes/theia-phase0/`
2. build the local `modular-dashboard` extension
3. start the Theia Electron target
4. verify the view opens with:
   - backend probe status at the top
   - embedded Modular dashboard iframe below

Notes:

- the hosted dashboard is a compatibility spike, not a production integration
- it serves the current `app/dashboard` assets through a backend route
- it injects a minimal `window.api` shim so the dashboard can bootstrap without Electron preload

## Results

What this spike proved:

- a custom Theia application can load a custom `Modular Dashboard` view
- the view can host the current dashboard shell in an iframe
- a backend contribution can serve Modular-specific routes successfully
- the embedded dashboard can render the current dashboard shell and load a dashboard JSON fixture

What this spike did not prove:

- production-grade Electron packaging
- native hardware integration inside Theia backend services
- reuse of the full existing `window.api` contract
- that the current dashboard can run unmodified without a compatibility shim

Environment-specific findings from this repo:

- the latest Theia packages available during this spike required compatibility shims on Node 18
- an Electron-targeted bootstrap initially hit native dependency issues around `native-keymap` and host system libraries
- the browser-targeted Theia app was sufficient to answer the architectural Phase 0 question

Implication:

- the host-platform idea is viable enough to justify a real Phase 1 only if the team is willing to align on a supported Theia toolchain and treat Electron packaging as separate follow-up work
