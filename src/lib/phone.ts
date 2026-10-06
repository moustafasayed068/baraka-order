// Egyptian mobile: 010 / 011 / 012 / 015 + 8 digits
export const PHONE_RE = /^01[0125][0-9]{8}$/;

// Arabic-Indic and Persian digits typed on Arabic keyboards -> ASCII, spaces/dashes dropped
export const normalizePhone = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[\s-]/g, "");
