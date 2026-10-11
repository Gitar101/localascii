import { spawn } from 'node:child_process';
import path from 'node:path';
const child = spawn(process.execPath, ['scripts/launch.cjs', '--mcp'], {
  env: { ...process.env, LOCALASCII_DIAGNOSTICS: path.resolve('test-results/mcp-diagnostics.log') },
  stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => console.log('stdout:', chunk.toString()));
child.stderr.on('data', chunk => console.log('stderr:', chunk.toString()));
child.on('exit', (code, signal) => console.log('exit:', code, signal));
child.stdin.on('error', error => console.log('stdin error:', error.message));
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1.0.0' }
} }) + '\n');
setTimeout(() => { child.stdin.end(); child.kill(); }, 15_000);
