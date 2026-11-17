/** GPX 1.1 export (works with Strava, Garmin Connect and Komoot). */

const esc = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function buildGpx({ name, description, points }) {
  const time = new Date().toISOString();
  const pts = points
    .map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Shape Run" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${esc(name)}</name>
    <desc>${esc(description)}</desc>
    <time>${time}</time>
  </metadata>
  <trk>
    <name>${esc(name)}</name>
    <desc>${esc(description)}</desc>
    <type>running</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function slugify(s) {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shape-run'
  );
}

export function downloadText(filename, text, mime = 'application/gpx+xml') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
