export function visibleFrame(frame, bounds) {
  const area = {...bounds};
  for (let parent = frame.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const rect = parent.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      area.left = Math.max(area.left,rect.left + parent.clientLeft);
      area.right = Math.min(area.right,rect.left + parent.clientLeft + parent.clientWidth);
    }
    if (style.overflowY !== "visible") {
      area.top = Math.max(area.top,rect.top + parent.clientTop);
      area.bottom = Math.min(area.bottom,rect.top + parent.clientTop + parent.clientHeight);
    }
  }
  return area;
}
