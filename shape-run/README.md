# ZobRun

Generate GPS-art running routes (heart, awareness ribbon, "La Grande Barre", fish, mustache, middle finger, star) and export them as GPX for Strava, Garmin or Komoot. Frontend only, no backend, no API keys.

## Run it

```bash
cd shape-run
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` outputs a static site to `dist/`.

## Deploy (Netlify)

`netlify.toml` at the repo root does the setup: base `shape-run`, build `npm ci && npm run build`, publish `dist`, Node 22. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo. Every push to the deployed branch redeploys.

## How it works

| Module | Role |
| --- | --- |
| `src/shapes.js` | Shape library: control points, `closed`, `sharp` corners, optional `variants` tried in the background. Add a shape by pushing an object. |
| `src/osm.js` | Downloads the walkable street network from Overpass (with mirrors) and builds a graph in local metres. |
| `src/planner.js` | Shape-following router (corridor A*), placement search, river/bridge check, fidelity score. |
| `src/plan.worker.js` | Runs download + search in a Web Worker; keeps the street graph between runs. |
| `src/routing.js` | Fallback: FOSSGIS OSRM shortest-path routing between waypoints. |
| `src/geometry.js` | Catmull-Rom smoothing, arc-length resampling, rotate/mirror, projection. |
| `src/geocode.js` | Nominatim search (on submit only, ≥1.1 s between calls). |
| `src/gpx.js` | GPX 1.1 export. |
| `src/main.js` | Map (Leaflet + OSM tiles) and UI. |

**Follow roads**:
1. Download the streets and paths around the start (Overpass), once per area.
2. Build candidates: the shape and its variants, rotated by up to ±30° (Auto-tune), with the start slid a little along the outline.
3. Pre-score each candidate by how much of its outline runs along a street with the same direction, then check the best ones for bottlenecks: if walking between neighbouring outline points is much longer than the straight line, a river, railway or motorway cuts the shape with no crossing nearby.
4. Route the best candidates with corridor A*: each street costs `length × (1 + (gap/σ)² + 0.8 × (1 − alignment))`, so streets close to and parallel with the drawing win. Out-and-backs are allowed (thin parts can be run both ways on one street); short accidental stubs are trimmed.
5. Rescale the best three until the distance is within 3–5% of the target, and keep the one with the best fidelity.

Fidelity (the MATCH %) blends the mean and 90th-percentile gap between route and drawing, relative to the shape size. 0% means the route is on average 5% of the shape size away.

If street data can't be downloaded, the app falls back to OSRM routing, then to Free shape.

**Free shape**: the shape is scaled so its perimeter equals the target, for beaches, parks and fields.

## Notes and limits

- Uses public free services (OSM tiles, Overpass, routing.openstreetmap.de, Nominatim). Fine for a prototype; for a public launch, host your own tiles and OSRM, or use a paid provider.
- Suburbs with irregular streets give lower match scores than grid-like city centres. Fine details (finger stubs, fins) need at least a half-marathon to show.
- The fundraising link is a placeholder: set `FUNDRAISER_URL` in `src/main.js`.
