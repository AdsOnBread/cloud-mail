// Preserve the position of visible drafts. When space runs out, keep the most
// recently used windows on screen and leave room for the draft switcher.
export function dockLayout(windows, viewport, active, sideInset = 0) {
  const edge = viewport < 768 ? 8 : sideInset ? sideInset + 16 : 48;
  const gap = 12;
  const available = viewport - edge - 8;
  const sizes = new Map(
    windows.map((item) => [
      item.key,
      item.minimized ? 328 : Math.max(510, Math.min(590, viewport * 0.39)),
    ]),
  );
  const focused = windows.find((item) => item.key === active);
  const exclusive =
    focused && !focused.minimized && (focused.expanded || viewport < 768);
  const crowded =
    windows.reduce((total, item) => total + sizes.get(item.key) + gap, -gap) >
    available;
  let remaining = Math.max(
    0,
    available - (crowded && windows.length > 1 ? 52 : 0),
  );
  const visible = new Set();
  const ranked = [...windows].sort(
    (a, b) =>
      Number(b.key === active) - Number(a.key === active) || b.used - a.used,
  );
  for (const item of ranked) {
    if ((exclusive || (item.expanded && !item.minimized)) && item !== focused)
      continue;
    const width = sizes.get(item.key);
    if (visible.size && width > remaining) continue;
    sizes.set(item.key, Math.min(width, remaining));
    remaining -= width + gap;
    visible.add(item.key);
  }
  let right = edge;
  const positions = new Map();
  for (const item of windows) {
    if (!visible.has(item.key)) continue;
    const width = sizes.get(item.key);
    positions.set(item.key, { right, width });
    right += width + gap;
  }
  return { positions, right, exclusive };
}
