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
