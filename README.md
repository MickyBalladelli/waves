# Ocean

Realistic real-time ocean in the browser (Three.js + custom GLSL).

## Stack

- **Vite + TypeScript**
- **Three.js r172** — scene, sky, post-processing
- **Custom ocean shader** — multi-Gerstner spectrum, analytical normals, Jacobian foam
- **Planar reflection + scene refraction** with depth-based absorption
- **Shore breakers**, spray particles, bloom / grade / SMAA

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Controls

| Slider | Effect |
|--------|--------|
| Sea State | Overall amplitude |
| Wind Speed | Wave phase speed + spray |
| Choppiness | Horizontal Gerstner displacement |
| Break Distance | How far from shore waves plunge |

Drag to orbit, scroll to zoom, **R** to reset sliders.

## Architecture

```
src/
  main.ts                 # scene, lights, post-FX, loop
  config.ts               # live UI params
  ocean/
    Ocean.ts              # mesh + reflection/refraction passes
    oceanShaders.ts       # vertex/fragment GLSL
    waveSpectrum.ts       # Phillips-inspired wave table
  scene/
    Beach.ts
    Spray.ts
  ui.ts
```
