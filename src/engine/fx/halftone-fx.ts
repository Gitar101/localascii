import { Recipe } from '../recipe';
import { contrastFactor, hexRgb } from './context';
import { spatialCoverage } from './coverage-fx';

export const halftoneFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uScreen;
uniform vec4 uPrint;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uTone;
out vec4 outColor;
${spatialCoverage}
vec3 picture(vec2 uv) {
  vec3 c=clamp((texture(uSrc,clamp(uv,0.,1.)).rgb-.501961)*uTone.x+.501961+uTone.y,0.,1.);
  return uTone.z>.5?1.-c:c;
}
vec3 cellColor(vec2 center) {
  vec2 uv=center/uRes,o=vec2(uScreen.x*.25)/uRes;
  return picture(uv)*.4+(picture(uv+o)+picture(uv-o)+picture(uv+vec2(o.x,-o.y))+picture(uv+vec2(-o.x,o.y)))*.15;
}
vec2 rotatePoint(vec2 p,float a) { float c=cos(a),s=sin(a); return vec2(c*p.x-s*p.y,s*p.x+c*p.y); }
float rectangle(vec2 p,vec2 size) { vec2 q=abs(p)-size; return length(max(q,0.))+min(max(q.x,q.y),0.); }
float triangle(vec2 p) {
  float k=1.7320508; p.x=abs(p.x)-1.; p.y+=1./k;
  if(p.x+k*p.y>0.) p=vec2(p.x-k*p.y,-k*p.x-p.y)*.5;
  p.x-=clamp(p.x,-2.,0.); return -length(p)*sign(p.y);
}
float plusSign(vec2 p,float width) { return min(rectangle(p,vec2(1,width)),rectangle(p,vec2(width,1))); }
float star(vec2 p,float points,float inner) {
  float a=3.14159265/points,b=3.14159265/inner;
  vec2 outer=vec2(cos(a),sin(a)),edge=vec2(cos(b),sin(b));
  float angle=mod(atan(p.x,p.y),2.*a)-a;
  vec2 q=length(p)*vec2(cos(angle),abs(sin(angle)))-outer;
  q+=edge*clamp(-dot(q,edge),0.,outer.y/edge.y);
  return length(q)*sign(q.x);
}
float shapeDistance(vec2 p,int shape) {
  if(shape==0) return length(p)-1.;
  if(shape==1) return length(p*vec2(1,1.55))-1.;
  if(shape==2) return rectangle(p,vec2(.88));
  if(shape==3) return (abs(p.x)+abs(p.y)-1.)*.70710678;
  if(shape==4) return triangle(p*.9);
  if(shape==5) return abs(length(p)-.72)-.28;
  if(shape==6) return plusSign(p,.34);
  if(shape==7) return plusSign(rotatePoint(p,.78539816339),.3);
  if(shape==8) { float a=atan(p.x,p.y),stepAngle=6.28318530718/6.; return (cos(floor(.5+a/stepAngle)*stepAngle-a)*length(p)-1.)*.86; }
  if(shape==9) return star(p,5.,2.4);
  if(shape==10) return star(p,4.,2.);
  if(shape==11) {
    vec2 q=vec2(abs(p.x),p.y)*.587+vec2(0,.5518); float d;
    if(q.y+q.x>1.) d=length(q-vec2(.25,.75))-.35355339;
    else { vec2 a=q-vec2(0,1),b=q-.5*max(q.x+q.y,0.); d=sqrt(min(dot(a,a),dot(b,b)))*sign(q.x-q.y); }
    return d/.587;
  }
  if(shape==12) return length(p)-mix(.18,1.,pow(abs(cos(2.*atan(p.y,p.x))),.9));
  return rectangle(p,vec2(1,.34));
}
float textureThreshold(vec2 p,int pattern) {
  vec2 q=fract(p/uScreen.x)-.5;
  float parity=mod(floor(p.x/uScreen.x)+floor(p.y/uScreen.x),2.);
  if(pattern==1) { float square=max(abs(q.x),abs(q.y))*2.; return parity<.5?square:1.-square; }
  if(pattern==2) return abs(q.x)*2.;
  if(pattern==3) return abs(q.y)*2.;
  float a=abs(fract((p.x+p.y)/uScreen.x)-.5)*2.;
  if(pattern==4) return a;
  if(pattern==5) return min(a,abs(fract((p.x-p.y)/uScreen.x)-.5)*2.);
  if(pattern==6) return 1.-max(abs(q.x),abs(q.y))*2.;
  if(pattern==7) return 1.-max(abs(fract(p.x/uScreen.x+mod(floor(p.y/uScreen.x),2.)*.5)-.5),abs(q.y))*2.;
  if(pattern==8) return clamp(triangle(q*1.7)*.7+.5,0.,1.);
  if(pattern==9) return max(abs(q.y)*2.6,abs(fract(p.x/uScreen.x)-.5)*2.-.35);
  if(pattern==10) return abs(fract(length(q)*4.)-.5)*2.;
  return clamp(plusSign(q*2.,.34)*.9+.5,0.,1.);
}
float cellGate(vec2 cell,vec2 center,float luma) {
  float tie=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
  return step(.5,spatialGate(clamp(center/uRes,0.,1.),clamp(luma+(tie-.5)*.16,0.,1.)));
}
vec3 inkColor(vec3 c,float luma) { return uPrint.w>.5?clamp(mix(vec3(luma),c,1.25),0.,1.)*(.5+.5*smoothstep(0.,.9,luma)):uInk; }
void main() {
  vec2 px=gl_FragCoord.xy,center=uRes*.5;
  vec2 grid=rotatePoint(px-center,uScreen.w)+center;
  vec3 src=picture(px/uRes),ghost=uPrint.w>.5?src:vec3(dot(src,vec3(.299,.587,.114)));
  vec3 paper=uPaper*(.97+.03*ghost),base=mix(src,paper,uCovSub);
  int pattern=int(uScreen.y+.5),shape=int(uScreen.z+.5);
  vec2 cell=floor(grid/uScreen.x),gc=(cell+.5)*uScreen.x;
  vec2 at=rotatePoint(gc-center,-uScreen.w)+center;
  vec3 c=cellColor(at); float luma=dot(c,vec3(.299,.587,.114)),gate=cellGate(cell,at,luma);
  if(pattern>0) {
    float amount=clamp(pow(1.-luma,uPrint.x)*100./85.+uPrint.y,0.,1.),aa=mix(.16,.02,uPrint.z);
    float alpha=1.-smoothstep(amount-aa,amount+aa,textureThreshold(grid,pattern));
    outColor=vec4(mix(base,inkColor(c,luma),alpha*gate),1); return;
  }
  const float compensation[14]=float[14](1.,1.12,.92,1.14,1.28,1.35,1.2,1.2,.92,1.34,1.4,1.10,1.24,1.1);
  float bestAlpha=0.; vec3 bestInk=uInk;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 index=cell+vec2(x,y),gridCenter=(index+.5)*uScreen.x;
    vec2 imageCenter=rotatePoint(gridCenter-center,-uScreen.w)+center;
    if(imageCenter.x<-uScreen.x || imageCenter.y<-uScreen.x || imageCenter.x>uRes.x+uScreen.x || imageCenter.y>uRes.y+uScreen.x) continue;
    vec3 rgb=cellColor(imageCenter); float l=dot(rgb,vec3(.299,.587,.114));
    if(cellGate(index,imageCenter,l)<.5) continue;
    float amount=clamp(pow(1.-l,uPrint.x)*100./85.+uPrint.y,0.,1.);
    if(amount<.004) continue;
    float radius=sqrt(amount)*.5*uScreen.x*1.32*compensation[shape]; if(radius<.35) continue;
    float aa=mix(2.4,.7,uPrint.z)/radius;
    float alpha=1.-smoothstep(-aa,aa,shapeDistance((grid-gridCenter)/radius,shape));
    if(alpha>bestAlpha) { bestAlpha=alpha; bestInk=inkColor(rgb,l); }
  }
  outColor=vec4(mix(base,bestInk,bestAlpha*gate),1);
}`;

const textures: Record<string, number> = { dots: 0, checker: 1, stripesV: 2, stripesH: 3, diagonal: 4,
  crosshatch: 5, grid: 6, brick: 7, triangle: 8, dash: 9, rings: 10, plus: 11 };
const shapes: Record<string, number> = { circle: 0, ellipse: 1, square: 2, diamond: 3, triangle: 4, ring: 5,
  plus: 6, xmark: 7, hexagon: 8, star5: 9, sparkle4: 10, heart: 11, petal: 12, dash: 13 };
export function halftoneUniforms(r: Recipe, scale: number) {
  return {
    uScreen: [Math.max(4, 1.5 * r.fontSize * scale), textures[r.htTexture], shapes[r.htShape], r.htAngle * Math.PI / 180],
    uPrint: [.55 + 1.6500000000000001 * r.htContrast / 100, .6 * r.htSpread / 100, r.htSharpness / 100, Number(r.htColorMode === 'color')],
    uInk: hexRgb(r.htInk).map(c => c / 255), uPaper: hexRgb(r.htPaper).map(c => c / 255),
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert)]
  };
}
