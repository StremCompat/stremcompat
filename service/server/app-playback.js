// The native player's side of the server: starting a chosen source (/app/play) and keeping
// what is watched (/app/progress). The progress is kept as the web player keeps it
// (src/player/progress.js), in the same library items, so Continue Watching, the watched marks
// and the account behave as with the web interface.

var { readJsonBody, sendJson } = require('./http-util');
var { playerConstants, playerContext } = require('./player-page');
var { getStreamRef, storeStreamRef } = require('./stream-refs');
var { seriesVideos, setWatched } = require('./watched');
var runtime = require('./app-runtime');

var WATCHED_THRESHOLD = 0.7;
var SUBTITLE_SIZES = {
  0: 72,
  1: 80,
  2: 100,
  3: 120,
  4: 140,
  5: 160,
  6: 180
}; /* watched once 70 % was really played, as stremio-core */
var PUSH_EVERY_MS = 60000;
var LONGEST_STEP_MS = 15000; /* more than this between two reports is a jump, not playback */

function fail(res, status, why) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: why }));
}

function writeItem(L, item) {
  runtime.storage.setItem(L.libKey(item._id), JSON.stringify(item));
}

/* ---------- starting a source ---------- */
/* per title, what the next episode's source should look like (web: nextSourcePref) */
var nextPrefs = {};
/* the source playing now, for what the player says it could not play (/app/learn) */
var playing = null;

function nextPref(id) {
  return nextPrefs[id] || null;
}

function answerStream(res, q, ref) {
  var stream = getStreamRef(ref);
  if (!stream) return fail(res, 404, 'gone');
  var L = runtime.logic(),
    it = L.libItem(q.id),
    s = (it && it.state) || {},
    /* where this video was left, unless that was its last half minute (web: tryResume) */
    resume =
      s.video_id === (q.vid || q.id) &&
      s.timeOffset > 5000 &&
      (!s.duration || s.timeOffset < s.duration - 30000)
        ? s.timeOffset
        : 0;
  playing = stream;
  playerContext(stream, { type: q.type, id: q.id, vid: q.vid, ref: ref }, function (context) {
    var info = playerConstants(stream, context);
    nextPrefs[q.id] = {
      addon: info.ADDON,
      quality: info.QUALITY,
      compat: info.COMPAT,
      text: info.SNAME,
      binge: info.BINGE,
      langs: L.streamLanguages({ name: info.SNAME })
    };
    sendJson(res, {
      ref: ref,
      info: info,
      /* Settings: play the next episode by itself */
      binge: L.setting('bingeWatch', 'true') !== 'false' && L.setting('enableNextVideo', 'true') !== 'false',
      resume: resume,
      seekStep: parseInt(L.setting('seekStep', '10'), 10) || 10,
      /* the subtitles chosen in Settings, or the interface's language until then (web: subtitles.js) */
      subtitleLanguage: L.setting('subsLang', L.defaultMediaLanguage()),
      /* Settings > Subtitles: size, colour, outline and background (web: subtitles.js) */
      subtitleStyle: {
        size: Math.round((38 * (SUBTITLE_SIZES[L.setting('subtitleSize', '2')] || 100)) / 100),
        color: L.setting('subsColor', '#ffffff'),
        outline: L.setting('subsOutlineColor', '#000000'),
        background: parseFloat(L.setting('subsBgStyle', '0')) || 0
      }
    });
  });
}

/* the source chosen in a search (by its number), or with resume=1 the one played last time
   for this video while the server still has it */
function play(req, res, q, searches) {
  var L = runtime.logic(),
    vid = q.vid || q.id,
    kept = 'tvstream_' + q.id + '_' + vid;
  if (q.resume) {
    var last = /[?&]ref=([^&]+)/.exec(runtime.storage.getItem(kept) || '');
    return last && getStreamRef(decodeURIComponent(last[1]))
      ? answerStream(res, q, decodeURIComponent(last[1]))
      : fail(res, 404, 'gone');
  }
  var search = searches[q.type + '|' + vid],
    seq = parseInt(q.seq, 10),
    item = null;
  for (var i = 0; search && i < search.items.length; i++)
    if (search.items[i]._seq === seq) item = search.items[i];
  if (!item) return fail(res, 404, 'unknown source');
  var body = L.streamRefBody(item);
  body.meta = L.knownArtwork(q.type, q.id);
  var ref = storeStreamRef(body);
  if (!ref) return fail(res, 400, 'not playable');
  /* the same source is offered again by Continue (web: playback.js); a live channel is not */
  if (L.setting('noHistory', 'false') !== 'true' && !isLive(q.type))
    runtime.storage.setItem(
      kept,
      '?ref=' +
        ref +
        '&type=' +
        encodeURIComponent(q.type) +
        '&id=' +
        encodeURIComponent(q.id) +
        '&vid=' +
        encodeURIComponent(vid)
    );
  answerStream(res, q, ref);
}

/* live channels are watched, never kept: no progress, library or Continue Watching */
function isLive(type) {
  return type === 'tv' || type === 'channel';
}

/* ---------- progress ---------- */
var sessions = {}; /* per video: the last position reported, to tell playback from jumps */

function newItem(p, now) {
  return {
    state: {},
    _id: p.id,
    removed: false,
    temp: true,
    _ctime: now,
    name: p.name || '',
    type: p.type,
    poster: p.poster || '',
    posterShape: 'poster',
    background: p.background || '',
    logo: p.logo || '',
    year: ''
  };
}

var lastPush = 0;
function push(L, item, force) {
  if (!force && Date.now() - lastPush < PUSH_EVERY_MS) return;
  lastPush = Date.now();
  L.pushLib(item);
}

function save(L, p, session) {
  var now = new Date().toISOString(),
    it = L.libItem(p.id) || newItem(p, now);
  if (!it.state) it.state = {};
  if (!it.name && p.name) it.name = p.name;
  if (!it.poster && p.poster) it.poster = p.poster;
  if (!it.type) it.type = p.type;
  var s = it.state,
    vid = p.vid || p.id,
    pos = Math.round(p.time);
  /* time watched counts real playback of this video only, and starts again with another one */
  if (s.video_id !== vid) {
    s.video_id = vid;
    s.timeWatched = 0;
    s.flaggedWatched = 0;
    session.lastPos = -1;
  }
  var step = session.lastPos >= 0 ? pos - session.lastPos : 0;
  session.lastPos = pos;
  if (step > 0 && step <= LONGEST_STEP_MS) {
    s.timeWatched = (s.timeWatched || 0) + step;
    s.overallTimeWatched = (s.overallTimeWatched || 0) + step;
  }
  s.timeOffset = pos;
  s.duration = Math.round(p.duration);
  s.lastWatched = now;
  ['timeWatched', 'overallTimeWatched', 'timesWatched', 'flaggedWatched', 'season', 'episode'].forEach(
    function (k) {
      if (s[k] == null) s[k] = 0;
    }
  );
  if (!s.watchedEpisodes) s.watchedEpisodes = [];
  if (s.noNotif == null) s.noNotif = false;
  if (s.watched == null) s.watched = '';
  it._mtime = now;
  if (it.removed == null) it.removed = false;
  if (it.temp == null) it.temp = true;
  /* listed in Continue Watching only while in the library or temporary */
  if (it.removed && !it.temp) it.temp = true;
  writeItem(L, it);
  if (s.timeWatched > s.duration * WATCHED_THRESHOLD && !s.flaggedWatched) markWatched(L, p);
  return it;
}

/* the watched flag, one more time watched, and for an episode its bit in state.watched */
function markWatched(L, p) {
  var it = L.libItem(p.id),
    vid = p.vid || p.id;
  if (!it || !it.state || it.state.video_id !== vid || it.state.flaggedWatched) return;
  var s = it.state;
  s.flaggedWatched = 1;
  s.timesWatched = (s.timesWatched || 0) + 1;
  if (s.watchedEpisodes.indexOf(vid) < 0) s.watchedEpisodes.push(vid);
  it._mtime = new Date().toISOString();
  writeItem(L, it);
  push(L, it, true);
  if (p.type !== 'series' || !p.vid) return;
  seriesVideos(p.id, function (videos) {
    var field = videos ? setWatched(s.watched || '', videos, p.vid, true) : '';
    var cur = L.libItem(p.id);
    if (!field || !cur || !cur.state) return;
    cur.state.watched = field;
    cur._mtime = new Date().toISOString();
    writeItem(L, cur);
    push(L, cur, true);
  });
}

/* Leaving after the credits started (90 %), or with Next: the position goes back to the start
   and a series moves on to its next episode, which Continue Watching then offers. */
function finish(L, p, session, toNext) {
  var it = save(L, p, session),
    s = it.state;
  if (!toNext && !L.watchFinished(s.timeOffset, s.duration)) return push(L, it, true);
  if (p.vid && p.next) runtime.storage.setItem('tvnext_' + p.id + '_' + p.vid, p.next);
  s.timeOffset = 0;
  if (p.type === 'series' && p.next) {
    s.video_id = p.next;
    s.timeOffset = 1;
    s.timeWatched = 0;
    s.flaggedWatched = 0;
    var parts = p.next.split(':');
    if (parts.length >= 3) {
      s.season = parseInt(parts[parts.length - 2], 10) || 0;
      s.episode = parseInt(parts[parts.length - 1], 10) || 0;
    }
  }
  it._mtime = new Date().toISOString();
  writeItem(L, it);
  push(L, it, true);
}

/* reports: { type, id, vid, next, name, poster, background, logo, time, duration (ms), event }
   with event 'tick' (every few seconds while playing), 'pause', 'seek', 'leave', 'next' */
function progress(req, res) {
  readJsonBody(req, 16384, function (p) {
    if (!p || !p.id || !p.type || !(p.duration > 0))
      return fail(res, 400, 'id, type and duration are needed');
    var L = runtime.logic();
    if (L.setting('noHistory', 'false') === 'true' || isLive(p.type))
      return sendJson(res, { ok: true, kept: false });
    var key = p.id + '|' + (p.vid || p.id),
      session = sessions[key] || (sessions[key] = { lastPos: -1 });
    if (p.event === 'seek') session.lastPos = -1;
    else if (p.event === 'leave' || p.event === 'next') {
      finish(L, p, session, p.event === 'next');
      delete sessions[key];
    } else push(L, save(L, p, session), p.event === 'pause');
    sendJson(res, { ok: true, kept: true });
  });
}

/* the player could not decode this source's audio ({what: "audio"}): its audio formats are kept
   as not playable on this TV, and the sources lists warn of them from then on */
function learn(req, res) {
  readJsonBody(req, 4096, function (body) {
    var labels = playing && playing.compat ? String(playing.compat).split(',') : [];
    var added = body && playing ? runtime.logic().learnUnsupported(labels, body.what) : [];
    sendJson(res, { ok: true, learned: added });
  });
}

module.exports = {
  learn: learn,
  nextPref: nextPref,
  play: play,
  progress: progress
};
