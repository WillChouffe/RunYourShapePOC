# Shape Run

Generate GPS-art running routes (heart, awareness ribbon, "La Grande Barre", fish, mustache, star) and export them as GPX for Strava, Garmin or Komoot. Frontend only, no backend, no API keys.

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
| `src/shapes.js` | Shape library: control points in unit coords, `closed`, `sharp` corners. Add a shape by pushing an object. |
| `src/geometry.js` | Centripetal Catmull-Rom smoothing, arc-length resampling, rotate/mirror, local equirectangular projection, shape-match score. |
| `src/routing.js` | FOSSGIS OSRM foot routing, skipping waypoints in water or behind detours, spur trimming, scale search. |
| `src/geocode.js` | Nominatim search (on submit only, ≥1.1 s between calls). |
| `src/gpx.js` | GPX 1.1 export. |
| `src/main.js` | Map (Leaflet + OSM tiles) and UI. |

**Follow roads**: sample N waypoints along the shape (corners always included), route them on foot, then rescale (proportional first, then interpolating between the closest over/under tries) up to 5 times until within 5% of the target. The best try is kept.
Waypoints that snap far from any path, or whose leg is a big detour (e.g. across a river), are dropped and the route is recomputed.
Short out-and-back spurs at waypoints are trimmed.

**Free shape**: the shape is scaled so its perimeter equals the target, for beaches, parks and fields. It is also the automatic fallback if routing fails.

## Notes and limits

- Uses public free services (OSM tiles, routing.openstreetmap.de, Nominatim). Fine for a prototype; for a public launch, host your own tiles and OSRM, or use a paid provider.
- Large shapes near coasts or rivers converge poorly (the shape doesn't fit the street network). The app warns when the result is more than 5% off target. Moving the start inland or rotating the shape helps.
- The fundraising link is a placeholder: set `FUNDRAISER_URL` in `src/main.js`.
