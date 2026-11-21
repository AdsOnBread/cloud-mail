// Gmail's four rows of preset label backgrounds, in display order.
export const presetColors = [
  "#e7e7e7", "#b6cff5", "#98d7e4", "#e3d7ff", "#fbd3e0", "#f2b2a8",
  "#757575", "#1e53b8", "#007286", "#7858c3", "#c2185b", "#d93025",
  "#ffc8af", "#ffdeb5", "#fbe983", "#fdedc1", "#b3efd3", "#a2dcc1",
  "#ff7537", "#ffad46", "#ebdbde", "#cca6ac", "#42d692", "#16a765",
];
const foregrounds = [
  "#464646", "#0d3472", "#0d3b44", "#3d188e", "#711a36", "#8a1c0a",
  "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff",
  "#7a2e0b", "#7a4706", "#594c05", "#684e07", "#0b4f30", "#04502e",
  "#54240e", "#633e04", "#662e37", "#521d28", "#202124", "#083018",
];
export function presetText(index) { return foregrounds[index]; }

export function labelStyle(label) {
  if (label?.background) return { backgroundColor: label.background, color: label.foreground };
}

export const customColors = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
  "#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3",
  "#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3de", "#c9daf8", "#e4d7f5", "#fcdee8",
  "#efa093", "#ffd6a2", "#fce8b3", "#89d3b2", "#a0eac9", "#a4c2f4", "#d0bcf1", "#fbc8d9",
  "#e66550", "#ffbc6b", "#fcda83", "#44b984", "#68dfa9", "#6d9eeb", "#b694e8", "#f7a7c0",
  "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798",
  "#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775",
  "#822111", "#a46a21", "#aa8831", "#076239", "#1a764d", "#1c4587", "#41236d", "#83334c",
];

// Keep the original swatch selectable while editing a previously saved pair.
export function customPalette(original) {
  return original && !customColors.includes(original) ? [...customColors, original] : customColors;
}
