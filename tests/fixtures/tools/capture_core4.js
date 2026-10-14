// Captures a real Core4 board's responses to every command the app sends, as
// fixtures for the simulated OwnTech board (M12 of docs/GUI/02-navigation_overhaul.md).
// Run from the repo root with the board on /dev/ttyACM1 (if02) and /dev/ttyACM0 (if00),
// nothing else holding them:  node tests/fixtures/tools/capture_core4.js tests/fixtures
// Writes only values it restores (blink period, scope config) plus rejected writes.
const path = require('path');
const fs = require('fs');
const { ThingSetSerialShell } = require(path.resolve('app/js/thingset_serial_shell.js'));
const { SerialPort } = require(require.resolve('serialport', { paths: [path.resolve('app')] }));
const { ScopeSerialLink } = require(path.resolve('app/extensions/owntech/scope_serial.js'));
const OUT = process.argv[2];
const transcript = [];
const origSend = ThingSetSerialShell.prototype.sendCommand;
let phase = '';
ThingSetSerialShell.prototype.sendCommand = async function (cmd, t) {
  const buf = await origSend.call(this, cmd, t);
  transcript.push({ phase, cmd, prefix: this.getCommandPrefix(), response: buf.toString('utf8') });
  return buf;
};
const raw = async (port, bytes, waitMs) => { let got = ''; const h = (d) => { got += d.toString('utf8'); }; port.on('data', h); if (bytes) port.write(bytes); await new Promise((r) => setTimeout(r, waitMs)); port.off('data', h); return got; };
(async () => {
  const out = { captured_at: new Date().toISOString(), board: 'Spin running Core4 (no power stage)', if02: {}, if00: {} };
  // 1. what the board sends when the port opens (DTR toggled like the app does)
  const p = new SerialPort({ path: '/dev/ttyACM1', baudRate: 115200, autoOpen: false });
  await new Promise((r, j) => p.open((e) => (e ? j(e) : r())));
  p.set({ dtr: false }, () => {}); await new Promise((r) => setTimeout(r, 20)); p.set({ dtr: true }, () => {});
  out.if02.on_open = await raw(p, null, 400);
  out.if02.raw_enter = await raw(p, '\r\n', 300);
  out.if02.raw_unknown_command = await raw(p, 'foo\r\n', 300);
  out.if02.raw_thingset_prefixed_root = await raw(p, 'thingset ?\r\n', 400);
  out.if02.raw_select = await raw(p, 'select thingset\r\n', 300);
  out.if02.raw_select_mode_bare = await raw(p, '?\r\n', 400);
  out.if02.raw_select_mode_prefixed = await raw(p, 'thingset ?\r\n', 400);
  out.if02.raw_alt_r = await raw(p, '\x1br', 300);
  await new Promise((r) => p.close(r));

  // 2. the app's own command sequence through the real shell class
  const sh = new ThingSetSerialShell({ path: '/dev/ttyACM1', baudRate: 115200 });
  await sh.open();
  phase = 'enterThingSet'; await sh.enterThingSet(); out.if02.probe_succeeded = sh.probeSucceeded(); out.if02.prefix_after_probe = sh.getCommandPrefix();
  phase = 'buildTree'; const root = await sh.buildTree();
  phase = 'nodeMeta'; out.if02.node = { uid: await sh.readNodeUid(), name: await sh.readNodeName(), addr: await sh.readNodeAddr() };
  phase = 'refreshValues'; await sh.refreshValues(root);
  phase = 'getValue'; for (const q of ['Measurements/rVHigh_V', 'Config/Mode', 'Config/Leg1/wDutyCycle', 'Device/cFirmwareVersion', 'Measurements', 'Nope/Missing']) await sh.getValue(q);
  phase = 'setValue'; 
  for (const [q, v] of [['Config/wBlinkPeriod_s', 0.5], ['Config/wBlinkPeriod_s', 1], ['Config/Leg1/wDutyCycle', 0.1], ['Config/Leg1/wTrackingVar', 'V1'], ['Debug/Scope/wDecimation', 1], ['Measurements/rVHigh_V', 1], ['Device/cFirmwareVersion', 'x'], ['Nope/wMissing', 1], ['Config/Leg1/wDutyCycle', 2]]) {
    out.if02['set_' + q.replace(/\W/g, '_') + '_' + String(v).replace(/\W/g, '_')] = await sh.setValue(q, v);
  }
  phase = 'scopeArm'; await sh.setValue('Debug/Scope/wArm', true); const st1 = await sh.getValue('Debug/Scope/rState'); await sh.setValue('Debug/Scope/wTrigger', true);
  await new Promise((r) => setTimeout(r, 400)); const st2 = await sh.getValue('Debug/Scope/rState'); out.if02.scope_states = [st1.value, st2.value];
  phase = 'misc'; await sh.sendCommand('ls /', 1200); await sh.sendCommand('?Config null', 1200); await sh.sendCommand('fetch 0x16 ["Config/Mode"]', 1200);
  await sh.close();
  out.if02.transcript = transcript;
  fs.writeFileSync(path.join(OUT, 'core4_tree.json'), JSON.stringify({ captured_at: out.captured_at, node: out.if02.node, root }, null, 1));

  // 3. the scope data port (if00): only its own protocol
  const sp = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200, autoOpen: false });
  await new Promise((r, j) => sp.open((e) => (e ? j(e) : r())));
  out.if00.raw_probe = await raw(sp, '?', 300);
  out.if00.raw_unknown = await raw(sp, 'x', 300);
  const dl = await raw(sp, 'D', 2500);
  const lines = dl.split('\n');
  out.if00.download_head = lines.slice(0, 6).join('\n');
  out.if00.download_tail = lines.slice(-4).join('\n');
  out.if00.download_line_count = lines.length;
  out.if00.raw_download_when_not_ready = await raw(sp, 'D', 400);
  await new Promise((r) => sp.close(r));
  fs.writeFileSync(path.join(OUT, 'core4_shell_transcript.json'), JSON.stringify(out, null, 1));
  console.log('transcript entries', transcript.length, '| tree groups', Object.keys(root.children).length, '| download lines', out.if00.download_line_count);
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
