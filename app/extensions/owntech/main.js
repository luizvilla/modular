module.exports = function registerOwntechExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('OwnTech extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
