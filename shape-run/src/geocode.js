/**
 * Address search via Nominatim. Usage policy: max 1 request/second,
 * no autocomplete. We only search on explicit submit and space calls out.
 */
import { sleep } from './routing.js';

let lastCall = 0;

export async function searchAddress(query, signal) {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait, signal);
  lastCall = Date.now();
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return data.map((r) => ({ name: r.display_name, lat: +r.lat, lng: +r.lon }));
}
