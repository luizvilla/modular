# Text

| Widget View | Edit Widget Window View |
|---|---|
| ![Widget screenshot](widget.png) | ![Edit dialog](widget-edit.png) |

Displays a calculated value with an optional unit label, size variant, and sparkline history.

## Parameters

| Parameter | Type       | Default | Description                               |
|-----------|------------|---------|-------------------------------------------|
| Title     | text       | —       | Label shown in the pane header.           |
| Size      | option     | regular | Font size: regular or big.                |
| Value     | calculated | —       | Expression or datasource path to display. |
| Sparkline | boolean    | false   | Render a sparkline below the value.       |
| Animate   | boolean    | true    | Animate value changes.                    |
| Units     | text       | —       | Short unit label shown after the value.   |
