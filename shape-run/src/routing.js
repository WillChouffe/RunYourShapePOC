/**
 * Pedestrian routing through the public FOSSGIS OSRM foot server.
 * Be polite: we only call it when the user presses Generate, wait
 * between iterations and cache identical requests.
 */
import { haversine } from './geometry.js';

const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
const cache = new Map();

export class RoutingError extends Error {}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Route through [lat, lng] waypoints. Returns an array of legs, each an
 * array of [lat, lng] points.
 */
export async function routeOnFoot(waypoints, signal) {
  const coords = waypoints.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `${OSRM_FOOT}${coords}?overview=false&steps=true&geometries=geojson&continue_straight=false`;
  if (cache.has(url)) return cache.get(url);

  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new RoutingError('Routing server unreachable');
  }
  if (res.status === 429) throw new RoutingError('Routing server is busy (rate limited)');
  let data;
  try {
    data = await res.json();
  } catch {
    throw new RoutingError(`Routing server error (${res.status})`);
  }
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new RoutingError(data.message || `No route found (${data.code})`);
  }
  const legs = data.routes[0].legs.map((leg) => {
    const pts = [];
    for (const step of leg.steps) {
      for (const [lng, lat] of step.geometry.coordinates) {
        const last = pts[pts.length - 1];
        if (!last || last[0] !== lat || last[1] !== lng) pts.push([lat, lng]);
      }
    }
    return pts;
  });
  const result = { legs, snaps: data.waypoints.map((w) => w.distance ?? 0) };
  cache.set(url, result);
  return result;
}

/**
 * Route a whole shape. Waypoints that snap far from any path (sea, lakes,
 * private land) create long out-and-back detours, so we drop them and route
 * again without them. The first and last waypoints are always kept.
 * Returns { path, skipped, requests }.
 */
export async function routeShape(waypoints, spacingM, signal) {
  let { legs, snaps } = await routeOnFoot(waypoints, signal);
  let requests = 1;
  const maxSnap = Math.max(120, 0.75 * spacingM);
  const far = snaps.map((d, i) => i > 0 && i < snaps.length - 1 && d > maxSnap);
  // A leg much longer than the straight gap means the waypoint sits across
  // water/rail and the route goes around via a distant bridge: drop it too.
  legs.forEach((leg, i) => {
    const end = i + 1;
    if (end >= waypoints.length - 1) return;
    const straight = haversine(waypoints[i], waypoints[end]);
    let len = 0;
    for (let j = 1; j < leg.length; j++) len += haversine(leg[j - 1], leg[j]);
    if (len > Math.max(4 * straight, straight + 800)) far[end] = true;
  });
  const skipped = far.filter(Boolean).length;
  if (skipped > 0 && waypoints.length - skipped >= 4) {
    await sleep(600, signal);
    ({ legs } = await routeOnFoot(waypoints.filter((_, i) => !far[i]), signal));
    requests++;
  }
  return { path: joinLegs(legs, Math.max(30, 0.6 * spacingM)), skipped, requests };
}

/**
 * Join legs, trimming short out-and-back "spurs" that OSRM creates when a
 * waypoint snaps to a road the runner would only touch and turn around on.
 * Spurs longer than `maxSpurM` are kept (they might be part of the drawing).
 */
export function joinLegs(legs, maxSpurM) {
  const near = (a, b) => haversine(a, b) < 3;
  let out = [...legs[0]];
  for (let li = 1; li < legs.length; li++) {
    const b = legs[li];
    if (!b.length) continue;
    let k = 0;
    let spur = 0;
    while (k + 1 < b.length && out.length - 2 - k >= 0 && near(out[out.length - 2 - k], b[k + 1])) {
      const add = haversine(out[out.length - 1 - k], out[out.length - 2 - k]);
      if (spur + add > maxSpurM) break;
      spur += add;
      k++;
    }
    if (k > 0) out = out.slice(0, out.length - k);
    out.push(...b.slice(k + 1));
  }
  return out;
}

/**
 * Next scale to try. Proportional (scale *= target / actual) until we have
 * one try above and one below the target, then interpolate between the
 * closest pair. Routed distance isn't linear in scale (snapping, detours),
 * so bracketing avoids the oscillation plain proportional steps can cause.
 */
export function nextScale(tries, current, target) {
  tries.push(current);
  const below = tries.filter((t) => t.distance < target).sort((a, b) => b.distance - a.distance)[0];
  const above = tries.filter((t) => t.distance > target).sort((a, b) => a.distance - b.distance)[0];
  if (below && above && above.scale !== below.scale) {
    const w = (target - below.distance) / (above.distance - below.distance);
    const s = below.scale + w * (above.scale - below.scale);
    // nudge off the exact endpoints so we don't repeat an identical request
    const lo = Math.min(below.scale, above.scale);
    const hi = Math.max(below.scale, above.scale);
    return Math.min(hi - (hi - lo) * 0.1, Math.max(lo + (hi - lo) * 0.1, s));
  }
  return current.scale * Math.max(0.6, Math.min(1.6, target / current.distance));
}
