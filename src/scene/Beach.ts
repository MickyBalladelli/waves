import * as THREE from 'three';

/**
 * Beach + intertidal shelf that continues under the water so the shoreline
 * never shows a hard geometric seam.
 */
export function createBeach(): THREE.Group {
  const group = new THREE.Group();

  // Dry / wet sand on land (z >= 0) and a submerged shelf (z < 0)
  const w = 200;
  const landDepth = 70; // toward camera (+)
  const shelfDepth = 40; // under water toward sea (-)
  const totalDepth = landDepth + shelfDepth;
  const maxH = 4.2;
  const sx = 160;
  const sz = 110;
  const vx = sx + 1;
  const vz = sz + 1;

  const pos = new Float32Array(vx * vz * 3);
  const colors = new Float32Array(vx * vz * 3);
  const dry = new THREE.Color(0xd8bf9c);
  const damp = new THREE.Color(0x8f7a64);
  const wet = new THREE.Color(0x3d342c);
  const underwater = new THREE.Color(0x2a4038);

  for (let iz = 0; iz < vz; iz++) {
    for (let ix = 0; ix < vx; ix++) {
      const i = (iz * vx + ix) * 3;
      const u = ix / sx;
      const v = iz / sz; // 0 = far under water, 1 = inland
      const x = (u - 0.5) * w;
      // map v so shoreline sits near z = 0
      const z = -shelfDepth + v * totalDepth;

      const dunes =
        Math.sin(x * 0.065) * 0.2 +
        Math.sin(x * 0.17 + z * 0.07) * 0.09 +
        Math.sin(x * 0.38) * Math.cos(z * 0.13) * 0.045;

      // height profile: negative under water, rising on land
      let y: number;
      if (z < 0) {
        // gentle shelf dropping seaward
        const t = THREE.MathUtils.clamp(-z / shelfDepth, 0, 1);
        y = -0.15 - t * t * 3.8 + dunes * 0.04 * (1 - t);
      } else {
        const t = THREE.MathUtils.clamp(z / landDepth, 0, 1);
        y = maxH * Math.pow(t, 0.52) + dunes * t * t - 0.02;
      }

      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;

      // wetness: max at shoreline, dry inland, green-brown underwater
      let c: THREE.Color;
      if (z < 0) {
        const t = THREE.MathUtils.smoothstep(0, -shelfDepth * 0.85, z);
        c = wet.clone().lerp(underwater, t);
      } else {
        const wetness = 1 - THREE.MathUtils.smoothstep(0.0, 14.0, z);
        c = dry.clone().lerp(damp, THREE.MathUtils.smoothstep(0.12, 0.45, wetness));
        c = c.lerp(wet, THREE.MathUtils.smoothstep(0.5, 1.0, wetness) * 0.9);
      }

      const grain = Math.sin(x * 4.1 + z * 2.0) * Math.cos(x * 1.6 - z * 3.1) * 0.03;
      colors[i] = Math.min(1, c.r + grain);
      colors[i + 1] = Math.min(1, c.g + grain * 0.85);
      colors[i + 2] = Math.min(1, c.b + grain * 0.55);
    }
  }

  const idx: number[] = [];
  for (let iz = 0; iz < sz; iz++) {
    for (let ix = 0; ix < sx; ix++) {
      const a = iz * vx + ix;
      const b = a + 1;
      const c = a + vx;
      const d2 = c + 1;
      idx.push(a, b, d2, a, d2, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.0,
    envMapIntensity: 0.22,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);

  return group;
}
