// Simple node-based tests for Twist/Ownverter command formatting.
const assert = require('assert');
const protocol = require('../../app/dashboard/js/twist_protocol.js');

function run() {
  assert.strictEqual(protocol.cmdIdle(), 'd_i');
  assert.strictEqual(protocol.cmdPowerOff(), 'd_f');
  assert.strictEqual(protocol.cmdPowerOn(), 'd_o');

  assert.strictEqual(protocol.cmdToggle('LEG', 1, 'ON', 'TWIST'), 's_LEG1_l_on');
  assert.strictEqual(protocol.cmdToggle('BOOST', 'LEG2', 'off', 'TWIST'), 's_LEG2_t_off');

  assert.strictEqual(protocol.cmdReference(1, 'V1', 1.23456, 'TWIST'), 's_LEG1_r_V1_1.23456');
  assert.strictEqual(protocol.cmdDuty(2, 0.02233, 'TWIST'), 's_LEG2_d_0.02233');
  assert.strictEqual(protocol.cmdPhaseShift(1, 10, 'TWIST'), 's_LEG1_p_10');
  assert.strictEqual(protocol.cmdFrequency(1, 20000, 'TWIST'), 's_LEG1_f_20000');
  assert.strictEqual(protocol.cmdDeadTimeRising(1, 50, 'TWIST'), 's_LEG1_x_50');
  assert.strictEqual(protocol.cmdDeadTimeFalling(1, 50, 'TWIST'), 's_LEG1_z_50');

  assert.strictEqual(protocol.cmdCalibrate('V1', 22.03409353, 0.11349874, 'TWIST'),
    'k_V1_g_22.03409353_o_0.11349874');

  assert.throws(() => protocol.normalizeVariable('X9', 'TWIST'));
  assert.throws(() => protocol.normalizeLeg(3, 'TWIST'));
}

run();
