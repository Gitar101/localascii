import { Recipe, RenderError } from '../recipe';
import { TexturePlane } from '../gpu';
import { clamp01, contrastFactor, sampleFrame, smooth } from './context';

export const vitrineFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uPaneMask;
uniform vec2 uRes;
uniform vec2 uGrid;
uniform vec4 uOptics;
uniform vec4 uSurface;
uniform vec3 uTone;
out vec4 outColor;
float randomValue(vec2 p) { p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 randomPair(vec2 p) {
  vec3 v=fract(p.xyx*vec3(.1031,.1030,.0973)); v+=dot(v,v.yzx+33.33); return fract((v.xx+v.yz)*v.zy);
}
float noise(vec2 p) {
  vec2 c=floor(p),t=fract(p); t=t*t*(3.-2.*t);
  return mix(mix(randomValue(c),randomValue(c+vec2(1,0)),t.x),
    mix(randomValue(c+vec2(0,1)),randomValue(c+1.),t.x),t.y);
}
float flowField(vec2 p) {
  float sum=0.,weight=.5;
  for(int i=0;i<4;i++) { sum+=weight*noise(p); p=p*2.03+vec2(19.1,47.3); weight*=.5; }
  return sum;
}
vec3 picture(vec2 uv) {
  vec3 c=clamp((texture(uSrc,clamp(uv,0.,1.)).rgb-.501961)*uTone.x+.501961+uTone.y,0.,1.);
  return uTone.z>.5?1.-c:c;
}
float paneHeight(vec2 uv,vec2 aspect) {
  float x=fract(uv.x*aspect.x*uOptics.x)*2.-1.;
  return sqrt(max(0.,1.-x*x))*.55+flowField(uv*aspect*uSurface.x)*.9;
}
vec3 splitSample(vec2 uv,vec2 split) { return vec3(picture(uv+split).r,picture(uv).g,picture(uv-split).b); }
void main() {
  vec2 uv=gl_FragCoord.xy/uRes,aspect=vec2(uRes.x/uRes.y,1.);
  vec2 grid=uv*aspect*uOptics.x,cell=floor(grid),local=fract(grid);
  float fitted=texture(uPaneMask,(cell+.5)/uGrid).r;
  vec3 plain=picture(uv);
  if(fitted<.5) { outColor=vec4(plain,1); return; }
  vec2 domain=uv*aspect*uSurface.x;
  vec2 current=vec2(flowField(domain)-.5,(flowField(domain*1.7+vec2(5.2,1.3))-.5)*.30)*uOptics.w*.10;
  float x=local.x*2.-1.,bend=x*sqrt(max(0.,1.-x*x));
  vec2 refracted=vec2(bend*uOptics.z*.05,0)+(randomPair(cell)-.5)*uOptics.z*.018;
  vec2 at=uv+current+refracted;
  vec2 chroma=normalize(current+refracted+1e-5)*(uOptics.z*.004+uOptics.w*.002);
  vec3 color=splitSample(at,chroma);
  vec2 edge=min(local,1.-local);
  bool vertical=edge.x<edge.y;
  float t=clamp((vertical?edge.x:edge.y)/mix(.045,.10,uOptics.y),0.,1.);
  float bar=1.-smoothstep(.82,1.,t),dome=sqrt(max(0.,1.-t*t));
  vec2 normal=vertical?vec2((local.x<.5?1.:-1.)*t,0):vec2(0,(local.y<.5?1.:-1.)*t);
  vec3 rod=normalize(vec3(normal*1.6,dome+.05));
  vec3 light=normalize(vec3(uSurface.zw,.7)),halfLight=normalize(light+vec3(0,0,1));
  float sheen=uSurface.y;
  if(bar>.001) {
    vec3 glass=splitSample(at-rod.xy*(.03+uOptics.z*.04),chroma*2.);
    glass=mix(glass,glass*vec3(.88,.94,1.07),.4)*mix(.9,1.05,dome);
    color=mix(color,glass,bar);
    float crown=smoothstep(.5,0.,t);
    color+=vec3(crown*crown*bar*(.35+.6*sheen));
    color+=vec3(pow(max(dot(rod,halfLight),0.),30.)*bar*(.5+.9*sheen));
    color+=vec3(.8,.9,1)*pow(1.-dome,2.)*bar*(.4+.6*sheen);
  }
  vec2 stepSize=1.5/uRes;
  float dx=paneHeight(uv-vec2(stepSize.x,0),aspect)-paneHeight(uv+vec2(stepSize.x,0),aspect);
  float dy=paneHeight(uv-vec2(0,stepSize.y),aspect)-paneHeight(uv+vec2(0,stepSize.y),aspect);
  vec3 n=normalize(vec3(dx*3.,dy*3.,1));
  color+=vec3(pow(max(dot(n,halfLight),0.),mix(12.,80.,sheen))*(.5+.9*sheen));
  float gleam=.5+.5*sin(dot(uv-.5,uSurface.zw)*4.);
  color+=vec3(.9,.95,1)*gleam*gleam*sheen*.10;
  outColor=vec4(clamp(color,0.,1.),1);
}`;

export function vitrineMask(source: CanvasImageSource, cols: number, rows: number,
  r: Recipe, key: string, amount: number): TexturePlane {
  const total = cols * rows, data = new Float32Array(total);
  if (amount >= 1) { data.fill(1); return { width: cols, height: rows, data }; }
  if (amount <= 0) return { width: cols, height: rows, data };
  const pixels = sampleFrame(source, cols, rows, `vitrine|${key}`);
  if (!pixels) throw new RenderError('IMAGE_SAMPLE_FAILED', 'Could not rank the glass panes.');
  const ranks = new Float32Array(total), histogram = new Uint32Array(1024), factor = contrastFactor(r.contrast);
  for (let i = 0; i < total; i++) {
    let luminance = 0;
    for (let c = 0; c < 3; c++) {
      let value = Math.max(0, Math.min(255, factor * (pixels[4 * i + c] - 128) + 128 + r.brightness * 2.55));
      if (r.invert) value = 255 - value;
      luminance += value / 255 * [.299, .587, .114][c];
    }
    ranks[i] = luminance;
    const draw = 43758.5453 * Math.sin(127.1 * i + 311.7);
    ranks[i] = .8200000000000001 * ranks[i] + .18 * (draw - Math.floor(draw));
    histogram[Math.max(0, Math.min(1023, Math.floor(ranks[i] * 1024)))]++;
  }
  let low = -.02, high = 1.02;
  for (let step = 0; step < 24; step++) {
    const threshold = (low + high) / 2; let covered = 0;
    for (let bin = 0; bin < 1024; bin++) covered += histogram[bin] * smooth(clamp01(((bin + .5) / 1024 - threshold + .02) / .02));
    if (covered > amount * total) low = threshold; else high = threshold;
  }
  const threshold = (low + high) / 2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    data[(rows - 1 - y) * cols + x] = Number(smooth(clamp01((ranks[y * cols + x] - threshold + .02) / .02)) >= .5);
  }
  return { width: cols, height: rows, data };
}

export function vitrineUniforms(r: Recipe) {
  const light = r.vitrineLight * Math.PI / 180;
  return {
    uOptics: [4 + 22 * r.vitrinePanel / 100, r.vitrineSeam / 100, r.vitrineRefract / 100, r.vitrineFlow / 100],
    uSurface: [2 + 7 * r.vitrineViscosity / 100, r.vitrineSheen / 100, Math.cos(light), Math.sin(light)],
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert)]
  };
}
