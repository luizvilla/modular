# Playwright E2E Tests

## Run
1) Install dependencies:
```
npm install
```

2) Run the suite:
```
npm run test:ui
```

Playwright launches Electron directly. DevTools may appear because the app opens it in development mode.

## Mock Hardware Flags
The preload bridge supports test-only mock behavior controlled by env vars.

- `MOCK_HW=1`: Enable hardware mocks (default for tests).
- `MOCK_NO_PORTS=1`: Return an empty serial port list.
- `MOCK_NO_EXAMPLES=1`: Return no docs/examples.
- `MOCK_FW_MISSING=1`: Make firmware selection/flash fail.
- `MOCK_IPC_UNAVAILABLE=1`: Expose `window.api` but set serial/flash/can/thingset to `null`.
- `MOCK_DASHBOARD_PATH=...`: Force `openDashboardDialog()` to return a fixed path.
- `MOCK_CSV_PATH=...`: Force the mock CSV chooser to return a specific file path.

Example:
```
MOCK_HW=1 MOCK_NO_PORTS=1 npm run test:ui
```

## Simulated OwnTech Board
Unlike `MOCK_HW`, which replaces the hardware calls in the window, the
simulated OwnTech board sits below the app's real serial code: detection,
the ThingSet tree walk, sessions, writes and the scope download all run
their production code paths against it (`app/js/sim/`, M12 of
`docs/GUI/02-navigation_overhaul.md`).

- `MODULAR_SIM_BOARD=1`: add the demo board at startup (`sim://owntech-demo/if02` ThingSet shell, `/if00` scope data port). Options: `MODULAR_SIM_BOARD=vHigh=24,loadOhm=5`.
- `MODULAR_SIM_ONLY=1`: hide real serial ports, so results don't depend on attached hardware.
- Use with `MOCK_HW=0`: `launchApp({ MOCK_HW: '0', MODULAR_SIM_BOARD: '1', MODULAR_SIM_ONLY: '1' })` (see `tests/e2e/owntech-sim.spec.js`).

Node-level tests (`tests/unit/sim_*.test.js`) drive the simulator directly or through the real main-process handlers without Electron. `tests/unit/sim_thingset_shell.test.js` replays a transcript captured from a real Core4 board (`tests/fixtures/core4_shell_transcript.json`) and compares the bytes; refresh it with `node tests/fixtures/tools/capture_core4.js tests/fixtures` against a board, then regenerate the simulator's data with `node tests/fixtures/tools/derive_core4_objects.js tests/fixtures/core4_shell_transcript.json app/js/sim/core4_objects.json`.
