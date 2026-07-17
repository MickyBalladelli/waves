export const OCEAN_WAVE_COUNT = 32;

export const oceanVertexShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSeaState;
uniform float uWindSpeed;
uniform float uChoppiness;
uniform float uBreakDist;
uniform float uShorelineZ;
uniform float uShoalZone;
uniform float uWaves[${OCEAN_WAVE_COUNT * 6}];

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFoam;
varying float vDepthFactor;
varying float vCrest;
varying float vDistToShore;
varying float vJacobian;
varying vec4 vScreenPos;
varying float vShoreBlend;

const float PI = 3.14159265359;
const float G = 9.81;

float smoother(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void gerstner(
  vec2 xz,
  float t,
  float dx, float dz, float wavelength, float steepness, float speed, float phase,
  float ampScale, float steepScale, float chop,
  inout vec3 disp,
  inout vec3 tangent,
  inout vec3 binormal,
  inout float jacobian
) {
  float wl = max(wavelength, 0.4);
  float k = (2.0 * PI) / wl;
  float a = (steepness * steepScale / k) * ampScale * uSeaState;
  a = min(a, wl * 0.105 * uSeaState);

  float c = sqrt(G / k) * speed * uWindSpeed * 0.55;
  float f = k * (dx * xz.x + dz * xz.y) - c * t + phase;
  float s = sin(f);
  float co = cos(f);

  float ch = chop * uChoppiness;
  disp.x += -dx * a * co * ch;
  disp.y += a * s;
  disp.z += -dz * a * co * ch;

  float dpdxx = dx * dx * k * a * s * ch;
  float dpdxz = dx * dz * k * a * s * ch;
  float dpdzz = dz * dz * k * a * s * ch;
  float dpdxy = dx * k * a * co;
  float dpdzy = dz * k * a * co;

  tangent.x  -= dpdxx;
  tangent.y  += dpdxy;
  tangent.z  -= dpdxz;

  binormal.x -= dpdxz;
  binormal.y += dpdzy;
  binormal.z -= dpdzz;

  jacobian -= k * a * s * ch;
}

void main() {
  vec3 pos = position;
  vec4 world0 = modelMatrix * vec4(pos, 1.0);
  vec2 xz = world0.xz;
  float dist = uShorelineZ - xz.y;
  vDistToShore = dist;

  // Wide soft shore blend — kills the hard shoreline "line"
  // Fully transparent slightly inland, fully opaque a few meters seaward
  vShoreBlend = smoother(-1.8, 3.5, dist);

  float ampScale = 1.0;
  float steepScale = 1.0;
  float breakFade = 1.0;

  if (dist >= uShoalZone) {
    ampScale = 1.0;
    steepScale = 1.0;
  } else if (dist >= uBreakDist) {
    float t = 1.0 - (dist - uBreakDist) / max(uShoalZone - uBreakDist, 0.01);
    // steepen hard going into the barrel zone
    ampScale = 1.0 + 1.9 * t;
    steepScale = 1.0 + 1.45 * t;
  } else if (dist > 0.0) {
    float t = dist / max(uBreakDist, 0.01);
    ampScale = 2.3 * pow(t, 0.48);
    steepScale = 1.0 + 2.2 * (1.0 - t);
    breakFade = smoother(0.05, 0.55, t);
  } else {
    ampScale = 0.08 * smoother(-1.5, 0.0, dist);
    steepScale = 0.4;
    breakFade = 0.0;
  }

  // break zone envelope (wide enough for a full tube section)
  float breakLine = uBreakDist * (0.9 + 0.1 * sin(xz.x * 0.032 + uTime * 0.12));
  float nearBreak = exp(-pow((dist - breakLine) / max(uBreakDist * 0.62, 1.0), 2.0));

  vec3 disp = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float jacobian = 1.0;

  for (int i = 0; i < ${OCEAN_WAVE_COUNT}; i++) {
    int o = i * 6;
    float atten = 1.0;
    float wl = uWaves[o + 2];
    if (dist < uShoalZone) {
      atten = mix(smoother(0.0, 5.0, dist), 1.0, clamp(wl / 14.0, 0.0, 1.0));
    }
    gerstner(
      xz, uTime,
      uWaves[o], uWaves[o+1], uWaves[o+2], uWaves[o+3], uWaves[o+4], uWaves[o+5],
      ampScale * atten, steepScale, 1.0,
      disp, tangent, binormal, jacobian
    );
  }

  // =========================================================================
  // ROLLING TUBE / BARREL BREAKER
  // Shore is +Z. Face pitches shoreward, lip curls over and tucks under.
  // Peel runs along X so barrels open as a progressive tube, not a wall.
  // =========================================================================
  float peelWave = sin(xz.x * 0.038 - uTime * uWindSpeed * 0.62);
  // peel: 0 = unbroken swell face, 1 = fully barreling section
  float peel = smoother(-0.15, 0.75, peelWave);
  // secondary slower peel for longer tubes
  float peel2 = smoother(-0.25, 0.55, sin(xz.x * 0.019 - uTime * uWindSpeed * 0.31 + 1.7));
  peel = max(peel * 0.75, peel2 * 0.9);

  // wave phase along travel direction (crest ~ 0)
  float phase = xz.y * 0.55 + xz.x * 0.028 - uTime * uWindSpeed * 0.88;
  float wr = atan(sin(phase), cos(phase)); // (-π, π]

  float mask = breakFade * nearBreak;
  float tube = peel * mask; // 0..1 barrel intensity at this vertex

  // Profile lobes along the wave cross-section (s = wr)
  // s≈0 crest, s<0 shoreward face/lip, s>0 seaward back
  float crestRaw = exp(-wr * wr * 5.5);
  float faceRaw  = exp(-pow(wr + 0.35, 2.0) * 4.0);   // steep face
  float lipRaw   = exp(-pow(wr + 0.72, 2.0) * 7.5);   // curling lip
  float tipRaw   = exp(-pow(wr + 1.05, 2.0) * 14.0);  // lip tip tucking under
  float backRaw  = exp(-pow(wr - 0.55, 2.0) * 4.5);   // shoulder
  float troughRaw = exp(-pow(wr - 1.1, 2.0) * 3.0);

  // Tube radius grows with sea state + peel
  float R = (1.35 + 2.1 * peel) * uSeaState * mask;

  // Parametric barrel: map profile to a rolling arc
  // ang: 0 at trough/back → ~π at lip tip (half-pipe to full tube with peel)
  float ang = clamp((-wr + 0.9) * (0.85 + 0.95 * peel), 0.0, 3.4);
  float cosA = cos(ang);
  float sinA = sin(ang);

  // cycloid-like tube section in (shoreward Z, up Y)
  float tubeY = R * (1.0 - cosA) * (0.55 + 0.45 * peel);
  float tubeZ = R * sinA * (0.75 + 0.55 * peel); // throw toward shore (+Z)

  // blend parametric tube with lobe shaping for a cleaner crest/lip
  float lift =
      crestRaw * R * 0.95
    + faceRaw  * R * 0.55
    + lipRaw   * R * 0.35
    + tubeY * 0.85
    - tipRaw * R * 1.15 * peel          // lip drops as it closes the barrel
    - troughRaw * R * 0.4
    - backRaw * R * 0.08;

  float pitch =
      crestRaw * R * 0.55
    + faceRaw  * R * 1.15
    + lipRaw   * R * 1.85 * peel
    + tubeZ * 0.9
    + tipRaw * R * 0.35 * peel          // tip still shoreward then tucks
    - tipRaw * R * 0.9 * peel * peel    // tuck under (slight seaward pull)
    - troughRaw * R * 0.5
    - backRaw * R * 0.25;

  // slight along-shore twist so the tube isn't a perfect extrusion
  float twist = sin(xz.x * 0.09 + uTime * 1.1) * lipRaw * peel * R * 0.2;

  lift  *= tube;
  pitch *= tube;
  twist *= tube;

  // unbroken shoaling still gets a steep face (no full curl)
  float steepFace = (1.0 - peel * 0.85) * mask * crestRaw * uSeaState;
  lift  += steepFace * 0.9;
  pitch += steepFace * 0.7;

  disp.y += lift;
  disp.z += pitch;
  disp.x += twist;

  // flatten only very near the sand so the tube keeps volume in the break zone
  float shoreFlat = mix(0.35, 1.0, vShoreBlend);
  disp *= shoreFlat;

  // Normals wrap around the barrel (critical for tube read)
  tangent.y  += (crestRaw * 0.3 + faceRaw * 0.55) * tube * uSeaState;
  binormal.y += (pitch * 0.12 + faceRaw * R * 0.35 * tube);
  binormal.z -= (crestRaw * 0.4 + lipRaw * 1.1 * peel + tipRaw * 0.8 * peel) * mask * uSeaState;
  // underside of lip: flip-ish contribution when tucked
  binormal.y -= tipRaw * peel * mask * uSeaState * 0.9;
  tangent.z  += twist * 0.15;

  pos += disp;

  vec3 n = normalize(cross(binormal, tangent));
  // allow inverted normals on the lip underside (DoubleSide material)
  // only force up-facing in open water
  if (n.y < 0.0 && tube < 0.25) n = -n;

  // Foam on lip tip + thin crest line of the barrel (not a solid wall)
  float crestFoam = pow(crestRaw, 2.2) * peel * mask;
  float lipFoam = pow(lipRaw, 1.6) * peel * mask;
  float tipFoam = pow(tipRaw, 1.3) * peel * mask;
  float jFoam = smoother(0.2, -0.1, jacobian) * 0.35
    * smoother(uBreakDist + 4.0, uShoalZone, dist);

  vFoam = clamp(crestFoam * 0.55 + lipFoam * 0.95 + tipFoam * 1.1 + jFoam, 0.0, 1.0) * vShoreBlend;
  // high on the translucent barrel face + lip
  vCrest = clamp(faceRaw * tube + lipRaw * peel * mask + crestRaw * tube * 0.5, 0.0, 1.0);
  // shallow factor: 0 at shore, 1 deep — used for color (not foam bands)
  vDepthFactor = smoother(2.0, 40.0, max(dist, 0.0));
  vJacobian = jacobian;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vViewDir = cameraPosition - worldPos.xyz;

  vec4 clip = projectionMatrix * viewMatrix * worldPos;
  vScreenPos = clip;
  gl_Position = clip;
}
`;

export const oceanFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uWindSpeed;
uniform float uSeaState;
uniform sampler2D uReflection;
uniform sampler2D uRefraction;
uniform sampler2D uRefractionDepth;
uniform sampler2D uFoamNoise;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFoam;
varying float vDepthFactor;
varying float vCrest;
varying float vDistToShore;
varying float vJacobian;
varying vec4 vScreenPos;
varying float vShoreBlend;

float smoother(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

vec3 skyFallback(vec3 R, vec3 L) {
  float elev = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHorizonColor, uSkyColor, smoother(0.0, 0.55, elev));
  col = mix(col, uSkyColor * 1.2, smoother(0.4, 1.0, elev));
  float sun = pow(max(dot(normalize(R), L), 0.0), 380.0);
  float glow = pow(max(dot(normalize(R), L), 0.0), 14.0);
  col += uSunColor * (sun * 3.0 + glow * 0.45);
  if (R.y < 0.0) col = mix(uDeepColor * 0.55, col, 0.45);
  return col;
}

void main() {
  // early soft discard far inland — no hard edge
  if (vShoreBlend < 0.004) discard;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);

  // multi-scale chop normals
  vec2 nUV = vWorldPos.xz * 0.065;
  float n1 = texture2D(uFoamNoise, nUV + vec2(uTime * 0.016 * uWindSpeed, 0.0)).r;
  float n2 = texture2D(uFoamNoise, nUV * 2.6 - vec2(0.0, uTime * 0.026 * uWindSpeed)).r;
  float n3 = texture2D(uFoamNoise, nUV * 6.2 + vec2(uTime * 0.038, uTime * 0.018)).r;
  float n4 = texture2D(uFoamNoise, nUV * 14.0 - vec2(uTime * 0.06, -uTime * 0.05)).r;
  vec2 bump = vec2(
    (n1 - 0.5) * 0.15 + (n2 - 0.5) * 0.08 + (n3 - 0.5) * 0.04 + (n4 - 0.5) * 0.018,
    (n2 - 0.5) * 0.13 + (n1 - 0.5) * 0.06 + (n3 - 0.5) * 0.035 + (n4 - 0.5) * 0.015
  );
  // damp micro-normals near shore (calmer thin water)
  bump *= mix(0.25, 1.0, smoother(0.5, 8.0, vDistToShore));
  N = normalize(N + vec3(bump.x, 0.0, bump.y));

  float NdV = max(dot(N, V), 0.001);
  float NdL = max(dot(N, L), 0.0);
  float F0 = 0.02;
  float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  // thin water near shore: less mirror, more see-through sand
  float shoreProx = 1.0 - smoother(0.0, 12.0, max(vDistToShore, 0.0));
  fresnel *= mix(1.0, 0.35, shoreProx);

  vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
  vec2 safeUV = clamp(screenUV, vec2(0.002), vec2(0.998));

  float distortAmt = 0.03 + 0.055 * (1.0 - NdV);
  distortAmt *= mix(1.0, 0.2, shoreProx);
  vec2 distort = N.xz * distortAmt;

  vec2 reflUV = clamp(vec2(1.0 - safeUV.x, safeUV.y) + distort * vec2(-1.0, 0.45), 0.002, 0.998);
  vec2 refrUV = clamp(safeUV - distort * 0.9, 0.002, 0.998);

  vec3 reflection = texture2D(uReflection, reflUV).rgb;
  vec3 refraction = texture2D(uRefraction, refrUV).rgb;

  // optical path through water column
  float sceneDepth = linearizeDepth(texture2D(uRefractionDepth, safeUV).r);
  float waterDepth = linearizeDepth(gl_FragCoord.z);
  float optical = max(sceneDepth - waterDepth, 0.0);
  // if depth is unreliable (common near shore), fall back to distance-to-shore estimate
  float approxDepth = max(vDistToShore, 0.0) * 0.22 + 0.08;
  if (optical < 0.05 || optical > 80.0) {
    optical = approxDepth;
  }
  // shoreward of break: force shallow optical so we never get "scuba" navy
  float insideBreak = 1.0 - smoother(0.5, 10.0, max(vDistToShore, 0.0));
  optical = mix(optical, min(optical, approxDepth), clamp(insideBreak + shoreProx, 0.0, 1.0));

  // Beer-Lambert: weak absorption in shallows, stronger offshore
  float absorbScale = mix(0.25, 1.15, vDepthFactor);
  vec3 absorb = exp(-vec3(0.35, 0.08, 0.05) * optical * absorbScale);
  // lift floor so shallow never goes black/navy
  absorb = max(absorb, vec3(0.55, 0.72, 0.78) * mix(1.0, 0.35, vDepthFactor));
  refraction *= absorb;

  // body tint: turquoise shallows → deep blue offshore (never solid dark inshore)
  vec3 shallowTint = vec3(0.35, 0.78, 0.82);  // clear tropical shallow
  vec3 midTint = uShallowColor;
  vec3 deepTint = uDeepColor;
  vec3 body = mix(shallowTint, midTint, smoother(0.0, 0.45, vDepthFactor));
  body = mix(body, deepTint, smoother(0.35, 1.0, vDepthFactor));
  float face = clamp(1.0 - N.y, 0.0, 1.0);
  body = mix(body, body * vec3(0.7, 1.12, 0.95), face * 0.35 * vDepthFactor);

  // murk: how much solid body color replaces refraction — LOW near shore so sand shows
  float murk = smoother(0.4, 8.0, optical) * mix(0.15, 0.75, vDepthFactor);
  murk = clamp(murk, 0.0, 0.78);
  // keep refraction bright (sand/shelf) in swash zone
  refraction = mix(refraction, refraction * 0.5 + body * 0.5, murk * 0.35);
  vec3 under = mix(refraction, body * (0.55 + 0.45 * NdL), murk);
  // warm sand bleed when very shallow
  vec3 sandTint = vec3(0.55, 0.48, 0.36);
  under = mix(under, mix(refraction, sandTint, 0.35), shoreProx * 0.55);

  vec3 R = reflect(-V, N);
  vec3 skyR = skyFallback(R, L);
  float reflLum = dot(reflection, vec3(0.299, 0.587, 0.114));
  float sceneW = smoother(0.01, 0.07, reflLum) * 0.65;
  reflection = mix(skyR, reflection * 1.03, sceneW);
  reflection = mix(reflection, skyR, 0.12 + 0.2 * (1.0 - clamp(R.y, 0.0, 1.0)));

  // SSS — strong on barrel face / thin lip (classic green tube wall)
  float sss = pow(max(dot(V, -L + N * 0.55), 0.0), 1.8);
  float wall = clamp(face * 1.4 + vCrest * 1.2, 0.0, 1.5);
  sss *= 0.08 + wall * 0.85;
  // backlight through the tube when looking through the face
  float tubeLight = pow(max(dot(-V, L), 0.0), 1.5) * wall * 0.55;
  sss += tubeLight;
  vec3 sssCol = vec3(0.02, 0.62, 0.48) * sss * mix(0.7, 1.15, 1.0 - vDepthFactor * 0.4);
  // extra emerald on steep faces
  sssCol += vec3(0.0, 0.35, 0.22) * wall * NdL * 0.25;

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 780.0) * 2.2;
  float soft = pow(max(dot(N, H), 0.0), 52.0) * 0.18;
  float sparkle = pow(max(n3 * n4, 0.0), 6.0) * fresnel * NdL * 0.35;
  vec3 specular = uSunColor * (spec + soft + sparkle) * (0.2 + fresnel) * mix(0.4, 1.0, vDepthFactor);

  vec3 color = mix(under + sssCol, reflection, clamp(fresnel, 0.0, 0.95));
  color += specular;

  // Foam — crest tips only; hard threshold so weak ridges vanish
  vec2 fuv = vWorldPos.xz * 0.14;
  float ft1 = texture2D(uFoamNoise, fuv + vec2(-uTime * 0.03 * uWindSpeed, uTime * 0.02)).r;
  float ft2 = texture2D(uFoamNoise, fuv * 4.2 + vec2(uTime * 0.05, -uTime * 0.04)).r;
  float pattern = smoother(0.45, 0.95, ft1 * 0.5 + ft2 * 0.65);
  // require strong vFoam AND noise speckles — kills soft continuous bands
  float foam = smoother(0.22, 0.7, vFoam) * pattern;
  foam *= 0.7 + 0.3 * sin(vWorldPos.x * 4.0 + uTime * 3.5 + ft1 * 10.0);
  foam = clamp(foam, 0.0, 1.0);

  vec3 foamCol = mix(vec3(0.82, 0.9, 0.94), vec3(0.98, 0.99, 1.0), pattern);
  foamCol *= 0.7 + 0.3 * NdL;
  color = mix(color, foamCol, foam * 0.7);

  float dist = length(vViewDir);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  color = mix(color, uFogColor, clamp(fog, 0.0, 0.85));

  float alpha = vShoreBlend;
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;
