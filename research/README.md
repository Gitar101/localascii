# ASCII Magic Reference

Observed on 2026-10-09 at https://www.ascii-magic.com/app.

This directory records public client behavior for an independent local implementation.
It does not contain a working renderer or MCP server.

## Inventory

1. 90 main style entries.
2. 10 additional glass variant entries.
3. 100 selectable style entries in total.
4. 91 distinct render mode IDs, because all glass variants use `liquidglass`.
5. 650 recipe keys, each with an exported default.
6. 28 post effect definitions.
7. 15 publicly advertised dither algorithms.
8. 15 built in palette choices, including `original`.
9. 17 character presets.
10. 10 style categories.

`catalog.json` contains the observed style metadata, glass variant settings,
recipe keys, recipe defaults, post effect defaults, dither data, and character presets.
`source-index.json` records renderer and pipeline symbol locations in formatted public chunks.

Unicode in the catalog is intentional: character ramps must retain their exact glyphs.

## Retrieval

The initial HTML references public Next.js JavaScript chunks. Following their public
chunk references retrieved 100 JavaScript files, including lazy effect modules.
These files were formatted with Prettier in a temporary research cache:

`C:/Users/user/AppData/Local/Temp/opencode/localascii-upstream`

The cache contains `app.html`, formatted chunks, and extracted JSON. It is outside
the project and may be removed by normal temporary file cleanup. Source index line
numbers refer to that formatted cache, not the original minified responses.

Catalog and recipe data were extracted from pure module definitions in a restricted
Node VM. Renderers, account code, and entitlement overrides were not executed.

The initial session browser tool failed before navigating with `Bun is not defined`.
Later sessions connected Playwriter and performed development comparisons. Those
checks did not establish exact visual parity; see the project root README for
current implementation status.

## Source Locations

1. `05-df7jnp0_tj.js`: module `11737`, style categories, main styles, glass variants, and picker metadata.
2. `17_0dewacgpz9.js`: module `61008`, recipe defaults, recipe keys, and post effect defaults.
3. `0zup-hnozfsdf.js`: frame processing, base character renderer, ASCII Studio, dither engine, backdrop, animation helpers, and final tone operations.
4. `3oegay3tctwga.js`: post processing, bitmap forensic glyphs, renderer registry, sampling, and shared effects.
5. `2itprvgt070hj.js`: replacement renderer registrations and several effect implementations.
6. `2d-1l54v26p8c.js`: many replacement effect implementations and WebGL shaders.
7. `1vg36pmkpp1ou.js`: controls, character presets, parameter options, and UI ranges.
8. `2l9zpxby2cme3.js`: the browser automation API exposed as `window.__AM`.

## Render Behavior

The renderer uses Canvas 2D and WebGL. The base character renderer sets the font to
Courier New, Courier, then monospace. A text cell is `0.6 * fontSize` wide and
`fontSize` high. The source luminance formula is `0.299 * R + 0.587 * G + 0.114 * B`.

Preview fitting uses a pixel budget of 2,300,000 on desktop and 1,200,000 on phone.
Export scale is resolved separately. Video sampling can reduce the source to a cell
grid, while static image sampling uses the full processed source.

Three major render paths are visible: dither, registered replacement effects, and
the base cell renderer. Schematic also has a dedicated branch. These paths do not
apply every operation identically. Preserve branch ordering during implementation.

Backdrop painting precedes rendering. Coverage reveal, overlay tint, grayscale,
mask composition, post processing, animation helpers, tone operations, and the
text layer are additional stages. Levels, curves, gradient mapping, saturation,
hue, and vibrance belong to the final tone stage. Character bloom and character
chroma are applied while drawing glyphs, rather than as ordinary full frame effects.

`observedPostFxOrder` in the catalog is the first occurrence order of the full frame
post effect calls in the public implementation. It excludes glyph specific effects.
It is an observation, not a universal order for all render paths.

## Naming Differences

1. The catalog labels mode `ripple` as ZigZag and mode `zigzag` as Ripple.
2. Glass Ripple is a separate selectable entry, `glass-ripple`, using mode `liquidglass` and `glassStyle: ripple`.
3. Cyanotype uses the mode ID `blueprint`.
4. Kaleidoscope uses `starburst`.
5. CMYK Drops uses `halftonecmyk`.
6. Aberration uses `lens`.
7. Voxel uses `3d`.

Use stable IDs and preserve the observed display names explicitly. Do not silently
correct the source labels or collapse glass variants into unrelated effects.

## Dither Details

Advertised algorithms are `bayer2`, `bayer4`, `bayer8`, `bayer16`, `halftone`,
`radial`, `linesH`, `linesV`, `linesD`, `whiteNoise`, `blueNoise`, `floyd`,
`atkinson`, `stucki`, and `sierraLite`.

The engine also defines diffusion kernels for `sierra`, `sierraTwo`, `burkes`, and
`jjn`. Their presence does not make them advertised UI capabilities. The snapshot
retains all eight observed diffusion kernels separately from the advertised list.

Palette selection uses squared Euclidean RGB distance. `original` is represented
as null in the palette table. A custom palette path also exists, but it is not an
entry in the exported built in palette names. Preserve that distinction.

## Automation Reference

`window.__AM` exposes `version`, `ready`, `capabilities`, `setSource`, `applyRecipe`,
`processFrame`, `renderPNG`, `renderOnce`, `suggest`, `serializeRecipe`, `parseRecipe`,
and `state`.

`renderOnce` accepts an image and optional recipe, enhancement, variant, time,
scale, minimum long edge, automatic levels, and recipe embedding options.
PNG rendering returns image data, dimensions, serialized recipe, and actual mode.
The hosted app can report gated modes and effects. This API is a schema reference,
not a dependency for our local implementation.

The generative tab uses a remote service. Optional depth estimation uses
`onnx-community/depth-anything-v2-small`. Neither is necessary for basic image
filter rendering. Their support and model distribution need a separate scope decision.

## Suggested Direction

A TypeScript engine shared by a local browser editor and a stdio MCP adapter is
the recommended direction. Canvas and WebGL keep the same rendering primitives.
A local headless Chromium worker could render images for MCP requests without
uploading user files. This shared desktop/MCP design was subsequently approved
and implemented; runtime never calls the hosted app.

A native CPU implementation would reduce browser dependencies but needs more work
to match glass and light shaders. Driving the hosted site would be faster to wire
up but would retain network and account dependencies, so it does not meet the local goal.

## Verification Gaps

CRITICAL: Full reference coverage and visual parity remain incomplete. A local
renderer and MCP exist with 76 wired render IDs covering 85 catalog entries,
including all ten glass presets. The inventory is not filter support.

MEDIUM: Visual parity, parameter ranges, complete enum choices, animation behavior,
export limits, and per effect parameter relevance still need validation.

LOW: Chunk names are deployment specific. The source index is a dated observation.

Future tests should exercise every selectable style, boundary dimensions,
transparent inputs, dark and bright inputs, seeded noise, invalid recipes,
unavailable WebGL, and MCP tool calls. Unsupported options must return clear errors,
not silently render a different effect.
