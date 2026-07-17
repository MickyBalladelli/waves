import * as THREE from 'three';
import { CONFIG } from '../config';
import { sampleSwellHeight, type Wave } from '../ocean/waveSpectrum';

/**
 * Fine mist / spray off the barrel lip.
 * Many tiny particles, crest-gated so they don't form a solid white band.
 */
export class Spray {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly sizes: Float32Array;
  private readonly count: number;

  constructor(private readonly waves: Wave[], count = 5200) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.sizes = new Float32Array(count);

    // tiny soft speck (mostly transparent so many can stack as mist)
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.25, 'rgba(240,248,255,0.45)');
    grd.addColorStop(0.65, 'rgba(210,235,255,0.08)');
    grd.addColorStop(1, 'rgba(180,220,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);

    for (let i = 0; i < count; i++) {
      this.life[i] = Math.random();
      this.maxLife[i] = 1;
      this.sizes[i] = 0.04 + Math.random() * 0.1;
      this.positions[i * 3 + 1] = -80;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aMaxLife', new THREE.BufferAttribute(this.maxLife, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSizeScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aLife;
        attribute float aMaxLife;
        uniform float uPixelRatio;
        uniform float uSizeScale;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          vUv = vec2(0.0);
          float alive = aLife > 0.0 && aLife < aMaxLife ? 1.0 : 0.0;
          float age = 1.0 - clamp(aLife / max(aMaxLife, 0.001), 0.0, 1.0);
          // fade in, then out
          float fade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.55, 1.0, age));
          vAlpha = fade * alive * 0.55;

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // world size → screen size; keep particles tiny
          float dist = max(-mv.z, 0.5);
          gl_PointSize = aSize * uSizeScale * uPixelRatio * (180.0 / dist);
          gl_PointSize = clamp(gl_PointSize, 0.5, 18.0);
          if (alive < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // offscreen
            gl_PointSize = 0.0;
          }
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          vec3 col = mix(vec3(0.85, 0.93, 0.98), vec3(1.0), t.r);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setPixelRatio(pr: number) {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uPixelRatio.value = Math.min(pr, 2);
  }

  update(time: number, dt: number) {
    const breakD = CONFIG.breakDistance;
    const arr = this.positions;
    const vel = this.velocities;
    const life = this.life;
    const maxLife = this.maxLife;
    const sizes = this.sizes;
    const speed = CONFIG.windSpeed;
    const sea = CONFIG.seaState;

    // match barrel peel / phase from ocean shader
    for (let i = 0; i < this.count; i++) {
      let L = life[i] - dt;
      const i3 = i * 3;

      if (L <= 0) {
        let spawned = false;
        // more attempts → denser mist when barrels are active
        for (let attempt = 0; attempt < 6; attempt++) {
          const x = (Math.random() - 0.5) * 95;
          const peelWave = Math.sin(x * 0.038 - time * speed * 0.62);
          const peel2 = Math.sin(x * 0.019 - time * speed * 0.31 + 1.7);
          const peel = Math.max(
            THREE.MathUtils.smoothstep(-0.15, 0.75, peelWave) * 0.75,
            THREE.MathUtils.smoothstep(-0.25, 0.55, peel2) * 0.9,
          );
          if (peel < 0.35) continue;

          // spawn near lip of tube (slightly shoreward of break line)
          const z =
            -breakD * (0.72 + Math.random() * 0.5) +
            (Math.random() - 0.5) * 4.0;

          const phase = z * 0.55 + x * 0.028 - time * speed * 0.88;
          const wr = Math.atan2(Math.sin(phase), Math.cos(phase));
          // lip / tip region of the barrel
          const lip = Math.exp(-Math.pow(wr + 0.72, 2) * 7.5);
          const tip = Math.exp(-Math.pow(wr + 1.05, 2) * 14.0);
          const crest = Math.exp(-wr * wr * 5.5);
          const strength = Math.max(lip * 1.2, tip * 1.4, crest * 0.45) * peel;
          if (strength < 0.2 || Math.random() > strength * 0.85) continue;

          const baseY =
            sampleSwellHeight(this.waves, x, z, time, sea, speed) +
            (1.0 + 1.8 * peel) * sea * (0.4 + lip + tip);

          // tight burst around lip tip
          arr[i3] = x + (Math.random() - 0.5) * 0.9;
          arr[i3 + 1] = baseY + Math.random() * 0.5;
          arr[i3 + 2] = z + (Math.random() - 0.5) * 0.8;

          // mostly fine mist: small upward + shoreward spray cone
          const spread = 0.7 + Math.random() * 1.4;
          vel[i3] = (Math.random() - 0.5) * 3.5 * spread;
          vel[i3 + 1] = 1.2 + Math.random() * 4.5 * sea * (0.5 + peel);
          vel[i3 + 2] = 1.0 + Math.random() * 3.2 * peel;

          // tiny droplets dominate; rare slightly larger flecks
          const r = Math.random();
          sizes[i] = r < 0.82 ? 0.03 + Math.random() * 0.05 : 0.07 + Math.random() * 0.08;

          const ml = 0.35 + Math.random() * 0.55;
          maxLife[i] = ml;
          L = ml;
          spawned = true;
          break;
        }
        if (!spawned) {
          // retry soon so pool stays dense when waves peel
          maxLife[i] = 1;
          L = 0.02 + Math.random() * 0.08;
          arr[i3 + 1] = -80;
        }
      } else {
        arr[i3] += vel[i3] * dt;
        arr[i3 + 1] += vel[i3 + 1] * dt;
        arr[i3 + 2] += vel[i3 + 2] * dt;
        vel[i3 + 1] -= 9.8 * dt;
        // air drag — mist hangs a bit then falls
        const drag = 1 - 1.1 * dt;
        vel[i3] *= drag;
        vel[i3 + 1] *= 1 - 0.15 * dt;
        vel[i3 + 2] *= drag;
        // kill if under water
        if (arr[i3 + 1] < -0.2) L = 0;
      }
      life[i] = L;
    }

    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aMaxLife as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;

    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uSizeScale.value = 0.85 + 0.2 * Math.min(sea, 1.8);
  }
}
