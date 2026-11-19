// Library add/remove and watched state.
/* ================= library helpers (explicit add only — watching never adds) ================= */
function libHas(id) {
  var it = lsJson(PRE + id);
  return !!(it && it.removed === false);
}
/* A film counts as watched when Stremio says so (times watched or the watched flag, also
   set by other devices, which reset the position to 0 once a film ends), when it is in the
   local watched list, or when it stopped in the credits (past 90 %). */
function itemWatched(it) {
  if (!it || !it.id) return false;
  if (it.type === 'series') return seriesHasWatched(it);
  var lib = lsJson(PRE + it.id);
  if (!lib || !lib.state) return false;
  var s = lib.state;
  var vid = it.videoId || it.id;
  if (s.timesWatched > 0 || s.flaggedWatched > 0) return true;
  if (s.watchedEpisodes)
    for (var i = 0; i < s.watchedEpisodes.length; i++) if (s.watchedEpisodes[i] === vid) return true;
  return watchFinished(s.timeOffset, s.duration);
}
/* A series counts as watched (for "Mark series unwatched") once anything of it is: an episode's bit
   in state.watched, one in the local list, or one played to its end. Its flaggedWatched only speaks
   of the episode in state.video_id, so it cannot say this. */
function seriesHasWatched(it) {
  var lib = lsJson(PRE + it.id),
    s = lib && lib.state;
  return !!(s && (s.watched || (s.watchedEpisodes && s.watchedEpisodes.length) || s.timesWatched > 0));
}
/* A library entry as Stremio stores one, for a title the library has not seen yet */
function newLibItem(item, now) {
  return {
    state: {
      lastWatched: now,
      timeOffset: 0,
      timeWatched: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: item.id,
      watched: '',
      noNotif: false,
      season: 0,
      episode: 0,
      watchedEpisodes: []
    },
    _id: item.id,
    _ctime: now
  };
}
/* Channels that 4.3.0 and earlier kept after playing them live: out of the library and Continue
   Watching, on this TV and on the account, once */
function dropLiveFromLibrary() {
  if (lsRaw('liveDropped', '')) return;
  lsRawSet('liveDropped', '1');
  var gone = [],
    now = new Date().toISOString(),
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i];
    if (!isLiveType(it.type) || (it.removed && !it.temp)) continue;
    it.removed = true;
    it.temp = false;
    it._mtime = now;
    lsSet(PRE + it._id, it);
    gone.push(it);
  }
  if (gone.length) pushLibItems(gone);
}
function libToggle(item) {
  var now = new Date().toISOString();
  var it = lsJson(PRE + item.id);
  if (it && it.removed === false) {
    it.removed = true;
    it._mtime = now;
    lsSet(PRE + item.id, it);
    toast(tx('removedLibrary'));
  } else {
    if (!it) it = newLibItem(item, now);
    it.removed = false;
    it.temp = false;
    it._mtime = now;
    it.name = item.name || it.name || '';
    it.type = item.type;
    it.poster = item.poster || it.poster || '';
    it.posterShape = 'poster';
    it.background = item.background || it.background || '';
    lsSet(PRE + item.id, it);
    toast(tx('addedLibrary'));
  }
  pushLib(lsJson(PRE + item.id));
  invalidateBoards();
}
/* Leaves Continue Watching without marking anything watched, as Stremio dismisses an
   item: the saved position returns to the start. Synced like any library change. */
function dismissCw(id) {
  var lib = lsJson(PRE + id);
  if (!lib || !lib.state) return null;
  lib.state.timeOffset = 0;
  lib._mtime = new Date().toISOString();
  lsSet(PRE + id, lib);
  return lib;
}
function removeFromCw(it) {
  var lib = dismissCw(it.id);
  if (lib) pushLib(lib);
  invalidateBoards();
}
function clearContinueWatching() {
  var items = cwItems(1000),
    changed = [];
  for (var i = 0; i < items.length; i++) {
    var lib = dismissCw(items[i]._id);
    if (lib) changed.push(lib);
  }
  pushLibItems(changed);
  invalidateBoards();
  return changed.length;
}
/* The searches Search offers again: typing with the remote is slow, so the last ones stay
   one key away (views/search.js). */
var RECENT_SEARCH_KEY = 'recentSearches',
  RECENT_SEARCH_MAX = 8;
function recentSearches() {
  var list = lsJson(RECENT_SEARCH_KEY);
  return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
}
function rememberSearch(q) {
  q = String(q || '').replace(/^\s+|\s+$/g, '');
  if (!q || lsRaw('noHistory', 'false') === 'true') return;
  var list = recentSearches(),
    out = [q];
  for (var i = 0; i < list.length && out.length < RECENT_SEARCH_MAX; i++)
    if (typeof list[i] === 'string' && list[i].toLowerCase() !== q.toLowerCase()) out.push(list[i]);
  lsSet(RECENT_SEARCH_KEY, out);
}
function clearRecentSearches() {
  lsSet(RECENT_SEARCH_KEY, []);
  search.recentSig = null;
}
/* Marked watched as the official apps do: the watched flag, one more time watched and,
   for an episode, its bit in state.watched (written by the local server, which has the
   episode list), so other devices show it too. */
function markCwWatched(it) {
  var lib2 = lsJson(PRE + it.id);
  if (!lib2) return;
  var s2 = lib2.state || {};
  var vid = s2.video_id || it.videoId || it.id;
  if (!s2.watchedEpisodes) s2.watchedEpisodes = [];
  if (s2.watchedEpisodes.indexOf(vid) < 0) s2.watchedEpisodes.push(vid);
  if (!s2.flaggedWatched) s2.timesWatched = (s2.timesWatched || 0) + 1;
  s2.flaggedWatched = 1;
  s2.timeOffset = 0;
  lib2.state = s2;
  lib2._mtime = new Date().toISOString();
  lsSet(PRE + it.id, lib2);
  pushLib(lib2);
  invalidateBoards();
  if (lib2.type !== 'series' || vid === it.id) return;
  pushEpisodeField(it.id, vid, true, s2.watched);
}
/* Episodes' bits in state.watched, written by the local server (it has the episode list), so other
   devices show the change too: EPISODE_FIELD_BATCH episodes a request, each on the field the one
   before left, and the account told once at the end; cb runs once it is saved. */
var EPISODE_FIELD_BATCH = 80;
function pushEpisodeField(id, vids, watched, field, cb) {
  var left = [].concat(vids),
    changed = false;
  (function next(f) {
    var part = left.splice(0, EPISODE_FIELD_BATCH);
    if (!part.length) {
      var cur = lsJson(PRE + id);
      if (changed && cur && cur.state) {
        cur.state.watched = f;
        cur._mtime = new Date().toISOString();
        lsSet(PRE + id, cur);
        pushLib(cur);
      }
      if (cb) cb();
      return;
    }
    var q =
      '/watchedset?id=' +
      encodeURIComponent(id) +
      '&w=' +
      (watched ? '1' : '0') +
      '&f=' +
      encodeURIComponent(f || '');
    for (var i = 0; i < part.length; i++) q += '&vid=' + encodeURIComponent(part[i]);
    xhrJson(q, function (j) {
      if (j && j.watched) {
        changed = true;
        f = j.watched;
      }
      next(f);
    });
  })(field);
}
/* Mark as watched / unwatched from the title menu: a film (it.videoId empty or its own id)
   or one episode of a series (it.videoId). A title not in the library gets an entry that
   stays out of it (removed), as Stremio keeps watched state for titles never added. */
function watchedEntry(it, now) {
  var lib = lsJson(PRE + it.id);
  if (!lib) {
    lib = newLibItem(it, now);
    lib.removed = true;
    lib.temp = true;
    lib.name = it.name || '';
    lib.type = it.type;
    lib.poster = it.poster || '';
    lib.posterShape = 'poster';
    lib.background = it.background || '';
  }
  if (!lib.state) lib.state = {};
  if (!lib.state.watchedEpisodes) lib.state.watchedEpisodes = [];
  return lib;
}
function setItemWatched(it, watched, cb) {
  var now = new Date().toISOString(),
    lib = watchedEntry(it, now);
  var s = lib.state,
    vid = it.videoId || it.id,
    episode = it.type === 'series' && vid !== it.id;
  var at = s.watchedEpisodes.indexOf(vid);
  if (watched && at < 0) s.watchedEpisodes.push(vid);
  if (!watched && at >= 0) s.watchedEpisodes.splice(at, 1);
  if (!episode) {
    if (watched && !s.flaggedWatched) s.timesWatched = (s.timesWatched || 0) + 1;
    s.flaggedWatched = watched ? 1 : 0;
    if (!watched) s.timesWatched = 0;
  }
  if (s.video_id === vid) s.timeOffset = 0;
  lib._mtime = now;
  lsSet(PRE + it.id, lib);
  pushLib(lib);
  invalidateBoards();
  if (episode) pushEpisodeField(it.id, vid, watched, s.watched, cb);
  else if (cb) cb();
}
/* The regular episodes of a series in order up to vid, vid included (marking one watched marks the
   ones before it too, as the official apps' "watched up to here"); all of them when vid is empty.
   Episodes not out yet are left out: they would never show as new. A special (season 0) is only
   itself. */
function episodesUpTo(meta, vid) {
  var seasons = buildEpisodeModel((meta && meta.videos) || []).seasons,
    now = Date.now(),
    out = [];
  for (var s = 0; s < seasons.length; s++) {
    if (!(seasons[s].n > 0)) continue;
    for (var e = 0; e < seasons[s].eps.length; e++) {
      var ep = seasons[s].eps[e];
      if (episodeReleased(ep, now)) out.push(ep.id);
      if (vid && ep.id === vid) return out;
    }
  }
  return vid ? [vid] : out;
}
/* Several episodes at once (a season, a series, the ones before an episode): one change of the
   library entry and a few requests for their bits, instead of three requests an episode. */
function setEpisodesWatched(it, vids, watched, cb) {
  if (!vids.length) {
    if (cb) cb();
    return;
  }
  var now = new Date().toISOString(),
    lib = watchedEntry(
      { type: 'series', id: it.id, name: it.name, poster: it.poster, background: it.background },
      now
    ),
    s = lib.state;
  for (var i = 0; i < vids.length; i++) {
    var at = s.watchedEpisodes.indexOf(vids[i]);
    if (watched && at < 0) s.watchedEpisodes.push(vids[i]);
    if (!watched && at >= 0) s.watchedEpisodes.splice(at, 1);
    if (s.video_id === vids[i]) s.timeOffset = 0;
  }
  lib._mtime = now;
  lsSet(PRE + it.id, lib);
  pushLib(lib);
  invalidateBoards();
  pushEpisodeField(it.id, vids, watched, s.watched, cb);
}
/* A whole series, from the hold menu of the web interface and of Native (app-api.js): every episode
   out (every one at all when unmarking), then the series' own state */
function setSeriesWatched(it, watched, cb) {
  var started = false;
  /* getMeta answers twice when it has a copy and then a fresher one: the first answer does it */
  getMeta('series', it.id, function (m) {
    if (started) return;
    started = true;
    var all = watched
      ? episodesUpTo(m, '')
      : ((m && m.videos) || []).map(function (v) {
          return v.id;
        });
    setEpisodesWatched(it, all, watched, function () {
      setItemWatched(
        { id: it.id, type: 'series', name: it.name, poster: it.poster, background: it.background },
        watched,
        cb
      );
    });
  });
}
