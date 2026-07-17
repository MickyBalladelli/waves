import * as THREE from 'three';

/** Soft-edged animated caustics over the intertidal shelf. */
export function createCausticsPlane(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.45 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vWorld;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      float caustic(vec2 p, float t) {
        vec2 q = p;
        q += 0.35 * vec2(noise(p + t * 0.15), noise(p.yx - t * 0.12));
        q += 0.2 * vec2(noise(q * 1.7 - t * 0.2), noise(q.yx * 1.5 + t * 0.18));
        float n1 = noise(q * 3.0 + t * 0.4);
        float n2 = noise(q * 5.5 - t * 0.35);
        float n3 = noise(q * 9.0 + t * 0.25);
        float c = pow(1.0 - abs(n1 * 2.0 - 1.0), 4.0);
        c += 0.55 * pow(1.0 - abs(n2 * 2.0 - 1.0), 5.0);
        c += 0.3 * pow(1.0 - abs(n3 * 2.0 - 1.0), 6.0);
        return c;
      }

      void main() {
        // soft UV edge falloff — kills hard rectangle borders
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x)
                   * smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);

        // active mainly in shallow shelf (negative Z) and just over wet sand
        float shore = smoothstep(6.0, -1.0, vWorld.z) * smoothstep(-38.0, -3.0, vWorld.z);
        float shallow = smoothstep(1.8, -0.2, abs(vWorld.y));
        float mask = shore * shallow * edge;
        if (mask < 0.008) discard;

        vec2 p = vWorld.xz * 0.12;
        float c = caustic(p, uTime);
        float c2 = caustic(p * 1.3 + 4.2, uTime * 0.85 + 10.0);
        float pattern = pow(c * 0.7 + c2 * 0.45, 1.45);

        vec3 col = vec3(0.5, 0.82, 0.95) * pattern * uIntensity * mask;
        float alpha = pattern * mask * 0.48;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(140, 55, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.04, -14);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}

export function updateCaustics(mesh: THREE.Mesh, time: number, intensity: number) {
  const mat = mesh.material as THREE.ShaderMaterial;
  mat.uniforms.uTime.value = time;
  mat.uniforms.uIntensity.value = intensity;
}
