/**
 * This file can be edited to customize webpack configuration.
 * To reset delete this file and rerun theia build again.
 */
// @ts-check
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');

// Phase 0 only needs a browser-hosted workbench plus a custom backend probe route.
// Disable ripgrep native packaging to avoid current @vscode/ripgrep export issues
// in this isolated spike environment.
if (nodeConfig && nodeConfig.nativePlugin && typeof nodeConfig.nativePlugin.copyRipgrep === 'function') {
    nodeConfig.nativePlugin.copyRipgrep = async () => {};
}

/**
 * Expose bundled modules on window.theia.moduleName namespace, e.g.
 * window['theia']['@theia/core/lib/common/uri'].
 * Such syntax can be used by external code, for instance, for testing.
configs[0].module.rules.push({
    test: /\.js$/,
    loader: require.resolve('@theia/application-manager/lib/expose-loader')
}); */

module.exports = [
    ...configs,
    nodeConfig.config
];
