# Release Notes — v0.9.4

> Released: 2026-05-25

---

## Multi-Tab Dashboard System

The single dashboard has been replaced by a full tab system. Each tab holds an independent, fully isolated dashboard that is automatically saved and restored when switching.

- A **+** button (pinned to the left of the tab strip) opens a blank dashboard in a new tab.
- **Opening a file** always loads it into a new tab — the current dashboard is never overwritten.
- **Switching tabs** auto-saves the departing dashboard and restores the arriving one; no data is lost.
- **Tab rename**: click an already-active tab to rename it inline (Enter to confirm, Escape to cancel).
- **Tab reorder**: drag tabs left and right to reorganise them.
- **Keyboard shortcuts**: Ctrl+T (new tab), Ctrl+O (open file), Ctrl+S (save current), Ctrl+Tab (next tab), Ctrl+Shift+Tab (previous tab).
- File menu updated: *New Dashboard Tab* and *Open Dashboard* replace the old single-tab actions.

<!-- INSERT SCREENSHOT: tab strip showing multiple named dashboard tabs with + button on the left -->

---

## Widgets Side Panel

A second tab has been added to the left side pane alongside *Datasources*: **Widgets**.

- Lists all panes and their widgets grouped by pane.
- Clicking a **widget name** opens its settings editor directly — no need to hover over the board to find the wrench.
- Clicking a **pane title** opens the pane settings editor, making it easy to rename a pane.

<!-- INSERT SCREENSHOT: side pane showing Widgets tab with pane groups and widget items -->

---

## Duplicate Pane

A clone icon now appears in the pane toolbar (between the wrench and the trash separator). Clicking it creates an exact copy of the pane and all its widgets. Each cloned widget receives a unique `_2` / `_3` / `_4` suffix so names never collide.

<!-- INSERT SCREENSHOT: pane toolbar showing +, wrench, clone, |, and trash icons -->

---

## OwnTech Actions Widget — Scope Section

A dedicated **Scope** section has been added to the Twist/Ownverter Actions widget:

- **Trigger** sends the scope trigger command immediately.
- **Acquire** arms fast-frame capture on the port, sends the acquire command, polls until data is complete, and automatically saves a timestamped `scope.csv`.

<!-- INSERT SCREENSHOT: Actions widget showing Power, Scope, and Leg Toggles sections -->

---

## OwnTech Setpoints Widget Redesign

The Setpoints widget has been reorganised with a per-leg layout:

- Each leg (LEG1, LEG2, …) has its own group of rows: Reference (variable + value), Duty, Frequency, Phase, DT Rise, DT Fall.
- **Auto Send** toggle: when enabled, changes to a numeric field are debounced and sent automatically without clicking Send.
- The reference variable dropdown is narrowed to fit short names (V1, VH, I1…) and leave maximum space for the value field.
- All field values and the Auto Send state are **persisted across dashboard tab switches**.

<!-- INSERT SCREENSHOT: Setpoints widget showing LEG1 and LEG2 groups with per-row Send buttons -->

---

## Fast Frame Control — Standalone Retrieve Button

A **Retrieve** button has been added alongside *Trigger + Retrieve*. It sends only the retrieve command, allowing data to be re-read after an acquisition that already completed without re-arming the trigger.

---

## Widget and Pane State Persistence Across Tab Switches

When switching dashboard tabs, freeboard serialises all widget state. Two widgets that hold runtime state beyond their saved settings are now explicitly included:

- **Twist/Ownverter Actions**: power mode (IDLE / ON / OFF) and all leg toggle positions are saved.
- **Twist/Ownverter Setpoints**: all field values per leg and the Auto Send toggle are saved.

Switching tabs and switching back will restore the exact state the user left.

---

## Serial Terminal Improvements

- **Line wrap** is now supported; long lines wrap instead of overflowing horizontally.
- **Sign alignment**: positive and negative numbers in columns now align correctly.
- **Pause/Resume** button replaces the old auto-scroll toggle. The terminal pauses scrolling while the user inspects output and resumes on click.

---

## Extension Manager

A built-in Extension Manager is now accessible from the Extensions menu:

- Lists all installed and built-in extensions with their current enabled/disabled state.
- **Toggle buttons** enable or disable built-in extensions without restarting.
- **Local install** flow: install an extension bundle from disk.
- **Uninstall** removes installed (non-built-in) extensions.
- ThingSet CAN has been moved out of the core process into its own extension entry, reducing the application footprint for users who do not use ThingSet.

<!-- INSERT SCREENSHOT: Extension Manager showing built-in and installed extensions with toggle buttons -->

---

## Plot Stability Fixes

- Time Plot no longer freezes or disappears when dragged to a pane of a different height.
- Time Plot channel editor labels corrected to match the fast-frame editor style.
- Fast Frame plot no longer enters an infinite resize loop; axis bounds now default to *auto*.
- XY Plot drag behaviour stabilised.
- Single-widget panes now fill the full pane height correctly.
- Fast Frame overflow at the bottom of the widget is resolved.

---

## Other Fixes

- **Duplicate datasource rows**: moving a pane no longer creates a ghost label row in the Datasource selector of OwnTech widgets.
- **Serial Command Buttons widget**: the Title field was missing from the settings dialog; it is now present and renaming works correctly.
- **Dashboard save format**: dashboards are now saved with indented JSON instead of a single line, making them diff-friendly.
- **Grid width**: maximum column count increased to 10.
- **Calibration widget**: serial writes are now chunked to prevent Zephyr UART ring-buffer overflow on long calibration commands.
- **Pane header**: toolbar buttons no longer wrap to a second line in narrow panes.
- **Dashboard file save dialog**: defaults to the project-local folder instead of the system home directory.

---

## Upgrading

No breaking changes. Existing dashboard JSON files load without modification. The first time an existing dashboard is opened it will appear in the first tab; additional tabs can be created as needed.
