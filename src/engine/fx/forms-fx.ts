import { Recipe } from '../recipe';
import { contrastFactor } from './context';
import { spatialCoverage } from './coverage-fx';

export const formsFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uForms;
uniform vec4 uWeights;
uniform vec3 uTone;
uniform vec3 uCursor;
uniform float uSeed;
out vec4 outColor;
${spatialCoverage}
float randomValue(vec2 p) { p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 picture(vec2 uv) {
  vec3 c=clamp((texture(uSrc,clamp(uv,0.,1.)).rgb-.501961)*uTone.x+.501961+uTone.y,0.,1.);
  return uTone.z>.5?1.-c:c;
}
vec3 stampColor(vec2 center) {
  vec2 uv=center/uRes,o=vec2(uForms.x*.25)/uRes;
  return picture(uv)*.4+(picture(uv+o)+picture(uv-o)+picture(uv+vec2(o.x,-o.y))+picture(uv+vec2(-o.x,o.y)))*.15;
}
float triangle(vec2 p) {
  float k=1.7320508; p.x=abs(p.x)-1.; p.y+=1./k;
  if(p.x+k*p.y>0.) p=vec2(p.x-k*p.y,-k*p.x-p.y)*.5;
  p.x-=clamp(p.x,-2.,0.); return -length(p)*sign(p.y);
}
float stampAlpha(vec2 p,float aa) {
  int shape=int(uForms.y+.5); float radius=uWeights.x,d;
  if(shape==0) return 1.-smoothstep(mix(.05,.8,radius),1.,length(p));
  if(shape==1) d=length(p)-1.;
  else if(shape==2) {
    vec2 q=p*1.05+vec2(0,-.05); q.x=abs(q.x);
    d=min(length(q-vec2(.5,.35))-.55,max(q.y-.35,dot(q-vec2(1.05,.35),vec2(.78933,-.61393))))/1.05;
  } else if(shape==3) d=triangle(p*.9);
  else if(shape==4) d=max(abs(p.y)-1.,abs(p.x)-mix(mix(.12,.85,radius),1.,abs(p.y)));
  else if(shape==5) { float hole=mix(.35,.72,radius); d=abs(length(p)-(1.+hole)*.5)-(1.-hole)*.5; }
  else { float lobe=pow(abs(cos(.5*uWeights.y*atan(p.y,p.x))),mix(3.2,.65,radius)); d=length(p)-max(.2,mix(.16,1.,lobe)); }
  return 1.-smoothstep(-aa,aa,d);
}
void main() {
  vec2 px=gl_FragCoord.xy,uv=px/uRes,cell=floor(px/uForms.x);
  int shape=int(uForms.y+.5);
  float compensation=shape==0?1.12:shape==2?1.15:shape==3?1.3:shape==4?1.2:shape==5?1.12:shape==6?1.28:1.;
  float bestAlpha=0.; vec3 bestInk=vec3(0);
  float sigma=min(uRes.x,uRes.y)*.16;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 c=cell+vec2(x,y),center=(c+.5)*uForms.x;
    if(center.x<-uForms.x || center.y<-uForms.x || center.x>uRes.x+uForms.x || center.y>uRes.y+uForms.x) continue;
    vec3 rgb=stampColor(center); float luma=dot(rgb,vec3(.299,.587,.114));
    float tone=mix(.62,pow(luma,mix(1.,2.,uForms.z))*100./85.,uForms.z);
    if(tone<.03) continue; tone=min(1.,tone);
    vec2 distance=center-uCursor.xy;
    float swell=exp(-dot(distance,distance)/(2.*sigma*sigma))*uCursor.z;
    float jitter=mix(1.,.3+1.5*randomValue(c*1.37+vec2(uSeed*13.7,uSeed*7.31)),uWeights.w);
    float radius=.5*uForms.x*uForms.w*compensation*(.24+.76*tone)*jitter*(1.+.9*swell);
    if(radius<.35) continue;
    float a=(randomValue(c+.7)-.5)*1.4+swell*1.1;
    vec2 delta=px-center,q=vec2(delta.x*cos(a)-delta.y*sin(a),delta.x*sin(a)+delta.y*cos(a))/radius;
    float alpha=stampAlpha(q,1.4/radius);
    if(alpha<=bestAlpha) continue;
    bestAlpha=alpha;
    bestInk=uWeights.z>.5?clamp(mix(vec3(luma),rgb,1.35),0.,1.)*(.35+.65*smoothstep(0.,.85,luma))+.04:
      vec3(.95,.93,.88)*(.3+.7*luma);
  }
  vec3 original=picture(uv);
  float gate=spatialGate(uv,dot(original,vec3(.299,.587,.114)));
  vec3 base=mix(original,vec3(.028,.028,.032),gate*uCovSub);
  outColor=vec4(mix(base,bestInk,bestAlpha*gate),1);
}`;

const forms: Record<string, number> = { soft: 0, dot: 1, heart: 2, triangle: 3, hourglass: 4, ring: 5, flower: 6 };
export function formsUniforms(r: Recipe, w: number, h: number, scale: number) {
  return {
    uForms: [Math.max(6, 1.6 * r.fontSize * scale), forms[r.formShape], r.formPower / 100, Math.max(.05, r.formScale / 100)],
    uWeights: [r.formRadius / 100, r.formRays, Number(r.grayscale < 100), r.formJitter / 100],
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert)],
    uCursor: [r.formOriginX / 100 * w, (1 - r.formOriginY / 100) * h, Number(r.formMouse)],
    uSeed: r.formSeed
  };
}
