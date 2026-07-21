const fs = require('fs');
const path = require('path');

const SAVE_ROOT_DIR_NAME = 'Modular';

const SUBDIRS = Object.freeze({
    headers: 'headers',
    dashboards: 'dashboards',
    machines: 'machines',
    captures: 'captures',
    time_plot_csv: 'time_plot_csv',
    xy_plot_csv: 'xy_plot_csv'
});

function getSaveRoot(documentsDir) {
    const root = process.env.MODULAR_SAVE_ROOT_DIR
        ? path.resolve(process.env.MODULAR_SAVE_ROOT_DIR)
        : path.join(documentsDir, SAVE_ROOT_DIR_NAME);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function getSaveSubdir(documentsDir, name) {
    const sub = SUBDIRS[name];
    if (!sub) throw new Error(`Unknown save subdir: ${name}`);
    const dir = path.join(getSaveRoot(documentsDir), sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = { SAVE_ROOT_DIR_NAME, SUBDIRS, getSaveRoot, getSaveSubdir };
