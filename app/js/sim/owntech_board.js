'use strict';

// Simulated OwnTech/Core4 board (M12 of docs/GUI/02-navigation_overhaul.md):
// the real Core4 object tree behind a simulated Zephyr/ThingSet shell (if02),
// the firmware's write callbacks, and a simple, deterministic power stage.
//
// Power stage, from the 2026-10-13 Twist bench (docs/GUI/02-navigation_overhaul.md):
//   - a leg switches only when Config/Mode == POWER_ON (1) and its wEnable;
//   - duty is clamped to >= 0.1 by the power library, while rDutyN echoes the
//     requested duty (and keeps its last value after the leg stops);
//   - V_low settles to duty x VHigh x 0.9 on a resistive load (10 ohm on leg 1
//     measured 2.74 V at 0.10, 4.06 V at 0.15) and x 1.2 on an open leg
//     (3.62 V at 0.10) within ~10 ms; a loaded leg falls just as fast when it
//     stops, an open leg's capacitor discharges over seconds;
//   - I_low = V_low / R; VHigh about 30 V; temperatures follow dissipation.
// Values are computed analytically from timestamps (no timers), so any
// instant can be sampled -- the scope does exactly that -- and tests can
// drive a fake clock.

const { ObjectStore, ThingSetShellSim } = require('./thingset_shell_sim');

const MODE_POWER_ON = 1;
const NUM_OF_MODES = 3;
const MIN_DUTY = 0.1;
const MIN_FREQUENCY_HZ = 10000;
const TRACKING_VARS = ['V1', 'V2', 'VH', 'I1', 'I2', 'IH'];
const TAU_RISE_S = 0.002;
const TAU_FALL_LOADED_S = 0.002;
const TAU_FALL_OPEN_S = 6;
const TAU_TEMP_S = 90;

// Core4 scope_capture.h
const SCOPE = {
    SAMPLE_COUNT: 1024, CHANNEL_COUNT: 8, BASE_PERIOD_US: 100, DECIMATION_MIN: 1, DECIMATION_MAX: 100,
    IDLE: 0, ARMED: 1, TRIGGERED: 2, READY: 3, STREAMING: 4, ERROR: 5,
    STATE_NAMES: ['IDLE', 'ARMED', 'TRIGGERED', 'READY', 'STREAMING', 'ERROR'],
    E_NONE: 0, E_INVALID_STATE: 1, E_INVALID_DECIMATION: 2, E_TRANSFER: 3, E_INTERNAL: 4,
    CHANNELS: ['V1Low_V', 'V2Low_V', 'VHigh_V', 'I1Low_A', 'I2Low_A', 'IHigh_A', 'Duty1', 'Duty2'],
};
const HISTORY_MS = 15000; // longer than the longest capture (102.4 ms x 100)

// Deterministic noise in [-1, 1] for a channel at a 10 ms time bucket.
function noise(seed, channel, tMs) {
    let x = (Math.floor(tMs / 10) * 2654435761 + channel * 40503 + seed * 9973) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return ((x % 20001) / 10000) - 1;
}

class OwnTechSimBoard {
    constructor(options = {}) {
        const objects = options.objects || require('./core4_objects.json');
        this.options = {
            serialNumber: 'SIM00000001',
            label: 'Demo OwnTech',
            vHigh: 30,
            loadsOhm: [10, Infinity], // leg 1 on a 10 ohm resistor, leg 2 open
            seed: 1,
            latencyMs: 8,
            now: () => Date.now(),
            ...options,
        };
        this.now = this.options.now;
        this.store = new ObjectStore(objects.nodes);
        this.shell = new ThingSetShellSim(this.store, { latencyMs: this.options.latencyMs });
        this.t0 = this.now();
        this.legs = [0, 1].map((i) => ({
            index: i,
            name: `Leg${i + 1}`,
            loadOhm: this.options.loadsOhm[i],
            // V(t) = target + (v0 - target) * exp(-(t - t0) / tau)
            v0: 0, target: 0, t0: this.t0, tau: TAU_RISE_S,
            running: false,
            vMax: 0,
            dutyReadback: 0,
        }));
        this.legs.forEach((leg) => { leg.history = [{ t0: this.t0, v0: 0, target: 0, tau: TAU_RISE_S, duty: 0 }]; });
        this.temp = [{ v0: 25, target: 25, t0: this.t0 }, { v0: 25, target: 25, t0: this.t0 }];
        this.scope = { state: SCOPE.IDLE, lastError: SCOPE.E_NONE, finalIndex: 0, armT: 0, triggerT: 0, readyT: 0, decimation: 1, pretrigger: 0.2 };
        this.bootLog = objects.if00_boot_log || '';
        this._initialValues();
        this._installFirmwareCallbacks();
        this._installScope();
        this._installReaders();
    }

    // --- state ---
    get mode() { return this.store.values.get('/Config/Mode'); }
    legValue(leg, name) { return this.store.values.get(`/Config/${this.legs[leg].name}/${name}`); }

    // Idle values of a board with a power stage (the captured Spin has none,
    // so its raw measurements are meaningless).
    _initialValues() {
        const set = (p, v) => this.store.set(p, v);
        set('/Measurements/rV1Low_V', 0);
        set('/Measurements/rV2Low_V', 0);
        set('/Measurements/rVHigh_V', this.options.vHigh);
        set('/Measurements/rI1Low_A', 0);
        set('/Measurements/rI2Low_A', 0);
        set('/Measurements/rIHigh_A', 0);
        set('/Measurements/rTemp1_degC', 25);
        set('/Measurements/rTemp2_degC', 25);
        set('/pNodeID', `SIM${this.options.serialNumber.replace(/\W/g, '').slice(-13).padStart(13, '0')}`);
        set('/pNodeName', `${this.options.label}`);
        set('/Converter/wSerialNumber', this.options.serialNumber);
    }

    // Core4's thingset_callbacks.cpp: invalid values are reverted after the
    // write is accepted (":84"), so the readback shows the previous value.
    _installFirmwareCallbacks() {
        this.store.onWrite((path, next, prev) => {
            if (path === '/Config/Mode') return next >= 0 && next < NUM_OF_MODES ? undefined : prev;
            if (path === '/Config/Frequency_Hz') return next >= MIN_FREQUENCY_HZ ? undefined : prev;
            const leg = /^\/Config\/Leg(\d)\/(\w+)$/.exec(path);
            if (leg) {
                const field = leg[2];
                if (field === 'wDutyCycle' && (next < 0 || next > 1)) return prev;
                if (field === 'wPhaseShift' && (next < -360 || next > 360)) return prev;
                if (field === 'wTrackingVar' && !TRACKING_VARS.includes(next)) return prev;
            }
            return undefined;
        });
        // Anything that changes what a leg does re-targets its output at the
        // instant of the write, from where it is right now.
        this.store.afterUpdate((paths) => {
            if (paths.some((p) => p === '/Config/Mode' || /^\/Config\/Leg\d\/(wEnable|wDutyCycle)$/.test(p))) this._retarget();
        });
    }

    _installReaders() {
        const r = this.store.readers;
        const n = (ch, amp) => amp * noise(this.options.seed, ch, this.now());
        r['/Measurements/rV1Low_V'] = () => this.legVoltage(0) + n(1, 0.03);
        r['/Measurements/rV2Low_V'] = () => this.legVoltage(1) + n(2, 0.03);
        r['/Measurements/rVHigh_V'] = () => this.options.vHigh + n(3, 0.08);
        r['/Measurements/rI1Low_A'] = () => this.legCurrent(0) + n(4, 0.01);
        r['/Measurements/rI2Low_A'] = () => this.legCurrent(1) + n(5, 0.01);
        r['/Measurements/rIHigh_A'] = () => this.inputCurrent() + n(6, 0.01);
        r['/Measurements/rTemp1_degC'] = () => this.temperature(0) + n(7, 0.05);
        r['/Measurements/rTemp2_degC'] = () => this.temperature(1) + n(8, 0.05);
        r['/Measurements/rV1Max_V'] = () => this._vMax(0);
        r['/Measurements/rV2Max_V'] = () => this._vMax(1);
        r['/Measurements/rDuty1'] = () => this.legs[0].dutyReadback;
        r['/Measurements/rDuty2'] = () => this.legs[1].dutyReadback;
        r['/Debug/Scope/rState'] = () => this.scopeState();
        r['/Debug/Scope/rLastError'] = () => this.scope.lastError;
        r['/Debug/Scope/rFinalIndex'] = () => (this.scopeState(), this.scope.finalIndex);
    }

    // --- power stage ---
    _retarget() {
        const t = this.now();
        this.legs.forEach((leg, i) => {
            const enabled = !!this.legValue(i, 'wEnable');
            const running = this.mode === MODE_POWER_ON && enabled;
            const requested = Number(this.legValue(i, 'wDutyCycle')) || 0;
            const applied = running ? Math.max(MIN_DUTY, Math.min(1, requested)) : 0;
            const factor = Number.isFinite(leg.loadOhm) ? 0.9 : 1.2;
            const target = running ? applied * this.options.vHigh * factor : 0;
            const tau = running ? TAU_RISE_S : (Number.isFinite(leg.loadOhm) ? TAU_FALL_LOADED_S : TAU_FALL_OPEN_S);
            if (running) leg.dutyReadback = requested;
            if (leg.running && !running) leg.vMax = 0; // the firmware resets v_max on stop
            if (target !== leg.target || tau !== leg.tau || running !== leg.running || leg.dutyReadback !== leg.history[leg.history.length - 1].duty) {
                leg.v0 = this._v(leg, t);
                leg.t0 = t;
                leg.target = target;
                leg.tau = tau;
                // Kept so the scope can sample any instant of its window.
                leg.history.push({ t0: t, v0: leg.v0, target, tau, duty: leg.dutyReadback });
                while (leg.history.length > 2 && leg.history[1].t0 < t - HISTORY_MS) leg.history.shift();
            }
            leg.running = running;
        });
        this.temp.forEach((tp, i) => {
            // Steady-state dissipation of the leg's new operating point.
            const leg = this.legs[i];
            const watts = Number.isFinite(leg.loadOhm) && leg.loadOhm > 0 ? (leg.target * leg.target) / leg.loadOhm : 0;
            const target = 25 + 0.8 * watts;
            if (Math.abs(target - tp.target) > 0.01) {
                tp.v0 = this._tempAt(tp, t);
                tp.t0 = t;
                tp.target = target;
            }
        });
    }

    _v(leg, t) {
        return leg.target + (leg.v0 - leg.target) * Math.exp(-Math.max(0, t - leg.t0) / 1000 / leg.tau);
    }

    _tempAt(tp, t) {
        return tp.target + (tp.v0 - tp.target) * Math.exp(-Math.max(0, t - tp.t0) / 1000 / TAU_TEMP_S);
    }

    _segmentAt(i, t) {
        const h = this.legs[i].history;
        for (let k = h.length - 1; k >= 0; k -= 1) if (h[k].t0 <= t) return h[k];
        return h[0];
    }

    legVoltage(i, t = this.now()) {
        return this._v(this._segmentAt(i, t), t);
    }

    legDutyAt(i, t) {
        return this._segmentAt(i, t).duty;
    }

    legCurrent(i, t = this.now()) {
        const leg = this.legs[i];
        return Number.isFinite(leg.loadOhm) && leg.loadOhm > 0 ? this.legVoltage(i, t) / leg.loadOhm : 0;
    }

    inputCurrent(t = this.now()) {
        const watts = [0, 1].reduce((sum, i) => sum + this.legVoltage(i, t) * this.legCurrent(i, t), 0);
        return watts / 0.95 / this.options.vHigh;
    }

    temperature(i) {
        return this._tempAt(this.temp[i], this.now());
    }

    // --- scope (Core4 scope_capture.cpp) ---
    _installScope() {
        const S = this.scope;
        const locked = () => [SCOPE.ARMED, SCOPE.TRIGGERED, SCOPE.STREAMING].includes(this.scopeState());
        this.store.onWrite((path, next, prev) => {
            if (path === '/Debug/Scope/wDecimation') {
                if (locked()) { S.lastError = SCOPE.E_INVALID_STATE; return prev; }
                if (next < SCOPE.DECIMATION_MIN || next > SCOPE.DECIMATION_MAX) { S.lastError = SCOPE.E_INVALID_DECIMATION; return prev; }
            }
            if (path === '/Debug/Scope/wPretriggerRatio') {
                if (locked()) { S.lastError = SCOPE.E_INVALID_STATE; return prev; }
                if (!(next >= 0 && next <= 0.9)) { S.lastError = SCOPE.E_INTERNAL; return prev; }
            }
            // One-shot requests: acted on, then cleared by the firmware.
            if (path === '/Debug/Scope/wArm' && next) {
                if (this.scopeState() === SCOPE.STREAMING) S.lastError = SCOPE.E_INVALID_STATE;
                else this._scopeArm();
                return false;
            }
            if (path === '/Debug/Scope/wTrigger' && next) {
                if (this.scopeState() === SCOPE.ARMED) this._scopeTrigger();
                else S.lastError = SCOPE.E_INVALID_STATE;
                return false;
            }
            return undefined;
        });
    }

    _scopeArm() {
        const S = this.scope;
        S.decimation = Number(this.store.values.get('/Debug/Scope/wDecimation')) || 1;
        S.pretrigger = Number(this.store.values.get('/Debug/Scope/wPretriggerRatio')) || 0;
        const periodUs = SCOPE.BASE_PERIOD_US * S.decimation;
        this.store.set('/Debug/Scope/rSamplePeriod_us', periodUs);
        this.store.set('/Debug/Scope/rCaptureDuration_ms', SCOPE.SAMPLE_COUNT * periodUs / 1000);
        S.armT = this.now();
        S.state = SCOPE.ARMED;
        S.lastError = SCOPE.E_NONE;
        S.finalIndex = 0;
        S.capture = null;
    }

    _scopeTrigger() {
        const S = this.scope;
        S.triggerT = this.now();
        const durationMs = SCOPE.SAMPLE_COUNT * SCOPE.BASE_PERIOD_US * S.decimation / 1000;
        S.readyT = S.triggerT + (1 - S.pretrigger) * durationMs;
        S.state = SCOPE.TRIGGERED;
    }

    // Advances TRIGGERED -> READY once the post-trigger samples are taken.
    scopeState() {
        const S = this.scope;
        if (S.state === SCOPE.TRIGGERED && this.now() >= S.readyT) {
            const periodMs = SCOPE.BASE_PERIOD_US * S.decimation / 1000;
            const recorded = Math.max(1, Math.floor((S.readyT - S.armT) / periodMs));
            S.finalIndex = (recorded - 1) % SCOPE.SAMPLE_COUNT;
            S.state = SCOPE.READY;
        }
        return S.state;
    }

    // The capture as the firmware's ring buffer holds it: row r holds the
    // sample whose ring index is r; the chronologically last one is at
    // finalIndex. Each row: the 8 channels sampled at that instant.
    scopeBuffer() {
        const S = this.scope;
        if (S.capture) return S.capture;
        const periodMs = SCOPE.BASE_PERIOD_US * S.decimation / 1000;
        const start = S.readyT - SCOPE.SAMPLE_COUNT * periodMs;
        const rows = new Array(SCOPE.SAMPLE_COUNT);
        for (let k = 0; k < SCOPE.SAMPLE_COUNT; k += 1) {
            const t = start + (k + 1) * periodMs;
            const n = (ch, amp) => amp * noise(this.options.seed, ch, t * 10 + k);
            const row = [
                this.legVoltage(0, t) + n(1, 0.03),
                this.legVoltage(1, t) + n(2, 0.03),
                this.options.vHigh + n(3, 0.08),
                this.legCurrent(0, t) + n(4, 0.01),
                this.legCurrent(1, t) + n(5, 0.01),
                this.inputCurrent(t) + n(6, 0.01),
                this.legDutyAt(0, t),
                this.legDutyAt(1, t),
            ];
            rows[(S.finalIndex + 1 + k) % SCOPE.SAMPLE_COUNT] = row;
        }
        S.capture = rows;
        return rows;
    }

    _vMax(i) {
        const leg = this.legs[i];
        if (leg.running) leg.vMax = Math.max(leg.vMax, this.legVoltage(i));
        return leg.vMax;
    }
}

module.exports = { OwnTechSimBoard, noise, SCOPE };
