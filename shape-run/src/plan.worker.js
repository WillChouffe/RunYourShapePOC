/**
 * Runs street download + shape search off the main thread so the UI stays
 * smooth. The street graph is kept between runs while the area still fits.
 */
import { getShape } from './shapes.js';
import { fetchNetwork, buildGraph, linesFromOverpass } from './osm.js';
import { fetchTileLines } from './tiles.js';
import { gridBearing, searchBBox, search, toLatLng } from './planner.js';

let cache = null; // { bbox, graph }
let controller = null;

const inside = (inner, outer) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

function local(origin, p) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  return [(p.lng - origin.lng) * rad * R * Math.cos(origin.lat * rad), (p.lat - origin.lat) * rad * R];
}

/** Download the streets in bbox: vector tiles first, Overpass as fallback. */
async function loadGraph(bbox, start, signal, status) {
  try {
    const lines = await fetchTileLines(bbox, signal, status);
    status('Building the street graph…');
    return buildGraph(lines, start, { repair: true });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.warn('Vector tiles failed, trying Overpass', e);
    const elements = await fetchNetwork(bbox, signal, status);
    status('Building the street graph…');
    return buildGraph(linesFromOverpass(elements), start);
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (data.type !== 'plan') return;
  const { shapeId, rotation, mirror, start, target, detail, auto } = data;
  controller = new AbortController();
  const progress = (p) => self.postMessage({ type: 'progress', ...p });
  try {
    const def = getShape(shapeId);
    const opts = { rotation, mirror, auto };
    const bbox = searchBBox(def, opts, start, target);
    if (!cache || !inside(bbox, cache.bbox)) {
      progress({ stage: 1, text: 'Downloading streets & paths around you…' });
      const graph = await loadGraph(bbox, start, controller.signal, (text) => progress({ stage: 1, text }));
      cache = { bbox, graph };
    }
    const g = cache.graph;
    const origin = local(g.origin, start);
    const grid = gridBearing(g, origin[0], origin[1], 2500);
    const best = search(g, def, opts, { start: origin, target, detail, onProgress: progress, grid });
    if (!best) throw new Error('No route found on the street network here');

    self.postMessage({
      type: 'result',
      path: toLatLng(best.path, g.origin),
      ideal: toLatLng(best.ideal, g.origin),
      distance: best.distance,
      match: best.match,
      skipped: best.skipped,
      scale: best.scale,
      dRot: best.dRot,
      rotation: best.rotation,
      shift: best.shift,
      variant: best.variant,
      variantName: best.variantName,
      laps: best.laps,
      approach: best.approach,
      moved: Math.round(Math.hypot(best.ox, best.oy)),
      tested: best.tested,
    });
  } catch (e) {
    self.postMessage({ type: 'error', name: e.name, message: e.message });
  } finally {
    controller = null;
  }
};
