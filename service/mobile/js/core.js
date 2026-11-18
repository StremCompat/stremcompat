/* What every part of the phone interface uses: the page's helpers, the API, pictures, texts,
   icons, the platform's look and the viewer's phone settings. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export const enc = encodeURIComponent;

/* ---------- the platform: iOS or Android looks, from the app (?platform=) or the phone ---------- */
function detectPlatform() {
  const asked = new URLSearchParams(location.search).get('platform');
  if (asked === 'ios' || asked === 'android') return asked;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
}
export const PLATFORM = detectPlatform();
export const IOS = PLATFORM === 'ios';
document.documentElement.dataset.platform = PLATFORM;

/* ---------- the API: null when the server did not answer, and the offline banner meanwhile ---------- */
let offline = false;
function setOffline(on) {
  if (on === offline) return;
  offline = on;
  const banner = $('#offline');
  if (banner) banner.textContent = t('noConnectionShort');
  document.documentElement.classList.toggle('offline', on);
}
export async function api(path, body) {
  try {
    const r = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    setOffline(false);
    return r.ok ? await r.json() : null;
  } catch (e) {
    setOffline(true);
    return null;
  }
}
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => setOffline(false));

/* pictures through the server, about as wide as they are shown on this screen */
export function img(url, cssWidth) {
  if (!url) return '';
  const w = Math.min(1280, Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 3)));
  return '/app/img?u=' + enc(url) + '&w=' + w;
}

/* ---------- the interface's texts in its language (the TV's strings) ---------- */
let texts = { lang: {}, fallback: {} };
export function setTexts(s) {
  if (s) texts = s;
}
export function t(key, ...args) {
  let s = String(texts.lang[key] || texts.fallback[key] || key);
  args.forEach((a, i) => (s = s.replace('{' + i + '}', a)));
  return s;
}

/* ---------- the viewer's phone settings (Settings > Phone) ---------- */
export const ACCENTS = {
  violet: '#7B5BF5',
  crimson: '#E5484D',
  ocean: '#3B82F6',
  emerald: '#10B981',
  amber: '#F5A524',
  rose: '#EC4899',
  white: '#F4F2FA'
};
export const prefs = { accent: 'violet', autoBest: false, player: 'app' };

/* the accent and the colours made from it (Android; iOS keeps the system blue) */
export function applyAccent(name) {
  prefs.accent = ACCENTS[name] ? name : 'violet';
  if (IOS) return;
  const hex = ACCENTS[prefs.accent],
    n = parseInt(hex.slice(1), 16),
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255],
    light = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 160,
    style = document.documentElement.style;
  style.setProperty('--accent', hex);
  style.setProperty('--accent-soft', `rgba(${rgb.join(',')},0.22)`);
  style.setProperty('--on-accent', light ? '#141218' : '#fff');
}

/* the values of the phone's settings, from its Settings model */
export function readPrefs(model) {
  const all = {};
  ((model && model.groups) || []).forEach((g) => g.items.forEach((it) => (all[it.k] = it.chosen)));
  applyAccent(all.phoneAccent);
  prefs.autoBest = all.phoneAutoBest === 'true';
  prefs.player = all.phonePlayer === 'external' ? 'external' : 'app';
}

/* ---------- small feedback ---------- */
export function haptic() {
  if (navigator.vibrate) navigator.vibrate(8);
}

let toastTimer = 0;
export function toast(text) {
  const box = $('#toast');
  if (!text || !box) return;
  box.textContent = text;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 2800);
}

/* ---------- icons (our own) ---------- */
const S = (body, fill) =>
  fill
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICON = {
  home: S('<path d="M12 3.2 2.8 11h2.7v9.3h5V15h3v5.3h5V11h2.7z"/>', true),
  search: S('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>'),
  library: S('<path d="M4 4h4v16H4zM10 4h4v16h-4zM15.6 4.8l3.8-1 4 15.4-3.8 1z"/>', true),
  settings: S(
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
  ),
  chevronBack: S('<path d="M15 4 7 12l8 8"/>'),
  arrowBack: S('<path d="M20 12H4M10 5l-7 7 7 7"/>'),
  play: S('<path d="M7 4.5v15l13-7.5z"/>', true),
  bolt: S('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', true),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  check: S('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  film: S(
    '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>'
  ),
  grid: S(
    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  ),
  list: S('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  eye: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  chevron: S('<path d="m9 5 7 7-7 7"/>'),
  more: S(
    '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    true
  ),
  sort: S('<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>'),
  link: S(
    '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'
  ),
  external: S('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  remove: S('<path d="M5 12h14"/>'),
  phone: S('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>'),
  globe: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
};
