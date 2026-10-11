import { Recipe } from '../recipe';
import { contrastFactor } from './context';
import { rankFieldGLSL } from './rank-field';

export const blueprintFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uPrint;
uniform vec3 uTone;
uniform vec2 uSampling;
uniform int uTheme;
out vec4 outColor;
${rankFieldGLSL}
const vec3 LUMA = vec3(.299,.587,.114);
float hash(vec2 p) { vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
vec3 source(vec2 uv,float lod) {
  vec3 c=(textureLod(uSrc,uv,lod).rgb-.5)*uTone.x+.5+uTone.y;
  return uTone.z>.5 ? 1.-c:c;
}
float at(float values[25],int x,int y) {return values[(y+2)*5+x+2];}
float blurred(float a[25],int x,int y) {
  return (at(a,x-1,y-1)+2.*at(a,x,y-1)+at(a,x+1,y-1)+2.*at(a,x-1,y)+4.*at(a,x,y)+2.*at(a,x+1,y)+at(a,x-1,y+1)+2.*at(a,x,y+1)+at(a,x+1,y+1))/16.;
}
vec2 gradient(float a[25],int x,int y) {
  return vec2(at(a,x+1,y-1)+2.*at(a,x+1,y)+at(a,x+1,y+1)-at(a,x-1,y-1)-2.*at(a,x-1,y)-at(a,x-1,y+1),
    at(a,x-1,y+1)+2.*at(a,x,y+1)+at(a,x+1,y+1)-at(a,x-1,y-1)-2.*at(a,x,y-1)-at(a,x+1,y-1))*.25;
}
vec2 detect(float a[25]) {
  vec2 g=vec2(blurred(a,1,-1)+2.*blurred(a,1,0)+blurred(a,1,1)-blurred(a,-1,-1)-2.*blurred(a,-1,0)-blurred(a,-1,1),
    blurred(a,-1,1)+2.*blurred(a,0,1)+blurred(a,1,1)-blurred(a,-1,-1)-2.*blurred(a,0,-1)-blurred(a,1,-1))*.25;
  float magnitude=length(g),normalizer=.55+.45*blurred(a,0,0);
  vec2 direction=magnitude>1e-5 ? g/magnitude:vec2(0);
  direction/=max(max(abs(direction.x),abs(direction.y)),1e-5);
  ivec2 d=ivec2(round(clamp(direction,-1.,1.)));
  float ridge=mix(.35,1.,smoothstep(-.02,.015,length(gradient(a,0,0))-max(length(gradient(a,d.x,d.y)),length(gradient(a,-d.x,-d.y)))));
  float neighbor=max(max(length(gradient(a,1,0)),length(gradient(a,-1,0))),max(length(gradient(a,0,1)),length(gradient(a,0,-1))));
  return vec2(magnitude*ridge,neighbor)/normalizer;
}
void main() {
  vec2 uv=gl_FragCoord.xy/uRes, delta=uSampling.y/uRes;
  float fine[25],coarse[25];
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) {
    vec2 offset=vec2(x,y)*delta;
    fine[(y+2)*5+x+2]=clamp(dot(source(uv+offset,uSampling.x),LUMA),0.,1.);
    coarse[(y+2)*5+x+2]=clamp(dot(source(uv+offset*3.,uSampling.x+1.2),LUMA),0.,1.);
  }
  vec2 edges=max(detect(fine),detect(coarse)*.45);
  float threshold=mix(.085,.006,pow(uPrint.x,.6)),width=threshold*.55+.004;
  float line=smoothstep(threshold,threshold+width,edges.x);
  if(uPrint.y>.01) line=mix(line,max(line,smoothstep(threshold,threshold+width,edges.y)),uPrint.y);
  bool photo=uTheme==0;
  vec3 background,ink;
  if(photo) {
    float t=smoothstep(.06,.95,pow(clamp(fine[12],0.,1.),uTone.z>.5?1.:.55));
    t=mix(t,t*t*(3.-2.*t),.5);
    vec3 deep=vec3(.055,.105,.36),mid=vec3(.17,.27,.66),paper=vec3(.60,.68,.88);
    background=t<.5 ? mix(deep,mid,t*2.):mix(mid,paper,(t-.5)*2.);ink=deep*.72;
  } else if(uTheme==1) { background=vec3(.2,.25,.35);ink=vec3(.9,.9,.85); }
  else if(uTheme==2) { background=vec3(.02,.05,.1);ink=vec3(.1,.7,1.); }
  else { background=vec3(.95);ink=vec3(.05,.2,.6); }
  if(!photo && uTone.z>.5) {vec3 swap=ink;ink=background;background=swap;}
  vec2 paperUV=vec2(uv.x,1.-uv.y);
  float n=hash(paperUV*uRes),grain=(n-.5)*.3*uPrint.z,lineGrain=(n-.5)*.8*uPrint.z;
  if(photo) {
    float clump=hash(floor(paperUV*uRes*.5)+7.3),mottle=noise(paperUV*9.)-.5;
    grain=((n-.5)*.62+(clump-.5)*.38)*.55*uPrint.z*(.35+.85*dot(background,LUMA))+mottle*.14*uPrint.z;
    lineGrain=grain;
  }
  background=clamp(background+grain,0.,1.);
  vec2 major=fract(paperUV*uRes/100.),minor=fract(paperUV*uRes/20.);
  float grid=clamp((step(.98,major.x)+step(.98,major.y))*.6+(step(.95,minor.x)+step(.95,minor.y))*.2,0.,1.)*uPrint.w;
  float gate=rankedGate(uv);
  vec3 sheet=mix(background,ink,grid*(photo?.14:.3));
  vec3 color=mix(clamp(source(uv,uSampling.x),0.,1.),sheet,photo?gate:uSubstrate);
  color=mix(color,clamp(ink+lineGrain,0.,1.),clamp(line,0.,1.)*gate*(photo?.4:1.));
  outColor=vec4(color,1.);
}`;

export function blueprintUniforms(r: Recipe, sourceWidth: number, sourceHeight: number, w: number, h: number) {
  return { uTheme: ['cyanotype','draft','dark','light'].indexOf(r.blueprintTheme),
    uPrint: [r.blueprintSensitivity / 100, r.blueprintThickness / 100, r.blueprintSpeckle / 100, r.blueprintGrid / 100],
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert)],
    uSampling: [Math.log2(Math.max(sourceWidth / w, sourceHeight / h, 1)), Math.max(1, w / sourceWidth)] };
}
