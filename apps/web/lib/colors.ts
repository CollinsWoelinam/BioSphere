/**
 * Validated reference palette (dataviz skill). Categorical slots are assigned to species
 * in a fixed order (alphabetical species list), so a species keeps its color when filtered.
 */
type RGB = [number, number, number];

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OTHER = { light: "#898781", dark: "#898781" };

export type Mode = "light" | "dark";

export function speciesColorHex(index: number, mode: Mode): string {
  return index >= 0 && index < 8 ? CATEGORICAL[mode][index] : OTHER[mode];
}
export const speciesColor = (index: number, mode: Mode): RGB => hex(speciesColorHex(index, mode));

/** Sequential blue ramp (100 → 700) for heatmap and hex density. */
export const SEQUENTIAL_BLUE: RGB[] = [
  "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b",
].map(hex);

/** Diverging pair for habitat change: gained (blue) vs lost (red), gray midpoint. */
export const DIVERGING = {
  gained: hex("#2a78d6"),
  lost: hex("#e34948"),
  stable: { light: hex("#c3c2b7"), dark: hex("#383835") },
};

export const rgba = ([r, g, b]: RGB, a: number): [number, number, number, number] => [r, g, b, a];
