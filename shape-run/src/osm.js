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
    const host = new URL(url).host;
    // Busy servers answer 429/504 (without CORS headers, so the browser
    // reports a CORS error): wait a little and try once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      onStatus?.(`Downloading streets from ${host}…`);
      try {
        const res = await fetch(url, { method: 'POST', body, signal });
        if (!res.ok) {
          errors.push(`${host} ${res.status}`);
          if (res.status !== 429 && res.status !== 504) break;
        } else {
          const data = await res.json();
          if (data.elements?.length) return data.elements;
          errors.push('no streets found');
          break;
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push(`${host} unreachable`);
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw new NetworkError(`Street data unavailable (${errors.join(', ')})`);
}

/** Overpass elements -> lines of [key, lat, lng] (key = OSM node id). */
export function linesFromOverpass(elements) {
  const coords = new Map();
  for (const e of elements) if (e.type === 'node') coords.set(e.id, e);
  const lines = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.nodes) continue;
    const pts = e.nodes.map((id) => coords.get(id)).filter(Boolean).map((n) => [n.id, n.lat, n.lon]);
    if (pts.length > 1) lines.push({ pts });
  }
  return lines;
}

/**
 * Build a graph in local metres around `origin` ({lat, lng}) from lines of
 * [key, lat, lng]; vertices with the same key become one node.
 * Nodes: x, y (Float64Array). Adjacency in CSR form: for node i, neighbours
 * are adj[off[i] .. off[i+1]) with edge lengths in len[].
 */
export function buildGraph(lines, origin, { repair = false } = {}) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const cosLat = Math.cos(origin.lat * rad);
  const index = new Map(); // key -> graph index
  const xs = [];
  const ys = [];
  const node = ([key, lat, lng]) => {
    let i = index.get(key);
    if (i === undefined) {
      i = xs.length;
      index.set(key, i);
      xs.push((lng - origin.lng) * rad * R * cosLat);
      ys.push((lat - origin.lat) * rad * R);
    }
    return i;
  };

  const from = [];
  const to = [];
  const raised = []; // bridge or tunnel: never joined to what it crosses
  for (const line of lines) {
    let prev = node(line.pts[0]);
    for (let k = 1; k < line.pts.length; k++) {
      const cur = node(line.pts[k]);
      if (prev !== cur) {
        from.push(prev);
        to.push(cur);
        raised.push(!!line.brunnel);
      }
      prev = cur;
    }
  }
  if (repair) {
    // Vector tiles: geometry is clipped at tile edges and simplified, so some
    // junction vertices are missing. Rebuild them.
    joinCrossings(xs, ys, from, to, raised);
    joinDanglingEnds(xs, ys, from, to, 3);
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

/**
 * Dead ends that stop within `tol` metres of another street get joined to
 * it. Vector tiles cut lines at tile edges and may drop the shared vertex of
 * a T-junction; this restores those connections.
 */
function joinDanglingEnds(xs, ys, from, to, tol) {
  const n = xs.length;
  const deg = new Uint32Array(n);
  for (let k = 0; k < from.length; k++) { deg[from[k]]++; deg[to[k]]++; }
  const cell = 20;
  const cells = new Map();
  const key = (i, j) => i * 1000003 + j;
  const m = from.length;
  for (let k = 0; k < m; k++) {
    const a = from[k]; const b = to[k];
    const i0 = Math.floor((Math.min(xs[a], xs[b]) - tol) / cell);
    const i1 = Math.floor((Math.max(xs[a], xs[b]) + tol) / cell);
    const j0 = Math.floor((Math.min(ys[a], ys[b]) - tol) / cell);
    const j1 = Math.floor((Math.max(ys[a], ys[b]) + tol) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const kk = key(i, j);
      let list = cells.get(kk);
      if (!list) cells.set(kk, (list = []));
      list.push(k);
    }
  }
  for (let v = 0; v < n; v++) {
    if (deg[v] !== 1) continue;
    const list = cells.get(key(Math.floor(xs[v] / cell), Math.floor(ys[v] / cell)));
    if (!list) continue;
    let best = -1;
    let bestD = tol;
    for (const k of list) {
      const a = from[k]; const b = to[k];
      if (a === v || b === v) continue;
      const dx = xs[b] - xs[a]; const dy = ys[b] - ys[a];
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((xs[v] - xs[a]) * dx + (ys[v] - ys[a]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(xs[v] - (xs[a] + t * dx), ys[v] - (ys[a] + t * dy));
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0) {
      const a = from[best]; const b = to[best];
      from.push(v, v); to.push(a, b);
    }
  }
}

/** Street segments that cross at street level without a shared vertex get a new junction node. */
function joinCrossings(xs, ys, from, to, raised) {
  const cell = 40;
  const cells = new Map();
  const key = (i, j) => i * 1000003 + j;
  const m = from.length;
  for (let k = 0; k < m; k++) {
    if (raised[k]) continue;
    const a = from[k]; const b = to[k];
    const i0 = Math.floor(Math.min(xs[a], xs[b]) / cell);
    const i1 = Math.floor(Math.max(xs[a], xs[b]) / cell);
    const j0 = Math.floor(Math.min(ys[a], ys[b]) / cell);
    const j1 = Math.floor(Math.max(ys[a], ys[b]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const kk = key(i, j);
      let list = cells.get(kk);
      if (!list) cells.set(kk, (list = []));
      list.push(k);
    }
  }
  const seen = new Set();
  for (const list of cells.values()) {
    for (let p = 0; p < list.length; p++) {
      const k1 = list[p];
      const a1 = from[k1]; const b1 = to[k1];
      for (let q = p + 1; q < list.length; q++) {
        const k2 = list[q];
        const a2 = from[k2]; const b2 = to[k2];
        if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
        const rx = xs[b1] - xs[a1]; const ry = ys[b1] - ys[a1];
        const sx = xs[b2] - xs[a2]; const sy = ys[b2] - ys[a2];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const qx = xs[a2] - xs[a1]; const qy = ys[a2] - ys[a1];
        const t = (qx * sy - qy * sx) / den;
        const u = (qx * ry - qy * rx) / den;
        if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
        const pk = k1 < k2 ? k1 * 4194304 + k2 : k2 * 4194304 + k1;
        if (seen.has(pk)) continue;
        seen.add(pk);
        const v = xs.length;
        xs.push(xs[a1] + t * rx);
        ys.push(ys[a1] + t * ry);
        from.push(v, v, v, v);
        to.push(a1, b1, a2, b2);
      }
    }
  }
}
