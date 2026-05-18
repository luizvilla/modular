module.exports = function registerCoursewareTestExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('CourseWare test extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();
};
