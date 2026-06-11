# Release Notes — v0.9.5

> Released: 2026-06-09

---

## Tutorials System

A new guided **Tutorials** system is now built into the application. Tutorials appear as an overlay stepper card (top-right corner) and walk the user through actions step by step without leaving the dashboard.

### Dashboard Basics tutorial

The first tutorial, available under **Tutorials → Core → Dashboard Basics**, covers the complete flow from a blank board to a live signal:

1. Introduction to panes and widgets
2. How datasources connect to widgets
3. Create a pane with the Add Pane button
4. Create a Signal Generator datasource (auto-advances once the datasource is created)
5. Add a Time Plot widget to the pane (auto-advances once the widget is added)
6. Bind the signal generator to the plot and configure Y range
7. Tutorial complete

The tutorial opens in its own tab with a clean blank dashboard. Switching to any other tab hides the stepper; switching back restores it exactly where you left off. Launching the tutorial a second time always opens a fresh tab.

<!-- INSERT SCREENSHOT: tutorial stepper card showing step title, progress bar, instructions, and Next/Back/Skip/Exit buttons -->

### Opposition Testing tutorial

A second tutorial, under **Tutorials → Hardware → Opposition Testing**, guides through activating one leg of the TWIST board for an opposition test:

1. Open Courseware → Hackathons → Opposition Testing
2. Upload the opposition-testing firmware to the target board
3. Load the pre-built Opposition Testing dashboard
4. Click POWER ON in the Action Buttons pane
5. Enable the LEG switch on LEG1
6. Enable the DRIVER switch on LEG1
7. Set duty cycle to 0.5 and click Send

This tutorial runs in **overlay mode**: the stepper card remains visible even when the user navigates to the courseware doc tab or the loaded dashboard tab, so the guidance is always on screen while the user interacts with hardware.

Relevant UI elements (Upload button, Load Dashboard button, POWER ON, LEG toggle, DRIVER toggle, Duty row) are highlighted with a green outline as the user advances through each step.

<!-- INSERT SCREENSHOT: opposition testing tutorial stepper visible alongside the loaded dashboard with hardware controls -->

---

## Opposition Testing Courseware Lab

The **Hackathons** courseware section now includes an **Opposition Testing** lab entry:

- Pre-built dashboard (`dashboard_opp_testing.json`) with Action Buttons, Setpoint Buttons, V1/V2 gauges, Scope Plot, and Terminal panes already configured for the TWIST board.
- Opposition-testing firmware binary ready to upload from the courseware panel.
- README with wiring diagram, communication diagram, and step-by-step instructions.

<!-- INSERT SCREENSHOT: Courseware → Hackathons → Opposition Testing panel with Load Dashboard and Upload buttons -->

---

## State Machine Widget — Major Update

The State Machine widget receives a large set of improvements across the editor, the execution engine, and hardware integration.

### Editable transitions

Transitions can now be edited in place. Clicking a transition arrow on the canvas (or its label in the sidebar) opens an edit form pre-filled with the From/To states and all existing condition rows. **Update**, **Delete**, and **Cancel** buttons replace the Add button when editing an existing transition.

### Multi-condition transitions (AND / OR)

Each transition now supports a list of conditions instead of a single condition:

- A **+ AND** button appends a condition that must also be true.
- A **+ OR** button appends an alternative condition (if any OR branch is true the transition fires).
- Conditions are evaluated left-to-right with short-circuit logic.

### Channel-name-aware variable picker

The condition variable dropdown now reads channel names directly from the serial datasource's custom header labels (the same names shown in the Terminal header row and the channel editor). The old hardcoded protocol variable names are used only as a fallback.

A synthetic `__state__` variable is also available, returning the locally tracked power mode (0 = IDLE, 1 = ON, 2 = OFF) without polling serial, useful for power-state-based transitions.

### Power mode and reference per state

Each state can now define a **Power mode** (IDLE / ON / OFF) and a **Reference** (variable + value) per leg. When the machine enters that state during execution, the Actions and Setpoints widgets mirror the values into their own fields, so the user can see and take manual control immediately.

A `sm:state-entered` CustomEvent is dispatched on every state transition, allowing other widgets to react.

### Export / Import (machine.json)

- **Export** serialises the full machine definition (states, transitions, device type, initial state) to a `machine.json` file via the native OS save dialog, defaulting to `userData/machines/`.
- **Import** reads a `machine.json` file via the native OS open dialog, validates it, and loads it into the editor for review before saving.

<!-- INSERT SCREENSHOT: State Machine editor showing states panel (left) and canvas with transition arrows (right) -->

---

## Fast Frame Plot — Inline Channel Editor and Math Channels

### Inline channel editor

The ▼ **Channels** toggle button at the bottom of the Fast Frame Plot widget reveals an inline channel editor. Users can add, configure, and remove channels without needing the separate Channel Manager widget.

### Math channels

A new **Math** channel type lets users compute derived signals directly in the widget:

- Choose two operands (any CSV column or a numeric constant **k**) and an operator (+, −, ×, ÷).
- The constant input (`k`) appears automatically when the "— constant k —" option is selected for an operand.
- Missing operands degrade gracefully: the math channel becomes an empty series so the remaining channels still render.

<!-- INSERT SCREENSHOT: Fast Frame Plot with Channels panel open showing a Duty math channel (A ÷ k=1000) -->

---

## Ripple Acquisition Button

A **Ripple Acq.** button has been added to the Scope row of the Twist/Ownverter Actions widget alongside the existing Trigger and Acquire buttons. It sends the `o_p` ripple-acquisition command in one click.

---

## Serial Terminal — Live Channel Header Row

A grayed-out header bar now sits above the serial terminal window displaying each channel's custom name (or default "Channel A / B / …") in the color matching its data column. The header:

- Aligns pixel-perfectly with the data values below using the same field-width logic as the terminal colorizer.
- Updates at most once per second.
- Stays in sync with horizontal scroll.
- Disappears automatically when the terminal has no channel data.

<!-- INSERT SCREENSHOT: serial terminal with "Channel A  Channel B  Channel C …" header row above live data -->

---

## Custom Serial Channel Names

The Serial Port Datasource settings panel now contains a **two-column names table** (one row per channel) instead of a single text field:

- Default names are "Channel A", "Channel B", … and update automatically when more channels appear.
- Custom names typed in the table are pushed to the backend immediately on blur.
- Names propagate to the Time Plot and XY Plot variable pickers, the terminal header row, and the state machine condition dropdowns — no manual configuration required elsewhere.

---

## Dashboard UX Improvements

### Pane drag fixed

A regression introduced in 0.9.4 caused panes to jump to the wrong vertical position when dragged. The gridster row calculation is now correct.

### Ctrl+Z undo for pane drag

Pressing **Ctrl+Z** immediately after dragging a pane restores it to its original position. Up to 20 drag snapshots are retained per session; history clears when a new dashboard is loaded.

### Dashboard lock

A lock icon in the header (left of the theme toggle) opens a **Lock Setup** dialog:

- When locked, pane drag and all editing are disabled.
- An optional password can be set; unlocking prompts for it.
- Lock state is persisted in `dashboard.json` and restored on load.

### Other UX fixes

- Edit-widget dialog now scrolls correctly on small screens (modal was clipped by `overflow:auto` on the overlay).
- **Ctrl+Tab / Ctrl+Shift+Tab** cycle through all open tabs (dashboard and doc tabs combined), not only dashboard tabs.
- Courseware and Examples dashboards now open in a new dashboard tab instead of replacing the current one.
- Doc panel code blocks no longer wrap mid-statement.

---

## Upgrading

No breaking changes. Existing dashboard JSON files load without modification. State machine definitions saved before this version are automatically upgraded to the multi-condition format on next save (the old single-condition fields are read and converted).
