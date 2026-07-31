# OwnTech Actions

Per-leg action toggles and power controls for a Core4/Twist board, sent as
plain ThingSet writes over the serial shell (`if02`) — no custom command
protocol involved.

Unlike the legacy Twist/Ownverter Actions widget, this panel does not
hardcode a leg count or action list. On each refresh it walks the linked
datasource's discovered ThingSet tree, finds every group under `/Config`
named `LegN` (`Leg1`, `Leg2`, …, sorted numerically), and renders one
on/off switch per writable boolean leaf discovered under that leg (e.g.
`wEnable`, `wCapa`, `wDriver`, `wBoost`, `wBuck`). A board that exposes a
third leg shows up here automatically, with no widget changes.

## Parameters

| Parameter                        | Type    | Default | Description                                                              |
|-----------------------------------|---------|---------|----------------------------------------------------------------------------|
| Title                             | text    | —       | Optional label shown above the panel.                                     |
| Datasource Name                   | option  | —       | The `ThingSet Serial` or `OwnTech (ThingSet Serial)` datasource to use.   |
| Use "thingset" command prefix     | boolean | false   | Prefix each shell command with `thingset ` (matches the datasource's own setting). |
| Verbose logging                   | boolean | false   | Log ThingSet write traffic to the console.                                |

## Behavior

- **Power controls** (IDLE / POWER ON / POWER OFF) write the fixed
  `/Config/Mode` enum (`0`/`1`/`2`) directly — the one piece of hardcoded
  protocol knowledge here, since the enum's meaning doesn't vary with leg
  count.
- **Leg toggles** write straight to the discovered leaf's own path (e.g.
  `/Config/Leg1/wEnable`) via `setValue` — the toggle reflects your click
  immediately, but a successful ThingSet status code only confirms the
  shell accepted the write syntactically. Use **Rescan Tree** on the
  linked datasource's sidebar entry to confirm the board's actual state.
- No auto-refresh timer: the panel re-renders whenever the linked
  datasource's own data updates (its own poll cycle, or an explicit
  rescan) — it never issues its own extra tree-walk IPC calls.
