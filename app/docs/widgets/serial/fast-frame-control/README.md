<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Control

## What it does
Sends a trigger command, monitors fast-frame acquisition status, and exports the latest completed fast-frame dataset to CSV.

## Creation (settings)
- Datasource Name: Fast Serial Frame datasource to control.
- Trigger Command: Command sent to the datasource port.
- CSV File Path: Output path used when saving the latest dataset.
- Auto-save after complete: Automatically export CSV when a triggered acquisition completes.
- Status Refresh: Poll interval used to refresh acquisition state.

## Usage (in dashboard)
- Send Trigger: Writes the trigger command to the selected fast-frame datasource port.
- Save Latest CSV: Exports the most recently completed fast-frame dataset.
- Status: Shows acquisition state, message, point count, and last completion time.
