const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'linux') return;

    const executableName = context.packager.executableName;
    const execPath = path.join(context.appOutDir, executableName);
    const realExecPath = path.join(context.appOutDir, `${executableName}.bin`);

    fs.renameSync(execPath, realExecPath);

    fs.writeFileSync(execPath,
        `#!/bin/bash\nexec "$(dirname "$0")/${executableName}.bin" --no-sandbox "$@"\n`,
        { mode: 0o755 }
    );
};
