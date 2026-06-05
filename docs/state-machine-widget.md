# State Machine Widget — OwnTech Extension

## Context

Add a "State Machine" widget to the OwnTech extension. The widget lets users define:
- **States** — named nodes, each storing a full Twist/Ownverter setpoint snapshot (power mode + per-leg toggles and numeric setpoints)
- **Transitions** — directed edges between states with a condition: a datasource variable (with math transform), a comparison operator, and a threshold value

The widget actively **executes** the state machine at runtime: it polls the serial datasource variables every 200 ms, evaluates outgoing transitions from the current state, and fires all Twist commands for the target state when a condition is met.

The pane shows a compact read-only SVG of the graph + Run/Stop button. The wrench icon opens a **full-screen SVG editor modal** for building the graph interactively.

---

## Key findings (research)

| Topic | Finding |
|-------|---------|
| Plugin registration | `app/extensions/owntech/manifest.json` → `rendererScripts`; `appRoot = app/` so paths resolve to `app/dashboard/plugins/` |
| Wrench → editor dispatch | `app/dashboard/js/freeboard.js` ~line 4454: hardcoded list of types → `openIntegratedPlotEditor()`; need to add `'state_machine'` |
| Editor dispatch | `app/dashboard/plugins/integrated_plot_editor.js` `open()`: add early-return case for `state_machine` → `window.ModularStateMachineEditor.open(widgetModel)` |
| Numeric setpoints | All already in `twist_protocol.js`: `cmdDuty`, `cmdFrequency`, `cmdPhaseShift`, `cmdDeadTimeRising`, `cmdDeadTimeFalling` |
| Variable reading | `freeboard.getPlotEditorShared().invoke('get-serial-buffer', {path})` → array; index via `getProfile(deviceType).variables.indexOf(varName)` |
| Dialog API | `new DialogBox(contentEl, title, okLabel, cancelLabel, okCallback)` — freeboard's modal |
| Script ordering | OwnTech scripts at order 170–190; use 174 (editor) + 175 (widget) |

---

## Data model (stored in widget settings)

```js
// State
{ id: 's0', name: 'IDLE', x: 100, y: 100,
  powerMode: 'IDLE',   // 'IDLE' | 'ON' | 'OFF' | null (= don't change)
  legs: [
    { leg: 1,
      toggles: { LEG: 'OFF', CAPA: 'OFF', DRIVER: 'OFF', BUCK: 'OFF', BOOST: 'OFF' },
      setpoints: { duty: 0, phase_shift: 0, frequency: 200000,
                   dead_time_rising: 200, dead_time_falling: 200 } }
  ]
}

// Transition
{ id: 't0', from: 's0', to: 's1',
  variable: 'V1',
  mathOp: 'k*x+b',   // 'x' | '-x' | 'k*x' | 'x+b' | 'k*x+b'
  mathK: 1, mathB: 0,
  operator: '>',       // '>' | '<' | '>=' | '<=' | '==' | '!='
  threshold: 12.0
}
```

---

## Implementation Sessions

### Session 1 — Widget skeleton + manifest hook

**Deliverable**: Widget appears in picker, renders placeholder in pane, wrench routes to editor without crash.

**Files**:
- **Create** `app/dashboard/plugins/state_machine.widget.js`
- **Modify** `app/extensions/owntech/manifest.json`
- **Modify** `app/dashboard/js/freeboard.js` (~line 4454)
- **Modify** `app/dashboard/plugins/integrated_plot_editor.js`

**Tests**: Smoke — widget renders (`.state-machine-widget`), Run button present.

---

### Session 2 — Full-screen SVG editor

**Deliverable**: Wrench opens modal; user can add/select/delete states and transitions; changes persist to widget settings on OK.

**Files**:
- **Create** `app/dashboard/plugins/state_machine_editor.js`
- **Modify** `app/extensions/owntech/manifest.json`

Editor layout:
```
┌──────────────────────────────┬────────────────────┐
│  SVG canvas (flex-fill)      │ [States][Transitions]│
│  state circles + arrows      │ list + [Add] btn    │
├──────────────────────────────┴────────────────────┤
│  Selected state params (power mode + leg toggles + setpoints) │
└───────────────────────────────────────────────────┘
```

SVG helpers: `_renderState(s)` → `<circle r="30">` + `<text>`; `_renderTransition(t)` → quadratic bezier `<path>` + arrowhead; `_renderAll()` clears and re-renders.

Interactions:
- Drag circle → update `state.x/y`, re-render
- Click circle → select state, show params in bottom panel
- Shift+click two states → transition creation form
- Add State button → new state, auto-select
- Delete → remove state + transitions
- Transitions tab: list with Delete per row, Add Transition button

---

### Session 3 — Live execution engine

**Deliverable**: Run button starts the machine; transitions fire and Twist commands are sent.

**Execution loop** (200 ms tick):
1. Find outgoing transitions from `_currentState`
2. For each: read variable via `shared.invoke('get-serial-buffer', {path})`, apply math, compare with threshold
3. First match → `_enterState(id)`: send power mode + all leg toggles + all numeric setpoints

**Math ops**: `x`, `-x`, `k*x`, `x+b`, `k*x+b`  
**Comparison ops**: `>`, `<`, `>=`, `<=`, `==`, `!=`

---

### Session 4 — Polish + full test suite

- Pane SVG: show transition labels, initial state as double-circle
- Editor: click arrow to select/delete, drag-create transitions
- Full Playwright suite: add/select/delete state, shift+click transition, fixture round-trip, Run/Stop

---

## Verification

```bash
npm run test:ui -- tests/e2e/state-machine.spec.js
```

Manual (Session 3+): connect TWIST device, click Run, observe serial commands when transitions fire.
