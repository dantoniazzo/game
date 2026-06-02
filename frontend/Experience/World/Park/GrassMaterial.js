import * as THREE from 'three';

// ─── GLSL helpers (identical to the sketch) ───────────────────────────────────

const slerp = /* glsl */`
vec4 slerp(vec4 v0, vec4 v1, float t) {
    normalize(v0); normalize(v1);
    float dot_ = dot(v0, v1);
    if (dot_ < 0.0) { v1 = -v1; dot_ = -dot_; }
    const float DOT_THRESHOLD = 0.9995;
    if (dot_ > DOT_THRESHOLD) {
        vec4 result = t*(v1 - v0) + v0;
        normalize(result);
        return result;
    }
    float theta_0 = acos(dot_);
    float theta   = theta_0 * t;
    float sin_theta   = sin(theta);
    float sin_theta_0 = sin(theta_0);
    float s0 = cos(theta) - dot_ * sin_theta / sin_theta_0;
    float s1 = sin_theta / sin_theta_0;
    return (s0 * v0) + (s1 * v1);
}`;

const snoise = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec2 mod289(vec2 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
    vec3 m = max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
    m = m*m; m = m*m;
    vec3 x  = 2.0*fract(p*C.www)-1.0;
    vec3 h  = abs(x)-0.5;
    vec3 ox = floor(x+0.5);
    vec3 a0 = x-ox;
    m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
    vec3 g;
    g.x  = a0.x *x0.x  + h.x *x0.y;
    g.yz = a0.yz*x12.xz + h.yz*x12.yw;
    return 130.0*dot(m,g);
}`;

const rotateVectorByQuaternion = /* glsl */`
vec3 rotateVectorByQuaternion(vec3 v, vec4 q){
    return 2.0*cross(q.xyz, v*q.w + cross(q.xyz, v)) + v;
}`;

// ─── vertex shader ────────────────────────────────────────────────────────────

const vertexShader = /* glsl */`
precision highp float;

attribute vec3 baseColor;
attribute vec3 middleColor;
attribute vec3 tipColor;
attribute vec3 offset;
attribute vec4 orientation;
attribute float halfRootAngleSin;
attribute float halfRootAngleCos;
attribute float stretch;

uniform float uTime;
uniform float uBladeHeight;

varying vec2  vUv;
varying vec3  vPosition;
varying float vRelativeY;
varying vec3  vBaseColor;
varying vec3  vMiddleColor;
varying vec3  vTipColor;

${snoise}
${rotateVectorByQuaternion}
${slerp}

void main() {
    vRelativeY = position.y / float(uBladeHeight);

    float adjustedTime = uTime * 0.1;
    float noise = 1.0 - snoise(vec2(
        adjustedTime - offset.x / 50.0,
        adjustedTime - offset.z / 50.0
    ));

    vec4 direction = vec4(0.0, halfRootAngleSin, 0.0, halfRootAngleCos);
    direction = slerp(direction, orientation, vRelativeY);
    vec3 localPos = vec3(position.x, position.y + position.y * stretch, position.z);
    localPos = rotateVectorByQuaternion(localPos, direction);

    float halfAngle = noise * 0.15;
    localPos = rotateVectorByQuaternion(
        localPos,
        normalize(vec4(sin(halfAngle), 0.0, -sin(halfAngle), cos(halfAngle)))
    );

    vec3 offsetPosition = offset + localPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPosition, 1.0);

    vUv           = uv;
    vPosition     = offsetPosition;
    vBaseColor    = baseColor;
    vMiddleColor  = middleColor;
    vTipColor     = tipColor;
}`;

// ─── fragment shader ──────────────────────────────────────────────────────────

const fragmentShader = /* glsl */`
precision highp float;

uniform float     uTime;
uniform sampler2D uCloud;
uniform sampler2D alphaMap;

varying vec3  vBaseColor;
varying vec3  vMiddleColor;
varying vec3  vTipColor;
varying vec3  vPosition;
varying vec2  vUv;
varying float vRelativeY;

void main() {
    vec3 cloudPos   = vPosition / 90.0;
    cloudPos.x += uTime * 0.05;
    cloudPos.z += uTime * 0.04;

    vec3 mixOne    = mix(vBaseColor,   vMiddleColor, vRelativeY);
    vec3 mixTwo    = mix(vMiddleColor, vTipColor,    vRelativeY);
    vec3 bladeColor = mix(mixOne, mixTwo, vRelativeY);

    float cloudIntensity = 1.0 - texture2D(uCloud, cloudPos.xz).r;

    bladeColor = mix(bladeColor * 0.7, bladeColor, cloudPos.y);
    bladeColor = mix(bladeColor, bladeColor * 0.3, cloudIntensity);

    float alpha = texture2D(alphaMap, vUv).r;
    if (alpha < 0.15) discard;

    gl_FragColor = vec4(bladeColor, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

// ─── exported material ────────────────────────────────────────────────────────

export class GrassMaterial extends THREE.ShaderMaterial {
    constructor() {
        super({
            uniforms: {
                uTime:        { value: 0 },
                uBladeHeight: { value: 0 },
                uCloud:       { value: null },
                alphaMap:     { value: null },
            },
            vertexShader,
            fragmentShader,
            side:      THREE.DoubleSide,
            wireframe: false,
            toneMapped: false,
        });
    }
}
