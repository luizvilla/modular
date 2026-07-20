# Release Notes — v0.9.7

> Released: 2026-07-21

---

## Scope — Configurable Ripple Period Count

The Twist/Ownverter Actions widget's Scope row gains a **Periods** spinner (1–32) next to the existing **Ripple Acq.** button. Changing it immediately sends the new period count to the firmware, which sweeps the trigger ratio over that many switching periods per acquisition cycle so the 1024-point capture buffer spans exactly the requested number of periods, instead of a fixed count.

<!-- INSERT SCREENSHOT: Scope row of the Actions widget showing the Periods spinner next to Trigger, Acquire, and Ripple Acq. buttons -->

---

## Serial Datasource Pane — Redesign

The settings pane for serial-based datasources (Serial Port, Fast Frame, OwnTech, ThingSet Serial) has been reworked to remove the confusing Save / Reset / Refresh / Pause button row.

### Open/Close Port toggle

A compact slider replaces the old Pause/Resume button for serial datasources. It's colored and labeled by the actual connection state — green "Port Open" or red "Port Closed" — and clicking it opens or closes the connection directly. Non-serial datasources (CAN, Signal Generator) keep the original generic Pause/Resume button, since they have no underlying port to open or close.

<!-- INSERT SCREENSHOT: datasource pane showing the Open Port / Close Port toggle, Reset Device, and Refresh Buffer buttons -->

### Reset Device now performs a real hardware reboot

Previously, "Reset" only sent the configured shutdown/idle command over the data link — the firmware kept running, just idled. **Reset Device** now sends that idle command first (if configured), then reboots the microcontroller for real via `mcumgr`'s SMP transport over serial — the same mechanism already used to reset a board after flashing firmware. The button is disabled until a shutdown command is configured and the port is open.

### Settings apply automatically

Editable fields (baud rate, separator, end-of-line, shutdown command, refresh interval, channel headers) now apply themselves — checkboxes and dropdowns commit immediately, text fields commit when you leave the field or press Enter. The **Save** button has been removed; every field's tooltip explains when it takes effect.

### Refresh Buffer

The existing "force an immediate update" button is relabeled **Refresh Buffer** for serial datasources, to make clear it re-reads the live serial buffer rather than reloading settings.

---

## Dashboard Pane Dragging — Less "Wiggly"

Dragging a pane to reposition it on the dashboard no longer throws neighboring panes much farther than necessary to make room. Two related issues were fixed in the drag/collision logic:

- A pane being nudged out of the way was previously displaced based on where the dragged pane would *eventually* settle, recalculated on every point the pointer crossed during the drag — so a small nudge could shove a neighboring pane down by the full height of the pane being dragged. Displacement is now measured against the drag's actual real-time position, so a neighbor only moves as far as truly needed to clear it.
- A narrow (single-column) pane sitting next to a much wider one could visibly ping-pong sideways as a drag continued nearby, because the "which side should this move to" choice was recalculated from scratch on every tick. It now recognizes when a pane is already clear and leaves it alone.

This is most noticeable in dashboards that mix thin, tall panes (e.g. a single-column command/action panel) with wider ones (e.g. plots) — a very common layout for control dashboards.

---

## Fixed: Dashboard Edits Lost When Switching Tabs

Editing a dashboard — adding a datasource, renaming one, dragging a pane — then clicking away to a documentation tab and back could silently discard those edits, reverting to whatever the dashboard looked like when the tab was first opened. The same bug also caused every pane and widget to be duplicated in the page (invisibly, since it happened while the dashboard was hidden behind the doc view).

The dashboard's live state is now correctly recognized as still current when you return to the same tab, instead of being unconditionally reloaded from an outdated snapshot. Switching between two different dashboard tabs continues to save and restore each one's state independently, as before.

---

## Serial Connection Reliability

### Fixed: concurrent port opens could permanently lock a device

If two datasource widgets (or a widget plus the app's own reconnect logic) tried to open the same serial port at nearly the same moment, the second attempt could open a duplicate OS-level handle and collide with the first, leaving the port locked until the device was physically unplugged and replugged. Opens on the same path are now serialized — a second concurrent request waits for the first instead of racing it.

### Serial diagnostics in the terminal

Serial port activity — open/close/write attempts and errors, with error codes where available, and whether a disconnect was requested or unexpected — is now logged with timestamps to the terminal Modular was launched from (`[serial] ...` lines), in addition to the existing on-screen activity indicators. This makes it much easier to diagnose connection issues during testing without opening DevTools.

---

## Fast Frame Fixes

- **Settings dialog restored**: the wrench/edit icon on the Fast Frame Control widget had stopped opening its settings dialog entirely, making the datasource impossible to (re)configure from the UI. It works again, including on first add.
- **Live port list**: the Fast Frame datasource's port dropdown now polls for available ports the same way the standard Serial Port datasource does, so a device plugged in after the settings dialog is opened appears within about 1.5 seconds instead of requiring the dialog to be reopened.
- **Welcome card no longer overlaps dialogs**: the "Getting Started" welcome card now hides itself while any modal (such as a datasource settings dialog) is open, and reappears if the dialog is cancelled.

---

## Performance

Renderer memory growth during extended sessions has been fixed. Gauge widgets were each running an independent polling timer and re-writing SVG attributes on every tick regardless of whether the value had changed, which caused steady memory growth (observed up to 3+ GB over 10 minutes) and unnecessary IPC traffic. Gauges now react to data updates instead of polling independently, skip redundant redraws, and sync their rendering to the browser's paint cycle. Overall serial-datasource IPC call volume dropped roughly 5x (~3000/min → ~600/min) in testing.

A periodic `[HEALTH]` diagnostic log (every 60s) was also added to the terminal, reporting main-process and renderer memory, per-channel IPC call rates, and buffer sizes — useful for spotting regressions of this kind going forward.

---

## Packaging & Platform Support

- **macOS**: builds now produce a proper universal binary with an application icon, instead of a discrete-architecture build.
- **mcumgr bundled per-platform**: the firmware-flashing/reset tool is now bundled separately for Linux (x64, x86, arm64, armv7) and macOS (x64, arm64), so flashing and device reset work correctly regardless of host architecture.

---

## Upgrading

No breaking changes. Existing dashboard JSON files load without modification.

- If you had a workflow built around clicking **Save** in the serial datasource pane, no action is needed — every field now applies itself, so there's simply nothing left to click.
- The **Reset Device** button now performs a full hardware reboot rather than only sending an idle command; if a shutdown command was previously left blank because a soft idle was sufficient, you may want to configure one for a clean reboot sequence.
