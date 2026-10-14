# Demo OwnTech Board (simulated)

A simulated OwnTech/Core4 board built into the app, for demos and for trying
the OwnTech widgets without hardware. It shows up next to real boards as two
serial ports and answers like a real board: the real Core4 variable tree,
the ThingSet shell, the scope data port, and a simple power stage whose
voltages and currents respond to what you write.

## Turning it on

**Edit → Demo OwnTech Board (simulated).** The choice is remembered across
restarts. Untick it to remove the board.

The port pickers then list:

- `sim://owntech-demo/if02 (Demo OwnTech, simulated) — ThingSet shell`
- `sim://owntech-demo/if00 (Demo OwnTech, simulated) — scope data port`

Add an **OwnTech (ThingSet Serial)** datasource. With *Auto detect port* on
it finds a real board first if one is plugged in, otherwise the demo board.
To always use the demo board, turn auto-detect off and pick
`sim://owntech-demo/if02`. Wherever the app shows the port, it says
*simulated*.

## What it simulates

- **The board's variables:** the same tree as a Core4 board (Calibration,
  Config with Leg1/Leg2, Control, Converter, Debug/Scope, Device,
  Measurements, …), with the same access: measurements and constants are
  read-only, and a write to them is rejected like on the real board.
- **The power stage:** a leg runs only when `Config/Mode` is POWER_ON (1) and
  that leg's `wEnable` is true. Input is about 30 V. **Leg 1 drives a 10 Ω
  load, leg 2 is open**, as on the test bench the simulation was measured
  against:
  - leg 1 settles to about duty × 30 V × 0.9 within 10 ms (duty 0.2 →
    5.4 V, 0.54 A);
  - leg 2, unloaded, to about duty × 30 V × 1.2, and its output capacitor
    discharges over seconds after it stops;
  - temperatures rise slowly with the power dissipated.
- **Firmware behaviour:**
  - duty below 0.1 is clamped to 0.1, while `Measurements/rDutyN` shows the
    requested value;
  - out-of-range writes (a duty above 1, `Mode` ≥ 3, …) are accepted and
    then put back;
  - `Debug/Scope/wArm` and `wTrigger` clear themselves once acted on.
- **The scope:** arm, trigger and download from the OwnTech Scope Capture
  widget. A capture is 1024 samples of 8 channels at the chosen decimation,
  so enabling a leg just before triggering shows the step. A download takes
  about a second, like the real one, and ThingSet reads wait for it.

## Limits

- It's a plausible demo, not an electrical model: no regulation (`wBuck`/
  `wBoost` closed loops), no switching ripple, no faults or protections.
- There is one demo board. CAN and firmware flashing aren't simulated.
- `Config/Frequency_Hz`, dead times, phase shift and calibration values can be
  written and read back, but don't change the simulated outputs.

## For scripts and tests

- `MODULAR_SIM_BOARD=1` enables the demo board at startup. Options can follow:
  `MODULAR_SIM_BOARD=vHigh=24,loadOhm=5`.
- `MODULAR_SIM_ONLY=1` hides real serial ports, so a run doesn't depend on
  what is plugged in.
- With `MOCK_HW=1` (the default for Playwright) the simulator isn't used:
  `MOCK_HW` replaces the hardware calls in the window, above the simulator.
