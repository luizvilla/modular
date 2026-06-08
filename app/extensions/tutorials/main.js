module.exports = function registerTutorialsExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('Tutorials extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
