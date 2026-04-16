<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Channel Manager

## What it does
Chooses the CSV source, sets the X axis column, and adds or removes plotted Y channels on a target Fast Frame Plot widget.

## Creation (settings)
- No creation-time settings. Select the target fast-frame plot in the widget body.

## Usage (in dashboard)
- Choose the target Fast Frame Plot widget.
- Choose the CSV file with the file picker. The dialog opens in the current working directory by default.
- Set the X Variable. This becomes the plot X axis; leave it empty to use the row index.
- Pick the Y Variable from the selected CSV file.
- Optionally set a label, color, and visibility state.
- Click `Add Channel` to add the series to the target plot.
- Use `Reset Channels` to clear the full channel list.
