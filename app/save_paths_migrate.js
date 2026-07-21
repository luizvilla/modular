const fs = require('fs');
const path = require('path');

function migrateDirContents(fromDir, toDir, skipNames = new Set(['.gitkeep'])) {
    let entries;
    try {
        entries = fs.readdirSync(fromDir, { withFileTypes: true });
    } catch {
        return; // old dir missing — nothing to migrate
    }
    fs.mkdirSync(toDir, { recursive: true });
    for (const entry of entries) {
        if (!entry.isFile() || skipNames.has(entry.name)) continue;
        const src = path.join(fromDir, entry.name);
        const dest = path.join(toDir, entry.name);
        if (fs.existsSync(dest)) continue; // never clobber; leave source in place on collision
        try {
            fs.renameSync(src, dest);
        } catch (err) {
            if (err.code === 'EXDEV') {
                fs.copyFileSync(src, dest);
                fs.unlinkSync(src);
            } else {
                console.warn(`[migrate] failed to move ${src} -> ${dest}:`, err?.message || err);
            }
        }
    }
}

function migrateLegacySaveLocations(appDir, documentsDir, saveRoot) {
    const marker = path.join(saveRoot, '.migrated');
    if (fs.existsSync(marker)) return;

    migrateDirContents(path.join(appDir, 'headers'), path.join(saveRoot, 'headers'));
    migrateDirContents(path.join(appDir, 'acquire'), path.join(saveRoot, 'captures'));
    // Read from the ORIGINAL userData-based locations, not the (already repointed) new consts.
    const { app } = require('electron');
    migrateDirContents(path.join(app.getPath('userData'), 'dashboards'), path.join(saveRoot, 'dashboards'));
    migrateDirContents(path.join(app.getPath('userData'), 'machines'), path.join(saveRoot, 'machines'));

    try {
        fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
    } catch (err) {
        console.warn('[migrate] failed to write migration marker:', err?.message || err);
    }
}

module.exports = { migrateLegacySaveLocations, migrateDirContents };
