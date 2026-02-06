<!-- Widget documentation (auto-generated from widget definitions). -->
# Twist/Ownverter Actions & Setpoints

## What it does
Control power state, toggles, and setpoints for Twist or Ownverter boards over serial.

## Creation (settings)
![Creation](creation.png)

- Title: Widget title shown in the header.
- Device Type: Select Twist or Ownverter to match leg count and variables.
- Datasource Name: Serial datasource used to send commands.

## Usage (in dashboard)
![Usage](usage.png)

- Datasource: Choose the serial datasource (e.g., MockSerial).
- Device: Switch between Twist (2 legs) and Ownverter (3 legs).
- Power: IDLE / POWER ON / POWER OFF commands.
- Leg toggles: Per-leg LEG/CAPA/DRIVER/BUCK/BOOST ON/OFF buttons.
- Setpoints: Reference, Duty, Frequency, Phase Shift, Dead Time Rising/Falling.
- Last command: Shows the most recent command sent.
