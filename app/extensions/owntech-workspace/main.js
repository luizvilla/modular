module.exports = function registerOwntechWorkspaceExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('OwnTech Firmware Workspace extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
