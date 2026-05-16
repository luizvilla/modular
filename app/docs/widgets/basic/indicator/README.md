# Indicator Light

![Widget screenshot](widget.png)

Boolean indicator that shows a labelled on/off state driven by a calculated expression.

## Parameters

| Parameter    | Type       | Default | Description                                     |
|--------------|------------|---------|-------------------------------------------------|
| Title        | text       | —       | Label shown in the pane header.                 |
| Value        | calculated | —       | Truthy expression controls the indicator state. |
| Active Label | text       | —       | Text shown when the value is truthy.            |
| Idle Label   | text       | —       | Text shown when the value is falsy.             |
