/**
 * Shape library.
 *
 * Each shape is a polyline of control points in unit coordinates
 * (x to the east, y to the north; any scale, it is normalized later).
 *
 *  - points : control points. The FIRST point is the start of the run.
 *  - closed : true if the run loops back to the start.
 *  - sharp  : indices of control points that are corners (no smoothing
 *             across them). Everything else is smoothed with Catmull-Rom.
 *
 * To add a shape, push a new object into SHAPES. That's it.
 */

function heartPoints() {
  // Classic parametric heart, sampled at 16 points starting at the bottom tip.
  const pts = [];
  const n = 16;
  for (let k = 0; k < n; k++) {
    const t = Math.PI + (2 * Math.PI * k) / n;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x, y]);
  }
  return pts;
}

function mustachePoints() {
  // Right half, from the top centre going clockwise to the bottom centre.
  const right = [
    [0.15, 0.2], [0.38, 0.18], [0.6, 0.06], [0.78, 0.04], [0.9, 0.14],
    [0.98, 0.3], // tip (sharp)
    [0.96, 0.12], [0.86, -0.02], [0.65, -0.1], [0.4, -0.14], [0.18, -0.1],
  ];
  const left = right.map(([x, y]) => [-x, y]).reverse();
  // top centre, right half, bottom centre, left half
  return [[0, 0.1], ...right, [0, -0.02], ...left];
}

function starPoints() {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 - (k * Math.PI) / 5; // clockwise from the top
    const r = k % 2 === 0 ? 1 : 0.42;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

export const SHAPES = [
  {
    id: 'heart',
    name: 'Heart',
    tagline: 'Run with love',
    closed: true,
    points: heartPoints(),
    sharp: [0, 8],
  },
  {
    id: 'ribbon',
    name: 'Awareness Ribbon',
    tagline: 'Point to point',
    closed: false,
    points: [
      [-0.42, -1.0], [-0.2, -0.55], [0, -0.18],
      [0.2, 0.2], [0.28, 0.55], [0.18, 0.85], [0, 0.95],
      [-0.18, 0.85], [-0.28, 0.55], [-0.2, 0.2],
      [0, -0.18], [0.2, -0.55], [0.42, -1.0],
    ],
    sharp: [],
  },
  {
    id: 'barre',
    name: 'La Grande Barre',
    tagline: 'For the boys',
    closed: true,
    points: [
      [0, -0.72],
      // right ball
      [0.12, -0.92], [0.32, -0.98], [0.5, -0.85], [0.52, -0.62], [0.38, -0.48],
      // shaft, right side
      [0.2, -0.45], [0.2, 0.4],
      // the tip
      [0.3, 0.45], [0.3, 0.62], [0.2, 0.82], [0, 0.9], [-0.2, 0.82], [-0.3, 0.62], [-0.3, 0.45],
      // shaft, left side
      [-0.2, 0.4], [-0.2, -0.45],
      // left ball
      [-0.38, -0.48], [-0.52, -0.62], [-0.5, -0.85], [-0.32, -0.98], [-0.12, -0.92],
    ],
    sharp: [0, 6, 7, 8, 14, 15, 16],
  },
  {
    id: 'fish',
    name: 'Fish',
    tagline: 'Just keep running',
    closed: true,
    points: [
      [1.0, 0.0],
      [0.75, 0.3], [0.35, 0.45], [-0.1, 0.38], [-0.4, 0.15],
      [-0.52, 0.07], [-0.92, 0.4], [-0.8, 0.0], [-0.92, -0.4], [-0.52, -0.07],
      [-0.4, -0.15], [-0.1, -0.36], [0.35, -0.42], [0.75, -0.28],
    ],
    sharp: [0, 5, 6, 7, 8, 9],
  },
  {
    id: 'mustache',
    name: 'Mustache',
    tagline: 'Movember mode',
    closed: true,
    points: mustachePoints(),
    sharp: [0, 6, 12, 18],
  },
  {
    id: 'star',
    name: 'Star',
    tagline: 'Bonus level',
    closed: true,
    points: starPoints(),
    sharp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  },
];

export const getShape = (id) => SHAPES.find((s) => s.id === id) || SHAPES[0];
