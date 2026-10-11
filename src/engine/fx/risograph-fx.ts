import { Recipe } from '../recipe';
import { contrastFactor } from './context';

export const risographFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uScreen;
uniform vec3 uAngles;
uniform vec4 uDrive;
out vec4 outColor;
vec3 picture(vec2 uv) {
  vec3 c=clamp((texture(uSrc,clamp(uv,0.,1.)).rgb-.501961)*uDrive.x+.501961,0.,1.);
  return uDrive.y>.5?1.-c:c;
}
vec3 drive(vec3 c) {
  float luma=dot(c,vec3(.299,.587,.114));
  vec3 hue=max(mix(vec3(luma),c,uScreen.w),vec3(0));
  float peak=max(max(hue.r,hue.g),hue.b);
  return clamp((peak>1e-4?hue/peak:vec3(1))*luma*1.5,0.,1.);
}
void main() {
  vec2 px=gl_FragCoord.xy;
  const vec3 guns[3]=vec3[3](vec3(1,.05,.06),vec3(.04,.95,.30),vec3(.10,.13,1));
  const vec2 registration[3]=vec2[3](vec2(-1,.5),vec2(1,-.6),vec2(.2,1));
  vec3 color=vec3(0);
  for(int i=0;i<3;i++) {
    vec2 shifted=px+registration[i]*uScreen.y;
    float level=clamp(drive(picture(shifted/uRes))[i]*uDrive.z,0.,1.);
    level=floor(level*uScreen.z+.5)/uScreen.z;
    float c=cos(uAngles[i]),s=sin(uAngles[i]);
    vec2 q=vec2(c*shifted.x+s*shifted.y,-s*shifted.x+c*shifted.y)/uScreen.x;
    float radius=sqrt(clamp(level,0.,1.))*.66,aa=1.2/uScreen.x;
    color+=guns[i]*(1.-smoothstep(radius-aa,radius+aa,length(fract(q)-.5)));
  }
  color*=uDrive.w;
  float overflow=max(0.,max(max(color.r,color.g),color.b)-1.);
  color=clamp(color+overflow,0.,1.);
  outColor=vec4(mix(picture(px/uRes),color,min(1.,uDrive.z)),1);
}`;

export function risographUniforms(r: Recipe, scale: number, coverage: number) {
  const pitch = Math.max(3, r.fontSize * scale * .8), angle = r.risoAngle * Math.PI / 180;
  return {
    uScreen: [pitch, r.risoRegOffset / 100 * Math.min(pitch, 14 * scale) * .6, r.risoLevels, r.risoChroma / 100],
    uAngles: [Math.PI / 12 + angle, 5 * Math.PI / 12 + angle, angle],
    uDrive: [contrastFactor(r.contrast), Number(r.invert), Math.max(0, Math.min(2, coverage / 85)), 1 + r.brightness / 100]
  };
}
