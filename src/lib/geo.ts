// Delivery zone matching. Polygons are stored as [[lat, lng], ...] on delivery_zones.polygon.
export type Pt = [number, number];

// Ray casting; fine for city-sized zones (no antimeridian or pole cases in Egypt).
export function inPolygon([lat, lng]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, oi] = poly[i], [aj, oj] = poly[j];
    if (oi > lng !== oj > lng && lat < ((aj - ai) * (lng - oi)) / (oj - oi) + ai) inside = !inside;
  }
  return inside;
}

export const matchZone = <Z extends { polygon: Pt[] | null }>(p: Pt, zones: Z[]) =>
  zones.find((z) => z.polygon && z.polygon.length >= 3 && inPolygon(p, z.polygon));
