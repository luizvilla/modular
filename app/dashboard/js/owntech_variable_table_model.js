// Pure model for the OwnTech Variable Table widget (Milestone 11 of
// docs/GUI/02-navigation_overhaul.md): turns a walked ThingSet tree into the
// rows the table renders, and knows the naming conventions the serial shell
// can't tell us (it exposes no access metadata). No DOM, no IPC -- loadable
// from Node for unit tests, same shape as thingset_value_parse.js.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.OwntechVariableTableModel = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // ThingSet naming prefixes: a lowercase letter followed by an uppercase
  // letter or digit ("rV1Low_V", "wEnable", "pNodeID"). Names without one
  // (Core4's "Mode", "Frequency_Hz") are writable on some firmware and not on
  // others, so they are left to the board to accept or reject.
  // c/z/p as declared in OwnTech firmware (owntech_communication's
  // data_objects.h): cManufacturer etc. are THINGSET_ANY_R constants,
  // zStartStop/zCtrlReference the RW CAN control channel; p items are
  // persistent and may or may not be writable (pNodeID vs pCANNodeAddr), so
  // the board decides.
  const ACCESS = {
    r: { key: 'read', label: 'Read-only', editable: false },
    c: { key: 'constant', label: 'Constant', editable: false },
    w: { key: 'write', label: 'Writable', editable: true },
    s: { key: 'stored', label: 'Stored setting', editable: true },
    z: { key: 'control', label: 'Control', editable: true },
    p: { key: 'persistent', label: 'Persistent', editable: true },
    m: { key: 'record', label: 'Record', editable: false },
    e: { key: 'function', label: 'Function', editable: false },
  };
  const INTERNAL = { key: 'internal', label: 'Internal', editable: false };
  const UNKNOWN = { key: 'unknown', label: 'Unknown', editable: true };
  const PREFIX_RE = /^([a-z])(?=[A-Z0-9])/;

  function inferAccess(name) {
    const txt = String(name || '');
    if (txt.startsWith('_')) return INTERNAL;
    const m = txt.match(PREFIX_RE);
    if (m && ACCESS[m[1]]) return ACCESS[m[1]];
    return UNKNOWN;
  }

  // Unit suffixes used by Core4 and the ThingSet examples ("rVHigh_V",
  // "sPeriod_s", "rTemp1_degC"), with their display form.
  const UNITS = {
    V: 'V', mV: 'mV', A: 'A', mA: 'mA', W: 'W', Ohm: 'Ω', ohm: 'Ω',
    s: 's', ms: 'ms', us: 'µs', ns: 'ns', Hz: 'Hz', kHz: 'kHz',
    degC: '°C', pct: '%', percent: '%', rad: 'rad', deg: '°', rpm: 'rpm',
  };

  function parseUnit(name) {
    const txt = String(name || '');
    const idx = txt.lastIndexOf('_');
    if (idx <= 0) return { base: txt, unit: '' };
    const suffix = txt.slice(idx + 1);
    if (!Object.prototype.hasOwnProperty.call(UNITS, suffix)) return { base: txt, unit: '' };
    return { base: txt.slice(0, idx), unit: UNITS[suffix] };
  }

  // "wDeadTimeRising_ns" -> "DeadTimeRising": the access badge and the unit
  // column already carry the prefix and the suffix.
  function displayName(name) {
    const txt = String(name || '');
    if (txt.startsWith('_')) return txt;
    const { base } = parseUnit(txt);
    const m = base.match(PREFIX_RE);
    return m && ACCESS[m[1]] ? base.slice(1) : base;
  }

  function valueKind(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (Array.isArray(value)) return 'array';
    return 'object';
  }

  function formatValue(value) {
    const kind = valueKind(value);
    if (kind === 'null') return { kind, text: '—' };
    if (kind === 'bool') return { kind, text: value ? 'true' : 'false' };
    if (kind === 'number') {
      if (!Number.isFinite(value)) return { kind, text: String(value) };
      return { kind, text: Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4))) };
    }
    if (kind === 'string') return { kind, text: value };
    if (kind === 'array') return { kind, text: value.length ? `[${value.length}]` : '[ ]' };
    return { kind, text: JSON.stringify(value) };
  }

  // Parses what the user typed into the type of the value being edited.
  function parseEditorValue(text, currentValue) {
    const kind = valueKind(currentValue);
    const raw = typeof text === 'string' ? text.trim() : text;
    if (kind === 'bool') {
      if (raw === true || raw === false) return { ok: true, value: raw };
      if (/^(true|1|on)$/i.test(String(raw))) return { ok: true, value: true };
      if (/^(false|0|off)$/i.test(String(raw))) return { ok: true, value: false };
      return { ok: false, error: 'expected true or false' };
    }
    if (kind === 'number') {
      if (raw === '') return { ok: false, error: 'expected a number' };
      const num = Number(raw);
      if (!Number.isFinite(num)) return { ok: false, error: 'expected a number' };
      // The board's type can't be inferred from the value: a float that
      // holds 1.0 arrives as 1 (Config/wBlinkPeriod_s). The board accepts
      // or rejects, and the readback shows what it stored.
      return { ok: true, value: num };
    }
    if (kind === 'string') return { ok: true, value: String(text) };
    return { ok: false, error: 'this value type is not editable here' };
  }

  // Step for +/- and arrow keys. A value with a physical unit steps by its
  // magnitude (1 s -> 0.1, 30 V -> 1); a unitless whole number (Mode, an
  // index) steps by 1 so a fraction is never proposed for an integer.
  function stepFor(value, unit) {
    const v = Math.abs(Number(value));
    if (!Number.isFinite(v)) return 1;
    if (!unit && Number.isInteger(Number(value))) return 1;
    if (v >= 10) return 1;
    if (v >= 1) return 0.1;
    return 0.01;
  }

  // Writes that change what the power stage does: they ask for confirmation.
  const POWER_PATTERNS = [
    /^\/Config\/Mode$/,
    /^\/Config\/Frequency_Hz$/,
    /^\/Config\/[^/]+\/w(Enable|Driver|Capa|DutyCycle|ReferenceValue|Buck|Boost)$/,
    // OwnTech's CAN control channel: zStartStop/zCtrlReference start and
    // steer a converter on firmware that wires them to the power stage.
    /^\/Control\/z[A-Z]/,
  ];

  function isPowerPath(path) {
    return POWER_PATTERNS.some((re) => re.test(String(path || '')));
  }

  // Known firmware behaviour, observed on Core4 hardware (2026-10-13) and in
  // Core4's own automated_test.md.
  const CAVEATS = [
    [/\/wDriver$/, 'Once true, only an MCU reset clears it (known firmware bug).'],
    [/\/wDutyCycle$/, 'Values below 0.1 are clamped to 0.1 by the power library; rDuty echoes the requested value.'],
    [/^\/Debug\/Scope\/w(Arm|Trigger)$/, 'One-shot: the firmware clears it once acted on, so it reads back false after a successful write.'],
    [/^\/Config\/Frequency_Hz$/, 'Writing the switching frequency is a known firmware issue; Core4\'s own tests never write it.'],
  ];

  function caveatFor(path) {
    const hit = CAVEATS.find(([re]) => re.test(String(path || '')));
    return hit ? hit[1] : null;
  }

  function joinPath(parent, name) {
    return parent === '/' || !parent ? `/${name}` : `${parent}/${name}`;
  }

  // Groups carry `children` (real hardware) or only a `values` map (MOCK_HW
  // leg groups). A node with its own `value` and nothing under it is a
  // variable even when the walk gave it empty children -- on a Core4 board
  // Config/Mode, pNodeID and Device/c* come back that way.
  function isGroup(node) {
    if (!node || typeof node !== 'object') return false;
    const kids = node.children && typeof node.children === 'object' ? Object.keys(node.children).length : 0;
    const vals = node.values && typeof node.values === 'object' ? Object.keys(node.values).length : 0;
    const hasValue = Object.prototype.hasOwnProperty.call(node, 'value');
    if (hasValue && !kids && !vals) return false;
    return !!(node.children && typeof node.children === 'object') || !!(node.values && typeof node.values === 'object');
  }

  function variableRow(path, name, value, depth, parentPath) {
    const access = inferAccess(name);
    const { unit } = parseUnit(name);
    return {
      kind: 'variable', path, name, depth, parentPath,
      label: displayName(name), unit, access, value,
      power: isPowerPath(path), caveat: caveatFor(path),
    };
  }

  // Depth-first rows in the tree's own order. Variables come from leaf
  // children ({value}) on real hardware and from a group's `values` map in
  // the MOCK_HW tree -- both are rows. Each group row carries counts over
  // its whole subtree for the "Leg1 · 11 variables · 9 writable" summary.
  function buildRows(root, { showInternal = false } = {}) {
    const rows = [];
    const visit = (node, path, depth, parentPath) => {
      const groupRow = path === '/' ? null : {
        kind: 'group', path, name: path.split('/').pop(), depth, parentPath,
        label: path.split('/').pop(), variableCount: 0, writableCount: 0, groupCount: 0,
      };
      if (groupRow) rows.push(groupRow);
      const start = rows.length;
      const childDepth = groupRow ? depth + 1 : depth;
      const seen = new Set();
      for (const [name, child] of Object.entries(node.children || {})) {
        seen.add(name);
        if (!showInternal && name.startsWith('_')) continue;
        const childPath = joinPath(path, name);
        if (isGroup(child)) visit(child, childPath, childDepth, path);
        else rows.push(variableRow(childPath, name, child ? child.value : undefined, childDepth, path));
      }
      for (const [name, value] of Object.entries(node.values || {})) {
        if (seen.has(name) || (!showInternal && name.startsWith('_'))) continue;
        rows.push(variableRow(joinPath(path, name), name, value, childDepth, path));
      }
      if (groupRow) {
        for (const row of rows.slice(start)) {
          if (row.kind === 'group') groupRow.groupCount += 1;
          else {
            groupRow.variableCount += 1;
            if (row.access.editable) groupRow.writableCount += 1;
          }
        }
      }
    };
    if (root && typeof root === 'object') visit(root, '/', 0, null);
    return rows;
  }

  function groupSummary(row) {
    const parts = [`${row.variableCount} variable${row.variableCount === 1 ? '' : 's'}`];
    if (row.writableCount) parts.push(`${row.writableCount} writable`);
    return parts.join(' · ');
  }

  // filter: 'all' | 'writable' | 'readonly' | 'changed'; changedPaths: Set.
  function rowMatches(row, { query = '', filter = 'all', changedPaths = null } = {}) {
    if (row.kind !== 'variable') return false;
    if (filter === 'writable' && !row.access.editable) return false;
    if (filter === 'readonly' && row.access.editable) return false;
    if (filter === 'changed' && !(changedPaths && changedPaths.has(row.path))) return false;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return row.path.toLowerCase().includes(q) || row.label.toLowerCase().includes(q);
  }

  // Which rows to show: matching variables plus every ancestor group of one,
  // so search results keep their hierarchy. With no query/filter, all rows.
  function visibleRows(rows, opts = {}) {
    const active = String(opts.query || '').trim() || (opts.filter && opts.filter !== 'all');
    if (!active) return rows;
    const keep = new Set();
    for (const row of rows) {
      if (!rowMatches(row, opts)) continue;
      keep.add(row.path);
      let parent = row.parentPath;
      while (parent && parent !== '/') {
        keep.add(parent);
        parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
      }
    }
    return rows.filter((row) => keep.has(row.path));
  }

  return {
    inferAccess, parseUnit, displayName, valueKind, formatValue, parseEditorValue, stepFor,
    isPowerPath, caveatFor, buildRows, groupSummary, rowMatches, visibleRows,
  };
});
