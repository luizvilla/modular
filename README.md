# Modular

Modular is an Electron application built on top of [Freeboard](dashboard/README.md) for monitoring data coming from serial devices. It provides custom Freeboard plugins for reading serial ports, displaying terminal output, recording CSV files and flashing firmware to boards using **mcumgr**.

## Features

- **Serial datasources** – read numeric values from any serial port using a configurable separator and end of line.
- **Real time dashboards** – create dashboards using Freeboard widgets or the provided custom widgets (uPlot charts, serial terminal, etc.).
- **CSV recording** – record incoming data to a CSV file with optional timestamps.
- **Firmware flashing** – flash boards that support mcumgr directly from the GUI.

## Getting started

1. Install [Node.js](https://nodejs.org/) 20 or later.
2. Install dependencies:
   ```bash
   npm install
   ```
   On Windows, `socketcan` is an optional dependency and will be skipped. This is expected.
3. Launch the application in development mode:
   ```bash
   npm start
   ```
   <!-- Runtime content lives under app/ after the release/test split. -->
   The dashboard will be loaded from the `app/dashboard` directory.
4. To build distributable packages use:
   ```bash
   npm run dist
   ```
   Binaries for the current platform will be placed in the `dist` folder.

### Windows build notes

- CAN over SocketCAN is Linux-only. On Windows, CAN support requires a vendor driver and an `ffi-napi` binding (see `js/can_adapter.js`).
- If native modules need to compile (for example if prebuilt binaries are unavailable), install the Windows build tools first (MSVC Build Tools + Python).

<!-- Dev-only dashboards moved under dev/ to separate release vs test content. -->
Sample dashboard configurations can be found under [`dev/test_dashboards`](dev/test_dashboards/).

## ThingSet over CAN

<!-- Runtime JS moved under app/js after release/test split. -->
JavaScript implementation of the CAN/ThingSet protocol under `app/js/`:

- `app/js/ts_can_utils.js` – CAN ID builder and ISO‑TP response reassembly.
- `app/js/thingset_bin.js` – ISO‑TP TX/RX and high‑level ThingSet client (`ThingSetCAN`).
- `app/js/scan.js` – scans the bus for nodes by requesting `pNodeID`. Writes `thingset/nodes.json`.
- `app/js/query_nodes.js` – recursively explores a node’s ThingSet tree and writes `thingset/node_<addr>_tree.json`.
- `app/js/can_adapter.js` – CAN bus wrapper: native SocketCAN on Linux; on Windows use `ffi-napi` to call a vendor driver (no built‑in CAN).

Dependencies

- Included in `package.json`: `socketcan` (Linux) and `cbor`.
- Windows (optional): `ffi-napi` (+ `ref-napi`, vendor DLL) to bind a driver API.

Install

```bash
npm install
```

Test commands

- Scan the bus: `npm run scan:can` (outputs `thingset/nodes.json`)
- Build node trees: `npm run ts:query` (reads `thingset/nodes.json`, writes `thingset/*.json`)
- Basic client test: `npm run ts:test`

Windows support: use `ffi-napi` to bind your CAN vendor’s driver (e.g., Kvaser, PEAK PCAN, NI‑CAN) and implement the same `Bus` interface in `js/can_adapter.js` (`send`, `recv(timeoutMs)`, `shutdown`). No SocketCAN is required on Windows.

### Linux SocketCAN setup (GUI auth)

- Script: `app/scripts/setup_can_linux.sh` configures `can0` to 500000 bps and brings it up.
- IPC: call `ipcRenderer.invoke('can-setup-linux')` from the renderer to request setup. The main process uses `pkexec` to prompt for admin rights via GUI and runs the script.
- Notes: This is Linux-only. Ensure a PolicyKit agent is running on your desktop so `pkexec` can display the authentication prompt.

## Repository layout

<!-- Runtime sources now live under app/ (dev/test content is outside). -->
- `app/main.js` – Electron main process that handles serial ports and IPC.
- `app/flasher.js` – helper used for firmware flashing through mcumgr.
- `app/dashboard/` – bundled Freeboard source with additional plugins.
<!-- Dev-only dashboards are in dev/ to keep release artifacts clean. -->
- `dev/test_dashboards/` – example dashboards for development or testing.

## License

<!-- License file now resides under app/ with the bundled dashboard. -->
The code in this repository is provided under the MIT License. See [`app/dashboard/LICENSE`](app/dashboard/LICENSE) for details about the Freeboard components bundled with this application.
