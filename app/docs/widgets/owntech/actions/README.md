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
  `/Config/Leg1/wEnable`). After each write the panel shows the value the
  board reads back, and refreshes the datasource's values; a write the
  board rejects is reported in the status line as *Write failed*.
- **Rescan Tree** re-walks the board's whole tree (e.g. after a reflash
  adds or removes legs).
- No auto-refresh timer: the panel re-renders whenever the linked
  datasource's own data updates (its own poll cycle, a write, or a
  rescan) — it never issues its own tree-walk calls.
