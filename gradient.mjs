// Gradient geometry shared by the editor preview and WebGL renderer.
export const MAX_STOPS = 16;
export function stopColor(stop) {
  const rgb = [1, 3, 5].map(i => parseInt(stop.color.slice(i, i + 2), 16) / 255);
  const t = stop.shade / 100;
  return rgb.map(c => t <= .5 ? c * t * 2 : c + (1 - c) * (t - .5) * 2);
}
export function gradientModel(stops, stepping) {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const s = Math.max(0, Math.min(1, stepping));
  const p = sorted.map(stop => stop.position / 100);
  const last = p.length - 1;
  // Grow half a neighboring gap beyond each endpoint, then normalize.
  // At full stepping each endpoint receives a whole gap, not half a gap.
  const left = s * (p[0] - (p[1] - p[0]) / 2);
  const right = (1 - s) + s * (p[last] + (p[last] - p[last - 1]) / 2);
  const span = right - left;
  const starts = [], ends = [];
  for (let i = 0; i < last; i++) {
    const halfGap = (p[i + 1] - p[i]) / 2;
    starts.push((p[i] + s * halfGap - left) / span);
    ends.push((p[i + 1] - s * halfGap - left) / span);
  }
  return { colors: sorted.map(stopColor), starts, ends };
}
export function sampleGradient(model, x) {
  const { colors, starts, ends } = model;
  for (let i = 0; i < starts.length; i++) {
    if (x < starts[i]) return colors[i];
    if (x < ends[i]) {
      const t = (x - starts[i]) / (ends[i] - starts[i]);
      const eased = t * t * (3 - 2 * t);
      return colors[i].map((c, channel) => c + (colors[i + 1][channel] - c) * eased);
    }
  }
  return colors.at(-1);
}
export const colorCSS = rgb => `rgb(${rgb.map(c => Math.round(c * 255)).join(',')})`;
