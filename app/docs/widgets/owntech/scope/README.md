# OwnTech Scope Capture

Arm, trigger, and download a decimated software-scope capture from a
Core4/Twist board over its dedicated scope data port (`if00`) — a small,
fixed protocol that is entirely separate from the ThingSet shell (`if02`)
the rest of the OwnTech widgets use.

## Parameters

| Parameter                         | Type   | Default | Description                                                                 |
|-------------------------------------|--------|---------|--------------------------------------------------------------------------------|
| Title                                | text   | —       | Optional label shown above the panel.                                          |
| ThingSet Datasource (arm/trigger/status) | option | —   | The `ThingSet Serial` or `OwnTech (ThingSet Serial)` datasource used for arm/trigger/status reads over `if02`. |
| Scope Data Port (if00)               | option | —       | The board's `if00` serial interface. Not ThingSet-discoverable, so this is a manual port picker, separate from the datasource above. |

## Behavior

- **Arm / Trigger** buttons are discovery-driven, the same mechanism as
  the OwnTech Actions panel: they're generated from whatever writable
  boolean leaves are found under `/Debug/Scope` (normally `wArm` and
  `wTrigger`), not hardcoded paths.
- **Decimation** (`1`/`10`/`100`) and **pre-trigger ratio** are a fixed,
  legitimately-hardcoded pair of controls — same category as the Actions
  panel's power enum — writing directly to `/Debug/Scope/wDecimation` and
  `/Debug/Scope/wPretriggerRatio`.
- **Status** reflects `/Debug/Scope/rState` (`IDLE` / `ARMED` / `TRIGGERED`
  / `READY`) from the linked datasource's already-discovered tree — no
  extra polling. **Download** is disabled until the capture is `READY`.
- **Download** speaks directly to the `if00` port (not ThingSet) to
  retrieve the fixed 1024-sample × 8-channel capture, rotates it into
  chronological order, and renders it as an inline chart plus a **Save
  CSV** button. This is an explicit, user-initiated action — there is no
  auto-refresh timer, since a real transfer can take anywhere from
  roughly 1 to 20 seconds depending on the decimation used.
