# OwnTech Variable Table

Every variable a Core4/Twist board exposes over its ThingSet shell, laid out
as the board's own hierarchy (`Config` → `Leg1` → `wEnable`, …), with live
values, units and access. With writes unlocked, writable values can be
edited in place, and each edit sends one ThingSet write to the board.

The table draws from the linked datasource's already-discovered tree and
values; it never talks to the board on its own, except to send the writes
you make.

## Parameters

| Parameter                 | Type    | Default | Description                                                            |
|---------------------------|---------|---------|------------------------------------------------------------------------|
| Title                     | text    | —       | Optional label shown above the table.                                  |
| Datasource Name           | option  | —       | The `OwnTech (ThingSet Serial)` or `ThingSet Serial` datasource to use. |
| Show internal (_) nodes   | boolean | false   | Also list internal nodes such as `_Reporting`.                         |

## Reading the table

- **Groups** expand and collapse with a click. Top-level groups start open,
  deeper ones closed. Each group summarizes what it contains, e.g.
  `Leg1 · 11 variables · 11 writable`.
- **Name** drops the ThingSet prefix and unit suffix (`wDeadTimeRising_ns` reads
  as *DeadTimeRising*, in ns). Hover a name for its full path.
- **Value** is live: it follows the datasource's refreshes and flashes when it
  changes. Turn on **Auto Refresh** on the datasource for continuous
  updates; otherwise use **Refresh**. The status line says which is active.
- **Access** comes from the ThingSet naming prefix, because the serial shell
  doesn't report access:

  | Prefix | Badge          | Editable?                       |
  |--------|----------------|---------------------------------|
  | `r`    | Read-only      | no                              |
  | `c`    | Constant       | no                              |
  | `m`    | Record         | no                              |
  | `w`    | Writable       | yes                             |
  | `s`    | Stored setting | yes                             |
  | `z`    | Control        | yes                             |
  | `p`    | Persistent     | yes — the board accepts or rejects |
  | none   | Unknown        | yes — the board accepts or rejects (e.g. `Config/Mode`) |

- ⚡ marks a variable that changes what the power stage does.
  ⚠ marks known firmware behaviour; hover it for details.

**Toolbar:** search by name or path, the **All / Writable / Read-only /
Changed** filters (*Changed* lists values that changed since the table
opened), expand/collapse all, **Refresh** (values) and **Rescan** (re-walk
the whole tree, e.g. after a reflash).

## Editing

1. Click **Locked** to unlock writes. The table always opens locked, including
   after a reload.
2. Click a writable value:
   - a **boolean** flips with one click;
   - a **number or string** opens an input. **Enter** writes, **Esc** cancels,
     and the arrow keys step a number.
3. Power-stage variables (`Config/Mode`, `Config/Frequency_Hz`, a leg's
   `wEnable`, `wDriver`, `wCapa`, `wDutyCycle`, `wReferenceValue`, `wBuck`,
   `wBoost`, and `Control/z*`) ask for confirmation first, showing the current
   and the new value.
4. The cell then shows the result:
   - ✓ — written, and the board reads back what you wrote.
   - ✓ *board holds X* — accepted, but the board holds something else. For
     example a duty cycle below 0.1 (the power library clamps it), or
     `Debug/Scope/wArm`, which the firmware clears once it has armed.
   - ✗ *rejected* — the board refused the write; hover for the reason.

Known firmware caveats (also shown as tooltips):
- `wDriver`: once set to true, only an MCU reset clears it.
- `wDutyCycle`: values below 0.1 are clamped to 0.1, and `Measurements/rDutyN`
  reports the requested value, not the applied one.
- `Config/Frequency_Hz`: writing it is a known firmware issue.

No board at hand? **Edit → Demo OwnTech Board (simulated)** adds a simulated
Core4 board to try the table on — see [Demo OwnTech Board](../demo-board/README.md).

## Right-click

- **On a variable:** *Copy path*; *Add +/− button* (writable number), *Add
  toggle* (writable boolean) or *Add gauge* (read-only number) to the same
  pane, already bound to that variable; *Refresh*.
- **On the status line:** switch the table to another ThingSet datasource.
