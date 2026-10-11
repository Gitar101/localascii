import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('app', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/mcp/bridge.ts'], outfile: 'app/mcp.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['ffmpeg-static', 'ffprobe-static'] }),
  build({ entryPoints: ['src/desktop/main.ts'], outfile: 'app/main.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['electron', 'ffmpeg-static', 'ffprobe-static'], sourcemap: true }),
  build({ entryPoints: ['src/desktop/preload.ts'], outfile: 'app/preload.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['src/ui/editor.ts'], outfile: 'app/editor.js', bundle: true,
    platform: 'browser', format: 'iife', target: 'chrome132', sourcemap: true }),
  build({ entryPoints: ['src/engine/recipe.ts'], outfile: 'app/recipe.mjs', bundle: true,
    platform: 'node', format: 'esm' }),
  build({ entryPoints: ['src/desktop/media.ts'], outfile: 'app/media.cjs', bundle: true,
    platform: 'node', format: 'cjs', external: ['ffmpeg-static', 'ffprobe-static'] }),
  copyFile('src/ui/index.html', 'app/index.html'),
  copyFile('src/ui/styles.css', 'app/styles.css')
]);
