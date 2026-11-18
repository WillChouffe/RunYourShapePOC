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
| `src/tiles.js` | Main street source: OpenFreeMap z14 vector tiles (CDN, no key, no rate limit), walkable classes only. |
| `src/osm.js` | Builds the street graph in local metres (repairs junctions lost in vector tiles); Overpass download as a fallback. |
| `src/planner.js` | Shape-following router (corridor A*), placement search, river/bridge check, fidelity score. |
| `src/plan.worker.js` | Runs download + search in a Web Worker; keeps the street graph between runs. |
| `src/routing.js` | Fallback: FOSSGIS OSRM shortest-path routing between waypoints. |
| `src/geometry.js` | Catmull-Rom smoothing, arc-length resampling, rotate/mirror, projection. |
| `src/geocode.js` | Nominatim search (on submit only, ≥1.1 s between calls). |
| `src/gpx.js` | GPX 1.1 export. |
| `src/main.js` | Map (Leaflet + OSM tiles) and UI. |

**Follow roads**:
1. Download the streets and paths around the start from OpenFreeMap vector tiles (Overpass if that fails), once per area.
2. Build candidates (Auto-tune): the shape and its variants, at the runner's rotation plus the street-grid-aligned one (grid cities) or ±12° (irregular ones), entered from 8 points around the outline. Each is tried at the pin and at 18 places up to 1.5 km away (reached by running there and back), as one big drawing or a smaller one run 2 or 3 times.
3. Pre-score all of them (thousands) against a per-direction distance field of the streets: how much of the outline runs close to a street going the same way. The best, plus the best with 2 laps, 3 laps and away from the pin, are checked for bottlenecks: if walking between neighbouring outline points is much longer than the straight line, a river, railway or motorway cuts the shape with no crossing nearby.
4. Route the best candidates with corridor A*: each street costs `length × (1 + (gap/σ)² + 0.8 × (1 − alignment))`, so streets close to and parallel with the drawing win. Out-and-backs are allowed (thin parts can be run both ways on one street); short accidental stubs are trimmed.
5. Rescale the best three until approach + laps × loop is within 3–5% of the target. The winner has the best fidelity minus penalties for staircasing (street runs at an angle to the drawing next to them), turning away from the chosen or grid-aligned orientation (stronger in grid cities), the share of the run spent getting to the drawing, and extra laps.

Fidelity (the MATCH %) blends the mean and 90th-percentile gap between route and drawing, relative to the shape size. 0% means the route is on average 5% of the shape size away.

If street data can't be downloaded, the app falls back to OSRM routing, then to Free shape.

**Free shape**: the shape is scaled so its perimeter equals the target, for beaches, parks and fields.

## Notes and limits

- Uses public free services (OSM tiles, OpenFreeMap, Overpass, routing.openstreetmap.de, Nominatim). Fine for a prototype; for a public launch, host your own tiles and OSRM, or use a paid provider.
- Suburbs with irregular streets give lower match scores than grid-like city centres. Fine details (finger stubs, fins) need at least a half-marathon to show.
- The fundraising link is a placeholder: set `FUNDRAISER_URL` in `src/main.js`.
