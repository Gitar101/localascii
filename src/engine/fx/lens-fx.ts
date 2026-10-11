import { Recipe } from '../recipe';

export const lensFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uFan;
uniform vec4 uPrism;
uniform vec4 uFocus;
uniform vec4 uGrain;
uniform vec4 uShape;
uniform float uImageScale;
out vec4 outColor;
const float PI=3.14159265358979323846;
vec2 turn(vec2 p,float a) { return mat2(cos(a),sin(a),-sin(a),cos(a))*p; }
float randomValue(vec2 p) {
  p=fract(p*vec2(.3183099,.3678794))+.1; p+=dot(p,p+19.19); return fract(p.x*p.y);
}
float grainAt(vec2 p) {
  vec2 c=floor(p),t=fract(p); t=t*t*(3.-2.*t);
  return mix(mix(randomValue(c),randomValue(c+vec2(1,0)),t.x),
    mix(randomValue(c+vec2(0,1)),randomValue(c+1.),t.x),t.y);
}
vec3 hueWeight(float h) {
  vec3 c=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); return c*c*(3.-2.*c);
}
vec4 samplePaper(vec2 uv) {
  vec2 aa=1./clamp(fwidth(uv),1e-5,.02);
  vec2 low=clamp(uv*aa+.5,0.,1.),high=clamp((1.-uv)*aa+.5,0.,1.);
  vec4 image=texture(uSrc,vec2(uv.x,1.-uv.y));
  float opacity=image.a*low.x*high.x*low.y*high.y;
  return vec4(mix(vec3(1),image.rgb,opacity),opacity);
}
vec2 lensPosition(vec2 p,float radius,float inner,out float fade) {
  fade=1.;
  if(radius<1e-5 || (uShape.x==0. && uShape.y<=0.)) return p;
  float r=radius;
  if(uShape.x!=0.) {
    float normalized=radius/inner,bulge=abs(uShape.x)*(uShape.x>0.?1.4:1.2);
    if(uShape.x>0.) fade=1.-smoothstep(1.45,1.53,normalized*bulge);
    float warped=uShape.x>0.?tan(min(normalized*bulge,1.53))/tan(bulge):atan(normalized*tan(bulge))/bulge;
    float factor=warped/normalized; p*=factor; r*=factor;
  }
  if(uShape.y>0.) {
    vec2 direction=p/max(r,1e-5),box=vec2(uRes.x/uRes.y,1.)*.5;
    float edge=min(box.x/max(abs(direction.x),1e-4),box.y/max(abs(direction.y),1e-4));
    float band=inner*mix(.03,.2,.5*(uShape.x+1.));
    float t=smoothstep(0.,1.,(r-inner+band)/band);
    p=direction*mix(r,r+(edge-inner)*pow(t,14.),uShape.y);
  }
  return p;
}
void main() {
  float aspect=uRes.x/uRes.y,inner=.5*min(aspect,1.),outer=.5*length(vec2(aspect,1.));
  vec2 imageUV=(gl_FragCoord.xy/uRes-.5)/uImageScale+.5; imageUV.y=1.-imageUV.y;
  vec2 p=(imageUV-.5)*vec2(aspect,1.);
  float radius=length(p),fade;
  vec2 warped=lensPosition(p,radius,inner,fade),base=warped/vec2(aspect,1.)+.5;
  float reach=.7*pow(uFan.x,1.3+2.7*uFan.x);
  vec2 radial=p/inner;
  if(radius>outer+reach) radial*=(outer+reach)/radius;
  vec2 direction=mix(vec2(cos(radians(uFan.z)),sin(radians(uFan.z))),radial,uFan.w);
  float circle=smoothstep(inner*.8,inner,radius)*pow(uShape.y,3.);
  direction=mix(direction,radial,circle);
  vec2 distance=abs(base-.5);
  float center=mix(1.,smoothstep(0.,mix(inner,outer,uFocus.x),radius),uFocus.x);
  float edges=mix(1.,1.-min(max(distance.x,distance.y)*2.,1.),uFocus.y);
  float strength=center*edges*mix(1.,mix(.15,.03,max(-uShape.x,0.)),circle);
  vec2 derivative=fwidth(base);
  float edgeAA=clamp(2.*max(derivative.x,derivative.y),.001,.02);
  float margin=max(reach*length(direction)*(1.-uShape.y),edgeAA);
  strength*=1.-smoothstep(0.,margin,length(max(distance-.5,0.)));
  vec2 axis=direction*reach*strength;
  if(uFocus.w>0.) {
    float a=(grainAt(p*uGrain.x*18.+uGrain.y*30.)-.5)*2.*uFocus.w;
    axis=turn(axis,-a);
  }
  axis.x/=aspect;
  vec2 grainUV=vec2(0);
  if(uGrain.z>0. || uGrain.w>0.) {
    grainUV=(imageUV-.5)*(.8/vec2(length(dFdx(imageUV)),length(dFdy(imageUV))))+.5;
  }
  if(uGrain.z>0.) {
    vec2 jitter=fract(grainAt(grainUV)*vec2(157.31,113.57))*2.-1.;
    axis+=jitter*.3*uGrain.z*length(axis);
  }
  float count=floor(uPrism.x),power=1.+2.*abs(uFan.y);
  float middle=1.-smoothstep(.5*inner,1.1*inner,radius);
  float dispersion=uPrism.y*mix(clamp(1.+uPrism.z,0.,1.),clamp(1.-uPrism.z,0.,1.),middle);
  float spectrum=pow(dispersion,.8);
  float swirl=uFocus.z*.4*PI*strength*uFan.x*min(1.,inner/max(length(warped),1e-4));
  vec3 sum=vec3(0),weights=vec3(0); float covers=0.;
  for(int i=0;i<50;i++) {
    if(float(i)>=count) break;
    float t=float(i)/max(count-1.,1.);
    if(uFan.y!=0.) { t=pow(uFan.y<0.?1.-t:t,power); if(uFan.y<0.) t=1.-t; }
    float fan=1.-2.*t;
    vec2 at=base+axis*fan-.5;
    if(uFocus.z!=0.) { at.x*=aspect; at=turn(at,swirl*fan); at.x/=aspect; }
    vec4 tap=samplePaper(at+.5-uShape.zw);
    vec3 weight=1.-spectrum*hueWeight(uPrism.w+.5+float(i)/count);
    sum+=tap.rgb*weight; weights+=weight; covers+=tap.a;
  }
  vec3 color=sum/max(weights,vec3(1e-4));
  float alpha=max(covers/count,1.-min(color.r,min(color.g,color.b)));
  vec3 premult=max(color-(1.-alpha),0.)*fade; alpha*=fade;
  if(uGrain.w>0.) {
    float value=mix(grainAt(turn(grainUV,1.)+3.),grainAt(turn(grainUV,2.)-1.),.5);
    value=pow(value,1.3)*2.-1.;
    float amount=pow(uGrain.w*abs(value),.8)*alpha;
    premult=mix(premult,vec3(step(0.,value))*alpha,.35*amount);
  }
  // The reference composites this non-premultiplied WebGL canvas over white.
  outColor=vec4(premult*alpha+1.-alpha,1);
}`;

export function lensUniforms(r: Recipe) {
  return {
    uFan: [r.lensdSpread, r.lensdBias, r.lensdAngle, r.lensdPerspective],
    uPrism: [r.lensdCount, r.lensdDispersion, r.lensdDispShift, r.lensdDispColor],
    uFocus: [r.lensdFocusCenter, r.lensdFocusEdges, r.lensdSwirl, r.lensdNoise],
    uGrain: [r.lensdNoiseFreq, r.lensdNoiseOffset, r.lensdGrainMix, r.lensdGrainOverlay],
    uShape: [r.lensdBulge, r.lensdCircle, r.lensdImageX, r.lensdImageY],
    uImageScale: r.lensdScale
  };
}
