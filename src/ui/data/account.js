// Stremio account session and library synchronization.
/* ================= account / library ================= */
function user() {
  return lsJson('user');
}
function authKey() {
  return lsJson('authKey');
}
/* signed in with a Nuvio account (experimental): the local server answers its calls */
function isNuvioAccount() {
  return /^nuvio:/.test(String(authKey() || ''));
}
/* Library / Continue Watching / watched all sync to the Stremio account, exactly like
   the official apps: items live under lib_<first4 of user._id>_<id> (shared with the
   classic shell on this origin), pulled on boot and pushed on every change. */
function libPrefix() {
  var u = user();
  if (u && u._id) return 'lib_' + u._id.slice(0, 4) + '_';
  var keys = storageKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf('lib_') === 0) {
      var j = k.indexOf('_', 4);
      if (j > 0) return k.slice(0, j + 1);
    }
  }
  return 'lib_local_';
}
var PRE = libPrefix();
window.__SC_PHASE__('M1');
function allLib() {
  var out = [],
    keys = storageKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(PRE) !== 0) continue;
    var it = lsJson(k);
    if (it && it._id) out.push(it);
  }
  return out;
}
/* whole minutes left, or 0 when the numbers cannot be trusted */
function watchMinutesLeft(offsetMs, durationMs) {
  if (!(durationMs > 0) || !(offsetMs > 60000) || offsetMs >= durationMs) return 0;
  return Math.max(1, Math.round((durationMs - offsetMs) / 60000));
}
/* the episode the player recorded as next when this one finished */
function upNextOf(id, vid) {
  var next = lsRaw('tvnext_' + id + '_' + vid, '');
  return next && next !== vid ? next : '';
}
/* A series item whose position sits at the very start points at its next episode: the
   official apps move it there (position 1 ms) once an episode is finished. */
function upNextPointer(it) {
  var s = it.state || {};
  return it.type === 'series' && s.video_id && s.timeOffset > 0 && s.timeOffset < 60000 ? s.video_id : '';
}
/* Continue Watching card data: a finished episode becomes its next episode, and the
   minutes left are only shown when the saved numbers can be trusted. */
function cwCard(it) {
  var s = it.state || {},
    next = upNextPointer(it) || (watchFinished(s.timeOffset, s.duration) ? upNextOf(it._id, s.video_id) : '');
  return {
    id: it._id,
    type: it.type || 'movie',
    name: it.name,
    poster: it.poster,
    background: it.background,
    videoId: next || s.video_id || it._id,
    progress: next ? 0 : s.duration > 0 ? s.timeOffset / s.duration : 0,
    minutesLeft: next ? 0 : watchMinutesLeft(s.timeOffset, s.duration),
    upNext: !!next,
    cw: true
  };
}
window.__SC_CW_CARD__ = cwCard;
/* the day an episode airs, short: "Tue 24 Nov" */
function airDay(at) {
  try {
    return new Date(at).toLocaleDateString(UI_LANG, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch (e) {
    return new Date(at).toISOString().slice(5, 10);
  }
}
/* "Up next · S2 E6", "S2 E5 · 12 min left" or "48 min left" under a Continue Watching title */
function cwSubtitle(it) {
  var ep = '';
  if (it.videoId && it.videoId.indexOf(':') > 0) {
    var pp = it.videoId.split(':');
    if (pp.length >= 3) {
      if (it.upNext) return tx('cwUpNext', pp[pp.length - 2], pp[pp.length - 1]);
      if (it.airsAt) return tx('upcomingTag', pp[pp.length - 2], pp[pp.length - 1], airDay(it.airsAt));
      if (it.fresh) return tx('newEpisodeTag', pp[pp.length - 2], pp[pp.length - 1]);
      ep = tx('cwEpisode', pp[pp.length - 2], pp[pp.length - 1]);
    }
  }
  var left = it.minutesLeft ? tx('cwLeft', it.minutesLeft) : '';
  return ep && left ? ep + '  ·  ' + left : ep || left;
}
/* As in Stremio, an item removed from the library stays only while it is temporary */
function cwItems(limit) {
  var out = [],
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i],
      s = it.state || {};
    if ((it.removed && !it.temp) || isLiveType(it.type)) continue;
    if (!upNextPointer(it)) {
      if (!s.timeOffset || s.timeOffset < 60000) continue;
      /* a finished episode stays only when its next episode is known (cwCard) */
      if (watchFinished(s.timeOffset, s.duration) && !(it.type === 'series' && upNextOf(it._id, s.video_id)))
        continue;
    }
    if (!it.name) continue;
    out.push(it);
  }
  out.sort(function (a, b) {
    return String(b._mtime || '').localeCompare(String(a._mtime || ''));
  });
  return out.slice(0, limit || 12);
}
window.__SC_CW_ITEMS__ = cwItems;
function libGridItems() {
  var out = [],
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i];
    if (it.removed || isLiveType(it.type)) continue;
    if (!it.name) continue;
    out.push(it);
  }
  out.sort(function (a, b) {
    return String(b._mtime || '').localeCompare(String(a._mtime || ''));
  });
  return out.slice(0, TV_PROFILE.libraryCap);
}
/* pull the account library on boot: newest-mtime-wins, then rebuild the boards */
/* a modification time as milliseconds, from a number or an ISO string */
function mtimeMs(v) {
  if (typeof v === 'number') return v;
  var t = Date.parse(v || '');
  return isNaN(t) ? 0 : t;
}
window.__SC_MTIME_MS__ = mtimeMs;
function pullLib(cb) {
  var ak = authKey();
  if (!ak) {
    if (cb) cb();
    return;
  }
  postJson(API + '/api/datastoreMeta', { authKey: ak, collection: 'libraryItem' }, function (r) {
    var rows = r && r.result;
    if (!rows || !rows.length) {
      if (cb) cb();
      return;
    }
    /* datastoreMeta returns modification times in milliseconds while items carry ISO
       strings, so both are compared as times (a text comparison never pulled anything
       that already existed here). Items newer here than on the account, or missing
       there, are pushed back: a push lost when the player closed is not lost for good. */
    var want = [],
      onServer = {},
      push = [];
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i][0],
        mt = mtimeMs(rows[i][1]),
        loc = lsJson(PRE + id);
      onServer[id] = 1;
      if (!loc || mtimeMs(loc._mtime) < mt) {
        if (want.length < 150) want.push(id);
      } else if (mtimeMs(loc._mtime) > mt + 1000 && push.length < 50) push.push(loc);
    }
    var local = allLib();
    for (var l = 0; l < local.length && push.length < 50; l++) {
      var li = local[l],
        ls = li.state || {};
      if (li._id && !onServer[li._id] && (li.removed === false || ls.timeOffset > 0)) push.push(li);
    }
    pushLibItems(push);
    if (!want.length) {
      if (cb) cb();
      return;
    }
    postJson(
      API + '/api/datastoreGet',
      { authKey: ak, collection: 'libraryItem', ids: want, all: false },
      function (g) {
        var items = g && g.result;
        if (items && items.length)
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it && it._id) lsSet(PRE + it._id, it);
          }
        if (cb) cb();
      }
    );
  });
}
/* push one library item up to the account (datastorePut = how Stremio persists it) */
/* Signing out: the account is told, and what this TV kept of it is forgotten */
function signOut() {
  var ak = authKey();
  postJson(API + '/api/logout', { authKey: ak }, function () {}, 4000);
  var kill = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (
      k === 'authKey' ||
      k === 'user' ||
      k === 'profileFace' ||
      k === 'newEpisodes' ||
      k === 'addons' ||
      k === 'addonsLastModified' ||
      k === 'blib_migrated' ||
      k.indexOf('lib_') === 0 ||
      k.indexOf('blib_') === 0 ||
      k.indexOf('subs_') === 0 ||
      k.indexOf('tvstream_') === 0 ||
      k.indexOf('beta_') === 0
    )
      kill.push(k);
  }
  for (var j = 0; j < kill.length; j++) {
    try {
      localStorage.removeItem(kill[j]);
    } catch (e) {}
  }
}
/* After a sign-in: the key, then the account's user and addons; done(true) for a Nuvio
   account, which asks whose profile it is first. Addons that take long are not waited for
   more than 4 s once the account answered. */
function completeSignIn(ak, user, done) {
  lsSet('authKey', ak);
  if (user) lsSet('user', user);
  if (isNuvioAccount()) return done(true);
  postJson(API + '/api/getUser', { authKey: ak }, function (j) {
    if (j && j.result) lsSet('user', j.result);
    var called = false;
    function once() {
      if (called) return;
      called = true;
      done(false);
    }
    syncAddons(once);
    setTimeout(once, 4000);
  });
}
function pushLib(item) {
  if (item && item._id) pushLibItems([item]);
}
function pushLibItems(items) {
  var ak = authKey();
  if (!ak || !items || !items.length) return;
  postJson(
    API + '/api/datastorePut',
    { authKey: ak, collection: 'libraryItem', changes: items },
    function () {},
    9000
  );
}
