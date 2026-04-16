<!-- Widget documentation (auto-generated from widget definitions). -->
# XY Plot

## What it does
Plots live `x` versus `y` data as a trajectory with trailing history.

## Creation (settings)
- Title: Widget title shown in the header.
- History Length: Number of recent points retained in the trail.
- Refresh Rate: Poll/update period in milliseconds.
- X Axis Label / Y Axis Label: Labels for the plot axes.
- X Min / X Max / Y Min / Y Max: Optional manual axis bounds.
- Helper Widgets: Auto-spawn the XY Source Manager when the widget is created.

## Usage (in dashboard)
- Plot area: Displays the `x` vs `y` trajectory.
- Trailing history: Retains the latest points so motion and drift remain visible.
- Clear history: Removes the current trail without changing sources.
