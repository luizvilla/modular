const assert = require('assert');
const M = require('../../app/dashboard/js/owntech_variable_table_model.js');

// A slice of the real Core4 tree (leaf children with {value}), as
// ThingSetSerialShell.buildTree() returns it.
const realTree = {
    id: '0x00', values: {},
    children: {
        _Reporting: { path: '_Reporting', values: {}, children: { mLive: { path: '_Reporting/mLive', values: {}, children: { sEnable: { value: true } } } } },
        Config: {
            path: 'Config', values: {},
            children: {
                Leg1: { path: 'Config/Leg1', values: {}, children: {
                    wEnable: { value: false }, wDutyCycle: { value: 0.1 }, wDriver: { value: false },
                    wDeadTimeRising_ns: { value: 100 }, wTrackingVar: { value: 'V1' },
                } },
                // Real walks return some leaves with empty children/values.
                Mode: { id: null, path: 'Config/Mode', values: {}, children: {}, value: 0 },
                wBlinkPeriod_s: { value: 1 },
            },
        },
        Measurements: { path: 'Measurements', values: {}, children: { rV1Low_V: { value: 0.7012 }, rTemp1_degC: { value: 33.88 } } },
        pNodeID: { id: null, path: 'pNodeID', values: {}, children: {}, value: '446175DBAF654140' },
        mLive: { value: [] },
    },
};

function testAccess() {
    assert.strictEqual(M.inferAccess('rV1Low_V').key, 'read');
    assert.strictEqual(M.inferAccess('wEnable').key, 'write');
    assert.strictEqual(M.inferAccess('sPeriod_s').key, 'stored');
    assert.strictEqual(M.inferAccess('pNodeID').key, 'persistent');
    assert.strictEqual(M.inferAccess('cFirmwareVersion').key, 'constant');
    assert.strictEqual(M.inferAccess('cFirmwareVersion').editable, false);
    assert.strictEqual(M.inferAccess('zStartStop').key, 'control');
    assert.strictEqual(M.inferAccess('zStartStop').editable, true);
    assert.strictEqual(M.inferAccess('mLive').key, 'record');
    assert.strictEqual(M.inferAccess('_Reporting').key, 'internal');
    // No prefix: the board decides.
    assert.strictEqual(M.inferAccess('Mode').key, 'unknown');
    assert.strictEqual(M.inferAccess('Mode').editable, true);
    assert.strictEqual(M.inferAccess('Frequency_Hz').key, 'unknown');
    // A lowercase word is not a prefix.
    assert.strictEqual(M.inferAccess('status').key, 'unknown');
    assert.strictEqual(M.inferAccess('r2Value').key, 'read', 'digit after the prefix letter counts');
}

function testUnitsAndNames() {
    assert.deepStrictEqual(M.parseUnit('rVHigh_V'), { base: 'rVHigh', unit: 'V' });
    assert.deepStrictEqual(M.parseUnit('rTemp1_degC'), { base: 'rTemp1', unit: '°C' });
    assert.deepStrictEqual(M.parseUnit('rSamplePeriod_us'), { base: 'rSamplePeriod', unit: 'µs' });
    assert.deepStrictEqual(M.parseUnit('wTrackingVar'), { base: 'wTrackingVar', unit: '' });
    assert.deepStrictEqual(M.parseUnit('rV1Low'), { base: 'rV1Low', unit: '' }, 'no underscore -> no unit');
    assert.deepStrictEqual(M.parseUnit('foo_bar'), { base: 'foo_bar', unit: '' }, 'unknown suffix is part of the name');
    assert.strictEqual(M.displayName('wDeadTimeRising_ns'), 'DeadTimeRising');
    assert.strictEqual(M.displayName('rV1Low_V'), 'V1Low');
    assert.strictEqual(M.displayName('Mode'), 'Mode');
    assert.strictEqual(M.displayName('Frequency_Hz'), 'Frequency');
    assert.strictEqual(M.displayName('_Reporting'), '_Reporting');
}

function testFormatAndParse() {
    assert.deepStrictEqual(M.formatValue(true), { kind: 'bool', text: 'true' });
    assert.deepStrictEqual(M.formatValue(0.7012), { kind: 'number', text: '0.7012' });
    assert.deepStrictEqual(M.formatValue(30.0748), { kind: 'number', text: '30.07' });
    assert.deepStrictEqual(M.formatValue(0.000215), { kind: 'number', text: '0.000215' });
    assert.deepStrictEqual(M.formatValue(1024), { kind: 'number', text: '1024' });
    assert.deepStrictEqual(M.formatValue('V1'), { kind: 'string', text: 'V1' });
    assert.deepStrictEqual(M.formatValue([]), { kind: 'array', text: '[ ]' });
    assert.deepStrictEqual(M.formatValue(null), { kind: 'null', text: '—' });

    assert.deepStrictEqual(M.parseEditorValue('true', false), { ok: true, value: true });
    assert.deepStrictEqual(M.parseEditorValue('off', true), { ok: true, value: false });
    assert.strictEqual(M.parseEditorValue('maybe', true).ok, false);
    assert.deepStrictEqual(M.parseEditorValue(' 0.25 ', 0.1), { ok: true, value: 0.25 });
    assert.strictEqual(M.parseEditorValue('abc', 0.1).ok, false);
    assert.strictEqual(M.parseEditorValue('', 0.1).ok, false);
    // A float holding 1.0 arrives as 1: the current value can't tell integer
    // from float, so fractions are always allowed (found on real hardware).
    assert.deepStrictEqual(M.parseEditorValue('0.5', 1), { ok: true, value: 0.5 });
    assert.deepStrictEqual(M.parseEditorValue('2', 0), { ok: true, value: 2 });
    assert.deepStrictEqual(M.parseEditorValue('V2', 'V1'), { ok: true, value: 'V2' });
    assert.strictEqual(M.parseEditorValue('[1]', []).ok, false, 'records are not editable');
}

function testStep() {
    assert.strictEqual(M.stepFor(1, 's'), 0.1, 'a 1 s period steps by 0.1, not 1');
    assert.strictEqual(M.stepFor(30.2, 'V'), 1);
    assert.strictEqual(M.stepFor(0.1, ''), 0.01, 'duty cycle');
    assert.strictEqual(M.stepFor(0, ''), 1, 'unitless whole number (Mode) steps by 1');
    assert.strictEqual(M.stepFor(100, 'ns'), 1);
    assert.strictEqual(M.stepFor(NaN, ''), 1);
}

function testPowerAndCaveats() {
    for (const p of ['/Config/Mode', '/Config/Frequency_Hz', '/Config/Leg1/wEnable', '/Config/Leg2/wDutyCycle', '/Config/Leg3/wDriver', '/Config/Leg1/wReferenceValue', '/Control/zStartStop', '/Control/zCtrlReference']) {
        assert.ok(M.isPowerPath(p), `${p} is a power path`);
    }
    for (const p of ['/Config/wBlinkPeriod_s', '/Debug/Scope/wArm', '/Calibration/I1/wGain', '/Measurements/rDuty1', '/Config/Leg1/wTrackingVar']) {
        assert.ok(!M.isPowerPath(p), `${p} is not a power path`);
    }
    assert.match(M.caveatFor('/Config/Leg1/wDriver'), /MCU reset/);
    assert.match(M.caveatFor('/Config/Leg2/wDutyCycle'), /clamped to 0\.1/);
    assert.match(M.caveatFor('/Debug/Scope/wArm'), /One-shot/);
    assert.strictEqual(M.caveatFor('/Config/Leg1/wEnable'), null);
}

function testBuildRows() {
    const rows = M.buildRows(realTree);
    const paths = rows.map((r) => r.path);
    // Internal nodes hidden by default, tree order kept, groups before their contents.
    assert.deepStrictEqual(paths, [
        '/Config', '/Config/Leg1',
        '/Config/Leg1/wEnable', '/Config/Leg1/wDutyCycle', '/Config/Leg1/wDriver', '/Config/Leg1/wDeadTimeRising_ns', '/Config/Leg1/wTrackingVar',
        '/Config/Mode', '/Config/wBlinkPeriod_s',
        '/Measurements', '/Measurements/rV1Low_V', '/Measurements/rTemp1_degC',
        '/pNodeID', '/mLive',
    ]);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    assert.strictEqual(byPath['/Config'].depth, 0);
    assert.strictEqual(byPath['/Config/Leg1'].depth, 1);
    assert.strictEqual(byPath['/Config/Leg1/wEnable'].depth, 2);
    assert.strictEqual(byPath['/Config/Mode'].depth, 1);
    assert.strictEqual(byPath['/pNodeID'].depth, 0);
    assert.strictEqual(byPath['/Config/Leg1'].variableCount, 5);
    assert.strictEqual(byPath['/Config/Leg1'].writableCount, 5);
    assert.strictEqual(byPath['/Config'].variableCount, 7, 'subtree counts include nested groups');
    assert.strictEqual(byPath['/Config'].groupCount, 1);
    assert.strictEqual(byPath['/Measurements'].writableCount, 0);
    assert.strictEqual(M.groupSummary(byPath['/Config/Leg1']), '5 variables · 5 writable');
    assert.strictEqual(M.groupSummary(byPath['/Measurements']), '2 variables');
    assert.strictEqual(byPath['/Measurements/rTemp1_degC'].unit, '°C');
    assert.strictEqual(byPath['/Config/Leg1/wEnable'].power, true);
    assert.match(byPath['/Config/Leg1/wDriver'].caveat, /MCU reset/);

    const withInternal = M.buildRows(realTree, { showInternal: true }).map((r) => r.path);
    assert.ok(withInternal.includes('/_Reporting/mLive/sEnable'));

    // MOCK_HW-style tree: variables live in a group's `values` map.
    const mockRows = M.buildRows({ path: '/', values: { rStatus: 1 }, children: {
        Config: { path: '/Config', values: { wMode: 0 }, children: { Leg1: { path: '/Config/Leg1', values: { wEnable: true } } } },
    } });
    assert.deepStrictEqual(mockRows.map((r) => r.path), ['/Config', '/Config/Leg1', '/Config/Leg1/wEnable', '/Config/wMode', '/rStatus']);
    assert.strictEqual(M.buildRows(null).length, 0);
}

function testFilters() {
    const rows = M.buildRows(realTree);
    const paths = (opts) => M.visibleRows(rows, opts).map((r) => r.path);
    assert.strictEqual(paths({}).length, rows.length, 'no query/filter -> everything');
    assert.deepStrictEqual(paths({ query: 'duty' }), ['/Config', '/Config/Leg1', '/Config/Leg1/wDutyCycle'], 'matches keep their ancestors');
    assert.deepStrictEqual(paths({ query: 'MEASUREMENTS/rv1' }), ['/Measurements', '/Measurements/rV1Low_V'], 'path match, case-insensitive');
    assert.deepStrictEqual(paths({ filter: 'readonly' }), ['/Measurements', '/Measurements/rV1Low_V', '/Measurements/rTemp1_degC', '/mLive']);
    assert.ok(paths({ filter: 'writable' }).includes('/Config/Mode'), 'unknown access counts as writable');
    assert.deepStrictEqual(paths({ filter: 'changed', changedPaths: new Set(['/Measurements/rV1Low_V']) }), ['/Measurements', '/Measurements/rV1Low_V']);
    assert.deepStrictEqual(paths({ query: 'nothing-matches' }), []);
    assert.deepStrictEqual(paths({ query: 'leg1 enable' }), ['/Config', '/Config/Leg1', '/Config/Leg1/wEnable'], 'each word matches, any order');
    assert.deepStrictEqual(paths({ query: 'enable  LEG1' }), ['/Config', '/Config/Leg1', '/Config/Leg1/wEnable']);
}

testAccess();
testUnitsAndNames();
testFormatAndParse();
testPowerAndCaveats();
testStep();
testBuildRows();
testFilters();

console.log('All owntech_variable_table_model tests passed.');
