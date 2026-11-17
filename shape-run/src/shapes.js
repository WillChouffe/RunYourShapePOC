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
 *  - variants : optional alternative outlines ({ variantName, points,
 *               sharp }). The UI only shows the main one, but the route
 *               search also tries every variant and keeps the best fit.
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

function starPoints(branches = 5, inner = 0.42) {
  const pts = [];
  for (let k = 0; k < branches * 2; k++) {
    const a = Math.PI / 2 - (k * Math.PI) / branches; // clockwise from the top
    const r = k % 2 === 0 ? 1 : inner;
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
    variants: [
      {
        variantName: 'angular heart',
        points: [
          [0, -1], [-0.95, 0.05], [-1, 0.45], [-0.8, 0.8], [-0.45, 0.88], [-0.15, 0.7], [0, 0.5],
          [0.15, 0.7], [0.45, 0.88], [0.8, 0.8], [1, 0.45], [0.95, 0.05],
        ],
        sharp: [0, 1, 6, 11],
      },
      { variantName: 'wide heart', points: heartPoints().map(([x, y]) => [x * 1.2, y]), sharp: [0, 8] },
    ],
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
    variants: [
      {
        variantName: 'longer shaft',
        points: [
          [0, -0.72], [0.12, -0.92], [0.32, -0.98], [0.5, -0.85], [0.52, -0.62], [0.38, -0.48],
          [0.2, -0.45], [0.2, 0.6],
          [0.3, 0.65], [0.3, 0.82], [0.2, 1.02], [0, 1.1], [-0.2, 1.02], [-0.3, 0.82], [-0.3, 0.65],
          [-0.2, 0.6], [-0.2, -0.45],
          [-0.38, -0.48], [-0.52, -0.62], [-0.5, -0.85], [-0.32, -0.98], [-0.12, -0.92],
        ],
        sharp: [0, 6, 7, 8, 14, 15, 16],
      },
    ],
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
    variants: [
      {
        variantName: 'long nose & dorsal fin',
        points: [
          [1.2, 0.0], [0.8, 0.28], [0.4, 0.42], [0.2, 0.45], [0.0, 0.68], [-0.12, 0.42],
          [-0.4, 0.15], [-0.52, 0.07], [-0.92, 0.4], [-0.8, 0.0], [-0.92, -0.4], [-0.52, -0.07],
          [-0.4, -0.15], [-0.1, -0.36], [0.35, -0.42], [0.8, -0.26],
        ],
        sharp: [0, 4, 5, 7, 8, 9, 10, 11],
      },
    ],
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
    // Traced from a classic middle-finger icon (200 px canvas, y down):
    // thumb on the left, index stub, tall middle finger, ring and pinky
    // stubs stepping down, rounded palm. Starts bottom-left, clockwise.
    id: 'finger',
    name: 'Middle Finger',
    tagline: 'Against racist & sexist violence',
    closed: true,
    points: [
      [80, 170], [64, 162], [58, 150], [55, 125],
      // thumb
      [55, 104], [60, 101], [71, 101],
      // index stub
      [71, 82], [75, 78], [83, 78], [88, 82],
      // middle finger
      [88, 38], [92, 33], [102, 33], [107, 38],
      // ring stub, then pinky stub
      // (small dip between them stands in for the icon's inner line)
      [107, 82], [110, 80], [120, 80], [123, 84], [125, 93],
      [128, 87], [138, 87], [141, 92],
      // right side of the palm and the rounded bottom
      [141, 140], [136, 155], [124, 165], [110, 170],
    ].map(([x, y]) => [x, -y]),
    // corners everywhere except the rounded palm bottom
    sharp: [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26],
    variants: [
      {
        // Thin middle finger: run it as an out-and-back along a single street.
        variantName: 'single-street finger',
        points: [
          [80, 170], [64, 162], [58, 150], [55, 125], [55, 104], [60, 101], [71, 101],
          [71, 82], [75, 78], [83, 78], [88, 82],
          [95, 82], [95, 36], [97, 33], [99, 36], [99, 82],
          [107, 82], [110, 80], [120, 80], [123, 84], [125, 93], [128, 87], [138, 87], [141, 92],
          [141, 140], [136, 155], [124, 165], [110, 170],
        ].map(([x, y]) => [x, -y]),
        sharp: [0, ...Array.from({ length: 22 }, (_, i) => i + 3), 27],
      },
    ],
  },
  {
    id: 'star',
    name: 'Star',
    tagline: 'Bonus level',
    closed: true,
    points: starPoints(),
    sharp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    variants: [
      { variantName: 'six-point star', points: starPoints(6, 0.5), sharp: [...Array(12).keys()] },
      { variantName: 'chunky star', points: starPoints(5, 0.55), sharp: [...Array(10).keys()] },
    ],
  },
];

export const getShape = (id) => SHAPES.find((s) => s.id === id) || SHAPES[0];
