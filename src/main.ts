import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Ocean } from './ocean/Ocean';
import { createBeach } from './scene/Beach';
import { createCausticsPlane, updateCaustics } from './scene/Caustics';
import { Spray } from './scene/Spray';
import { setupUI } from './ui';
import { CONFIG } from './config';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x7eb6d9, 0.0035);

const camera = new THREE.PerspectiveCamera(
  48,
  window.innerWidth / window.innerHeight,
  0.25,
  800,
);
// lower angle to read the barrel tube from inside/side
camera.position.set(6.5, 3.8, 6.5);
camera.lookAt(0, 1.2, -9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -9);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 3;
controls.maxDistance = 150;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minPolarAngle = 0.08;
controls.update();

// ---------------------------------------------------------------------------
// Sky + sun
// ---------------------------------------------------------------------------
const sky = new Sky();
sky.scale.setScalar(4500);
scene.add(sky);

const sun = new THREE.Vector3();
const sunElevation = 28; // degrees
const sunAzimuth = 168;
{
  const phi = THREE.MathUtils.degToRad(90 - sunElevation);
  const theta = THREE.MathUtils.degToRad(sunAzimuth);
  sun.setFromSphericalCoords(1, phi, theta);
}

sky.material.uniforms.turbidity.value = 2.8;
sky.material.uniforms.rayleigh.value = 1.9;
sky.material.uniforms.mieCoefficient.value = 0.0045;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.sunPosition.value.copy(sun);

// env map for beach
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(4500);
  envSky.material.uniforms.turbidity.value = 2.8;
  envSky.material.uniforms.rayleigh.value = 1.9;
  envSky.material.uniforms.mieCoefficient.value = 0.0045;
  envSky.material.uniforms.mieDirectionalG.value = 0.85;
  envSky.material.uniforms.sunPosition.value.copy(sun);
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
}

scene.add(new THREE.AmbientLight(0x8eb6d8, 0.28));
const hemi = new THREE.HemisphereLight(0x9ecfff, 0xc2a878, 0.4);
scene.add(hemi);

const sunLight = new THREE.DirectionalLight(0xfff2d0, 3.8);
sunLight.position.copy(sun).multiplyScalar(200);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 420;
sunLight.shadow.camera.left = -130;
sunLight.shadow.camera.right = 130;
sunLight.shadow.camera.top = 130;
sunLight.shadow.camera.bottom = -130;
sunLight.shadow.bias = -0.00025;
scene.add(sunLight);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const beach = createBeach();
scene.add(beach);

// deep seabed — sandy-green, not navy (avoids "scuba" look through water)
{
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 280, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x3a5a52,
      roughness: 1,
      metalness: 0,
    }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, -5.2, -100);
  bed.receiveShadow = true;
  scene.add(bed);
}

const ocean = new Ocean();
scene.add(ocean.mesh);
ocean.setSun(sun, new THREE.Color(0xfff1c8));
ocean.setSize(window.innerWidth, window.innerHeight);

const spray = new Spray(ocean.waves);
scene.add(spray.points);
ocean.hideDuringPasses.push(spray.points);

const caustics = createCausticsPlane();
scene.add(caustics);

// removed hard haze plane (it could read as a horizon "line")

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// low bloom so spray/foam never bloom into a solid white strip
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.1,
  0.85,
  0.92,
);
composer.addPass(bloom);

// mild color grade / contrast
const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.18 },
    uSat: { value: 1.06 },
    uContrast: { value: 1.03 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSat;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - smoothstep(0.35, 0.95, d) * uVignette;
      gl_FragColor = vec4(col, c.a);
    }
  `,
};
composer.addPass(new ShaderPass(gradeShader));

const smaa = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// UI + resize
// ---------------------------------------------------------------------------
setupUI();

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  ocean.setSize(w, h);
  smaa.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  spray.setPixelRatio(renderer.getPixelRatio());
}
window.addEventListener('resize', onResize);
spray.setPixelRatio(renderer.getPixelRatio());

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let last = performance.now();

function frame() {
  requestAnimationFrame(frame);
  const time = clock.getElapsedTime();
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  controls.update();
  ocean.update(time);
  spray.update(time, dt);
  updateCaustics(caustics, time, 0.35 + 0.35 * Math.min(CONFIG.seaState, 1.5));

  // reflection + refraction offscreen
  ocean.updatePasses(renderer, scene, camera);

  composer.render();
}

frame();
