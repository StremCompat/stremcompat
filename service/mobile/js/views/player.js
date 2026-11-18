/* Playing: the Android and iOS apps play in their own player (window.StremCompatNative); a browser
   plays in a <video>; Settings > Phone > Player can send it to another app instead. Either way the
   server hears the progress, as from the TV. */
import { $, api, enc, IOS, prefs, t, toast } from '../core.js';
import { goBack, opened, topView } from '../nav.js';
import { openSources } from './sources.js';

const native = () => window.StremCompatNative;

function playQuery(p) {
  return `type=${enc(p.type)}&id=${enc(p.id)}&vid=${enc(p.vid)}${p.resume ? '&resume=1' : `&seq=${p.seq}`}`;
}

/* the address a source plays from (to copy it, or open it elsewhere) */
export async function sourceUrl(type, id, vid, seq) {
  const ans = await api(`/app/play?${playQuery({ type, id, vid, seq })}`);
  return ans && ans.info && ans.info.URL;
}

/* another app: the app's own chooser, otherwise the system's (an Android intent, VLC on iOS) */
export function playExternal(url, name) {
  const n = native();
  if (n && n.openExternal) return n.openExternal(url, name || '');
  if (IOS) return (location.href = 'vlc-x-callback://x-callback-url/stream?url=' + enc(url));
  const u = new URL(url, location.href);
  location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};type=video/*;S.title=${enc(name || '')};end`;
}

/* The playback on screen now: what it plays, its own id for the server (a report that arrives
   after it was left is ignored there), and whether its next episode follows. A new playback
   replaces it, so a late end of the one before cannot start anything. */
let current = null;

export async function startPlayback(p) {
  toast(t('loadingText'));
  const ans = await api(`/app/play?${playQuery(p)}`);
  if (!ans || !ans.info) {
    if (p.resume) return openSources(p.type, p.id, p.vid, p.name);
    return toast(t('sourcePrepareFailed'));
  }
  const info = ans.info,
    item = {
      type: p.type,
      id: p.id,
      vid: p.vid,
      name: info.TITLE || p.name,
      poster: info.POSTER || '',
      background: info.BG || '',
      logo: info.LOGO || '',
      next: info.NEXTVID || '',
      play: Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    },
    /* what the app's own players apply: Settings and this show's remembered subtitles */
    options = {
      seekStep: ans.seekStep || 10,
      subtitleLanguage: ans.subtitleLanguage || '',
      audioLanguage: ans.audioLanguage || ''
    };
  const session = (current = { item, binge: !!ans.binge, sourceName: p.name });
  if (prefs.player === 'external') return playExternal(info.URL, item.name);
  const n = native();
  if (n && n.play)
    return n.play(info.URL, item.name, ans.resume || 0, JSON.stringify(item), JSON.stringify(options));
  playInPage(info.URL, ans.resume || 0, item, session);
}

/* how a playback ended: played to its end (the next episode follows, Settings > Play next
   episode), closed by the viewer, or failed (back to the sources of the same episode) */
function finished(session, how) {
  if (!session || session !== current) return;
  current = null;
  const it = session.item;
  if (how === 'ended' && it.next && session.binge)
    openSources(it.type, it.id, it.next, it.name, { best: true });
  else if (how === 'failed') {
    toast(t('sourcePrepareFailed'));
    openSources(it.type, it.id, it.vid, session.sourceName || it.name);
  }
}

function report(item, time, duration, event) {
  if (!item || !(duration > 0)) return;
  api(
    '/app/progress',
    Object.assign({}, item, { time: Math.round(time), duration: Math.round(duration), event })
  );
}

function playInPage(url, resume, item, session) {
  const box = $('#player'),
    video = $('#video');
  let last = 0,
    how = 'closed';
  box.classList.add('on');
  video.src = url;
  video.onloadedmetadata = () => {
    if (resume > 0) video.currentTime = resume / 1000;
    video.play().catch(() => {});
  };
  video.ontimeupdate = () => {
    if (Date.now() - last < 10000) return;
    last = Date.now();
    report(item, video.currentTime * 1000, video.duration * 1000, 'tick');
  };
  video.onpause = () => report(item, video.currentTime * 1000, video.duration * 1000, 'pause');
  video.onended = () => {
    how = 'ended';
    goBack();
  };
  video.onerror = () => {
    how = 'failed';
    goBack();
  };
  if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  opened(() => {
    report(item, video.currentTime * 1000, video.duration * 1000, 'leave');
    video.onpause = video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    box.classList.remove('on');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    refreshTop();
    /* after this back has closed the player, so the sources take their own history entry */
    if (session) setTimeout(() => finished(session, how), 350);
  });
  $('#playerClose').onclick = goBack;
}

function refreshTop() {
  const top = topView();
  if (top && top.refresh) top.refresh();
}
/* the app's own player closed (it told the server what was watched): 'ended', 'closed' or
   'failed'. The page shows the progress, and goes on as finished() decides. */
window.stremcompatPlaybackEnded = (how) => {
  setTimeout(refreshTop, 400);
  finished(current, how);
};

export async function playTrailer(type, id) {
  const ans = await api(`/app/trailer?type=${enc(type)}&id=${enc(id)}`);
  if (!ans || !ans.url) return toast((ans && ans.error) || t('trailerUnavailable'));
  playInPage(ans.url, 0, null, null);
}
