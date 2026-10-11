import { RenderError } from './recipe';

const vertex = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec3 glyph;
layout(location=2) in vec4 ink;
uniform vec2 viewportScale;
uniform vec2 slotSize;
uniform float columns;
out vec2 uv;
out vec4 tint;
void main() {
  vec2 location = glyph.xy + corner * slotSize;
  gl_Position = vec4(location * viewportScale + vec2(-1., 1.), 0., 1.);
  vec2 slot = vec2(mod(glyph.z, columns), floor(glyph.z / columns));
  uv = (slot + corner) * slotSize / 2048.;
  tint = ink;
}`;
const fragment = `#version 300 es
precision mediump float;
uniform sampler2D atlas;
in vec2 uv;
in vec4 tint;
out vec4 pixel;
void main() {
  float opacity = texture(atlas, uv).a * tint.a;
  pixel = vec4(tint.rgb * opacity, opacity);
}`;

export class GlyphBatch {
  private canvas = document.createElement('canvas');
  private atlas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private texture: WebGLTexture;
  private slots = new Map<string, number>();
  private font = -1;
  private slotW = 0;
  private slotH = 0;
  private columns = 0;
  private capacity = 0;
  private count = 0;
  private dirty = true;
  private data = new Float32Array(4096 * 7);

  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new RenderError('WEBGL_UNAVAILABLE', 'WebGL 2 is required for reference glyph rendering.');
    this.gl = gl; this.atlas.width = this.atlas.height = 2048;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
        throw new RenderError('SHADER_COMPILE_FAILED', reason || 'Glyph shader failed.');
      }
      return shader;
    };
    const a = compile(gl.VERTEX_SHADER, vertex), b = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram()!; gl.attachShader(program, a); gl.attachShader(program, b); gl.linkProgram(program);
    gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new RenderError('SHADER_LINK_FAILED', gl.getProgramInfoLog(program) || 'Glyph shader link failed.');
    this.program = program; this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12); gl.vertexAttribDivisor(2, 1);
    this.texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  begin(width: number, height: number, font: number) {
    if (this.gl.isContextLost()) throw new RenderError('WEBGL_CONTEXT_LOST', 'The glyph rendering context was lost. Restart LocalAscii.');
    this.canvas.width = width; this.canvas.height = height;
    if (font !== this.font) {
      this.font = font; this.slotW = Math.ceil(font * 1.1) + 4; this.slotH = Math.ceil(font * 1.3) + 4;
      this.columns = Math.floor(2048 / this.slotW); this.capacity = this.columns * Math.floor(2048 / this.slotH);
      this.slots.clear(); const ctx = this.atlas.getContext('2d')!; ctx.clearRect(0, 0, 2048, 2048);
      ctx.font = `${font}px "Courier New", Courier, monospace`; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffff'; this.dirty = true;
    }
    this.count = 0;
  }

  push(glyph: string, x: number, y: number, rgb: number[], opacity: number) {
    if (opacity <= 0) return;
    let slot = this.slots.get(glyph);
    if (slot === undefined) {
      if (this.slots.size >= this.capacity) throw new RenderError('GLYPH_ATLAS_FULL', 'Too many glyphs at this font size. Reduce fontSize.');
      slot = this.slots.size; this.slots.set(glyph, slot);
      this.atlas.getContext('2d')!.fillText(glyph, slot % this.columns * this.slotW + 2,
        Math.floor(slot / this.columns) * this.slotH + 2); this.dirty = true;
    }
    if ((this.count + 1) * 7 > this.data.length) { const bigger = new Float32Array(this.data.length * 2); bigger.set(this.data); this.data = bigger; }
    this.data.set([x - 2, y - 2, slot, ...rgb.map(v => Math.max(0, Math.min(1, v / 255))), Math.min(1, opacity)], this.count++ * 7);
  }

  flush(ctx: CanvasRenderingContext2D) {
    if (!this.count) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.dirty) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas); this.dirty = false; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * 7), gl.DYNAMIC_DRAW);
    gl.uniform2f(gl.getUniformLocation(this.program, 'viewportScale'), 2 / this.canvas.width, -2 / this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.program, 'slotSize'), this.slotW, this.slotH);
    gl.uniform1f(gl.getUniformLocation(this.program, 'columns'), this.columns);
    gl.uniform1i(gl.getUniformLocation(this.program, 'atlas'), 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count); ctx.drawImage(this.canvas, 0, 0);
  }
}
