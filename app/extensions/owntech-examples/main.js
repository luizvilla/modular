module.exports = function registerOwntechExamplesExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('OwnTech Examples extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
