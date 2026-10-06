// Local dev: Supabase runs on this PC, so a phone must reach it via the same host it opened the site on
// (the LAN IP can change after a reboot). Real deployments use the configured URL unchanged.
export function devHost(url: string, host: string) {
  const u = new URL(url);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") u.hostname = host;
  return u.origin;
}
