const assert = require('assert');
const { EventEmitter } = require('events');
const { parseHexFloat, rotateToChronological, ScopeSerialLink, SCOPE_SAMPLE_COUNT, SCOPE_CHANNEL_NAMES } = require('../../app/extensions/owntech/scope_serial.js');

function runParseHexFloatTests() {
    // Known IEEE-754 big-endian single-precision test vectors -- this is
    // the exact thing the migration plan flagged as an unconfirmed
    // real-hardware risk ("byte width and endianness"); these vectors
    // confirm the big-endian interpretation independent of any hardware,
    // matching Core4/src/tools/scope_serial.py's struct.unpack(">f", ...).
    assert.strictEqual(parseHexFloat('00000000'), 0);
    assert.strictEqual(parseHexFloat('3F800000'), 1);
    assert.strictEqual(parseHexFloat('40000000'), 2);
    assert.strictEqual(parseHexFloat('C0000000'), -2);
    assert.strictEqual(parseHexFloat('3f800000'), 1, 'lowercase hex must parse the same as uppercase');
    assert.ok(Math.abs(parseHexFloat('3DCCCCCD') - 0.1) < 1e-6, '3DCCCCCD ~= 0.1');
}

function runRotateToChronologicalTests() {
    const rows = [[0], [1], [2], [3], [4]];

    // finalIndex=2 means index 2 was the most recently written sample, so
    // index 3 is the oldest (chronologically first) sample in the ring
    // buffer -- the rotated array must start there.
    assert.deepStrictEqual(rotateToChronological(rows, 2), [[3], [4], [0], [1], [2]]);

    // finalIndex at the very end / very start of the buffer.
    assert.deepStrictEqual(rotateToChronological(rows, 4), [[0], [1], [2], [3], [4]], 'finalIndex=last -> already chronological');
    assert.deepStrictEqual(rotateToChronological(rows, 0), [[1], [2], [3], [4], [0]]);

    // Full-size synthetic ring buffer matching the real protocol's shape
    // (1024 samples * 8 channels), to exercise the same code path at scale.
    const fullRows = Array.from({ length: SCOPE_SAMPLE_COUNT }, (_, i) => SCOPE_CHANNEL_NAMES.map((_, ch) => i * 10 + ch));
    const finalIndex = 511;
    const rotated = rotateToChronological(fullRows, finalIndex);
    assert.strictEqual(rotated.length, SCOPE_SAMPLE_COUNT);
    assert.deepStrictEqual(rotated[0], fullRows[512], 'first chronological sample is finalIndex+1');
    assert.deepStrictEqual(rotated[SCOPE_SAMPLE_COUNT - 1], fullRows[511], 'last chronological sample is finalIndex itself');

    // Degenerate inputs must not throw.
    assert.deepStrictEqual(rotateToChronological([], 0), []);
}

// A port that ignores the first '?' (the real first-contact symptom) and
// answers every later one.
function makeLinkIgnoringFirstProbe(answerFrom = 2) {
    const link = new ScopeSerialLink({ path: '/dev/ttyNONEXISTENT_TEST_ONLY' });
    const port = new EventEmitter();
    let probes = 0;
    port.isOpen = true;
    port.write = (buf, cb) => {
        if (buf.toString() === '?') {
            probes += 1;
            if (probes >= answerFrom) setTimeout(() => port.emit('data', Buffer.from('SCOPE-DATA/1 OK\n')), 5);
        }
        cb();
    };
    link.port = port;
    port.on('data', link._onData);
    return { link, probeCount: () => probes };
}

async function runProbeResendTests() {
    const ok = makeLinkIgnoringFirstProbe(2);
    await ok.link.probe(200);
    assert.strictEqual(ok.probeCount(), 2, 'an unanswered first probe is resent once on the same link');

    const dead = makeLinkIgnoringFirstProbe(Infinity);
    await assert.rejects(() => dead.link.probe(100), /timed out/);
    assert.strictEqual(dead.probeCount(), 2, 'gives up after the resend');
}

runParseHexFloatTests();
runRotateToChronologicalTests();
runProbeResendTests().then(() => {
    console.log('All scope_serial tests passed.');
}).catch((err) => { console.error(err); process.exit(1); });
