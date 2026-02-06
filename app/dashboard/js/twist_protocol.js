// Twist/Ownverter serial command formatter (shared by widgets/tests).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.twistProtocol = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEVICE_PROFILES = {
    TWIST: {
      name: 'TWIST',
      legs: 2,
      variables: ['V1', 'V2', 'VH', 'I1', 'I2', 'IH'],
    },
    OWNVERTER: {
      name: 'OWNVERTER',
      legs: 3,
      variables: ['V1', 'V2', 'V3', 'VH', 'I1', 'I2', 'I3', 'IH'],
    },
  };

  const ACTION_CODES = {
    LEG: 'l',
    CAPA: 'c',
    DRIVER: 'v',
    BUCK: 'b',
    BOOST: 't',
  };

  function normalizeDeviceType(deviceType) {
    const key = String(deviceType || '').trim().toUpperCase();
    return DEVICE_PROFILES[key] ? key : 'TWIST';
  }

  function getProfile(deviceType) {
    return DEVICE_PROFILES[normalizeDeviceType(deviceType)];
  }

  function normalizeLeg(leg, deviceType) {
    if (typeof leg === 'string' && /^LEG\d+$/i.test(leg.trim())) {
      return leg.trim().toUpperCase();
    }
    const profile = getProfile(deviceType);
    const idx = Number(leg);
    if (!Number.isFinite(idx) || idx < 1 || idx > profile.legs) {
      throw new Error(`Invalid leg index: ${leg}`);
    }
    return `LEG${idx}`;
  }

  function normalizeVariable(variable, deviceType) {
    const v = String(variable || '').trim().toUpperCase();
    const profile = getProfile(deviceType);
    if (!profile.variables.includes(v)) {
      throw new Error(`Invalid variable: ${variable}`);
    }
    return v;
  }

  function formatFixed(value, decimals) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Invalid numeric value: ${value}`);
    }
    return num.toFixed(decimals);
  }

  function cmdIdle() {
    return 'd_i';
  }

  function cmdPowerOff() {
    return 'd_f';
  }

  function cmdPowerOn() {
    return 'd_o';
  }

  function cmdToggle(action, leg, state, deviceType) {
    const code = ACTION_CODES[String(action || '').toUpperCase()];
    if (!code) {
      throw new Error(`Invalid toggle action: ${action}`);
    }
    const legId = normalizeLeg(leg, deviceType);
    const normalizedState = String(state || '').trim().toLowerCase();
    const onOff = normalizedState === 'on' || normalizedState === '1' || normalizedState === 'true'
      ? 'on'
      : 'off';
    return `s_${legId}_${code}_${onOff}`;
  }

  function cmdReference(leg, variable, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    const varId = normalizeVariable(variable, deviceType);
    return `s_${legId}_r_${varId}_${formatFixed(value, 5)}`;
  }

  function cmdDuty(leg, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    return `s_${legId}_d_${formatFixed(value, 5)}`;
  }

  function cmdPhaseShift(leg, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    if (value === undefined || value === null) throw new Error('Invalid phase shift value');
    return `s_${legId}_p_${value}`;
  }

  function cmdFrequency(leg, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    if (value === undefined || value === null) throw new Error('Invalid frequency value');
    return `s_${legId}_f_${value}`;
  }

  function cmdDeadTimeRising(leg, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    if (value === undefined || value === null) throw new Error('Invalid dead time rising value');
    return `s_${legId}_x_${value}`;
  }

  function cmdDeadTimeFalling(leg, value, deviceType) {
    const legId = normalizeLeg(leg, deviceType);
    if (value === undefined || value === null) throw new Error('Invalid dead time falling value');
    return `s_${legId}_z_${value}`;
  }

  function cmdCalibrate(variable, gain, offset, deviceType) {
    const varId = normalizeVariable(variable, deviceType);
    return `k_${varId}_g_${formatFixed(gain, 8)}_o_${formatFixed(offset, 8)}`;
  }

  return {
    DEVICE_PROFILES,
    getProfile,
    normalizeDeviceType,
    normalizeLeg,
    normalizeVariable,
    cmdIdle,
    cmdPowerOff,
    cmdPowerOn,
    cmdToggle,
    cmdReference,
    cmdDuty,
    cmdPhaseShift,
    cmdFrequency,
    cmdDeadTimeRising,
    cmdDeadTimeFalling,
    cmdCalibrate,
  };
});
