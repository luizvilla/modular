module.exports = function registerCoursewareExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('CourseWare extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
