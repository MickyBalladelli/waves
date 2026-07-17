import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildWaveSpectrum, type Wave } from './waveSpectrum';
import {
  OCEAN_WAVE_COUNT,
  oceanFragmentShader,
  oceanVertexShader,
} from './oceanShaders';

function makeFoamNoise(): THREE.CanvasTexture {
  const n = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);

  const noise2 = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      let amp = 0.5;
      let freq = 1;
      for (let o = 0; o < 6; o++) {
        const nx = (x / n) * freq * 8;
        const ny = (y / n) * freq * 8;
        const ix = Math.floor(nx);
        const iy = Math.floor(ny);
        const fx = nx - ix;
        const fy = ny - iy;
        const u = fx * fx * (3 - 2 * fx);
        const w = fy * fy * (3 - 2 * fy);
        const a = noise2(ix, iy);
        const b = noise2(ix + 1, iy);
        const c = noise2(ix, iy + 1);
        const d = noise2(ix + 1, iy + 1);
        v += (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      const speck =
        Math.max(0, Math.sin(x * 0.37 + y * 0.21) * Math.cos(x * 0.19 - y * 0.41) * 0.5 + 0.1);
      const t = Math.min(255, Math.floor((v * 0.78 + speck * 0.45) * 255));
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly waves: Wave[];
  readonly waveData: Float32Array;

  private readonly reflectionTarget: THREE.WebGLRenderTarget;
  private readonly refractionTarget: THREE.WebGLRenderTarget;
  private readonly reflectionCamera: THREE.PerspectiveCamera;
  private readonly dummyWhite: THREE.Texture;
  private readonly dummyDepth: THREE.DepthTexture;

  constructor(width = 380, depth = 180) {
    const { waves, data } = buildWaveSpectrum(OCEAN_WAVE_COUNT);
    this.waves = waves;
    this.waveData = data;

    // high density so the barrel lip can curl without faceting
    const segsX = 480;
    const segsZ = 320;
    const geo = new THREE.PlaneGeometry(width, depth, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);

    const foamNoise = makeFoamNoise();

    // placeholder textures until first render
    const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    empty.needsUpdate = true;
    this.dummyWhite = empty;

    this.dummyDepth = new THREE.DepthTexture(1, 1);
    this.dummyDepth.type = THREE.UnsignedIntType;

    const depthTex = new THREE.DepthTexture(1, 1);
    depthTex.type = THREE.UnsignedIntType;
    depthTex.format = THREE.DepthFormat;

    this.reflectionTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      samples: 0,
    });

    this.refractionTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      depthTexture: depthTex,
      samples: 0,
    });

    this.reflectionCamera = new THREE.PerspectiveCamera();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeaState: { value: CONFIG.seaState },
        uWindSpeed: { value: CONFIG.windSpeed },
        uChoppiness: { value: CONFIG.choppiness },
        uBreakDist: { value: CONFIG.breakDistance },
        uShorelineZ: { value: 0 },
        uShoalZone: { value: 28 },
        uWaves: { value: this.waveData },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xfff1c8) },
        uDeepColor: { value: new THREE.Color(0x0a4a72) },
        uShallowColor: { value: new THREE.Color(0x3ec4d4) },
        uSkyColor: { value: new THREE.Color(0x6eb0d8) },
        uHorizonColor: { value: new THREE.Color(0xc8dceb) },
        uFogColor: { value: new THREE.Color(0x7eb6d9) },
        uFogDensity: { value: 0.0035 },
        uReflection: { value: empty },
        uRefraction: { value: empty },
        uRefractionDepth: { value: this.dummyDepth },
        uFoamNoise: { value: foamNoise },
        uCameraNear: { value: 0.5 },
        uCameraFar: { value: 500 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      transparent: true,
      // DoubleSide so curled lip underside / tube interior is visible
      side: THREE.DoubleSide,
      depthWrite: false,
      dithering: true,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    // shift slightly seaward so the near edge soft-blends over the shelf
    this.mesh.position.set(0, 0.01, -depth / 2 + 2);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setSize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.max(1, Math.floor(width * dpr * 0.75));
    const h = Math.max(1, Math.floor(height * dpr * 0.75));
    this.reflectionTarget.setSize(w, h);
    this.refractionTarget.setSize(w, h);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  setSun(direction: THREE.Vector3, color: THREE.Color) {
    this.material.uniforms.uSunDir.value.copy(direction).normalize();
    this.material.uniforms.uSunColor.value.copy(color);
  }

  /** Optional objects hidden during reflection / refraction captures. */
  hideDuringPasses: THREE.Object3D[] = [];

  /**
   * Render reflection (mirrored camera) + refraction (scene without water),
   * then bind textures to the ocean material.
   */
  updatePasses(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const waterY = this.mesh.position.y;
    const hidden = [this.mesh, ...this.hideDuringPasses];
    for (const o of hidden) o.visible = false;

    // --- Refraction: scene without ocean ---
    renderer.setRenderTarget(this.refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // --- Reflection: mirror camera over water plane y = waterY ---
    this.reflectionCamera.fov = camera.fov;
    this.reflectionCamera.aspect = camera.aspect;
    this.reflectionCamera.near = camera.near;
    this.reflectionCamera.far = camera.far;
    this.reflectionCamera.updateProjectionMatrix();

    const pos = camera.position;
    this.reflectionCamera.position.set(pos.x, 2 * waterY - pos.y, pos.z);

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const lookAt = pos.clone().add(forward);
    lookAt.y = 2 * waterY - lookAt.y;
    // Mirror Y: negate up so sky stays upright after mirror
    this.reflectionCamera.up.set(0, -1, 0);
    this.reflectionCamera.lookAt(lookAt);
    this.reflectionCamera.updateMatrixWorld(true);

    renderer.setRenderTarget(this.reflectionTarget);
    renderer.clear();
    renderer.render(scene, this.reflectionCamera);
    renderer.setRenderTarget(null);

    for (const o of hidden) o.visible = true;

    const u = this.material.uniforms;
    u.uReflection.value = this.reflectionTarget.texture;
    u.uRefraction.value = this.refractionTarget.texture;
    u.uRefractionDepth.value = this.refractionTarget.depthTexture ?? this.dummyDepth;
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
  }

  update(time: number) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSeaState.value = CONFIG.seaState;
    u.uWindSpeed.value = CONFIG.windSpeed;
    u.uChoppiness.value = CONFIG.choppiness;
    u.uBreakDist.value = CONFIG.breakDistance;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.reflectionTarget.dispose();
    this.refractionTarget.dispose();
    this.dummyWhite.dispose();
  }
}
