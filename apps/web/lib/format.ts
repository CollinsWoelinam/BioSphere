export const fmtDate = (t: number | string) =>
  new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export const fmtMonth = (t: number | string) =>
  new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short" });

export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n)
    ? "–"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export const DAY = 86_400_000;
