// Derives the simulated board's object database (app/js/sim/core4_objects.json)
// from a captured transcript (capture_core4.js): every node's child order,
// type, float precision, access and initial value, exactly as the board
// formats them. Run from the repo root:
//   node tests/fixtures/tools/derive_core4_objects.js tests/fixtures/core4_shell_transcript.json app/js/sim/core4_objects.json
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(src, 'utf8'));
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const payloadOf = (resp) => {
  const m = resp.replace(ANSI, '').match(/\r\n:85 (.*)\r\n/s);
  return m ? m[1] : null;
};
const byCmd = new Map();
for (const e of t.if02.transcript) if (e.phase !== 'setValue' && !byCmd.has(e.cmd)) byCmd.set(e.cmd, e.response);
const p = (path) => path.replace(/^\/+/, '');
const namesOf = (path) => {
  const cmd = p(path) ? `?${p(path)} null` : '? null';
  const payload = byCmd.has(cmd) ? payloadOf(byCmd.get(cmd)) : null;
  return payload ? JSON.parse(payload) : null;
};
// Raw tokens of a group's "?group" object, kept verbatim ("1.000000").
function rawTokens(payload) {
  const out = {};
  const re = /"([^"]+)":(\[[^\]]*\]|"(?:[^"\\]|\\.)*"|[^,}]+)/g;
  let m;
  while ((m = re.exec(payload))) out[m[1]] = m[2];
  return out;
}
function describe(token) {
  if (token === 'true' || token === 'false') return { type: 'bool', value: token === 'true' };
  if (token === 'null') return { type: 'group' };
  if (token.startsWith('"')) return { type: 'string', value: JSON.parse(token) };
  if (token.startsWith('[')) return { type: 'array', value: JSON.parse(token) };
  const dot = token.indexOf('.');
  if (dot >= 0) return { type: 'float', decimals: token.length - dot - 1, value: Number(token) };
  return { type: 'int', value: Number(token) };
}
const READ_ONLY_NAMES = new Set(['pNodeID', 'pNodeName']);
const access = (name) => (/^[rc][A-Z0-9]/.test(name) || READ_ONLY_NAMES.has(name) ? 'r' : 'rw');
const nodes = [];
function visit(path) {
  const names = namesOf(path);
  const cmd = p(path) ? `?${p(path)}` : '?';
  const payload = byCmd.has(cmd) ? payloadOf(byCmd.get(cmd)) : null;
  if (names && names.length) {
    const tokens = payload ? rawTokens(payload) : {};
    nodes.push({ path, kind: 'group', children: names });
    for (const name of names) {
      const child = path === '/' ? `/${name}` : `${path}/${name}`;
      const childNames = namesOf(child);
      if (childNames && childNames.length) { visit(child); continue; }
      const token = tokens[name] !== undefined ? tokens[name] : payloadOf(byCmd.get(`?${p(child)}`) || '');
      if (token == null) throw new Error(`no value captured for ${child}`);
      const d = describe(token);
      nodes.push({ path: child, kind: d.type === 'array' ? 'record' : 'leaf', type: d.type, decimals: d.decimals, access: access(name), value: d.value });
    }
  } else {
    nodes.push({ path, kind: 'group', children: [] });
  }
}
visit('/');
const out = {
  source: 'Captured from a Spin board running Core4 (tests/fixtures/core4_shell_transcript.json, ' + t.captured_at + ')',
  node: t.if02.node,
  nodes,
};
fs.writeFileSync(dst, JSON.stringify(out, null, 1) + '\n');
const leaves = nodes.filter((n) => n.kind !== 'group');
console.log(`${nodes.length - leaves.length} groups, ${leaves.length} variables (${leaves.filter((n) => n.access === 'r').length} read-only)`);
