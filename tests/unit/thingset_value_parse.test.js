const assert = require('assert');
const { parseInputValue } = require('../../app/dashboard/js/thingset_value_parse.js');

function runBooleanTests() {
    assert.strictEqual(parseInputValue('true'), true);
    assert.strictEqual(parseInputValue('false'), false);
    assert.strictEqual(parseInputValue('TRUE'), true, 'case-insensitive');
    assert.strictEqual(parseInputValue('False'), false, 'case-insensitive');
    assert.strictEqual(parseInputValue(' true '), true, 'surrounding whitespace trimmed');
}

function runNullTests() {
    assert.strictEqual(parseInputValue('null'), null);
    assert.strictEqual(parseInputValue('NULL'), null);
}

function runNumberTests() {
    assert.strictEqual(parseInputValue('42'), 42);
    assert.strictEqual(parseInputValue('-3.5'), -3.5);
    assert.strictEqual(parseInputValue('0'), 0);
    assert.strictEqual(parseInputValue('1e3'), 1000);
}

function runHexTests() {
    assert.strictEqual(parseInputValue('0x10'), 16);
    assert.strictEqual(parseInputValue('0XFF'), 255, 'uppercase 0X prefix');
    assert.strictEqual(parseInputValue('0xa0'), 160, 'lowercase hex digits');
}

function runJsonTests() {
    assert.deepStrictEqual(parseInputValue('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(parseInputValue('[1,2,3]'), [1, 2, 3]);
    assert.strictEqual(parseInputValue('"hello"'), 'hello', 'quoted string is JSON-unwrapped');
    // Malformed JSON-looking input falls back to the raw string rather than throwing.
    assert.strictEqual(parseInputValue('{not json}'), '{not json}');
    assert.strictEqual(parseInputValue('[1,2'), '[1,2');
}

function runPlainStringTests() {
    assert.strictEqual(parseInputValue('hello'), 'hello');
    assert.strictEqual(parseInputValue('Leg1'), 'Leg1');
}

function runEdgeCaseTests() {
    assert.strictEqual(parseInputValue(''), '');
    assert.strictEqual(parseInputValue('   '), '');
    assert.strictEqual(parseInputValue(null), '');
    assert.strictEqual(parseInputValue(undefined), '');
    // Non-string input is coerced via String() before parsing.
    assert.strictEqual(parseInputValue(42), 42);
    assert.strictEqual(parseInputValue(true), true);
}

runBooleanTests();
runNullTests();
runNumberTests();
runHexTests();
runJsonTests();
runPlainStringTests();
runEdgeCaseTests();

console.log('All thingset_value_parse tests passed.');
