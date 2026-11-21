// Gmail's four rows of preset label backgrounds, in display order.
export const presetColors = [
  "#e7e7e7", "#b6cff5", "#98d7e4", "#e3d7ff", "#fbd3e0", "#f2b2a8",
  "#757575", "#1e53b8", "#007286", "#7858c3", "#c2185b", "#d93025",
  "#ffc8af", "#ffdeb5", "#fbe983", "#fdedc1", "#b3efd3", "#a2dcc1",
  "#ff7537", "#ffad46", "#ebdbde", "#cca6ac", "#42d692", "#16a765",
];
export function presetText(index) {
  return index >= 6 && index < 12 ? "#ffffff" : "#202124";
}

export function labelStyle(label) {
  if (label?.background) return { backgroundColor: label.background, color: label.foreground };
}

export const customColors = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#ffffff",
  "#fb4c2f", "#202124", "#fad165", "#3c4043", "#2da2bb", "#4986e7", "#a479e2", "#f691b3",
  ...presetColors,
  "#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3f8", "#c9daf8", "#e4d7f5", "#fcdee8",
  "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#1c91a8", "#3c78d8", "#8e63ce", "#e07798",
  "#822111", "#a46a21", "#aa8831", "#0b4f30", "#0d5969", "#1c4587", "#5b2d90", "#83334c",
];
