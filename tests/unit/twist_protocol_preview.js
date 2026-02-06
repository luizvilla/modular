// Print Twist/Ownverter protocol commands for human verification.
const protocol = require('../../app/dashboard/js/twist_protocol.js');

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function print(label, value) {
  console.log(`${label}: ${value}`);
}

function previewDevice(deviceType) {
  const profile = protocol.getProfile(deviceType);
  printSection(`${profile.name} commands`);

  print('IDLE', protocol.cmdIdle());
  print('POWER_OFF', protocol.cmdPowerOff());
  print('POWER_ON', protocol.cmdPowerOn());

  for (let i = 1; i <= profile.legs; i += 1) {
    print(`LEG${i} LEG ON`, protocol.cmdToggle('LEG', i, 'ON', deviceType));
    print(`LEG${i} LEG OFF`, protocol.cmdToggle('LEG', i, 'OFF', deviceType));
    print(`LEG${i} CAPA ON`, protocol.cmdToggle('CAPA', i, 'ON', deviceType));
    print(`LEG${i} CAPA OFF`, protocol.cmdToggle('CAPA', i, 'OFF', deviceType));
    print(`LEG${i} DRIVER ON`, protocol.cmdToggle('DRIVER', i, 'ON', deviceType));
    print(`LEG${i} DRIVER OFF`, protocol.cmdToggle('DRIVER', i, 'OFF', deviceType));
    print(`LEG${i} BUCK ON`, protocol.cmdToggle('BUCK', i, 'ON', deviceType));
    print(`LEG${i} BUCK OFF`, protocol.cmdToggle('BUCK', i, 'OFF', deviceType));
    print(`LEG${i} BOOST ON`, protocol.cmdToggle('BOOST', i, 'ON', deviceType));
    print(`LEG${i} BOOST OFF`, protocol.cmdToggle('BOOST', i, 'OFF', deviceType));
    print(`LEG${i} REFERENCE V1`, protocol.cmdReference(i, 'V1', 1.23456, deviceType));
    print(`LEG${i} DUTY`, protocol.cmdDuty(i, 0.02233, deviceType));
    print(`LEG${i} FREQUENCY`, protocol.cmdFrequency(i, 20000, deviceType));
    print(`LEG${i} PHASE_SHIFT`, protocol.cmdPhaseShift(i, 10, deviceType));
    print(`LEG${i} DEAD_TIME_RISING`, protocol.cmdDeadTimeRising(i, 50, deviceType));
    print(`LEG${i} DEAD_TIME_FALLING`, protocol.cmdDeadTimeFalling(i, 50, deviceType));
  }

  const varSample = profile.variables[0];
  if (varSample) {
    print(`CALIBRATE ${varSample}`, protocol.cmdCalibrate(varSample, 22.03409353, 0.11349874, deviceType));
  }
}

previewDevice('TWIST');
previewDevice('OWNVERTER');
