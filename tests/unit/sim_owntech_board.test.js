const assert = require('assert');
const { OwnTechSimBoard } = require('../../app/js/sim/owntech_board.js');

// The simulated power stage against what the 2026-10-13 Twist bench showed
// (docs/GUI/02-navigation_overhaul.md, Phase 3 + scope follow-up).

function board(opts = {}) {
    let t = 1_000_000;
    const clock = { advance(ms) { t += ms; }, get t() { return t; } };
    const b = new OwnTechSimBoard({ now: () => t, ...opts });
    const read = (p) => b.store.read(p);
    const write = (group, obj) => b.store.update(group, obj);
    return { b, clock, read, write };
}

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} not within ${tol} of ${expected}`);

function testIdle() {
    const { read } = board();
    near(read('/Measurements/rVHigh_V'), 30, 0.1, 'VHigh idles at 30 V');
    near(read('/Measurements/rV1Low_V'), 0, 0.05, 'V1 idle');
    assert.strictEqual(read('/Config/Mode'), 0);
    assert.strictEqual(read('/Measurements/rDuty1'), 0);
}

function testLegNeedsPowerOn() {
    const { clock, read, write } = board();
    write('/Config/Leg1', { wEnable: true });
    clock.advance(100);
    near(read('/Measurements/rV1Low_V'), 0, 0.05, 'enabled leg stays off while Mode is IDLE');
    write('/Config', { Mode: 1 });
    clock.advance(50);
    near(read('/Measurements/rV1Low_V'), 0.1 * 30 * 0.9, 0.1, 'leg 1 on 10 ohm at duty 0.1');
    near(read('/Measurements/rI1Low_A'), 0.27, 0.02, 'I = V / 10 ohm');
    assert.strictEqual(read('/Measurements/rDuty1'), 0.1);
}

function testResponseTimes() {
    const { clock, read, write } = board();
    write('/Config', { Mode: 1 });
    write('/Config/Leg1', { wDutyCycle: 0.15, wEnable: true });
    clock.advance(10);
    assert.ok(read('/Measurements/rV1Low_V') > 0.9 * 4.05, 'within one 10 ms scope sample');
    near(read('/Measurements/rV1Low_V'), 4.05, 0.1, 'duty 0.15 on 10 ohm (bench: 4.06 V)');
    write('/Config/Leg1', { wEnable: false });
    clock.advance(20);
    near(read('/Measurements/rV1Low_V'), 0, 0.05, 'a loaded leg falls fast');
    assert.strictEqual(read('/Measurements/rV1Max_V'), 0, 'v_max resets when the leg stops');
}

function testOpenLeg() {
    const { clock, read, write } = board();
    write('/Config', { Mode: 1 });
    write('/Config/Leg2', { wEnable: true });
    clock.advance(50);
    near(read('/Measurements/rV2Low_V'), 3.6, 0.1, 'open leg at duty 0.1 (bench: 3.62 V)');
    near(read('/Measurements/rI2Low_A'), 0, 0.02, 'no current on an open leg');
    write('/Config/Leg2', { wEnable: false });
    clock.advance(4000);
    const v = read('/Measurements/rV2Low_V');
    assert.ok(v > 1 && v < 3, `open leg's capacitor discharges over seconds (bench: 2.18 V after 4 s), got ${v}`);
}

function testDutyClampAndEcho() {
    const { clock, read, write } = board();
    write('/Config', { Mode: 1 });
    write('/Config/Leg1', { wDutyCycle: 0.05, wEnable: true });
    clock.advance(50);
    near(read('/Measurements/rV1Low_V'), 2.7, 0.1, 'duty 0.05 is clamped to 0.1 (bench: same output as 0.10)');
    assert.strictEqual(read('/Measurements/rDuty1'), 0.05, 'rDuty echoes the requested duty, not the applied one');
    write('/Config/Leg1', { wEnable: false });
    assert.strictEqual(read('/Measurements/rDuty1'), 0.05, 'rDuty keeps its last value after the leg stops');
}

function testFirmwareReverts() {
    const { read, write } = board();
    assert.deepStrictEqual(write('/Config/Leg1', { wDutyCycle: 2 }), { status: '84' }, 'accepted like the real board');
    assert.strictEqual(read('/Config/Leg1/wDutyCycle'), 0.1, '... then reverted by the firmware');
    write('/Config', { Mode: 7 });
    assert.strictEqual(read('/Config/Mode'), 0, 'Mode >= NUM_OF_MODES reverted');
    write('/Config/Leg1', { wTrackingVar: 'XX' });
    assert.strictEqual(read('/Config/Leg1/wTrackingVar'), 'V1');
    write('/Config/Leg1', { wPhaseShift: 999 });
    assert.strictEqual(read('/Config/Leg1/wPhaseShift'), 0);
    write('/Config', { Frequency_Hz: 5 });
    assert.strictEqual(read('/Config/Frequency_Hz'), 200000);
    assert.strictEqual(write('/Measurements', { rV1Low_V: 1 }).status, 'A3');
}

function testTemperatureAndInput() {
    const { clock, read, write } = board();
    write('/Config', { Mode: 1 });
    write('/Config/Leg1', { wDutyCycle: 0.3, wEnable: true });
    clock.advance(50);
    near(read('/Measurements/rIHigh_A'), (8.1 * 8.1 / 10) / 0.95 / 30, 0.03, 'input current from output power');
    const t0 = read('/Measurements/rTemp1_degC');
    clock.advance(120_000);
    assert.ok(read('/Measurements/rTemp1_degC') > t0 + 2, 'leg 1 warms up under load');
    near(read('/Measurements/rTemp2_degC'), 25, 0.2, 'idle leg stays at ambient');
    assert.ok(read('/Measurements/rV1Max_V') >= 8, 'v_max tracks while running');
}

function testIdentity() {
    const { read } = board({ serialNumber: 'SIM00000001', label: 'Demo OwnTech' });
    assert.strictEqual(read('/pNodeName'), 'Demo OwnTech');
    assert.strictEqual(read('/Converter/wSerialNumber'), 'SIM00000001');
}

testIdle();
testLegNeedsPowerOn();
testResponseTimes();
testOpenLeg();
testDutyClampAndEcho();
testFirmwareReverts();
testTemperatureAndInput();
testIdentity();
console.log('All sim_owntech_board tests passed.');
