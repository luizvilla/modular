# Release Notes — v0.9.3

> Released: 2026-05-15

---

## Widget Picker Overhaul

The ADD and EDIT flows for widgets are now distinct and consistent across the entire dashboard.

- **ADD** opens a two-step flow: choose a widget type from the picker, then configure it. The picker and settings never appear at the same time.
- **EDIT (wrench)** opens only the settings panel — the type picker is never shown. There is no reason to change a widget's type in place.
- **Widgets with no configurable settings** (e.g. Fast Frame Control, all gauges, all plots) open nothing when the wrench is clicked. Their configuration lives directly in the widget or in a dedicated integrated editor.
- **Plots and gauges added via ADD** skip the settings dialog entirely and open their integrated editor directly after the widget is placed.

<!-- INSERT SCREENSHOT: widget picker showing Plots, Gauges, Serial, Controls, OwnTech, ThingSet categories -->

---

## ThingSet Category Styling

The ThingSet section in the widget picker now has the same orange-bordered highlight box as the OwnTech section, making the two first-party categories visually distinct from generic ones.

<!-- INSERT SCREENSHOT: widget picker — ThingSet section with orange border box -->

---

## Plot Editor Layout Consistency

All three plot editors (Time Plot, XY Plot, Fast Frame) now share the same two-column layout:

| Left column | Right column |
|---|---|
| Sources / Channels | Display settings |

Previously the Time Plot had Display on the left and the Fast Frame had a mixed layout.

Additionally, the Time Plot channel editor labels were corrected:

| Before | After |
|---|---|
| Source X | Source |
| Source Y | Second Source |

Time is always the X axis in a time plot; the old labels were misleading.

<!-- INSERT SCREENSHOT: Edit Owntech_plot_uplot — Channels left, Display right -->

---

## Datasource Picker

The datasource ADD dialog now uses an icon-based tile picker (matching the widget picker) instead of a dropdown. A single click on a tile advances directly to the settings form.

<!-- INSERT SCREENSHOT: datasource picker with Serial Port Reader, ThingSet CAN, Signal Generator, ThingSet Serial, Fast Serial Frame tiles -->

---

## Gauge Widgets

Five new integrated gauge widgets are available in the **Gauges** category:

- Vertical Gauge
- Horizontal Gauge
- Radial Arc Gauge
- Radial Needle Gauge
- Donut Gauge

Each gauge opens a dedicated integrated editor for source, zone, and alarm configuration. The vertical gauge icon uses two vertical bars to mirror the horizontal gauge's two horizontal bars.

<!-- INSERT SCREENSHOT: dashboard showing Donut, Radial Needle, Radial Arc, Horizontal, and Vertical gauges live -->

---

## Controls Category

All Controls widgets — including the legacy channel manager widgets — are now visible in the widget picker. Previously some were hidden.

The Fast Frame Control widget no longer opens a settings dialog when the wrench is clicked, since its inline UI already provides the same controls (datasource, arm/retrieve commands, delays, file path, auto-save).

---

## Other Fixes

- Plots category order is now: Time Plot → XY Plot → Fast Frame Widget.
- Modal dialog width narrowed to fit content (640 px) instead of the previous 900 px.
- Serial Terminal uses a compatible free Font Awesome icon.
- Fixed a crash ("cannot call methods on sortable prior to initialization") that occurred when clicking **New Dashboard** after certain widgets had been on the board.

<!-- INSERT SCREENSHOT: clean new dashboard after clicking New Dashboard — header and controls visible, empty board -->

---

## Upgrading

No breaking changes. Existing dashboards load without modification. Widgets that previously required a settings dialog on ADD will now open their integrated editor instead; wrench clicks on no-settings widgets are silently ignored.
