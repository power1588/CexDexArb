export function getViewportMode(width) {
  if (width <= 720) {
    return "mobile";
  }

  if (width <= 1220) {
    return "tablet";
  }

  return "desktop";
}

export function applyViewportMode(target, width) {
  const mode = getViewportMode(width);

  if (target?.dataset) {
    target.dataset.viewportMode = mode;
  }

  return mode;
}

export function getViewportModeLabel(mode) {
  const labels = {
    desktop: "桌面布局",
    tablet: "平板布局",
    mobile: "移动布局",
  };

  return labels[mode] ?? mode;
}
