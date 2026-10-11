import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchApp, fixture } from './helpers.mjs';
import { distortionAmountLimits, implementedProModes, catalog } from '../app/recipe.mjs';

test('MCP accepts images, exposes strict parameters and matches desktop output', { timeout: 60_000 }, async () => {
  const { app, page } = await launchApp();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['scripts/launch.cjs', '--mcp'], cwd: process.cwd(), env, stderr: 'pipe' });
  const client = new Client({ name: 'localascii-test', version: '1.0.0' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  try {
    const connecting = client.connect(transport);
    transport.stderr?.on('data', chunk => { stderr += chunk; });
    await connecting;
    const tools = await client.listTools(); assert.equal(tools.tools.length, 3);
    const renderTool = tools.tools.find(tool => tool.name === 'render_image');
    assert.equal(renderTool.inputSchema.additionalProperties, false);
    const variants = renderTool.inputSchema.properties.recipe.anyOf;
    assert(variants.every(recipe => recipe.additionalProperties === false));
    assert.equal(variants[0].properties.coverage.maximum, 100);
    for (const [mode, [min, max]] of Object.entries(distortionAmountLimits)) {
      const variant = variants.find(recipe => recipe.properties.renderMode.const === mode);
      assert.equal(variant.properties.distortAmount.minimum, min);
      assert.equal(variant.properties.distortAmount.maximum, max);
    }
    const inventory = await client.callTool({ name: 'list_filters', arguments: {} });
    assert.equal(JSON.parse(inventory.content[0].text).catalog.length, 100);
    const image = await fixture(page), recipe = { renderMode: 'dots', fontSize: 8, bgMode: 'solid', coverage: 70 };
    const desktop = await page.evaluate(request => window.localAscii.render(request), { image, recipe, scale: 1 });
    const response = await client.callTool({ name: 'render_image', arguments: { image, recipe } });
    assert(!response.isError); const png = response.content.find(item => item.type === 'image');
    assert.equal(`data:image/png;base64,${png.data}`, desktop.value.image);
    const gpuRecipe = { renderMode: 'twirl', distortAmount: -140, distortRadius: 130, distortCenterX: 40 };
    const gpuDesktop = await page.evaluate(request => window.localAscii.render(request), { image, recipe: gpuRecipe, scale: 1 });
    const gpuMcp = await client.callTool({ name: 'render_image', arguments: { image, recipe: gpuRecipe } });
    assert(!gpuMcp.isError); assert(gpuDesktop.ok);
    assert.equal(`data:image/png;base64,${gpuMcp.content.find(item => item.type === 'image').data}`, gpuDesktop.value.image);
    const colorRecipe = { renderMode: 'duotone', duoContrast: 160, coverage: 40, duoShadow: '#102040' };
    const colorDesktop = await page.evaluate(request => window.localAscii.render(request), { image, recipe: colorRecipe, scale: 1 });
    const colorMcp = await client.callTool({ name: 'render_image', arguments: { image, recipe: colorRecipe } });
    assert(!colorMcp.isError); assert(colorDesktop.ok);
    assert.equal(`data:image/png;base64,${colorMcp.content.find(item => item.type === 'image').data}`, colorDesktop.value.image);
    const recipes = [ ...implementedProModes.map(renderMode => ({ renderMode, contrast: 35 })),
      ...catalog.filter(item => item.mode === 'liquidglass').map(item => ({ renderMode: item.mode, contrast: 35, ...item.set })) ];
    for (const recipe of recipes) {
      const renderMode = recipe.renderMode + (recipe.glassStyle ? `:${recipe.glassStyle}` : '');
      const desktop = await page.evaluate(request => window.localAscii.render(request), { image, recipe, scale: 1 });
      const mcp = await client.callTool({ name: 'render_image', arguments: { image, recipe } });
      assert(desktop.ok, `${renderMode}: ${desktop.error?.message}`);
      assert(!mcp.isError, `${renderMode}: ${JSON.stringify(mcp.content)}`);
      assert.equal(`data:image/png;base64,${mcp.content.find(item => item.type === 'image').data}`,
        desktop.value.image, `${renderMode}: desktop/MCP mismatch`);
    }
    for (const args of [ { image, recipe: { renderMode: 'not-a-mode' } }, { image, recipe: { coverage: 101 } },
      { image, recipe: { typo: 1 } }, { image, inputPath: 'C:/invalid.png' }, { image: 'broken' },
      { image: 'https://www.ascii-magic.com/input.png' }, { image, recipe: { renderMode: 'pinch', distortAmount: 200 } },
      { image, recipe: { renderMode: 'ripple', distortAmount: -1 } } ]) {
      const invalid = await client.callTool({ name: 'render_image', arguments: args }); assert.equal(invalid.isError, true);
    }
  } catch (error) { error.message += `\nWorker stderr: ${stderr}`; throw error; }
  finally { await client.close(); await app.close(); }
});
