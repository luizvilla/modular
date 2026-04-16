<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Control

## What it does
Sends a trigger command, monitors fast-frame acquisition status, and exports the latest completed fast-frame dataset to CSV.

## Creation (settings)
- Datasource Name: Fast Serial Frame datasource to control.
- Arm Command: Command that tells the target to prepare/store the data.
- Retrieve Command: Command that asks the target to send the stored fast-frame data back.
- Retrieve Delay: Delay between the arm command and the retrieve command.
- CSV File Path: Output path used when saving the latest dataset.
- Auto-save after complete: Automatically export CSV when a triggered acquisition completes.
- Status Refresh: Poll interval used to refresh acquisition state.

## Usage (in dashboard)
- Trigger + Retrieve: Sends the arm command first, then the retrieve command after the configured delay.
- Save Latest CSV: Exports the most recently completed fast-frame dataset.
- Status: Shows acquisition state, message, point count, and last completion time.
