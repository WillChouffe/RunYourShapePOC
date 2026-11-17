/**
 * Geometry helpers: smoothing, arc-length resampling, transforms and the
 * local equirectangular projection used to drop a unit shape on the map.
 *
 * Unit-space points are [x, y] arrays (x east, y north).
 * Map points are [lat, lng] arrays.
 */

const R = 6371008.8; // mean Earth radius (m)
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

const dist2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/* ------------------------------------------------------------------ */
/* Normalize / transform                                               */
/* ------------------------------------------------------------------ */

/** Center on the bounding box and scale so the largest side is 1. */
export function normalize(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  return points.map(([x, y]) => [(x - cx) / s, (y - cy) / s]);
}

/** Mirror (horizontal flip) then rotate clockwise by `deg` around the origin. */
export function transform(points, deg = 0, mirror = false) {
  const a = toRad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return points.map(([x0, y]) => {
    const x = mirror ? -x0 : x0;
    return [x * c + y * s, -x * s + y * c];
  });
}

/* ------------------------------------------------------------------ */
/* Centripetal Catmull-Rom smoothing                                   */
/* ------------------------------------------------------------------ */

function catmullRom(p0, p1, p2, p3, u) {
  const alpha = 0.5;
  const eps = 1e-9;
  const t0 = 0;
  const t1 = t0 + Math.max(dist2(p0, p1), eps) ** alpha;
  const t2 = t1 + Math.max(dist2(p1, p2), eps) ** alpha;
  const t3 = t2 + Math.max(dist2(p2, p3), eps) ** alpha;
  const t = t1 + u * (t2 - t1);
  const lerp = (a, b, ta, tb) => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2);
  const B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

const reflect = (p, about) => [2 * about[0] - p[0], 2 * about[1] - p[1]];

/**
 * Smooth a control polyline. Sharp vertices (and open-shape endpoints)
 * are kept as corners. Returns the dense polyline and the dense indices
 * of the sharp vertices.
 */
export function smooth(points, closed, sharp = [], perSegment = 16) {
  const n = points.length;
  const sharpSet = new Set(sharp);
  if (!closed) {
    sharpSet.add(0);
    sharpSet.add(n - 1);
  }
  const segCount = closed ? n : n - 1;
  const out = [];
  const marks = new Array(n);
  for (let i = 0; i < segCount; i++) {
    const i1 = (i + 1) % n;
    const p1 = points[i];
    const p2 = points[i1];
    const p0 = sharpSet.has(i) ? reflect(p2, p1) : points[(i - 1 + n) % n];
    const p3 = sharpSet.has(i1) ? reflect(p1, p2) : points[(i1 + 1) % n];
    marks[i] = out.length;
    for (let s = 0; s < perSegment; s++) out.push(catmullRom(p0, p1, p2, p3, s / perSegment));
  }
  out.push(closed ? [...points[0]] : [...points[n - 1]]);
  if (!closed) marks[n - 1] = out.length - 1;
  const sharpIdx = [...sharpSet].map((i) => marks[i]).filter((i) => i !== undefined);
  return { points: out, sharpIdx };
}

/* ------------------------------------------------------------------ */
/* Arc length                                                          */
/* ------------------------------------------------------------------ */

export function cumulative(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist2(pts[i - 1], pts[i]));
  return c;
}

export function pointAt(pts, cum, s) {
  if (s <= 0) return [...pts[0]];
  const total = cum[cum.length - 1];
  if (s >= total) return [...pts[pts.length - 1]];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const w = (s - cum[lo]) / seg;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * w, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * w];
}

/** Resample evenly by arc length to `count` points (endpoints included). */
export function resample(pts, count) {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const out = [];
  for (let i = 0; i < count; i++) out.push(pointAt(pts, cum, (total * i) / (count - 1)));
  return out;
}

/* ------------------------------------------------------------------ */
/* Shape pipeline                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build a ready-to-place shape in unit space (largest side = 1 before rotation).
 * The run starts at dense[0].
 */
export function buildShape(def, { rotation = 0, mirror = false } = {}) {
  const ctrl = transform(normalize(def.points), rotation, mirror);
  const { points: raw, sharpIdx: rawSharp } = smooth(ctrl, def.closed, def.sharp || []);
  // Even arc-length resampling, keeping corner positions.
  const rawCum = cumulative(raw);
  const total = rawCum[rawCum.length - 1];
  const count = 400;
  const positions = new Set();
  for (let i = 0; i < count; i++) positions.add((total * i) / (count - 1));
  rawSharp.forEach((i) => positions.add(rawCum[i]));
  const sorted = [...positions].sort((a, b) => a - b);
  const dense = sorted.map((s) => pointAt(raw, rawCum, s));
  const cum = sorted;
  const sharpIdx = rawSharp.map((i) => sorted.indexOf(rawCum[i]));
  return { def, dense, cum, sharpIdx, perimeter: total, closed: def.closed };
}

/**
 * Pick ~N waypoints evenly by arc length, always including corners.
 * Returns unit-space points.
 */
export function sampleWaypoints(shape, n) {
  const L = shape.perimeter;
  const step = L / n;
  const sharpPos = shape.sharpIdx.map((i) => shape.cum[i]);
  const pos = [...sharpPos];
  for (let k = 0; k <= n; k++) {
    const p = k * step;
    const nearCorner = sharpPos.some((s) => Math.abs(s - p) < 0.35 * step);
    if (k === 0 || k === n || !nearCorner) pos.push(p);
  }
  pos.sort((a, b) => a - b);
  const uniq = pos.filter((p, i) => i === 0 || p - pos[i - 1] > 1e-9);
  return uniq.map((p) => pointAt(shape.dense, shape.cum, p));
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Place unit points on the map. `anchor` (unit space) lands on `origin`
 * ({lat, lng}); `scale` is metres per unit.
 */
export function toLatLngs(pts, anchor, origin, scale) {
  const cosLat = Math.cos(toRad(origin.lat));
  return pts.map(([x, y]) => {
    const dx = (x - anchor[0]) * scale;
    const dy = (y - anchor[1]) * scale;
    return [origin.lat + toDeg(dy / R), origin.lng + toDeg(dx / (R * cosLat))];
  });
}

/** Map points to local metres around `origin`. */
export function toLocal(latlngs, origin) {
  const cosLat = Math.cos(toRad(origin.lat));
  return latlngs.map(([lat, lng]) => [toRad(lng - origin.lng) * R * cosLat, toRad(lat - origin.lat) * R]);
}

export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(latlngs) {
  let d = 0;
  for (let i = 1; i < latlngs.length; i++) d += haversine(latlngs[i - 1], latlngs[i]);
  return d;
}

/** Points every `stepM` metres along a lat/lng path (used for km markers). */
export function markersEvery(latlngs, stepM) {
  const out = [];
  let acc = 0;
  let next = stepM;
  for (let i = 1; i < latlngs.length; i++) {
    const seg = haversine(latlngs[i - 1], latlngs[i]);
    while (seg > 0 && acc + seg >= next) {
      const w = (next - acc) / seg;
      const a = latlngs[i - 1];
      const b = latlngs[i];
      out.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
      next += stepM;
    }
    acc += seg;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Shape match score                                                   */
/* ------------------------------------------------------------------ */

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function meanDistTo(points, poly) {
  let sum = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const d = pointSegDist(p, poly[i - 1], poly[i]);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / points.length;
}

/**
 * 0-100 score of how well the route traces the ideal shape
 * (symmetric mean deviation relative to the shape size).
 */
export function shapeMatch(route, ideal, origin, sizeM) {
  const r = resample(toLocal(route, origin), 240);
  const s = resample(toLocal(ideal, origin), 240);
  const avg = (meanDistTo(r, s) + meanDistTo(s, r)) / 2;
  const score = 1 - avg / (0.12 * sizeM);
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
