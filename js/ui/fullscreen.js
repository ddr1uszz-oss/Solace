// Fullscreen helpers (standard + old WebKit). iPhone Safari has no element fullscreen, so the button hides there.
const d = document, el = d.documentElement;
export const fsSupported = () => !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
export const isFs = () => !!(d.fullscreenElement || d.webkitFullscreenElement);
export function toggleFs() {
  const fn = isFs() ? (d.exitFullscreen || d.webkitExitFullscreen) : (el.requestFullscreen || el.webkitRequestFullscreen);
  try { Promise.resolve(fn.call(isFs() ? d : el)).catch(() => {}); } catch { /* blocked */ }
}
export function onFsChange(fn) {
  d.addEventListener('fullscreenchange', fn); d.addEventListener('webkitfullscreenchange', fn);
  return () => { d.removeEventListener('fullscreenchange', fn); d.removeEventListener('webkitfullscreenchange', fn); };
}
