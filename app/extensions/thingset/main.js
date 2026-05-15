module.exports = function registerThingSetExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('ThingSet extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
