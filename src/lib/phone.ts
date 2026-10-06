// Egyptian mobile: 010 / 011 / 012 / 015 + 8 digits
export const PHONE_RE = /^01[0125][0-9]{8}$/;

// Arabic-Indic and Persian digits typed on Arabic keyboards -> ASCII, spaces/dashes dropped
export const normalizePhone = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[\s-]/g, "");

// Lists show 010•••••678; the full number only where the role needs it.
export const maskPhone = (p: string) => (p.length >= 6 ? `${p.slice(0, 3)}•••••${p.slice(-3)}` : p);
