import { RenderError } from './recipe';

export type TexturePlane = { width: number; height: number; data: Float32Array; linear?: boolean };

const vertex = `#version 300 es
void main() {
  vec2 corners[3] = vec2[3](vec2(-1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

export class GpuPass {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms = new Map<string, { location: WebGLUniformLocation; type: number }>();
  private lost = false;
  private readonly planes = new Map<string, { texture: WebGLTexture; data: TexturePlane | null }>();

  constructor(fragment: string, private readonly options: {
    sourceUniform?: string; sizeUniform?: string; flipY?: boolean; linear?: boolean; mipmaps?: boolean
  } = {}) {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false,
      depth: false, stencil: false, premultipliedAlpha: false });
    if (!gl) throw new RenderError('WEBGL_UNAVAILABLE', 'This filter requires WebGL 2. Check your GPU driver.');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    const shaders = [this.compile(gl.VERTEX_SHADER, vertex), this.compile(gl.FRAGMENT_SHADER, fragment)];
    const program = gl.createProgram();
    if (!program) throw new RenderError('GPU_ALLOCATION_FAILED', 'Could not allocate a shader program.');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'Shader linking failed.';
      gl.deleteProgram(program); throw new RenderError('SHADER_LINK_FAILED', message);
    }
    this.program = program;
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
      const info = gl.getActiveUniform(program, index)!;
      const location = gl.getUniformLocation(program, info.name);
      if (location !== null) this.uniforms.set(info.name, { location, type: info.type });
    }
    const texture = gl.createTexture(), vao = gl.createVertexArray();
    if (!texture || !vao) throw new RenderError('GPU_ALLOCATION_FAILED', 'Could not allocate GPU resources.');
    this.texture = texture; this.vao = vao;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : options.linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private compile(type: number, source: string) {
    const gl = this.gl, shader = gl.createShader(type);
    if (!shader) throw new RenderError('GPU_ALLOCATION_FAILED', 'Could not allocate a shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
      gl.deleteShader(shader); throw new RenderError('SHADER_COMPILE_FAILED', message);
    }
    return shader;
  }

  draw(source: TexImageSource, width: number, height: number,
    values: Record<string, number | number[]>, planes: Record<string, TexturePlane> = {}) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) throw new RenderError('WEBGL_CONTEXT_LOST', 'GPU context was lost. Restart the renderer.');
    if (Math.max(width, height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      throw new RenderError('GPU_SIZE_LIMIT', 'Image dimensions exceed this GPU texture limit. Reduce the output scale.');
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      throw new RenderError('GPU_ALLOCATION_FAILED', 'GPU could not allocate the requested output size.');
    }
    gl.viewport(0, 0, width, height); gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.options.flipY ?? false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (this.options.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    const samplers: Record<string, number> = {};
    let unit = 1;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const [name, plane] of Object.entries(planes)) {
      let resource = this.planes.get(name);
      if (!resource) {
        const texture = gl.createTexture();
        if (!texture) throw new RenderError('GPU_ALLOCATION_FAILED', 'Could not allocate an analysis texture.');
        resource = { texture, data: null }; this.planes.set(name, resource);
      }
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      if (resource.data !== plane) {
        if (plane.linear && !gl.getExtension('OES_texture_float_linear')) {
          throw new RenderError('WEBGL_UNAVAILABLE', 'This filter requires linear float texture sampling. Check your GPU driver.');
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, plane.linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, plane.linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, plane.width, plane.height, 0, gl.RED, gl.FLOAT, plane.data);
        resource.data = plane;
      }
      samplers[name] = unit++;
    }
    for (const [name, value] of Object.entries({
      [this.options.sourceUniform ?? 'uSource']: 0,
      [this.options.sizeUniform ?? 'uSize']: [width, height], ...samplers, ...values })) {
      const uniform = this.uniforms.get(name);
      if (!uniform) throw new RenderError('GPU_UNIFORM_INVALID', `Shader does not expose ${name}.`);
      if (typeof value === 'number') {
        if (uniform.type === gl.INT || uniform.type === gl.BOOL || uniform.type === gl.SAMPLER_2D) gl.uniform1i(uniform.location, value);
        else gl.uniform1f(uniform.location, value);
      } else if (value.length === 2) gl.uniform2fv(uniform.location, value);
      else if (value.length === 3) gl.uniform3fv(uniform.location, value);
      else if (value.length === 4) gl.uniform4fv(uniform.location, value);
      else throw new RenderError('GPU_UNIFORM_INVALID', `Invalid vector length for ${name}.`);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new RenderError('GPU_RENDER_FAILED', `WebGL error ${error}.`);
    return this.canvas;
  }

  dispose() {
    const gl = this.gl;
    for (const { texture } of this.planes.values()) gl.deleteTexture(texture);
    this.planes.clear();
    gl.deleteTexture(this.texture); gl.deleteVertexArray(this.vao); gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.lost = true;
  }
}
