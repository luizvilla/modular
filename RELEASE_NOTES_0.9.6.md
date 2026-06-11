# Release Notes — v0.9.6

> Released: 2026-06-11

---

## FFT Spectrum Widget

A new **FFT Spectrum** widget is now available under **Serial → FFT Spectrum Plot** in the widget picker. It computes a fast Fourier transform on a chosen data channel and displays the frequency spectrum as a bar chart alongside the time-domain signal.

Key features:

- **Dual-panel layout**: time-domain signal on top, frequency spectrum below — both rendered with uPlot.
- **Harmonic tracking**: up to 8 harmonics are automatically identified and highlighted with distinct colors that match the time-domain trace.
- **Legend**: each harmonic frequency and amplitude is listed in a legend below the spectrum panel.
- **Math channels**: define derived channels (sum, difference, product, or ratio of two raw channels or a constant) directly in the widget's integrated editor, with the same interface as the Fast Frame math channels.
- **FFT settings**: configurable sample size (N points), window function, and frequency axis units (Hz / kHz).
- **Integrated editor**: clicking the wrench icon opens the full-screen integrated editor for channel and FFT configuration.

<!-- INSERT SCREENSHOT: FFT Spectrum widget showing time domain signal above and bar-chart spectrum below with colored harmonic markers -->

---

## Tutorials — Five New Tutorials (TUT-003 to TUT-007)

The Tutorials system now ships with five additional guided tutorials, each opening in a dedicated tab:

| ID | Tutorial | Category | Description |
|----|----------|----------|-------------|
| TUT-003 | XY Signal Generator | Core | Create an XY plot from two signal generator datasources — covers XY Plot widget, binding two datasources to X and Y channels. |
| TUT-004 | Fast Frame CSV | Core | Load a pre-recorded CSV file and visualize it with the Fast Frame Plot widget — covers the Fast Frame datasource, integrated channel editor, and CSV column assignment. |
| TUT-005 | FFT Spectrum CSV | Core | Plot the frequency spectrum of a CSV channel — covers the FFT Spectrum widget and FFT configuration options. |
| TUT-006 | Vertical Gauge Basics | Core | Bind a signal to a vertical bar gauge — covers the Gauge widget, min/max range, and color zones. |
| TUT-007 | SPIN Serial Basics | Hardware | Connect a SPIN board, open the Serial Terminal, and read live data — covers the Serial Port datasource, baud rate, and the terminal widget. |

### Welcome card

A **Welcome** card is now shown when the tutorial list is opened for the first time. It provides a brief overview of the tutorial system and links to each category.

<!-- INSERT SCREENSHOT: Tutorials panel showing welcome card and tutorial list with category tabs -->

---

## Dashboard Zoom and Pan

Three new navigation controls make it easier to work with dense dashboards:

### Zoom buttons in the top bar

**+** and **−** buttons in the header bar zoom the board canvas in and out in 10 % increments. The current zoom level is shown between the buttons as a percentage. Clicking the percentage label resets to 100 %.

### Ctrl+Scroll to zoom

Holding **Ctrl** and scrolling the mouse wheel zooms the board canvas continuously, centered on the current cursor position.

### Right-click drag to pan

Holding the **right mouse button** and dragging pans the board canvas freely in any direction. This works even when the dashboard is locked.

<!-- INSERT SCREENSHOT: top bar with zoom − 100% + buttons visible next to the lock and theme icons -->

---

## Fast Frame and FFT Editor Fixes

- **Auto-advance color picker**: adding a new channel in the FFT Spectrum or Fast Frame integrated editor automatically selects the next color from the palette, so consecutive channels get distinct colors without manual selection.
- **Overflow fix**: the channel-select dropdown in the FFT and Fast Frame editors no longer overflows its container when many channels are available.
- **CSS grid layout**: editor label–field rows now use CSS grid instead of flex to guarantee that labels and inputs are always side-by-side, even inside narrow columns.

---

## Serial Port Reliability

### Stale port handle fix

A race condition could leave the `openPorts` map with a non-open port entry after a failed open attempt (e.g., after firmware upload). Subsequent opens would be blocked ("Port already open"), and writes would fail with "No open serial port". The fix:

- The error callback of `port.open()` now removes the stale map entry immediately.
- The "already open" guard checks `port.isOpen` before blocking re-entry; if the existing entry is not actually open it is removed and the open proceeds.

This resolves the common reconnect deadlock after flashing firmware.

### Resend All button

A **Resend All** button has been added to both the **Actions** and **Setpoints** widgets. After reconnecting to a board (or after a firmware upload), clicking it replays the current UI state to the hardware in one click:

- **Actions (Resend All)**: re-sends the current power command followed by all leg toggle states.
- **Setpoints (Resend All)**: re-sends every non-empty setpoint field for all legs in the correct order.

### Dynamic channel header column count

The channel map in the datasource sidebar now updates its row count immediately when the number of data columns changes — both when columns are added (e.g., POWER_ON → more channels) and removed (e.g., POWER_OFF → fewer channels). Previously the table only grew, leaving stale rows behind on mode switches. The terminal header row uses the same mechanism: it now strictly reflects the live column count from the board, truncating when fewer columns arrive.

---

## Channel Header Save / Load

The **DATA HEADERS** section in the datasource sidebar now includes two buttons:

- **Save Headers**: opens a native OS save dialog defaulting to `app/headers/` (a folder shipped alongside the application). The current labels are written as a JSON file.
- **Load Headers**: opens a native OS open dialog defaulting to the same folder. The selected JSON file is read and the labels are applied immediately to the channel map and pushed to the backend.

This allows named header sets to be reused across different dashboards or to be pre-configured for a specific board firmware variant.

<!-- INSERT SCREENSHOT: DATA HEADERS section showing Save Headers and Load Headers buttons below the channel name table -->

---

## Safety Shutdown

### Configurable shutdown command

Each **Serial Port Reader** datasource now has a **Shutdown Command** text field (e.g. `d_i` for Twist, `i` for other SPIN examples, blank to skip). When the port opens the command is registered with the main process. When Modular closes, the shutdown command is automatically sent to every connected board before the application exits, ensuring no board is left running unattended.

### Scope CSV saved to `app/acquire/`

Scope CSV files produced by the **Acquire** button are now written to `app/acquire/` — a folder shipped alongside the application — instead of a path relative to the process working directory. On Windows the working directory of an Electron app can resolve to a protected system folder (e.g. `C:\Windows\System32`), causing a permission error on save. The `app/acquire/` directory is created automatically on first launch if it does not exist.

### USB reset on quit

After the shutdown command is sent, Modular performs a **USB reset** on each connected device. This causes the board to fully re-enumerate on the bus, so the next connection opens with a clean state without requiring a physical replug. The reset uses libusb via the `usb` package and works on Linux, macOS, and Windows. Each reset is capped at 2 seconds so a non-responsive device never blocks shutdown.

---

## State Machine — Trigger Selector

Each state in the State Machine editor now has a **Trigger** dropdown in its parameter header row (next to the Power selector):

| Option | Command sent | Use case |
|--------|--------------|----------|
| — (no trigger) | *(nothing)* | Default; no scope action on entry |
| Triggering | `o_a` | Arm the scope trigger as soon as the state is entered |
| Acquire | `o_r` | Start a scope acquisition on entry |
| Ripple Trigger | `o_p` | Start a ripple measurement acquisition on entry |

The trigger value is stored in the state's `trigger` field in the machine JSON file and is backward-compatible with older machine definitions (states without the field behave as "no trigger").

<!-- INSERT SCREENSHOT: State Machine editor params panel showing Name, Power, and Trigger dropdowns in the header row -->

---

## Upgrading

No breaking changes. Existing dashboard JSON files and machine JSON files load without modification:

- States exported before this version without a `trigger` field default to "no trigger" automatically.
- The `app/headers/` folder is created automatically on first launch if it does not exist; no manual action is required.
