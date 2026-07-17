/** Phillips-inspired multi-Gerstner spectrum (CPU-generated, GPU-evaluated). */

export type Wave = {
  dx: number;
  dz: number;
  wavelength: number;
  steepness: number;
  speed: number;
  phase: number;
};

const TAU = Math.PI * 2;

function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build a directional sea spectrum aimed mostly toward +Z (shore).
 * Packs as flat Float32Array: [dx, dz, λ, steep, speed, phase] * N
 */
export function buildWaveSpectrum(count = 32): { waves: Wave[]; data: Float32Array } {
  const waves: Wave[] = [];
  const windAngle = 0.0; // radians from +Z
  const windDirX = Math.sin(windAngle);
  const windDirZ = Math.cos(windAngle);

  // Log-spaced wavelengths: swell → chop
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // denser at short wavelengths
    const wavelength = Math.exp(Math.log(42) * (1 - t) + Math.log(1.15) * t);

    // angular spread tighter for long swell
    const spread = 0.18 + t * 0.95;
    const side = (hash(i, 1) * 2 - 1) * spread;
    const ang = windAngle + side + (hash(i, 2) - 0.5) * 0.12 * t;
    let dx = Math.sin(ang);
    let dz = Math.cos(ang);
    // bias slightly toward wind
    dx = dx * 0.85 + windDirX * 0.15;
    dz = dz * 0.85 + windDirZ * 0.15;
    const inv = 1 / Math.hypot(dx, dz);
    dx *= inv;
    dz *= inv;

    // alignment with wind → more energy
    const align = Math.max(0, dx * windDirX + dz * windDirZ);
    const phillips = Math.exp(-1.0 / Math.max(wavelength / 8, 0.2)) / Math.pow(wavelength, 1.35);
    const baseSteep = (0.09 + 0.22 * (1 - t)) * (0.35 + 0.65 * align * align) * phillips * 18;
    const steepness = Math.min(0.38, baseSteep * (0.7 + hash(i, 3) * 0.6));

    // deep-water dispersion ω = sqrt(g k), speed used as scale in shader
    const k = TAU / wavelength;
    const c = Math.sqrt(9.81 / k);
    const speed = c / Math.max(wavelength * 0.12, 0.5); // normalized for shader

    waves.push({
      dx,
      dz,
      wavelength,
      steepness,
      speed: 0.55 + speed * 0.08 + hash(i, 4) * 0.12,
      phase: hash(i, 5) * TAU,
    });
  }

  const data = new Float32Array(count * 6);
  waves.forEach((w, i) => {
    const o = i * 6;
    data[o] = w.dx;
    data[o + 1] = w.dz;
    data[o + 2] = w.wavelength;
    data[o + 3] = w.steepness;
    data[o + 4] = w.speed;
    data[o + 5] = w.phase;
  });

  return { waves, data };
}

/** CPU sample of primary swell for spray placement. */
export function sampleSwellHeight(
  waves: Wave[],
  x: number,
  z: number,
  time: number,
  heightScale: number,
  speedScale: number,
  n = 6,
): number {
  let y = 0;
  for (let i = 0; i < Math.min(n, waves.length); i++) {
    const w = waves[i];
    const k = TAU / w.wavelength;
    const a = Math.min((w.steepness / k) * heightScale, w.wavelength * 0.1 * heightScale);
    const c = Math.sqrt(9.81 / k) * w.speed * speedScale;
    const f = k * (w.dx * x + w.dz * z) - c * time + w.phase;
    y += a * Math.sin(f);
  }
  return y;
}
