const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const electron = path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'electron.exe');
if (!fs.existsSync(electron)) {
  throw new Error('Electron is missing. Run npm install during setup. Runtime downloads are disabled.');
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--mcp')) {
  require('../app/mcp.cjs').startMcp({ executable: electron, workerArgs: [path.resolve(__dirname, '..')] })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
  return;
}
const child = spawn(electron, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit', env, windowsHide: process.argv.includes('--mcp')
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
