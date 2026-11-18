/**
 * Shape-following route planner on our own OSM graph.
 *
 * Instead of asking a router for the SHORTEST path between waypoints, we run
 * A* where every street costs  length × (1 + (distance to the drawing / σ)²).
 * Streets that hug the outline are cheap, shortcuts are expensive, so the
 * route follows the shape. Going back over the same street is allowed (thin
 * parts of a drawing are often best run as an out-and-back).
 *
 * On top of that we search placements: shape variants, small rotations and
 * shifts of where the outline passes through the start pin. Each candidate
 * is pre-scored by how well its edges line up with nearby streets (water
 * with no bridge scores badly), then the best ones are routed for real.
 */
import { buildShape, cumulative, pointAt } from './geometry.js';
import { forEdgesNear } from './osm.js';

const R = 6371008.8;
const rad = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Small geometry helpers (local metres)                               */
/* ------------------------------------------------------------------ */

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polyDist(px, py, poly) {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const d = segDist(px, py, poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Distance to the polyline and |cos| between direction (dx, dy) and the closest segment. */
function polyDistAlign(px, py, dx, dy, poly) {
  let best = Infinity;
  let align = 1;
  const dl = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < poly.length; i++) {
    const ax = poly[i - 1][0]; const ay = poly[i - 1][1];
    const bx = poly[i][0]; const by = poly[i][1];
    const d = segDist(px, py, ax, ay, bx, by);
    if (d < best) {
      best = d;
      const sl = Math.hypot(bx - ax, by - ay) || 1;
      align = Math.abs(((bx - ax) * dx + (by - ay) * dy) / (sl * dl));
    }
  }
  return [best, align];
}

function resampleXY(pts, count) {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const out = [];
  for (let i = 0; i < count; i++) out.push(pointAt(pts, cum, (total * i) / (count - 1)));
  return out;
}

export function lengthXY(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

export function toLatLng(pts, origin) {
  const cosLat = Math.cos(origin.lat * rad);
  return pts.map(([x, y]) => [origin.lat + y / R / rad, origin.lng + x / (R * cosLat) / rad]);
}

/**
 * Strict 0-100 fidelity: blends the mean and the 90th percentile of the
 * gap between route and drawing (both ways), relative to the shape size.
 * A route 5% of the shape size away everywhere scores 0.
 */
export function fidelity(path, ideal, size) {
  const a = resampleXY(path, 300);
  const b = resampleXY(ideal, 300);
  const ds = [];
  for (const p of a) ds.push(polyDist(p[0], p[1], b));
  for (const p of b) ds.push(polyDist(p[0], p[1], a));
  ds.sort((x, y) => x - y);
  const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
  const p90 = ds[Math.floor(ds.length * 0.9)];
  const m = 0.5 * mean + 0.5 * p90;
  return Math.round(Math.max(0, Math.min(1, 1 - m / (0.05 * size))) * 100);
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

/** Move the run's start to arc position `s` on a closed shape. */
function reanchor(shape, s) {
  if (!shape.closed || !s) return shape;
  const P = shape.perimeter;
  s = ((s % P) + P) % P;
  const cut = pointAt(shape.dense, shape.cum, s);
  const after = [];
  const before = [];
  for (let i = 0; i < shape.dense.length - 1; i++) (shape.cum[i] > s ? after : before).push(shape.dense[i]);
  const dense = [cut, ...after, ...before, cut];
  const cum = cumulative(dense);
  const sharpPos = shape.sharpIdx.map((i) => (shape.cum[i] - s + P) % P);
  const sharpIdx = sharpPos.map((p) => {
    let best = 0;
    for (let i = 1; i < cum.length; i++) if (Math.abs(cum[i] - p) < Math.abs(cum[best] - p)) best = i;
    return best;
  });
  return { ...shape, dense, cum, sharpIdx };
}

/** Waypoints (indices into dense): every corner plus evenly spaced points. */
function waypointIdx(shape, n) {
  const step = shape.perimeter / n;
  const marks = new Set([0, shape.dense.length - 1, ...shape.sharpIdx]);
  let next = step;
  for (let i = 1; i < shape.dense.length - 1; i++) {
    if (shape.cum[i] >= next) {
      const nearCorner = shape.sharpIdx.some((k) => Math.abs(shape.cum[k] - shape.cum[i]) < 0.35 * step);
      if (!nearCorner) marks.add(i);
      next += step;
    }
  }
  return [...marks].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* Street-grid orientation                                             */
/* ------------------------------------------------------------------ */

/** Length-weighted histogram of bearings mod 90° (1° bins), lightly smoothed. */
function bearingHist(segs) {
  const h = new Float64Array(90);
  for (const [dx, dy] of segs) {
    const l = Math.hypot(dx, dy);
    if (!l) continue;
    const a = ((Math.atan2(dy, dx) / rad) % 90 + 90) % 90;
    h[Math.floor(a) % 90] += l;
  }
  const out = new Float64Array(90);
  for (let i = 0; i < 90; i++) for (let k = -3; k <= 3; k++) out[i] += h[(i + k + 90) % 90] * (4 - Math.abs(k));
  return out;
}

const peak = (h) => h.reduce((b, v, i) => (v > h[b] ? i : b), 0);

/**
 * Dominant street direction (degrees mod 90, counter-clockwise from east)
 * within `radius` of (px, py), and how strongly the area is a grid (0-1:
 * share of street length within ±8° of the two main axes).
 */
export function gridBearing(g, px, py, radius) {
  const segs = [];
  forEdgesNear(g, px, py, radius, (k) => {
    const a = g.edges.from[k];
    const b = g.edges.to[k];
    segs.push([g.x[b] - g.x[a], g.y[b] - g.y[a]]);
  });
  const h = bearingHist(segs);
  const best = peak(h);
  let on = 0;
  let all = 0;
  for (const [dx, dy] of segs) {
    const l = Math.hypot(dx, dy);
    const a = ((Math.atan2(dy, dx) / rad) % 90 + 90) % 90;
    const diff = Math.min(Math.abs(a - best), 90 - Math.abs(a - best));
    all += l;
    if (diff <= 8) on += l;
  }
  return { bearing: best, strength: all ? on / all : 0 };
}

/** Dominant direction of the straight parts of a shape (degrees mod 90). */
export function shapeBearing(shape) {
  const segs = [];
  const d = shape.dense;
  for (let i = 1; i < d.length; i++) segs.push([d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]]);
  return peak(bearingHist(segs));
}

/* ------------------------------------------------------------------ */
/* Candidates: where, how big, how many laps                           */
/* ------------------------------------------------------------------ */

/**
 * Rotations to try: the runner's, plus the one that lines the shape up
 * with the street grid (grid cities) or two small turns (irregular ones).
 */
function rotationsFor(def, { rotation, mirror, auto }, grid) {
  if (!auto) return [{ dRot: 0, snap: null }];
  if (grid && grid.strength >= 0.45) {
    const sb = shapeBearing(buildShape(def, { rotation, mirror }));
    let delta = ((grid.bearing - sb) % 90 + 90) % 90; // counter-clockwise turn...
    if (delta > 45) delta -= 90; // ...or the shorter way round
    const snap = -Math.round(delta); // rotation is clockwise
    return Math.abs(snap) < 3 ? [{ dRot: 0, snap: 0 }] : [{ dRot: 0, snap }, { dRot: snap, snap }];
  }
  return [{ dRot: 0, snap: null }, { dRot: -12, snap: null }, { dRot: 12, snap: null }];
}

/**
 * Every outline to test: variants x rotations x where the loop is entered
 * (any of 8 points around a closed shape).
 */
export function outlines(def, opts, grid) {
  const { rotation, mirror, auto } = opts;
  const variants = auto ? [def, ...(def.variants || []).map((v) => ({ ...def, ...v }))] : [def];
  const entries = auto && def.closed ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k / 8) : [0];
  const out = [];
  variants.forEach((v, vi) => {
    for (const { dRot, snap } of rotationsFor(v, opts, grid)) {
      const base = buildShape(v, { rotation: rotation + dRot, mirror });
      for (const u of entries) {
        out.push({
          variant: vi, variantName: v.variantName || null, rotation: rotation + dRot, dRot, snap,
          shift: u, shape: reanchor(base, u * base.perimeter),
        });
      }
    }
  });
  return out;
}

/** How far from the start pin the drawing may begin (metres). */
export const approachMax = (target) => Math.max(400, Math.min(1500, 0.08 * target));

/** Shape in local metres: its start sits on (sx, sy). */
export function placeXY(shape, scale, sx, sy, pts = shape.dense) {
  const [ax, ay] = shape.dense[0];
  return pts.map(([x, y]) => [sx + (x - ax) * scale, sy + (y - ay) * scale]);
}

/* ------------------------------------------------------------------ */
/* Pre-score: does the outline run along streets?                      */
/* ------------------------------------------------------------------ */

const BINS = 12; // street directions, 15 degrees each (mod 180)
const CELL = 25; // metres

/**
 * Distance field per street direction: for each 25 m cell and each 15 deg
 * direction bin, the distance to the nearest street running that way.
 * Built once per graph; makes pre-scoring thousands of placements cheap.
 */
function streetField(g) {
  if (g.field) return g.field;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < g.n; i++) {
    if (g.x[i] < minX) minX = g.x[i]; if (g.x[i] > maxX) maxX = g.x[i];
    if (g.y[i] < minY) minY = g.y[i]; if (g.y[i] > maxY) maxY = g.y[i];
  }
  const W = Math.ceil((maxX - minX) / CELL) + 1;
  const H = Math.ceil((maxY - minY) / CELL) + 1;
  const N = W * H;
  const dt = Array.from({ length: BINS }, () => new Float32Array(N).fill(1e9));
  const E = g.edges.from.length;
  for (let k = 0; k < E; k++) {
    const a = g.edges.from[k];
    const b = g.edges.to[k];
    const dx = g.x[b] - g.x[a];
    const dy = g.y[b] - g.y[a];
    const l = Math.hypot(dx, dy);
    if (!l) continue;
    const ang = ((Math.atan2(dy, dx) / rad) % 180 + 180) % 180;
    const bin = Math.round(ang / (180 / BINS)) % BINS;
    const steps = Math.ceil(l / (CELL / 2));
    for (let t = 0; t <= steps; t++) {
      const cx = Math.round((g.x[a] + (dx * t) / steps - minX) / CELL);
      const cy = Math.round((g.y[a] + (dy * t) / steps - minY) / CELL);
      dt[bin][cy * W + cx] = 0;
    }
  }
  // Two-pass chamfer distance transform (within ~8% of Euclidean).
  const d1 = CELL;
  const d2 = CELL * Math.SQRT2;
  for (const f of dt) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = f[i];
        if (x > 0 && f[i - 1] + d1 < v) v = f[i - 1] + d1;
        if (y > 0) {
          if (f[i - W] + d1 < v) v = f[i - W] + d1;
          if (x > 0 && f[i - W - 1] + d2 < v) v = f[i - W - 1] + d2;
          if (x < W - 1 && f[i - W + 1] + d2 < v) v = f[i - W + 1] + d2;
        }
        f[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = f[i];
        if (x < W - 1 && f[i + 1] + d1 < v) v = f[i + 1] + d1;
        if (y < H - 1) {
          if (f[i + W] + d1 < v) v = f[i + W] + d1;
          if (x < W - 1 && f[i + W + 1] + d2 < v) v = f[i + W + 1] + d2;
          if (x > 0 && f[i + W - 1] + d2 < v) v = f[i + W - 1] + d2;
        }
        f[i] = v;
      }
    }
  }
  g.field = { minX, minY, W, H, dt };
  return g.field;
}

/**
 * Mean "gap to an aligned street" along the outline (lower is better).
 * A street at an angle to the outline costs extra (3 sigma x sin^2: 10 deg
 * costs 0.1 sigma, 30 deg 0.75 sigma), so diagonals across a grid lose and
 * a river with no bridge where the outline needs one shows as a big gap.
 */
export function prescore(g, ideal, sigma, samples = 100) {
  const F = streetField(g);
  const pts = resampleXY(ideal, samples);
  const cap = 2.5 * sigma;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const cx = Math.round((p[0] - F.minX) / CELL);
    const cy = Math.round((p[1] - F.minY) / CELL);
    if (cx < 0 || cy < 0 || cx >= F.W || cy >= F.H) { sum += cap; continue; }
    const th = Math.atan2(q[1] - o[1], q[0] - o[0]);
    const idx = cy * F.W + cx;
    let best = cap;
    for (let b = 0; b < BINS; b++) {
      const s = Math.sin(th - (b * Math.PI) / BINS);
      const d = F.dt[b][idx] + 3 * sigma * s * s;
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / pts.length;
}

/* ------------------------------------------------------------------ */
/* Corridor A*                                                         */
/* ------------------------------------------------------------------ */

function nearestNode(g, px, py) {
  let best = -1;
  let bestD = Infinity;
  for (const r of [60, 200, 600, 1500]) {
    forEdgesNear(g, px, py, r, (k) => {
      for (const i of [g.edges.from[k], g.edges.to[k]]) {
        if (g.comp[i] !== g.main) continue;
        const d = Math.hypot(g.x[i] - px, g.y[i] - py);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    if (best >= 0 && bestD <= r) break;
  }
  return { node: best, dist: bestD };
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k; const v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k; const v = this.v;
    const top = v[0];
    const lk = k.pop(); const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function makeScratch(n) {
  return { stamp: new Uint32Array(n), gs: new Float64Array(n), prev: new Int32Array(n), done: new Uint32Array(n), cur: 0 };
}

/**
 * A* from src to dst. With a corridor, each street costs
 *   length × (1 + (gap / σ)² + 0.8 × (1 − alignment))
 * so streets close to AND parallel to the drawing win; perpendicular jogs
 * (staircasing) are discouraged. Without a corridor it is plain shortest path.
 */
function corridorLeg(g, sc, src, dst, corridor, sigma, maxPops = 1500000) {
  if (src === dst) return [src];
  const stamp = ++sc.cur;
  const { gs, prev, done } = sc;
  const tx = g.x[dst];
  const ty = g.y[dst];
  const heap = new Heap();
  sc.stamp[src] = stamp; gs[src] = 0; prev[src] = -1;
  heap.push(Math.hypot(g.x[src] - tx, g.y[src] - ty), src);
  const maxPenalty = 400;
  let pops = 0;
  while (heap.size) {
    const u = heap.pop();
    if (done[u] === stamp) continue;
    done[u] = stamp;
    if (u === dst) break;
    if (++pops > maxPops) return null;
    const gu = gs[u];
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const v = g.adj[e];
      if (done[v] === stamp) continue;
      let w = 1;
      if (corridor) {
        const mx = (g.x[u] + g.x[v]) / 2;
        const my = (g.y[u] + g.y[v]) / 2;
        const [dm, align] = polyDistAlign(mx, my, g.x[v] - g.x[u], g.y[v] - g.y[u], corridor);
        const d = Math.max(dm, 0.5 * (polyDist(g.x[v], g.y[v], corridor) + polyDist(g.x[u], g.y[u], corridor)));
        w = 1 + Math.min(maxPenalty, (d / sigma) ** 2) + 0.8 * (1 - align);
      }
      const cost = gu + g.len[e] * w;
      if (sc.stamp[v] !== stamp || cost < gs[v]) {
        sc.stamp[v] = stamp; gs[v] = cost; prev[v] = u;
        heap.push(cost + Math.hypot(g.x[v] - tx, g.y[v] - ty), v);
      }
    }
  }
  if (done[dst] !== stamp) return null;
  const nodes = [];
  for (let v = dst; v !== -1; v = prev[v]) nodes.push(v);
  return nodes.reverse();
}

/**
 * Route one placed candidate. ideal: the drawing in local metres
 * (dense, starting at the start pin). Returns { path, skipped }.
 */
export function routeCandidate(g, sc, shape, ideal, detail, sigma) {
  // The corridor keeps the path on the outline between waypoints, so far
  // fewer hard waypoints are needed than with a shortest-path router.
  const idx = waypointIdx(shape, Math.max(8, Math.round(detail / 2.5)));
  const far = Math.max(150, 3 * sigma);
  const snaps = [];
  let skipped = 0;
  idx.forEach((i, k) => {
    const s = nearestNode(g, ideal[i][0], ideal[i][1]);
    const keep = k === 0 || k === idx.length - 1 || s.dist <= far;
    if (keep && s.node >= 0) snaps.push({ i, node: s.node });
    else skipped++;
  });
  let nodes = [];
  for (let k = 1; k < snaps.length; k++) {
    const a = snaps[k - 1];
    let b = snaps[k];
    const corridor = (bi) => ideal.slice(Math.max(0, a.i - 2), Math.min(ideal.length, bi + 3));
    let leg = corridorLeg(g, sc, a.node, b.node, corridor(b.i), sigma);
    if (!leg && k + 1 < snaps.length) {
      // Unreachable waypoint: skip it and aim for the next one.
      b = snaps[k + 1];
      leg = corridorLeg(g, sc, a.node, b.node, corridor(b.i), sigma);
      snaps.splice(k, 1);
      skipped++;
    }
    if (!leg) return null;
    nodes = nodes.length ? nodes.concat(leg.slice(1)) : leg;
  }
  nodes = trimSpurs(g, nodes, 3 * sigma);
  return { nodes, path: nodes.map((i) => [g.x[i], g.y[i]]), skipped };
}

/**
 * Remove short out-and-back stubs (A→B→A) created when a waypoint snaps to
 * a side street. Longer ones are kept: they are part of the drawing.
 */
function trimSpurs(g, nodes, maxSpur) {
  let out = nodes;
  for (let changed = true; changed;) {
    changed = false;
    const next = [];
    let t = 0;
    while (t < out.length) {
      // Is out[t] the tip of an out-and-back? Measure the whole stub first.
      let k = 0;
      let len = 0;
      while (t - k - 1 >= 0 && t + k + 1 < out.length && out[t - k - 1] === out[t + k + 1]) {
        len += Math.hypot(g.x[out[t - k]] - g.x[out[t - k - 1]], g.y[out[t - k]] - g.y[out[t - k - 1]]);
        k++;
      }
      if (k > 0 && len <= maxSpur) {
        // drop out[t-k+1 .. t+k]: keep out[t-k] (already pushed), skip the stub
        next.length -= k - 1;
        t += k + 1;
        changed = true;
      } else {
        next.push(out[t]);
        t++;
      }
    }
    out = next;
  }
  return out;
}

/**
 * Bottleneck check: walk between neighbouring points of the outline on the
 * street network (plain shortest path). Where the walk is much longer than
 * the straight line, a river, railway or motorway cuts the outline and the
 * only crossings are far away. Returns the mean excess detour ratio.
 */
export function detourScore(g, sc, ideal, samples = 16) {
  const pts = resampleXY(ideal, samples + 1);
  const snaps = pts.map(([x, y]) => nearestNode(g, x, y).node);
  let excess = 0;
  for (let k = 1; k < snaps.length; k++) {
    const a = snaps[k - 1];
    const b = snaps[k];
    if (a < 0 || b < 0 || a === b) continue;
    const straight = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]);
    const leg = corridorLeg(g, sc, a, b, null, 1, 60000);
    const walked = leg ? lengthXY(leg.map((i) => [g.x[i], g.y[i]])) : 6 * straight;
    excess += Math.max(0, walked / Math.max(straight, 50) - 1.6);
  }
  return excess / samples;
}

/* ------------------------------------------------------------------ */
/* The search                                                          */
/* ------------------------------------------------------------------ */

export const ROAD_FACTOR = 1.25; // corridor routes run a bit longer than the drawing

/**
 * Bounding box [s, w, n, e] for the street download: the full-size drawing
 * entered from any point of its outline, anywhere within approachMax.
 */
export function searchBBox(def, opts, origin, target) {
  const all = outlines(def, opts, null);
  // grid-aligned turns are only known once the streets are in: cover +-45 deg
  if (opts.auto) {
    all.push(...outlines(def, { ...opts, rotation: opts.rotation + 45 }, null));
    all.push(...outlines(def, { ...opts, rotation: opts.rotation - 45 }, null));
  }
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const c of all) {
    const scale = (target / (c.shape.perimeter * ROAD_FACTOR)) * 1.1;
    for (const [x, y] of placeXY(c.shape, scale, 0, 0)) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const m = (opts.auto ? approachMax(target) : 0) + 300;
  const cosLat = Math.cos(origin.lat * rad);
  const lat = (v) => origin.lat + (v / R) / rad;
  const lng = (v) => origin.lng + (v / (R * cosLat)) / rad;
  return [lat(minY - m), lng(minX - m), lat(maxY + m), lng(maxX + m)];
}

/** Offsets for where the drawing starts: the pin, then two rings around it. */
function offsets(aMax) {
  const out = [[0, 0]];
  for (const [r, n] of [[aMax / 2, 6], [aMax, 12]]) {
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n + (n === 12 ? Math.PI / 12 : 0);
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  return out;
}

/**
 * Full search on graph g. Each candidate is an outline (variant, rotation,
 * entry point), a place (offset from the pin, reached by running there and
 * back) and a number of laps: a smaller drawing run 2-3 times often fits the
 * streets far better than one huge one. Returns the best routed candidate.
 */
export function search(g, def, opts, { start, target, detail, onProgress, grid }) {
  const sc = makeScratch(g.n);
  const [sx, sy] = start;
  const { auto } = opts;
  const turnWeight = 0.1 + 0.5 * (grid?.strength ?? 0);
  const shapes = outlines(def, opts, grid);
  const aMax = approachMax(target);
  const offs = auto ? offsets(aMax) : [[0, 0]];
  const laps = auto && def.closed ? [1, 2, 3] : [1];
  const minLoop = Math.max(3000, 0.2 * target);

  // 1. Pre-score every (outline, laps, place).
  const best = new Map(); // best per (outline, laps, at pin or away): keeps the shortlist diverse
  let tested = 0;
  onProgress?.({ stage: 2, text: 'Searching the neighbourhood for streets that draw your shape...' });
  shapes.forEach((s, si) => {
    for (const K of laps) {
      for (const [ox, oy] of offs) {
        const approach = 2 * 1.3 * Math.hypot(ox, oy);
        const loopT = (target - approach) / K;
        if (loopT < minLoop) continue;
        const scale = loopT / (s.shape.perimeter * ROAD_FACTOR);
        const sigma = Math.max(25, 0.02 * scale);
        const ideal = placeXY(s.shape, scale, sx + ox, sy + oy);
        const pre = prescore(g, ideal, sigma, 50) / sigma + 3 * (approach / target) + 0.05 * (K - 1);
        tested++;
        const key = `${si}:${K}:${ox || oy ? 'away' : 'pin'}`;
        const cur = best.get(key);
        if (!cur || pre < cur.pre) best.set(key, { ...s, laps: K, ox, oy, scale, pre });
      }
    }
  });

  // 2. Bottlenecks (rivers, railways) on the best of them.
  onProgress?.({ stage: 2, text: 'Checking rivers, railways and bridges...' });
  // Keep room for every kind of solution: the best overall, plus the best
  // ones with 2 and 3 laps and the best ones away from the pin.
  const ranked = [...best.values()].sort((a, b) => a.pre - b.pre);
  const picked = new Set(ranked.slice(0, 24));
  for (const keep of [(c) => c.laps === 2, (c) => c.laps === 3, (c) => c.ox || c.oy]) {
    ranked.filter(keep).slice(0, 4).forEach((c) => picked.add(c));
  }
  const shortlist = [...picked].map((c) => ({
    ...c, pre: c.pre + 2 * detourScore(g, sc, placeXY(c.shape, c.scale, sx + c.ox, sy + c.oy), 12),
  })).sort((a, b) => a.pre - b.pre);

  // 3. Route the most promising ones.
  const startNode = nearestNode(g, sx, sy).node;
  const kinds = [(c) => c.laps === 2, (c) => c.laps === 3, (c) => c.ox || c.oy];
  const top = [...new Set([...shortlist.slice(0, 14), ...kinds.map((k) => shortlist.find(k)).filter(Boolean)])];
  const routed = [];
  top.forEach((c, i) => {
    onProgress?.({ stage: 3, text: `Routing candidate ${i + 1}/${top.length}...` });
    const r = tryPlace(g, sc, c, c.scale, startNode, sx, sy, detail);
    if (r) routed.push(r);
  });
  if (!routed.length) return null;

  // 4. Fit the size of the best few (on shape quality: the fit fixes distance).
  routed.sort((a, b) => rank(b, null, turnWeight) - rank(a, null, turnWeight));
  const finals = [];
  routed.slice(0, 3).forEach((first, i) => {
    onProgress?.({ stage: 4, text: `Fitting the distance (${i + 1}/3)...` });
    let bestR = first;
    const tries = [first];
    const min = 0.6 * first.scale;
    const max = 1.4 * first.scale;
    for (let it = 0; it < 7 && Math.abs(bestR.distance - target) / target > 0.025; it++) {
      const scale = nextScale(tries, target, min, max);
      const r = tryPlace(g, sc, first, scale, startNode, sx, sy, detail);
      if (!r) break;
      tries.push(r);
      if (rank(r, target, turnWeight) > rank(bestR, target, turnWeight)) bestR = r;
    }
    finals.push(bestR);
  });
  finals.sort((a, b) => rank(b, target, turnWeight) - rank(a, target, turnWeight));
  return { ...finals[0], tested };
}

/** Route one candidate at one size: run to the drawing, K laps, run back. */
function tryPlace(g, sc, c, scale, startNode, sx, sy, detail) {
  const sigma = Math.max(25, 0.02 * scale);
  const ideal = placeXY(c.shape, scale, sx + c.ox, sy + c.oy);
  const r = routeCandidate(g, sc, c.shape, ideal, detail, sigma);
  if (!r || r.nodes.length < 2) return null;
  let loop = r.nodes;
  const entry = loop[0];
  if (c.shape.closed && loop[loop.length - 1] !== entry) {
    const close = corridorLeg(g, sc, loop[loop.length - 1], entry, null, 1);
    if (!close) return null;
    loop = loop.concat(close.slice(1));
  }
  const there = corridorLeg(g, sc, startNode, entry, null, 1);
  const back = c.shape.closed
    ? there && there.slice().reverse()
    : corridorLeg(g, sc, loop[loop.length - 1], startNode, null, 1);
  if (!there || !back) return null;
  let nodes = there;
  for (let k = 0; k < c.laps; k++) nodes = nodes.concat(loop.slice(1));
  nodes = nodes.concat(back.slice(1));
  const xy = (ns) => ns.map((i) => [g.x[i], g.y[i]]);
  const loopPath = xy(loop);
  const loopLen = lengthXY(loopPath);
  const approach = lengthXY(xy(there)) + lengthXY(xy(back));
  return {
    ...c, scale, ideal, loop: loopPath, path: xy(nodes), skipped: r.skipped,
    loopLen, approach, distance: approach + c.laps * loopLen,
    match: fidelity(loopPath, ideal, scale), wobble: wobble(loopPath, ideal),
  };
}

/**
 * Staircase measure: length-weighted mean |sin| of the angle between each
 * street run and the drawing next to it. A route that runs along its
 * drawing scores ~0.1; a diagonal staircased across a grid ~0.5.
 */
function wobble(path, ideal) {
  const poly = resampleXY(ideal, 200);
  let sum = 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    const l = Math.hypot(dx, dy);
    if (l < 1) continue;
    const [, cos] = polyDistAlign((path[i][0] + path[i - 1][0]) / 2, (path[i][1] + path[i - 1][1]) / 2, dx, dy, poly);
    sum += l * Math.sqrt(Math.max(0, 1 - cos * cos));
    total += l;
  }
  return total ? sum / total : 0;
}
/**
 * Higher is better: shape fidelity, minus staircasing, minus turning away
 * from the chosen (or grid-aligned) orientation, minus the run to and from
 * the drawing and extra laps, with a steep penalty past 5% distance error
 * (skipped when target is null).
 */
function rank(r, target, turnWeight = 0.4) {
  const err = target ? Math.abs(r.distance - target) / target : 0;
  const turn = r.snap != null ? Math.min(Math.abs(r.dRot), Math.abs(r.dRot - r.snap)) : Math.abs(r.dRot);
  return r.match - 1500 * Math.max(0, err - 0.05) - 30 * err - 60 * r.wobble - turnWeight * turn
    - 40 * (r.approach / r.distance) - 2 * (r.laps - 1);
}

/** Next size to try so that approach + laps x loop hits the target. */
function nextScale(tries, target, min, max) {
  const last = tries[tries.length - 1];
  const loopT = (target - last.approach) / last.laps;
  const below = tries.filter((t) => t.distance < target).sort((a, b) => b.distance - a.distance)[0];
  const above = tries.filter((t) => t.distance > target).sort((a, b) => a.distance - b.distance)[0];
  let s;
  if (below && above && above.scale !== below.scale) {
    const w = (target - below.distance) / (above.distance - below.distance);
    s = below.scale + w * (above.scale - below.scale);
  } else {
    s = last.scale * Math.max(0.75, Math.min(1.3, loopT / last.loopLen));
  }
  if (tries.some((t) => Math.abs(t.scale - s) < 1e-6 * s)) s *= 1 + 0.02 * Math.sign(target - last.distance);
  return Math.max(min, Math.min(max, s));
}
