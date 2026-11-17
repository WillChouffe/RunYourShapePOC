/**
 * Walkable streets from OpenFreeMap vector tiles (OpenMapTiles schema).
 * Tiles are served by a CDN and cached, so this scales far better than the
 * public Overpass servers. Returns polylines in lat/lng with a stable key
 * per vertex so shared vertices become shared graph nodes.
 */
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;

// OpenMapTiles transportation classes a runner can use.
const WALKABLE = new Set(['primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'pedestrian']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);

let tileUrl = null;

async function template(signal) {
  if (!tileUrl) {
    const res = await fetch(TILEJSON, { signal });
    if (!res.ok) throw new Error(`tile index ${res.status}`);
    tileUrl = (await res.json()).tiles[0];
  }
  return tileUrl;
}

const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};

export function walkable(p) {
  if (!WALKABLE.has(p.class)) return false;
  if (p.foot === 'no' || p.access === 'no' || p.access === 'private') return false;
  if (p.class === 'service' && SKIP_SERVICE.has(p.service)) return false;
  if (p.indoor) return false;
  return true;
}

/**
 * Fetch every z14 tile covering bbox [s, w, n, e] and return the walkable
 * lines: [{ pts: [[key, lat, lng], ...], brunnel }].
 */
export async function fetchTileLines(bbox, signal, onStatus) {
  const [s, w, n, e] = bbox;
  const url = await template(signal);
  const x0 = Math.floor(lon2x(w));
  const x1 = Math.floor(lon2x(e));
  const y0 = Math.floor(lat2y(n));
  const y1 = Math.floor(lat2y(s));
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);

  let done = 0;
  onStatus?.(`Downloading street tiles (0/${jobs.length})…`);
  const lines = [];
  const fetchTile = async ([x, y]) => {
    const res = await fetch(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal });
    if (res.status === 204 || res.status === 404) return;
    if (!res.ok) throw new Error(`tile ${x}/${y}: ${res.status}`);
    const tile = new VectorTile(new Pbf(await res.arrayBuffer()));
    const layer = tile.layers.transportation;
    if (layer) {
      const ext = layer.extent;
      const scale = 2 ** Z;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 2 || !walkable(f.properties)) continue;
        for (const ring of f.loadGeometry()) {
          const pts = ring.map((p) => {
            // global pixel coords: identical for the same vertex in neighbouring tiles
            const gx = x * ext + p.x;
            const gy = y * ext + p.y;
            const lng = (gx / ext / scale) * 360 - 180;
            const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / ext / scale))) * 180) / Math.PI;
            return [gx * 67108864 + gy, lat, lng];
          });
          if (pts.length > 1) lines.push({ pts, brunnel: f.properties.brunnel || null });
        }
      }
    }
    onStatus?.(`Downloading street tiles (${++done}/${jobs.length})…`);
  };
  // a few in parallel
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) await fetchTile(queue.shift());
  }));
  return lines;
}

