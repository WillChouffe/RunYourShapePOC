import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

import { SHAPES, getShape } from './shapes.js';
import {
  buildShape, sampleWaypoints, toLatLngs, resample, pathLength, shapeMatch, markersEvery,
} from './geometry.js';
import { routeShape, nextScale, RoutingError, sleep } from './routing.js';
import { searchAddress } from './geocode.js';
import { buildGpx, slugify, downloadText } from './gpx.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const ROAD_FACTOR = 1.4; // routed paths run longer than the ideal outline
const MAX_ITER = 5;
// Short routes trace shapes badly on real streets, so we start at 8 km.
const MIN_KM = 8;
const TOLERANCE = 0.05;
const FUNDRAISER_URL = '#'; // TODO: replace with the real fundraising page

const state = {
  shapeId: 'heart',
  distanceKm: 10,
  start: { lat: 43.4911, lng: -1.5216 }, // Anglet, home of La Grande Barre
  rotation: 0,
  mirror: false,
  mode: 'roads',
  detail: 40,
  auto: true, // try variants, rotations and shifts in the background
  tiles: 'night',
  result: null,
  busy: false,
  abort: null,
};

const $ = (id) => document.getElementById(id);
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATTR_OSRM = 'Routing <a href="https://routing.openstreetmap.de/about.html">FOSSGIS OSRM</a>';

// Keyless OpenStreetMap tiles. "Night" is the same tiles recoloured with a
// CSS filter (see .tiles-night in style.css), so no extra provider is needed.
const osmTiles = () =>
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: `${ATTR_OSM} · ${ATTR_OSRM}`,
  });
const tileLayers = { night: osmTiles(), day: osmTiles() };

const map = L.map('map', { zoomControl: false, preferCanvas: false }).setView([state.start.lat, state.start.lng], 14);
if (import.meta.env.DEV) Object.assign(window, { __map: map, __L: L }); // debugging aid
L.control.zoom({ position: 'topright' }).addTo(map);
tileLayers.night.addTo(map);
document.body.classList.add('tiles-night');
// The first fit can run before layout settles (fonts, panel size), which
// over-zooms. Re-fit the preview on resizes until a fit with real room lands.
let fittedOnce = false;
new ResizeObserver(() => {
  map.invalidateSize();
  if (!fittedOnce && !state.result && ghost) fitTo(ghost.getLatLngs());
}).observe(document.getElementById('map'));

const ghost = L.polyline([], { className: 'ghost-line is-preview', weight: 3, interactive: false }).addTo(map);
const routeGlow = L.polyline([], { className: 'route-glow', weight: 12, interactive: false, lineJoin: 'round' }).addTo(map);
const routeLine = L.polyline([], { className: 'route-line', weight: 4, interactive: false, lineJoin: 'round' }).addTo(map);
const kmLayer = L.layerGroup().addTo(map);

const startMarker = L.marker([state.start.lat, state.start.lng], {
  draggable: true,
  keyboard: true,
  title: 'Start (drag to move)',
  zIndexOffset: 1000,
  icon: L.divIcon({ className: '', html: '<div class="pin">S</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
}).addTo(map);
const finishMarker = L.marker([0, 0], {
  interactive: false,
  icon: L.divIcon({ className: '', html: '<div class="pin pin-finish">F</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
});

map.on('click', (e) => {
  if (state.busy) return;
  setStart(e.latlng.lat, e.latlng.lng, { fit: false });
});
startMarker.on('dragend', () => {
  const p = startMarker.getLatLng();
  setStart(p.lat, p.lng, { fit: false });
});

function fitPadding() {
  const panel = $('panel');
  if (isMobile()) return { paddingTopLeft: [24, 70], paddingBottomRight: [24, panel.offsetHeight + 24] };
  return { paddingTopLeft: [panel.offsetWidth + 56, 80], paddingBottomRight: [56, 40] };
}

// Instant fit: an animated zoom gets stuck if the tab throttles animation
// frames (background tabs, embedded previews), leaving the map over-zoomed.
function fitTo(latlngs, animate = false) {
  if (!latlngs.length) return;
  map.invalidateSize();
  const pad = fitPadding();
  const size = map.getSize();
  const freeW = size.x - pad.paddingTopLeft[0] - pad.paddingBottomRight[0];
  const freeH = size.y - pad.paddingTopLeft[1] - pad.paddingBottomRight[1];
  // If the panel leaves too little room (tiny window), ignore it rather than over-zooming.
  if (size.x < 50 || size.y < 50) return; // not laid out yet; the ResizeObserver retries
  fittedOnce = true;
  const opts = freeW < 160 || freeH < 160 ? { padding: [20, 20] } : pad;
  map.fitBounds(L.latLngBounds(latlngs), { ...opts, maxZoom: 17, animate });
}

/* ------------------------------------------------------------------ */
/* Shape helpers                                                       */
/* ------------------------------------------------------------------ */

const currentShape = () => buildShape(getShape(state.shapeId), { rotation: state.rotation, mirror: state.mirror });

function previewScale(shape) {
  const target = state.distanceKm * 1000;
  return state.mode === 'roads' ? target / (shape.perimeter * ROAD_FACTOR) : target / shape.perimeter;
}

function idealLatLngs(shape, scale) {
  return toLatLngs(shape.dense, shape.dense[0], state.start, scale);
}

/** Small SVG of a shape (y flipped for screen), with start dot + direction arrow. */
function shapeSvg(shape, { size = 64, pad = 6, arrow = false } = {}) {
  const pts = shape.dense;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const s = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
  const ox = pad + ((size - pad * 2) - (maxX - minX) * s) / 2;
  const oy = pad + ((size - pad * 2) - (maxY - minY) * s) / 2;
  const P = ([x, y]) => [ox + (x - minX) * s, oy + (maxY - y) * s];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${P(p)[0].toFixed(1)} ${P(p)[1].toFixed(1)}`).join(' ') + (shape.closed ? 'Z' : '');
  const [sx, sy] = P(pts[0]);
  let arrowEl = '';
  if (arrow) {
    const [ax, ay] = P(pts[Math.min(14, pts.length - 1)]);
    const [bx, by] = P(pts[Math.min(22, pts.length - 1)]);
    const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    arrowEl = `<path class="dir-arrow" d="M-4 -4 L4 0 L-4 4 Z" transform="translate(${ax.toFixed(1)} ${ay.toFixed(1)}) rotate(${ang.toFixed(0)})"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><path class="shape-path" pathLength="1" d="${d}"/>${arrowEl}<circle class="start-dot" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${arrow ? 4 : 3.2}"/></svg>`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderShapeGrid() {
  const grid = $('shapeGrid');
  grid.innerHTML = '';
  SHAPES.forEach((def) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-card';
    btn.setAttribute('role', 'radio');
    btn.dataset.id = def.id;
    btn.innerHTML = `${shapeSvg(buildShape(def))}<span class="shape-card-name">${def.name}</span><span class="shape-card-tag">${def.tagline}</span>`;
    btn.addEventListener('click', () => {
      state.shapeId = def.id;
      syncShapeGrid();
      invalidate({ fit: true });
    });
    grid.appendChild(btn);
  });
  // Arrow-key navigation inside the radiogroup
  grid.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = SHAPES.findIndex((s) => s.id === state.shapeId);
    const next = SHAPES[(i + keys[e.key] + SHAPES.length) % SHAPES.length];
    state.shapeId = next.id;
    syncShapeGrid();
    grid.querySelector(`[data-id="${next.id}"]`).focus();
    invalidate({ fit: true });
  });
  syncShapeGrid();
}

function syncShapeGrid() {
  document.querySelectorAll('.shape-card').forEach((b) => {
    const on = b.dataset.id === state.shapeId;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

function renderTunePreview(shape) {
  $('tunePreview').innerHTML = shapeSvg(shape, { size: 78, pad: 8, arrow: true });
}

function renderGhost({ fit = false } = {}) {
  const shape = currentShape();
  renderTunePreview(shape);
  if (state.result) return; // the result owns the map until something changes
  const pts = idealLatLngs(shape, previewScale(shape));
  ghost.setLatLngs(pts);
  ghost.getElement()?.classList.add('is-preview');
  if (fit) fitTo(pts);
}

function setRangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function updateHud() {
  $('hudTarget').textContent = state.distanceKm.toFixed(1);
  const r = state.result;
  $('hudRoute').textContent = r ? (r.distance / 1000).toFixed(1) : '--.-';
  $('hudMatch').textContent = r ? String(r.match) : '--';
}

function updateCoords() {
  $('startCoords').textContent = `${state.start.lat.toFixed(5)}, ${state.start.lng.toFixed(5)}`;
}

/** Any change to the inputs that affect geometry clears the result. */
function invalidate({ fit = false } = {}) {
  if (state.busy) cancel();
  clearResult();
  renderGhost({ fit });
  updateHud();
}

function clearResult() {
  state.result = null;
  routeGlow.setLatLngs([]);
  routeLine.setLatLngs([]);
  kmLayer.clearLayers();
  finishMarker.remove();
  $('resultsEmpty').hidden = false;
  $('resultsBody').hidden = true;
}

function animateDraw(polyline) {
  const el = polyline.getElement();
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const len = el.getTotalLength();
  el.style.transition = 'none';
  el.style.strokeDasharray = `${len}`;
  el.style.strokeDashoffset = `${len}`;
  el.getBoundingClientRect();
  el.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(0.65, 0, 0.35, 1)';
  el.style.strokeDashoffset = '0';
  const done = () => {
    el.style.transition = '';
    el.style.strokeDasharray = '';
    el.style.strokeDashoffset = '';
  };
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 2000);
}

function showResult(result) {
  state.result = result;
  const shape = result.shape;

  ghost.setLatLngs(result.ideal);
  ghost.getElement()?.classList.remove('is-preview');
  routeGlow.setLatLngs(result.path);
  routeLine.setLatLngs(result.path);

  kmLayer.clearLayers();
  markersEvery(result.path, 1000).forEach((p, i) => {
    L.marker(p, {
      interactive: false,
      icon: L.divIcon({ className: '', html: `<span class="km-marker">${i + 1}</span>`, iconSize: [0, 0] }),
    }).addTo(kmLayer);
  });
  if (!shape.closed) finishMarker.setLatLng(result.path[result.path.length - 1]).addTo(map);
  else finishMarker.remove();

  fitTo(result.path);
  map.once('moveend', () => {
    animateDraw(routeLine);
    animateDraw(routeGlow);
  });

  // Stats
  const km = result.distance / 1000;
  $('statDist').textContent = km.toFixed(2);
  const delta = (result.distance - state.distanceKm * 1000) / (state.distanceKm * 1000);
  const deltaEl = $('statDelta');
  deltaEl.textContent = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  deltaEl.classList.toggle('warn', Math.abs(delta) > TOLERANCE);
  $('statMatch').textContent = result.match;
  $('statPoints').textContent = result.path.length.toLocaleString('en');
  $('statMode').textContent = result.mode === 'roads' ? 'ROADS' : result.fallback ? 'FREE*' : 'FREE';
  updateTime();
  $('resultsEmpty').hidden = true;
  $('resultsBody').hidden = false;
  updateHud();

  if (isMobile()) setSheet('collapsed');
  else $('resultsBlock').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parsePace(str) {
  const m = String(str).trim().match(/^(\d{1,2})(?:[:'.,](\d{1,2}))?$/);
  if (!m) return null;
  const min = +m[1];
  const sec = m[2] ? +m[2].padEnd(2, '0') : 0;
  if (sec >= 60) return null;
  const total = min * 60 + sec;
  return total > 0 ? total : null;
}

function formatDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function updateTime() {
  if (!state.result) return;
  const pace = parsePace($('paceInput').value);
  $('statTime').textContent = pace ? formatDuration((state.result.distance / 1000) * pace) : '--';
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function buildFreeResult(shape, { fallback = false } = {}) {
  const target = state.distanceKm * 1000;
  const scale = target / shape.perimeter;
  const ideal = idealLatLngs(shape, scale);
  const count = Math.max(120, Math.min(2000, Math.round(target / 12)));
  const path = resample(ideal, count);
  return {
    shape, scale, ideal, path, mode: 'free', fallback,
    distance: pathLength(path), match: 100,
  };
}

/* Shape-following router: our own A* on OSM streets, in a Web Worker. */
let worker = null;

function planOnStreets(shape, signal) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('./plan.worker.js', import.meta.url), { type: 'module' });
    const w = worker;
    const onAbort = () => {
      // The search itself is synchronous: stop it by dropping the worker.
      w.terminate();
      if (worker === w) worker = null;
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') return setLoaderStage(data.stage, data.text);
      signal.removeEventListener('abort', onAbort);
      if (data.type === 'error') return reject(new RoutingError(data.message));
      const target = state.distanceKm * 1000;
      resolve({
        ...data,
        shape,
        mode: 'roads',
        engine: 'streets',
        err: Math.abs(data.distance - target) / target,
      });
    };
    w.postMessage({
      type: 'plan',
      shapeId: state.shapeId,
      rotation: state.rotation,
      mirror: state.mirror,
      start: state.start,
      target: state.distanceKm * 1000,
      detail: state.detail,
      auto: state.auto,
    });
  });
}

const STAGES = 4;
function setLoaderStage(stage, text) {
  $('loaderBar').innerHTML = Array.from({ length: STAGES }, (_, i) =>
    `<i class="${i + 1 < stage ? 'on' : i + 1 === stage ? 'on active' : ''}"></i>`).join('');
  $('loaderTitle').textContent = `STAGE ${stage}/${STAGES}`;
  $('loaderText').textContent = text;
}

/* Fallback: public OSRM shortest-path router between waypoints. */
async function buildOsrmResult(shape, signal) {
  const target = state.distanceKm * 1000;
  let scale = previewScale(shape);
  let best = null;
  const tries = [];

  for (let it = 1; it <= MAX_ITER; it++) {
    setLoader(it, best, scale);
    const unitWaypoints = sampleWaypoints(shape, state.detail);
    const waypoints = toLatLngs(unitWaypoints, shape.dense[0], state.start, scale);
    const spacing = (shape.perimeter * scale) / state.detail;
    const { path, skipped } = await routeShape(waypoints, spacing, signal);
    const distance = pathLength(path);
    const err = Math.abs(distance - target) / target;

    if (!best || err < best.err) {
      const ideal = idealLatLngs(shape, scale);
      best = { shape, scale, ideal, path, distance, err, skipped, mode: 'roads', engine: 'osrm', iterations: it };
    }
    if (err <= TOLERANCE) break;
    scale = nextScale(tries, { scale, distance }, target);
    if (it < MAX_ITER) await sleep(900, signal); // be polite with the public server
  }
  best.match = shapeMatch(best.path, best.ideal, state.start, best.scale);
  return best;
}

function setLoader(iter, best, scale) {
  const bar = $('loaderBar');
  bar.innerHTML = Array.from({ length: MAX_ITER }, (_, i) => {
    const cls = i + 1 < iter ? 'on' : i + 1 === iter ? 'on active' : '';
    return `<i class="${cls}"></i>`;
  }).join('');
  $('loaderTitle').textContent = `STAGE ${iter}/${MAX_ITER}`;
  const size = ((scale / 1000) * 1).toFixed(2);
  $('loaderText').textContent = best
    ? `Last try: ${(best.distance / 1000).toFixed(2)} km. Rescaling shape to ${size} km wide…`
    : `Routing your shape on streets & paths (${size} km wide)…`;
}

async function generate() {
  if (state.busy) {
    cancel();
    return;
  }
  clearResult();
  const shape = currentShape();

  if (state.mode === 'free') {
    showResult(buildFreeResult(shape));
    toast('Free shape ready. Best on beaches, parks and open fields.', 'ok');
    return;
  }

  const controller = new AbortController();
  state.abort = controller;
  setBusy(true);
  try {
    let result;
    try {
      setLoaderStage(1, 'Preparing…');
      result = await planOnStreets(shape, controller.signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn(e);
      toast(`${e.message}. Falling back to the basic router.`, 'warn', 5000);
      result = await buildOsrmResult(shape, controller.signal);
    }
    showResult(result);
    if (result.engine === 'streets' && state.auto) {
      const bits = [];
      if (result.laps > 1) bits.push(`${result.laps} laps of a smaller drawing`);
      if (result.moved) bits.push(`drawn ${(result.moved / 1000).toFixed(1)} km from the pin (${(result.approach / 1000).toFixed(1)} km there & back)`);
      if (result.dRot) bits.push(`rotated ${result.dRot > 0 ? '+' : ''}${result.dRot}°`);
      if (result.shift) bits.push('joined at another point of the outline');
      if (result.variantName) bits.push(`${result.variantName} variant`);
      toast(`Auto-tune tested ${result.tested} placements${bits.length ? `: ${bits.join(', ')}` : ', the original fits best'}.`, 'ok', 6500);
    }
    if (result.err > TOLERANCE) {
      toast(`Closest match: ${(result.distance / 1000).toFixed(2)} km (${(result.err * 100).toFixed(0)}% off). Try another start point or rotation.`, 'warn');
    } else {
      toast(`Route locked in! ${(result.distance / 1000).toFixed(2)} km, ${result.match}% match.`, 'ok');
    }
    if (result.skipped > 0) {
      toast(`${result.skipped} waypoint${result.skipped > 1 ? 's' : ''} fell off the path network (water, private land) and ${result.skipped > 1 ? 'were' : 'was'} skipped. Rotating or moving the start can help.`, 'warn', 6500);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      toast('Generation cancelled.');
      renderGhost();
    } else {
      console.warn(e);
      const reason = e instanceof RoutingError ? e.message : 'Routing failed';
      showResult(buildFreeResult(shape, { fallback: true }));
      toast(`${reason}. Switched to Free shape (straight lines) instead.`, 'warn', 6000);
    }
  } finally {
    setBusy(false);
    state.abort = null;
  }
}

function cancel() {
  state.abort?.abort();
}

function setBusy(busy) {
  state.busy = busy;
  $('loader').hidden = !busy;
  const btn = $('generateBtn');
  btn.classList.toggle('is-busy', busy);
  $('generateLabel').textContent = busy ? 'CANCEL' : 'GENERATE';
  startMarker.dragging[busy ? 'disable' : 'enable']();
}

/* ------------------------------------------------------------------ */
/* Start point                                                         */
/* ------------------------------------------------------------------ */

function setStart(lat, lng, { fit = true } = {}) {
  state.start = { lat, lng };
  startMarker.setLatLng([lat, lng]);
  updateCoords();
  invalidate({ fit });
}

let searchController = null;
async function runSearch(q) {
  const list = $('searchResults');
  q = q.trim();
  if (q.length < 3) {
    list.hidden = true;
    return;
  }
  searchController?.abort();
  searchController = new AbortController();
  $('searchBtn').disabled = true;
  list.hidden = false;
  list.innerHTML = '<li class="muted">Searching…</li>';
  try {
    const results = await searchAddress(q, searchController.signal);
    if (!results.length) {
      list.innerHTML = '<li class="muted">No place found. Try a different spelling.</li>';
      return;
    }
    list.innerHTML = '';
    results.forEach((r) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.name;
      b.addEventListener('click', () => {
        list.hidden = true;
        $('searchInput').value = r.name.split(',').slice(0, 2).join(',');
        setStart(r.lat, r.lng, { fit: true });
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  } catch (e) {
    if (e.name !== 'AbortError') list.innerHTML = '<li class="muted">Search is unavailable right now.</li>';
  } finally {
    $('searchBtn').disabled = false;
  }
}

function locate() {
  if (!navigator.geolocation) {
    toast('Geolocation is not available in this browser.', 'warn');
    return;
  }
  const btn = $('locateBtn');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      setStart(pos.coords.latitude, pos.coords.longitude, { fit: true });
      toast('Start point set to your location.', 'ok');
    },
    (err) => {
      btn.disabled = false;
      toast(err.code === 1 ? 'Location permission denied.' : 'Could not get your location.', 'warn');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

function toast(msg, kind = '', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

function setSheet(mode) {
  const panel = $('panel');
  panel.dataset.sheet = mode;
  $('sheetHandle').setAttribute('aria-expanded', String(mode === 'expanded'));
}

let distFitTimer = null;
function setDistance(km, source) {
  km = Math.max(MIN_KM, Math.min(42.2, Number(km) || 0));
  state.distanceKm = Math.round(km * 10) / 10;
  if (source !== 'range') $('distRange').value = state.distanceKm;
  if (source !== 'num') $('distNum').value = state.distanceKm;
  setRangeFill($('distRange'));
  document.querySelectorAll('#distChips button').forEach((b) => b.classList.toggle('on', +b.dataset.km === state.distanceKm));
  invalidate();
  clearTimeout(distFitTimer);
  distFitTimer = setTimeout(() => renderGhost({ fit: true }), 350);
}

function setRotation(deg) {
  state.rotation = ((Math.round(deg) % 360) + 360) % 360;
  $('rotRange').value = state.rotation;
  $('rotOut').textContent = `${state.rotation}°`;
  setRangeFill($('rotRange'));
  invalidate();
}

function wire() {
  renderShapeGrid();

  $('distRange').addEventListener('input', (e) => setDistance(e.target.value, 'range'));
  $('distNum').addEventListener('change', (e) => setDistance(e.target.value)); // writes the clamped value back
  $('distChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setDistance(b.dataset.km);
  });

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch($('searchInput').value);
  });
  $('locateBtn').addEventListener('click', locate);

  $('rotRange').addEventListener('input', (e) => setRotation(+e.target.value));
  document.querySelectorAll('[data-rot]').forEach((b) =>
    b.addEventListener('click', () => setRotation(state.rotation + +b.dataset.rot)),
  );
  $('mirrorBtn').addEventListener('click', () => {
    state.mirror = !state.mirror;
    $('mirrorBtn').setAttribute('aria-pressed', String(state.mirror));
    invalidate();
  });

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.mode = r.value;
      $('detailField').hidden = state.mode !== 'roads';
      invalidate({ fit: true });
    }),
  );
  $('autoBtn').addEventListener('click', () => {
    state.auto = !state.auto;
    $('autoBtn').setAttribute('aria-pressed', String(state.auto));
    invalidate();
  });
  $('detailRange').addEventListener('input', (e) => {
    state.detail = +e.target.value;
    $('detailOut').textContent = state.detail;
    setRangeFill(e.target);
    invalidate();
  });

  $('paceInput').addEventListener('input', updateTime);
  $('exportBtn').addEventListener('click', exportGpx);
  $('generateBtn').addEventListener('click', generate);
  $('cancelBtn').addEventListener('click', cancel);

  $('tilesBtn').addEventListener('click', () => {
    const next = state.tiles === 'night' ? 'day' : 'night';
    map.removeLayer(tileLayers[state.tiles]);
    tileLayers[next].addTo(map);
    document.body.classList.replace(`tiles-${state.tiles}`, `tiles-${next}`);
    state.tiles = next;
    $('tilesLabel').textContent = next.toUpperCase();
    $('tilesBtn').setAttribute('aria-pressed', String(next === 'day'));
  });

  $('aboutBtn').addEventListener('click', () => $('aboutDialog').showModal());
  $('fundraiseLink').href = FUNDRAISER_URL;
  $('aboutDialog').addEventListener('click', (e) => {
    if (e.target === $('aboutDialog')) $('aboutDialog').close();
  });

  $('sheetHandle').addEventListener('click', () => {
    setSheet($('panel').dataset.sheet === 'expanded' ? 'collapsed' : 'expanded');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.busy) cancel();
  });

  ['rotRange', 'detailRange'].forEach((id) => setRangeFill($(id)));
  setRangeFill($('distRange'));
  setDistance(state.distanceKm);
  updateCoords();
  renderGhost({ fit: true });
}

function exportGpx() {
  const r = state.result;
  if (!r) return;
  const shape = getShape(state.shapeId);
  const km = (r.distance / 1000).toFixed(1);
  const custom = $('eventInput').value.trim();
  const name = custom || `ZobRun - ${shape.name} ${km} km`;
  const description = `${shape.name} GPS art route, ${km} km, generated with ZobRun.`;
  downloadText(`${slugify(name)}.gpx`, buildGpx({ name, description, points: r.path }));
  toast('GPX downloaded. Import it in Strava → My Routes.', 'ok');
}

wire();
