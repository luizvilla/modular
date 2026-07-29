# +/- Button

A `[+ value -]` control: pressing `+` or `-` sends its own configurable serial command, while the value in the middle tracks a datasource/channel picked the same way gauge widgets pick their source.

## Parameters

| Parameter        | Type   | Default | Description                                                     |
|------------------|--------|---------|-------------------------------------------------------------------|
| Title            | text   | —       | Optional label shown above the value.                             |
| Units            | text   | —       | Optional unit suffix shown next to the value.                     |
| Send Commands To | option | —       | Serial or Fast Frame datasource that receives commands.           |
| Plus Command     | text   | —       | Command sent when the plus button is pressed.                     |
| Plus Legend      | text   | —       | Step-size text shown on the plus button (e.g. "1"). Empty = no text, just the symbol. |
| Minus Command    | text   | —       | Command sent when the minus button is pressed.                    |
| Minus Legend     | text   | —       | Step-size text shown on the minus button (e.g. "1"). Empty = no text, just the symbol. |

## Notes

Value Source binding (datasource, device, variable) is configured in the widget's integrated editor panel — click the pencil icon on the widget — the same picker used by the Gauge widgets.
