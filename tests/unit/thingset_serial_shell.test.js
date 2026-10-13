const assert = require('assert');
const { ThingSetSerialShell } = require('../../app/js/thingset_serial_shell.js');

// autoOpen: false means the constructor never touches a real device -- this
// is a pure-logic test of _extractJson()'s ANSI-escape handling.
function makeShell() {
    return new ThingSetSerialShell({ path: '/dev/ttyNONEXISTENT_TEST_ONLY', baudRate: 115200 });
}

function runExtractJsonAnsiTests() {
    const shell = makeShell();

    // Regression test for a real bug found against real Twist/Core4 hardware:
    // Zephyr's shell prefixes/suffixes echoed input and its prompt with ANSI
    // color codes (e.g. "\x1b[m", "\x1b[1;32m"). _extractJson()'s original
    // "find the first [ or {" search would land on the ANSI code's own "["
    // instead of the real JSON's "{", breaking bracket matching so it
    // returned null even though a valid JSON payload was right there --
    // which made ThingSetSerialShell.enterThingSet()'s probe silently fail
    // (probeSucceeded() stayed false) despite the board answering correctly
    // on the very first try.
    const realWorldResponse = '\x1b[m?\r\n:85 {"Measurements":null,"Config":null,"pNodeID":"446175DB82FF7C65"}\r\n\x1b[1;32muart:~$ ';
    const extracted = shell._extractJson(realWorldResponse);
    assert.ok(extracted, 'JSON must be found despite leading/trailing ANSI escape codes');
    assert.strictEqual(extracted.pNodeID, '446175DB82FF7C65');
    assert.strictEqual(extracted.Measurements, null);

    // A response with no ANSI codes at all must still work (no regression).
    const plain = ':85 {"a":1,"b":[1,2,3]}';
    assert.deepStrictEqual(shell._extractJson(plain), { a: 1, b: [1, 2, 3] });

    // ANSI codes appearing *inside* an array/object value's surrounding text
    // (not just before it) must not break matching either.
    const withMultipleAnsiRuns = '\x1b[m\x1b[2K?\r\n:85 [1,2,3]\r\n\x1b[0m\x1b[1;32muart:~$ ';
    assert.deepStrictEqual(shell._extractJson(withMultipleAnsiRuns), [1, 2, 3]);

    // No JSON present at all -> null, not a throw.
    assert.strictEqual(shell._extractJson('\x1b[mno json here\x1b[1;32muart:~$ '), null);
    assert.strictEqual(shell._extractJson(''), null);
    assert.strictEqual(shell._extractJson(null), null);

    // Malformed JSON-looking text (unbalanced brackets) -> null, not a throw.
    assert.strictEqual(shell._extractJson('\x1b[m{"a":1\x1b[1;32m'), null);
}

runExtractJsonAnsiTests();

async function runGetValueGroupTests() {
    const shell = makeShell();
    // A leaf read whose response echoes the leaf name is unwrapped to the value.
    shell.get = async () => ({ statusHex: '85', json: { rV1Low_V: 0.7 } });
    assert.deepStrictEqual(await shell.getValue('Measurements/rV1Low_V'), { ok: true, value: 0.7 });
    // A group read is the whole object -- it used to return only its first
    // value (found against real hardware: getValue('Measurements') gave 0.7).
    shell.get = async () => ({ statusHex: '85', json: { rV1Low_V: 0.7, rI1Low_A: 0.3 } });
    assert.deepStrictEqual(await shell.getValue('Measurements'), { ok: true, value: { rV1Low_V: 0.7, rI1Low_A: 0.3 } });
    // A single-key group whose key isn't the requested leaf stays an object.
    shell.get = async () => ({ statusHex: '85', json: { wEnable: false } });
    assert.deepStrictEqual(await shell.getValue('Config/Leg1'), { ok: true, value: { wEnable: false } });
}

runGetValueGroupTests().then(() => {
    console.log('All thingset_serial_shell tests passed.');
}).catch((err) => { console.error(err); process.exit(1); });

