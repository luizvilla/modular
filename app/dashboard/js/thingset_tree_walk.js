// ThingSet tree discovery helpers (shared by widgets/tests).
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.ThingSetTreeWalk = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    // ThingSetSerialShell.buildTree() (the real tree source) sets node.path
    // WITHOUT a leading slash (e.g. "Debug/Scope/wArm", confirmed against
    // real Core4/Twist hardware); flattenTree()'s own computed paths (used
    // for the values map elsewhere in this app) always have one. The ThingSet
    // shell layer normalizes either form identically on the wire, so this
    // was never a functional bug -- but callers comparing a discovered
    // leaf.path against a values-map key would see a mismatch. Always
    // normalize to a leading slash so this module's output matches
    // flattenTree()'s convention regardless of the input's.
    function ensureLeadingSlash(path) {
        if (!path) return '/';
        return path.charAt(0) === '/' ? path : `/${path}`;
    }

    function joinPath(parent, leaf) {
        const base = ensureLeadingSlash(parent);
        if (!leaf) return base;
        if (base === '/') return `/${leaf}`;
        return `${base}/${leaf}`;
    }

    // A node's leaves can show up two ways depending on the tree source:
    // - embedded directly in node.values (the map shape thingset_serial_datasource_core.js's
    //   flattenTree() also reads), or
    // - as a full child node in node.children with its own .value (the shape
    //   ThingSetSerialShell.buildTree() produces for every individually
    //   discovered leaf). A child only counts as a leaf here if it has no
    //   children of its own -- otherwise it's a nested group, not a leaf.
    function collectLeaves(node) {
        const leaves = [];
        if (!node || typeof node !== 'object') return leaves;
        if (node.values && typeof node.values === 'object') {
            Object.keys(node.values).forEach((name) => {
                leaves.push({ name, path: joinPath(node.path, name), value: node.values[name] });
            });
        }
        if (node.children && typeof node.children === 'object') {
            Object.keys(node.children).forEach((name) => {
                const child = node.children[name];
                if (!child || typeof child !== 'object') return;
                const hasChildren = child.children && typeof child.children === 'object' && Object.keys(child.children).length;
                if (hasChildren) return;
                if (!Object.prototype.hasOwnProperty.call(child, 'value')) return;
                leaves.push({ name, path: child.path ? ensureLeadingSlash(child.path) : joinPath(node.path, name), value: child.value });
            });
        }
        return leaves;
    }

    // Walks /Config's direct children looking for groups named LegN (any
    // case), sorted numerically (not lexicographically, so Leg10 doesn't
    // sort before Leg2). Discovery-driven: adding a Leg3 group in firmware
    // makes it show up here with zero code changes -- the concrete mechanism
    // behind OwnVerter readiness.
    function findLegGroups(tree) {
        if (!tree || typeof tree !== 'object') return [];
        const config = tree.children && tree.children.Config;
        if (!config || typeof config !== 'object' || !config.children) return [];
        const legs = [];
        Object.keys(config.children).forEach((name) => {
            const match = /^Leg(\d+)$/i.exec(name);
            if (!match) return;
            const node = config.children[name];
            legs.push({
                name,
                index: parseInt(match[1], 10),
                path: (node && node.path) ? ensureLeadingSlash(node.path) : joinPath(config.path || '/Config', name),
                node,
            });
        });
        legs.sort((a, b) => a.index - b.index);
        return legs;
    }

    // Discovery-driven, not a name allow-list: any leaf whose key starts
    // with w/s (ThingSet's writable/state naming convention) AND whose
    // current value is a real boolean is treated as a toggle -- so a
    // firmware-added boolean action leaf appears automatically too.
    function findBooleanActionLeaves(legNode) {
        return collectLeaves(legNode).filter((leaf) => /^[ws]/i.test(leaf.name) && typeof leaf.value === 'boolean');
    }

    // Same walk, non-boolean side -- not consumed by Milestone 4's Actions
    // panel, but computed now so a future Setpoints-panel successor can
    // reuse this single tree-walk pass instead of re-implementing it.
    function findWritableNonBooleanLeaves(legNode) {
        return collectLeaves(legNode).filter((leaf) => /^[ws]/i.test(leaf.name) && typeof leaf.value !== 'boolean');
    }

    return {
        findLegGroups,
        findBooleanActionLeaves,
        findWritableNonBooleanLeaves,
    };
});
