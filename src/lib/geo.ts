// Delivery by distance: the customer's pin picks the nearest branch that delivers that far.
export type Pt = [number, number]; // [lat, lng]

// Great-circle distance (haversine). Straight line, so real road distance is a bit longer.
export function distanceKm([lat1, lng1]: Pt, [lat2, lng2]: Pt): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function nearestBranch<B extends { lat: number | null; lng: number | null; maxKm: number }>(p: Pt, branches: B[]) {
  return branches
    .filter((b) => b.lat !== null && b.lng !== null)
    .map((b) => ({ b, km: distanceKm(p, [b.lat!, b.lng!]) }))
    .filter((x) => x.km <= x.b.maxKm)
    .sort((x, y) => x.km - y.km)[0];
}
