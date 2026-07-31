const assert = require('assert');
const treeWalk = require('../../app/dashboard/js/thingset_tree_walk.js');

function buildValuesShapeTree(legNames) {
    // Mirrors the {path, values, children} shape thingset_serial_datasource_core.js's
    // flattenTree() and the MOCK_HW preload mock both use: leaves embedded
    // directly as a path -> value map, no per-leaf child node.
    const config = { path: '/Config', values: {}, children: {} };
    legNames.forEach((name) => {
        config.children[name] = {
            path: `/Config/${name}`,
            values: {
                wEnable: true,
                wCapa: false,
                wDriver: false,
                sFault: false,
                Frequency_Hz: 100000,
                rDutyCycle: 0.5,
            },
        };
    });
    return { path: '/', values: {}, children: { Config: config } };
}

function buildChildNodeShapeTree(legNames) {
    // Mirrors ThingSetSerialShell.buildTree()'s real output shape: every leaf
    // is its own child node with a .value property, not a values-map entry.
    const config = { path: '/Config', values: {}, children: {} };
    legNames.forEach((name) => {
        config.children[name] = {
            path: `/Config/${name}`,
            values: {},
            children: {
                wEnable: { path: `/Config/${name}/wEnable`, value: true },
                wCapa: { path: `/Config/${name}/wCapa`, value: false },
                sFault: { path: `/Config/${name}/sFault`, value: false },
                Frequency_Hz: { path: `/Config/${name}/Frequency_Hz`, value: 100000 },
            },
        };
    });
    return { path: '/', values: {}, children: { Config: config } };
}

function runFindLegGroupsTests() {
    const twoLegTree = buildValuesShapeTree(['Leg1', 'Leg2']);
    const twoLegs = treeWalk.findLegGroups(twoLegTree);
    assert.strictEqual(twoLegs.length, 2, 'should discover exactly 2 legs');
    assert.deepStrictEqual(twoLegs.map((l) => l.name), ['Leg1', 'Leg2']);
    assert.deepStrictEqual(twoLegs.map((l) => l.path), ['/Config/Leg1', '/Config/Leg2']);

    // The core OwnVerter-readiness proof: a synthetic 3-leg tree is
    // discovered with zero code changes, exactly as a real 3-leg firmware
    // tree would be.
    const threeLegTree = buildValuesShapeTree(['Leg1', 'Leg2', 'Leg3']);
    const threeLegs = treeWalk.findLegGroups(threeLegTree);
    assert.strictEqual(threeLegs.length, 3, 'should discover exactly 3 legs (OwnVerter)');
    assert.deepStrictEqual(threeLegs.map((l) => l.name), ['Leg1', 'Leg2', 'Leg3']);
    assert.deepStrictEqual(threeLegs.map((l) => l.index), [1, 2, 3]);

    // Numeric sort, not lexicographic: Leg10 must not sort before Leg2.
    const outOfOrderTree = buildValuesShapeTree(['Leg10', 'Leg2', 'Leg1']);
    const sortedLegs = treeWalk.findLegGroups(outOfOrderTree);
    assert.deepStrictEqual(sortedLegs.map((l) => l.name), ['Leg1', 'Leg2', 'Leg10']);

    // Non-Leg groups under /Config must not be picked up.
    const mixedTree = buildValuesShapeTree(['Leg1']);
    mixedTree.children.Config.children.Debug = { path: '/Config/Debug', values: {} };
    mixedTree.children.Config.children.Legacy = { path: '/Config/Legacy', values: {} };
    const mixedLegs = treeWalk.findLegGroups(mixedTree);
    assert.deepStrictEqual(mixedLegs.map((l) => l.name), ['Leg1']);

    // Missing/empty tree shapes degrade to an empty array, not a throw.
    assert.deepStrictEqual(treeWalk.findLegGroups(null), []);
    assert.deepStrictEqual(treeWalk.findLegGroups({}), []);
    assert.deepStrictEqual(treeWalk.findLegGroups({ children: {} }), []);
}

function runFindBooleanActionLeavesTests() {
    const tree = buildValuesShapeTree(['Leg1']);
    const leg1 = tree.children.Config.children.Leg1;
    const booleans = treeWalk.findBooleanActionLeaves(leg1);
    const names = booleans.map((l) => l.name).sort();
    // wEnable/wCapa/wDriver/sFault are boolean and start with w/s;
    // Frequency_Hz and rDutyCycle are excluded (wrong prefix and/or non-boolean).
    assert.deepStrictEqual(names, ['sFault', 'wCapa', 'wDriver', 'wEnable']);
    booleans.forEach((leaf) => assert.strictEqual(typeof leaf.value, 'boolean'));
    assert.strictEqual(booleans.find((l) => l.name === 'wEnable').path, '/Config/Leg1/wEnable');

    assert.deepStrictEqual(treeWalk.findBooleanActionLeaves(null), []);
}

function runFindWritableNonBooleanLeavesTests() {
    const tree = buildValuesShapeTree(['Leg1']);
    const leg1 = tree.children.Config.children.Leg1;
    const nonBoolean = treeWalk.findWritableNonBooleanLeaves(leg1);
    // Frequency_Hz starts with neither w nor s -> excluded. rDutyCycle
    // doesn't start with w/s either -> excluded. Nothing in this fixture
    // matches w/s-prefixed AND non-boolean, so the result should be empty.
    assert.deepStrictEqual(nonBoolean, []);

    const tree2 = buildValuesShapeTree(['Leg1']);
    tree2.children.Config.children.Leg1.values.wSetpoint = 0.42;
    const nonBoolean2 = treeWalk.findWritableNonBooleanLeaves(tree2.children.Config.children.Leg1);
    assert.strictEqual(nonBoolean2.length, 1);
    assert.strictEqual(nonBoolean2[0].name, 'wSetpoint');
    assert.strictEqual(nonBoolean2[0].value, 0.42);
}

function runChildNodeShapeTests() {
    // Same assertions, but against the real ThingSetSerialShell.buildTree()
    // node shape (leaves as full child nodes with .value, not a values map).
    const tree = buildChildNodeShapeTree(['Leg1', 'Leg2', 'Leg3']);
    const legs = treeWalk.findLegGroups(tree);
    assert.deepStrictEqual(legs.map((l) => l.name), ['Leg1', 'Leg2', 'Leg3']);

    const leg1 = legs[0].node;
    const booleans = treeWalk.findBooleanActionLeaves(leg1);
    assert.deepStrictEqual(booleans.map((l) => l.name).sort(), ['sFault', 'wCapa', 'wEnable']);
    assert.strictEqual(booleans.find((l) => l.name === 'wEnable').path, '/Config/Leg1/wEnable');

    // A nested group child (has its own .children) must not be treated as a leaf.
    const treeWithNestedGroup = buildChildNodeShapeTree(['Leg1']);
    treeWithNestedGroup.children.Config.children.Leg1.children.wSub = {
        path: '/Config/Leg1/wSub',
        children: { wInner: { path: '/Config/Leg1/wSub/wInner', value: true } },
    };
    const withNested = treeWalk.findBooleanActionLeaves(treeWithNestedGroup.children.Config.children.Leg1);
    assert.strictEqual(withNested.some((l) => l.name === 'wSub'), false, 'a group node must not be treated as a leaf');
}

function buildRealHardwarePathShapeTree() {
    // Regression test for a real bug found against real Twist/Core4
    // hardware: ThingSetSerialShell.buildTree()'s actual node.path values
    // have NO leading slash (e.g. "Config/Leg1/wEnable"), unlike every
    // synthetic fixture above and unlike flattenTree()'s own computed paths
    // (which always start with "/"). This never broke a write/read (the
    // shell layer normalizes either form on the wire), but a discovered
    // leaf.path must still come out normalized so it's comparable to a
    // flattenTree()-produced values-map key.
    return {
        path: undefined,
        values: {},
        children: {
            Config: {
                path: 'Config',
                values: {},
                children: {
                    Leg1: {
                        path: 'Config/Leg1',
                        values: {},
                        children: {
                            wEnable: { path: 'Config/Leg1/wEnable', value: false },
                            wDutyCycle: { path: 'Config/Leg1/wDutyCycle', value: 0.1 },
                        },
                    },
                },
            },
        },
    };
}

function runRealHardwarePathShapeTests() {
    const tree = buildRealHardwarePathShapeTree();
    const legs = treeWalk.findLegGroups(tree);
    assert.strictEqual(legs.length, 1);
    assert.strictEqual(legs[0].path, '/Config/Leg1', 'leg path must be normalized to a leading slash');

    const booleans = treeWalk.findBooleanActionLeaves(legs[0].node);
    assert.strictEqual(booleans.length, 1);
    assert.strictEqual(booleans[0].name, 'wEnable');
    assert.strictEqual(booleans[0].path, '/Config/Leg1/wEnable', 'leaf path must be normalized to a leading slash');

    const nonBoolean = treeWalk.findWritableNonBooleanLeaves(legs[0].node);
    assert.strictEqual(nonBoolean.length, 1);
    assert.strictEqual(nonBoolean[0].path, '/Config/Leg1/wDutyCycle');
}

runFindLegGroupsTests();
runFindBooleanActionLeavesTests();
runFindWritableNonBooleanLeavesTests();
runChildNodeShapeTests();
runRealHardwarePathShapeTests();

console.log('All thingset_tree_walk tests passed.');
