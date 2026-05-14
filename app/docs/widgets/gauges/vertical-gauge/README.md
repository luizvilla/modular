<!-- Widget documentation (auto-generated from widget definitions). -->
# Vertical Gauge

## What it does
Single-channel vertical gauge with integrated source binding, warning/critical zones, and optional alarm state.

## Creation (settings)
![Creation](creation.png)

- Title: Widget title shown above the gauge.
- Source: Choose the bound datasource, CAN device when needed, and variable directly in the integrated editor.
- Display: Configure range, units, value visibility, min/max labels, and refresh rate.
- Zones: Configure warning and critical thresholds plus whether high values or low values are considered bad.
- Style: Select palette and active bar color from the integrated editor.

## Usage (in dashboard)
![Usage](usage.png)

- Gauge fill: Represents the current value across the configured range.
- Source summary: Shows the active datasource, optional CAN device, and resolved signal label.
- Min/Max labels: Show configured bounds when enabled.
- Value: Numeric readout of the current value with units when enabled.
- Zones: Warning and critical bands use shared gauge-family colors.
- Alarm styling: Red highlight when the critical zone is active and alarms are enabled.
