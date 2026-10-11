import { Recipe } from '../recipe';
import { contrastFactor } from './context';

// Static surface optics. Pattern coordinates are Y-down, matching the reference pane.
export const liquidGlassFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform int uPattern;
uniform vec4 uOptics;
uniform vec4 uSurface;
uniform vec4 uTone;
uniform vec2 uPane;
out vec4 outColor;

mat2 rotation(float a) { return mat2(cos(a),sin(a),-sin(a),cos(a)); }
vec2 randomPair(vec2 p) {
  vec3 h=fract(p.xyx*vec3(.1031,.1030,.0973));
  h+=dot(h,h.yzx+33.33);
  return fract((h.xx+h.yz)*h.zy);
}
float randomValue(vec2 p) {
  vec3 h=fract(p.xyx*.1031); h+=dot(h,h.yzx+33.33);
  return fract((h.x+h.y)*h.z);
}
float gradientNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p), t=f*f*(3.-2.*f);
  float a=dot(randomPair(cell)*2.-1.,f);
  float b=dot(randomPair(cell+vec2(1,0))*2.-1.,f-vec2(1,0));
  float c=dot(randomPair(cell+vec2(0,1))*2.-1.,f-vec2(0,1));
  float d=dot(randomPair(cell+1.)*2.-1.,f-1.);
  return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
float valueNoise(vec2 p) {
  vec2 c=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(randomValue(c),randomValue(c+vec2(1,0)),f.x),
    mix(randomValue(c+vec2(0,1)),randomValue(c+1.),f.x),f.y);
}
float grit(vec2 p) { return .6*valueNoise(p)+.4*valueNoise(p*2.3+11.); }
vec2 hexLocal(vec2 p) {
  vec2 period=vec2(1.,1.7320508);
  vec2 a=mod(p,period)-period*.5,b=mod(p+period*.5,period)-period*.5;
  return dot(a,a)<dot(b,b)?a:b;
}
float paneHeight(vec2 p) {
  vec2 f=fract(p);
  if(uPattern==0) return 2.*min(min(f.x,1.-f.x),min(f.y,1.-f.y));
  if(uPattern==1) {
    float x=fract(p.x+uPane.y*.002*sin(p.y*1.2))*2.-1.;
    return sqrt(max(0.,1.-x*x));
  }
  if(uPattern==2 || uPattern==6) {
    float nearest=8.,second=8.;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
      vec2 offset=vec2(x,y);
      float d=length(offset+randomPair(floor(p)+offset)-f);
      if(d<nearest) { second=nearest; nearest=d; } else second=min(second,d);
    }
    return uPattern==2?smoothstep(0.,1.,1.-min(1.,nearest)):smoothstep(0.,.14,second-nearest);
  }
  if(uPattern==3) {
    p*=.25; return 3.*(gradientNoise(p)+.16*gradientNoise(p*2.));
  }
  if(uPattern==4) {
    vec2 q=abs(f-.5)*2.;
    return smoothstep(1.,.6,pow(pow(q.x,6.)+pow(q.y,6.),1./6.));
  }
  if(uPattern==5) {
    float d=length(f-.5); return (.5+.5*cos(d*26.))*smoothstep(.7,0.,d);
  }
  if(uPattern==7) {
    float x=fract(p.x+abs(f.y-.5))*2.-1.; return sqrt(max(0.,1.-x*x));
  }
  if(uPattern==8) {
    float height=0.;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
      vec2 offset=vec2(x,y),r=randomPair(floor(p)+offset);
      if(r.x<.55) continue;
      float d=length(offset+.25+r*.5-f)/(.14+.22*r.y);
      height=max(height,sqrt(max(0.,1.-d*d)));
    }
    return height;
  }
  if(uPattern==9) {
    vec2 q=f*2.-1.; return max(sqrt(max(0.,1.-q.x*q.x)),sqrt(max(0.,1.-q.y*q.y)));
  }
  if(uPattern==10) {
    vec2 q=abs(hexLocal(p)); return smoothstep(.5,.33,max(q.x,.5*q.x+.8660254*q.y));
  }
  p+=.1*vec2(sin(p.y*2.7),cos(p.x*2.7));
  vec2 q=abs(fract(p)-.5)*2.;
  float d=clamp(pow(pow(q.x,2.4)+pow(q.y,2.4),1./2.4),0.,1.);
  float splay=clamp(uSurface.w*.01,0.,2.);
  return pow(max(0.,1.-d*d),.65)*smoothstep(1.02+.10*splay,.90-.22*splay,d);
}
float paneCoverage(vec2 p) {
  float amount=uSurface.z;
  if(amount>=.999) return 1.;
  if(amount<=.001) return 0.;
  float rank;
  if(uPattern==1) rank=randomValue(vec2(floor(p.x),0));
  else if(uPattern==7) rank=randomValue(vec2(0,floor(p.y)));
  else if(uPattern==3) rank=clamp(gradientNoise(p*.15)*2.2+.5,0.,1.);
  else if(uPattern==10) rank=randomValue(floor((p-hexLocal(p))*4.+.5));
  else rank=randomValue(floor(p));
  return clamp((amount-rank)*10.,0.,1.);
}
vec3 picture(vec2 uv) {
  vec3 c=texture(uSrc,clamp(vec2(uv.x,1.-uv.y),0.,1.)).rgb;
  c=(c-.5)*uTone.x+.5+uTone.y;
  if(uTone.z>.5) c=1.-c;
  return clamp(c,0.,1.);
}
vec3 screenLight(vec3 base,vec3 light) { return 1.-(1.-base)*(1.-clamp(light,0.,1.)); }
vec2 bendRay(vec3 normal,float index,float depth) {
  vec3 ray=refract(vec3(0,0,-1),normal,1./index);
  return ray.z>-1e-4?vec2(0):ray.xy/(-ray.z)*depth;
}
void main() {
  vec2 uv=gl_FragCoord.xy/uRes; uv.y=1.-uv.y;
  vec2 aspect=vec2(uRes.x/uRes.y,1.);
  float frequency=mix(5.,80.,uTone.w);
  mat2 intoPane=rotation(-uPane.x),intoScreen=rotation(uPane.x);
  vec2 p=intoPane*(uv*aspect*frequency);
  float coverage=paneCoverage(p);
  if(coverage<=.001) { outColor=vec4(picture(uv),1); return; }
  vec3 n;
  float reedZ=1.;
  if(uPattern==1) {
    float x=fract(p.x+uPane.y*.002*sin(p.y*1.2))*2.-1.;
    reedZ=sqrt(max(1e-4,1.-x*x));
    float slope=.06*.35*cos(p.y*.35)+uPane.y*.002*1.2*cos(p.y*1.2);
    n=normalize(vec3(x,x*slope,reedZ));
  } else {
    float dx=paneHeight(p+vec2(.01,0))-paneHeight(p-vec2(.01,0));
    float dy=paneHeight(p+vec2(0,.01))-paneHeight(p-vec2(0,.01));
    n=normalize(vec3(-dx,-dy,.15));
  }
  n.xy=intoScreen*n.xy;
  vec2 offset=n.xy*uOptics.x*.05*uOptics.w*.01;
  vec2 dispersion=n.xy*uOptics.z*.2;
  vec3 color;
  if(uPattern==1) {
    float thick=uOptics.x*1.1,spread=uOptics.z*.35;
    vec2 units=1./(aspect*frequency);
    offset=bendRay(n,1.5,thick)*units;
    color=vec3(picture(uv+bendRay(n,1.5-spread,thick)*units).r,
      picture(uv+offset).g,picture(uv+bendRay(n,1.5+spread,thick)*units).b);
    color*=exp(-thick/max(.22,reedZ)*.018);
  } else {
    color=vec3(picture(uv+offset+dispersion).r,picture(uv+offset).g,picture(uv+offset-dispersion).b);
    if(uPattern==4) {
      float height=paneHeight(p);
      vec2 center=intoScreen*(floor(p)+.5)/(aspect*frequency);
      vec2 fringe=(uv-center)*uOptics.z*.6,lens=offset*.35;
      vec3 tile=vec3(picture(center+lens+fringe).r,picture(center+lens).g,picture(center+lens-fringe).b);
      color=mix(color,tile,smoothstep(.15,.75,height));
      vec2 corner=fract(p)-.5;
      color+=(.06-(corner.x+corner.y)*.06)*height*(.3+uOptics.y);
      color*=mix(.22,1.,smoothstep(0.,.3,height));
    }
  }
  vec3 light=normalize(vec3(-.6,.8,.9)),halfLight=normalize(light+vec3(0,0,1));
  float fresnel=pow(1.-clamp(n.z,0.,1.),3.);
  bool neutral=uPattern==1 || uPattern==7;
  vec3 reflection=reflect(vec3(0,0,-1),n);
  vec3 environment=mix(neutral?vec3(.55):vec3(.42,.50,.62),
    neutral?vec3(.99):vec3(.97,.99,1.),clamp(reflection.y*.5+.5,0.,1.));
  color=mix(color,environment,fresnel*(.30+.45*uOptics.y));
  float fringe=fresnel*uOptics.z*.25*n.x;
  color=screenLight(color,vec3(max(fringe,0.),0,max(-fringe,0.)));
  color.rb-=vec2(max(-fringe,0.),max(fringe,0.));
  float tilt=1.-n.z*n.z, alignment=max(dot(n,halfLight),0.);
  color=screenLight(color,(neutral?vec3(1):vec3(.9,.95,1))*pow(alignment,6.)*tilt*(.12+.30*uOptics.y));
  color=screenLight(color,vec3(pow(alignment,110.)*(neutral?tilt:1.)*(.5+uOptics.y)));
  color=clamp(color,0.,1.);
  float frost=uSurface.x;
  if(frost>0.) {
    float radius=frost*frost*.085,start=randomValue(floor(gl_FragCoord.xy))*6.2831853;
    vec3 accumulated=vec3(0); float weightSum=0.;
    for(int i=0;i<16;i++) {
      float t=(float(i)+.5)/16.,angle=start+float(i)*2.39996323,weight=1.-t*.5;
      vec2 direction=vec2(cos(angle),sin(angle)*aspect.x);
      accumulated+=picture(uv+offset+direction*sqrt(t)*radius)*weight;
      weightSum+=weight;
    }
    vec3 diffuse=accumulated/weightSum;
    diffuse=mix(diffuse,vec3(dot(diffuse,vec3(.299,.587,.114))),frost*.28)+vec3(.05,.055,.065)*frost;
    color=mix(color,diffuse,clamp(frost*1.3,0.,1.));
    vec2 gp=gl_FragCoord.xy*.34;
    vec3 gn=normalize(vec3(-(grit(gp+vec2(.7,0))-grit(gp-vec2(.7,0))),
      -(grit(gp+vec2(0,.7))-grit(gp-vec2(0,.7))),.5));
    color*=mix(1.,.70+.58*clamp(dot(gn,light),0.,1.),frost);
    color=clamp(screenLight(color,vec3(pow(max(dot(gn,halfLight),0.),40.)*frost*.55)),0.,1.);
  }
  color=mix(color,vec3(.95,.97,1),uSurface.y*.8);
  if(coverage<.999) color=mix(picture(uv),color,coverage);
  outColor=vec4(color,1);
}`;

const patterns: Record<string, number> = {
  diamond: 0, hammered: 2, liquid: 3, pixel: 4, ripple: 5, crackle: 6,
  chevron: 7, seedy: 8, cross: 9, hexagon: 10, jello: 11
};

export function liquidGlassUniforms(r: Recipe, coverage: number) {
  return {
    uPattern: patterns[r.glassStyle],
    uOptics: [r.glassRefraction / 100, r.glassReflection / 100, r.glassDispersion / 100, r.glassDepth],
    uSurface: [r.glassFrost / 100, r.glassFog / 100, coverage / 100, r.glassSplay],
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert), 1 - Math.max(0, Math.min(1, (r.fontSize - 3) / 77))],
    uPane: [r.glassAngle * Math.PI / 180, r.glassReedWave]
  };
}
