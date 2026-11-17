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

export function candidates(def, { rotation, mirror, auto }) {
  const variants = auto ? [def, ...(def.variants || []).map((v) => ({ ...def, ...v }))] : [def];
  const rots = auto ? [0, -10, 10, -20, 20, -30, 30] : [0];
  const shifts = auto && def.closed ? [0, 0.03, -0.03, 0.06, -0.06] : [0];
  const out = [];
  variants.forEach((v, vi) => {
    for (const dr of rots) {
      const base = buildShape(v, { rotation: rotation + dr, mirror });
      for (const sh of shifts) {
        out.push({ variant: vi, variantName: v.variantName || null, rotation: rotation + dr, dRot: dr, shift: sh, shape: reanchor(base, sh * base.perimeter) });
      }
    }
  });
  return out;
}

/** Shape in local metres: its start sits on (sx, sy). */
export function placeXY(shape, scale, sx, sy, pts = shape.dense) {
  const [ax, ay] = shape.dense[0];
  return pts.map(([x, y]) => [sx + (x - ax) * scale, sy + (y - ay) * scale]);
}

/* ------------------------------------------------------------------ */
/* Pre-score: does the outline run along streets?                      */
/* ------------------------------------------------------------------ */

/**
 * Mean "gap to an aligned street" along the outline (lower is better).
 * Streets crossing the outline at an angle do not count, so a river with
 * no bridge where the outline needs one shows up as a large gap.
 */
export function prescore(g, ideal, sigma) {
  const pts = resampleXY(ideal, 100);
  const cap = 2.5 * sigma;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const tx = q[0] - o[0];
    const ty = q[1] - o[1];
    const tl = Math.hypot(tx, ty) || 1;
    let best = cap;
    forEdgesNear(g, p[0], p[1], cap, (k) => {
      const a = g.edges.from[k];
      const b = g.edges.to[k];
      const ex = g.x[b] - g.x[a];
      const ey = g.y[b] - g.y[a];
      const el = Math.hypot(ex, ey) || 1;
      const cos = Math.abs((ex * tx + ey * ty) / (el * tl));
      const d = segDist(p[0], p[1], g.x[a], g.y[a], g.x[b], g.y[b]) + (cos < 0.8 ? sigma : 0);
      if (d < best) best = d;
    });
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
  return { path: nodes.map((i) => [g.x[i], g.y[i]]), skipped };
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

/** Bounding box [s, w, n, e] that covers every candidate up to `grow` × its predicted size. */
export function searchBBox(cands, origin, target, grow = 1.2, marginM = 300) {
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const c of cands) {
    const scale = (target / (c.shape.perimeter * ROAD_FACTOR)) * grow;
    for (const [x, y] of placeXY(c.shape, scale, 0, 0)) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const cosLat = Math.cos(origin.lat * rad);
  const lat = (m) => origin.lat + (m / R) / rad;
  const lng = (m) => origin.lng + (m / (R * cosLat)) / rad;
  return [lat(minY - marginM), lng(minX - marginM), lat(maxY + marginM), lng(maxX + marginM)];
}

/**
 * Run the full search on graph g. `start` is the pin in g's local metres.
 * Returns the best routed candidate.
 */
export function search(g, cands, { start, target, detail, onProgress }) {
  const sc = makeScratch(g.n);
  const [sx, sy] = start;
  const scale0 = (c) => target / (c.shape.perimeter * ROAD_FACTOR);

  // 1. Pre-score every placement.
  onProgress?.({ stage: 2, text: `Testing ${cands.length} placements against the street grid…` });
  const scored = cands.map((c) => {
    const s = scale0(c);
    const sigma = Math.max(25, 0.02 * s);
    return { ...c, pre: prescore(g, placeXY(c.shape, s, sx, sy), sigma) / sigma };
  }).sort((a, b) => a.pre - b.pre);

  // 2. Bottlenecks: among the best pre-scores, penalise outlines that rivers
  //    or railways cut without a nearby crossing.
  onProgress?.({ stage: 2, text: 'Checking rivers, railways and bridges…' });
  const shortlist = scored.slice(0, Math.min(18, scored.length)).map((c) => {
    const s = scale0(c);
    return { ...c, pre: c.pre + 2 * detourScore(g, sc, placeXY(c.shape, s, sx, sy)) };
  }).sort((a, b) => a.pre - b.pre);

  // 3. Route the most promising ones at the predicted size.
  const top = shortlist.slice(0, Math.min(6, shortlist.length));
  const routed = [];
  top.forEach((c, i) => {
    onProgress?.({ stage: 3, text: `Routing candidate ${i + 1}/${top.length}…` });
    const r = tryScale(g, sc, c, scale0(c), sx, sy, detail);
    if (r) routed.push(r);
  });
  if (!routed.length) return null;

  // 4. Fine-tune the size of the best few so the distance hits the target.
  routed.sort((a, b) => rank(b, target) - rank(a, target));
  const finals = [];
  routed.slice(0, 3).forEach((first, i) => {
    onProgress?.({ stage: 4, text: `Fitting the distance (${i + 1}/3)…` });
    let best = first;
    const tries = [first];
    let scale = first.scale;
    const min = 0.7 * scale0(first);
    const max = 1.2 * scale0(first);
    for (let it = 0; it < 4 && Math.abs(best.distance - target) / target > 0.03; it++) {
      scale = nextScale(tries, scale, target, min, max);
      const r = tryScale(g, sc, first, scale, sx, sy, detail);
      if (!r) break;
      tries.push(r);
      if (rank(r, target) > rank(best, target)) best = r;
    }
    finals.push(best);
  });
  finals.sort((a, b) => rank(b, target) - rank(a, target));
  return finals[0];
}

function tryScale(g, sc, c, scale, sx, sy, detail) {
  const sigma = Math.max(25, 0.02 * scale);
  const ideal = placeXY(c.shape, scale, sx, sy);
  const r = routeCandidate(g, sc, c.shape, ideal, detail, sigma);
  if (!r || r.path.length < 2) return null;
  const distance = lengthXY(r.path);
  return { ...c, scale, ideal, path: r.path, skipped: r.skipped, distance, match: fidelity(r.path, ideal, scale) };
}

/** Higher is better: shape fidelity first, with a steep penalty past 5% distance error. */
function rank(r, target) {
  const err = Math.abs(r.distance - target) / target;
  return r.match - 400 * Math.max(0, err - 0.05) - 20 * err;
}

function nextScale(tries, current, target, min, max) {
  const below = tries.filter((t) => t.distance < target).sort((a, b) => b.distance - a.distance)[0];
  const above = tries.filter((t) => t.distance > target).sort((a, b) => a.distance - b.distance)[0];
  let s;
  if (below && above && above.scale !== below.scale) {
    const w = (target - below.distance) / (above.distance - below.distance);
    s = below.scale + w * (above.scale - below.scale);
  } else {
    const last = tries[tries.length - 1];
    s = last.scale * Math.max(0.75, Math.min(1.3, target / last.distance));
  }
  if (Math.abs(s - current) < 1e-6) s = current * (1 + 0.02 * Math.sign(target - tries[tries.length - 1].distance));
  return Math.max(min, Math.min(max, s));
}
