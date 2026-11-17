/**
 * Walkable street network from OpenStreetMap (Overpass API), turned into a
 * compact graph in local metres for our own shape-following router.
 */

// Public Overpass instances, tried in order. The main one is often at capacity.
const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const HIGHWAYS = [
  'footway', 'path', 'pedestrian', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link',
  'track', 'steps', 'cycleway', 'road', 'bridleway',
].join('|');

export class NetworkError extends Error {}

function query([south, west, north, east]) {
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(',');
  // Sidewalks, crossings, driveways and parking aisles add lots of nodes but
  // nothing a runner drawing a shape needs: the street itself is enough.
  return `[out:json][timeout:90];
way["highway"~"^(${HIGHWAYS})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]["footway"!~"^(sidewalk|crossing)$"]["service"!~"^(driveway|parking_aisle|drive-through)$"]["area"!="yes"](${bbox});
(._;>;);out skel qt;`;
}

/**
 * Fetch the walkable network inside bbox [south, west, north, east].
 * Returns raw Overpass elements.
 */
export async function fetchNetwork(bbox, signal, onStatus) {
  const body = new URLSearchParams({ data: query(bbox) });
  const errors = [];
  for (const url of ENDPOINTS) {
    onStatus?.(`Downloading streets from ${new URL(url).host}…`);
    try {
      const res = await fetch(url, { method: 'POST', body, signal });
      if (!res.ok) {
        errors.push(`${new URL(url).host} ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!data.elements?.length) {
        errors.push('no streets found');
        continue;
      }
      return data.elements;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      errors.push(`${new URL(url).host} unreachable`);
    }
  }
  throw new NetworkError(`Street data unavailable (${errors.join(', ')})`);
}

/**
 * Build a graph in local metres around `origin` ({lat, lng}).
 * Nodes: x, y (Float64Array). Adjacency in CSR form: for node i, neighbours
 * are adj[off[i] .. off[i+1]) with edge lengths in len[].
 */
export function buildGraph(elements, origin) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const cosLat = Math.cos(origin.lat * rad);
  const coords = new Map();
  for (const e of elements) if (e.type === 'node') coords.set(e.id, e);

  const index = new Map(); // osm id -> graph index
  const xs = [];
  const ys = [];
  const node = (id) => {
    let i = index.get(id);
    if (i === undefined) {
      const n = coords.get(id);
      if (!n) return -1;
      i = xs.length;
      index.set(id, i);
      xs.push((n.lon - origin.lng) * rad * R * cosLat);
      ys.push((n.lat - origin.lat) * rad * R);
    }
    return i;
  };

  const from = [];
  const to = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.nodes) continue;
    let prev = node(e.nodes[0]);
    for (let k = 1; k < e.nodes.length; k++) {
      const cur = node(e.nodes[k]);
      if (prev >= 0 && cur >= 0 && prev !== cur) {
        from.push(prev);
        to.push(cur);
      }
      prev = cur;
    }
  }

  const n = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const deg = new Uint32Array(n + 1);
  for (let k = 0; k < from.length; k++) {
    deg[from[k] + 1]++;
    deg[to[k] + 1]++;
  }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const off = deg;
  const fill = off.slice(0, n);
  const adj = new Uint32Array(from.length * 2);
  const len = new Float32Array(from.length * 2);
  for (let k = 0; k < from.length; k++) {
    const a = from[k];
    const b = to[k];
    const d = Math.hypot(x[b] - x[a], y[b] - y[a]);
    adj[fill[a]] = b; len[fill[a]++] = d;
    adj[fill[b]] = a; len[fill[b]++] = d;
  }
  // Label connected components: we only snap to the main network, never to
  // an isolated footway inside a private compound.
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const c = sizes.length;
    let size = 0;
    comp[s] = c;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (let e = off[u]; e < off[u + 1]; e++) {
        const v = adj[e];
        if (comp[v] === -1) { comp[v] = c; stack.push(v); }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  return { n, x, y, off, adj, len, origin, comp, main, edges: { from, to }, grid: buildGrid(x, y, from, to) };
}

/* Uniform grid over edges, for "nearest street" queries. */
const CELL = 60; // metres

function buildGrid(x, y, from, to) {
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (let k = 0; k < from.length; k++) {
    const a = from[k];
    const b = to[k];
    const i0 = Math.floor(Math.min(x[a], x[b]) / CELL);
    const i1 = Math.floor(Math.max(x[a], x[b]) / CELL);
    const j0 = Math.floor(Math.min(y[a], y[b]) / CELL);
    const j1 = Math.floor(Math.max(y[a], y[b]) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const kk = key(i, j);
        let list = cells.get(kk);
        if (!list) cells.set(kk, (list = []));
        list.push(k);
      }
    }
  }
  return { cells, key };
}

/** Visit edges whose grid cells are within `r` metres of (px, py). */
export function forEdgesNear(g, px, py, r, fn) {
  const { cells, key } = g.grid;
  const i0 = Math.floor((px - r) / CELL);
  const i1 = Math.floor((px + r) / CELL);
  const j0 = Math.floor((py - r) / CELL);
  const j1 = Math.floor((py + r) / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = cells.get(key(i, j));
      if (list) for (const k of list) fn(k);
    }
  }
}
