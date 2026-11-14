// /app/...: what the native interface asks the server, in JSON. The answers come from the same
// data logic the web interface runs (app-runtime.js); this file only shapes them.

var { APP_VERSION, PROFILE } = require('./config');
var { readJsonBody, sendJson } = require('./http-util');
var { appImage } = require('./app-images');
var { title } = require('./app-title');
var playback = require('./app-playback');
var { addonSubtitles } = require('./subtitle-addons');
var runtime = require('./app-runtime');

var STREAM_WAIT_MS = 8000;
var STREAM_KEEP_MS = 120000;
var MIGRATE_MAX_BYTES = 8 * 1024 * 1024;

function logic() {
  return runtime.logic();
}

function fail(res, status, why) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: why }));
}

/* ---------- who is signed in, in which language ---------- */
function state(req, res, q) {
  if (q.tvLanguage) runtime.setTvLanguage(q.tvLanguage);
  var L = logic(),
    u = L.user();
  sendJson(res, {
    version: APP_VERSION,
    language: L.uiLanguage(),
    signedIn: !!L.authKey(),
    provider: L.authKey() ? (L.isNuvioAccount() ? 'nuvio' : 'stremio') : '',
    email: (u && u.email) || ''
  });
}

/* every text of the interface in its language, with English for what a language lacks */
function strings(req, res) {
  sendJson(res, logic().uiText());
}

/* what a card shows, as the web interface decides it: its picture (a poster, or a landscape
   picture on wide cards), the backdrop behind the focused title, and the line under a Continue
   Watching title or the watched badge */
function decorate(items, wide) {
  var L = logic();
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    it.art = wide ? L.bgSmall(it) : L.posterOf(it);
    it.backdrop = L.bgOf(it);
    if (wide) it.subtitle = L.cwSubtitle(it);
    else it.watched = !!L.itemWatched(it);
  }
  return items;
}

/* ---------- Home: the library rows, then the catalogs, each fetched on its own ---------- */
function home(req, res) {
  var L = logic(),
    rows = L.homeLibraryRows(),
    defs = L.homeDefs();
  for (var r = 0; r < rows.length; r++) decorate(rows[r].items, rows[r].wide);
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    if (d.tiles) rows.push({ title: d.title, items: d.tiles, wide: true, collection: true });
    else rows.push({ title: d.title, catalog: { url: d.url, key: d.key, type: d.type }, ranked: !!d.ranked });
  }
  sendJson(res, { rows: rows });
}

/* one catalog's titles: the saved copy when there is one, otherwise the addon's answer */
function catalog(req, res, q) {
  if (!q.url || !q.key) return fail(res, 400, 'url and key are needed');
  var answered = false;
  logic().getCatalogUrl(q.url, q.key, q.type || '', function (items, cached) {
    if (answered) return;
    answered = true;
    sendJson(res, { items: decorate(items, false), cached: !!cached });
  });
}

/* ---------- a title with its episodes ---------- */
function meta(req, res, q) {
  if (!q.type || !q.id) return fail(res, 400, 'type and id are needed');
  var answered = false;
  logic().getMeta(q.type, q.id, function (m) {
    if (answered) return;
    answered = true;
    if (!m) return sendJson(res, { meta: null });
    sendJson(res, { meta: m, episodes: m.videos ? logic().buildEpisodeModel(m.videos) : null });
  });
}

/* ---------- sources: the addons answer one by one, so the interface asks again with the
   version it has and gets an answer as soon as there is more, or when all have answered ---------- */
var searches = {};

function startSearch(type, vid) {
  var s = {
    items: [],
    trimmed: {},
    version: 0,
    done: false,
    failed: [],
    waiters: [],
    at: Date.now(),
    seq: 0
  };
  var L = logic();
  function changed() {
    s.version++;
    var waiting = s.waiters;
    s.waiters = [];
    for (var i = 0; i < waiting.length; i++) waiting[i]();
  }
  L.fetchStreams(
    type,
    vid,
    function (part) {
      /* each source keeps its number, so the one chosen is found again as more arrive */
      for (var i = 0; i < part.length; i++) part[i]._seq = ++s.seq;
      var pool = s.items.concat(part),
        result = L.compactSourcePool(pool, PROFILE.sourceCap || 60);
      s.items = result.items;
      s.trimmed = result.trimmed;
      changed();
    },
    function (total, failed) {
      s.done = true;
      s.failed = failed || [];
      changed();
    }
  );
  return s;
}

/* the list as the sources screen shows it: chips, the language filter, the sources in order */
function sourceList(s, quality, lang) {
  var L = logic(),
    langs = L.languageChoices(s.items),
    list = L.orderedSources(s.items, quality, lang);
  return {
    version: s.version,
    done: s.done,
    failed: s.failed.length ? L.tx('addonsNoAnswer', s.failed.join(', ')) : '',
    chips: L.qualityChips(s.items, s.trimmed),
    langs: langs.keys.map(function (key) {
      return { key: key, label: L.langFilterName(key), count: langs.counts[key] || 0 };
    }),
    recommended: list.recommended,
    items: list.items.map(function (it) {
      return {
        seq: it._seq,
        heading: L.sourceHeading(it),
        text: L.sourceText(it),
        tags: it.stored ? [] : L.sourceTags(it),
        compat:
          it.compatLabels && it.compatLabels.length
            ? L.tx('compatibilityCheck', it.compatLabels.join(' · '))
            : ''
      };
    })
  };
}

function forgetOldSearches() {
  var now = Date.now();
  for (var key in searches)
    if (Object.prototype.hasOwnProperty.call(searches, key) && now - searches[key].at > STREAM_KEEP_MS)
      delete searches[key];
}

function streams(req, res, q) {
  if (!q.type || !q.vid) return fail(res, 400, 'type and vid are needed');
  forgetOldSearches();
  var key = q.type + '|' + q.vid,
    have = parseInt(q.have, 10) || 0;
  /* a new visit to the sources (have=0) asks the addons again once the last search ended */
  if (!searches[key] || (!have && searches[key].done && q.again)) searches[key] = startSearch(q.type, q.vid);
  var s = searches[key];
  function answer() {
    sendJson(res, sourceList(s, q.quality || 'All', q.lang || 'All'));
  }
  if (s.version > have || s.done) return answer();
  function woken() {
    clearTimeout(timer);
    answer();
  }
  var timer = setTimeout(function () {
    var at = s.waiters.indexOf(woken);
    if (at >= 0) s.waiters.splice(at, 1);
    answer();
  }, STREAM_WAIT_MS);
  s.waiters.push(woken);
}

/* the subtitles of the account's subtitle addons for this video (OpenSubtitles without any),
   each read later through /sub?u= as cues */
function subtitles(req, res, q) {
  var L = logic();
  addonSubtitles(
    {
      ref: q.ref || '',
      type: q.type || '',
      vid: q.vid || '',
      addons: L.addonsFor(L.addons(), 'subtitles', q.type, q.vid)
    },
    function (list) {
      sendJson(res, { subtitles: list });
    }
  );
}

/* ---------- moving to the native interface: the web interface hands over what it kept ---------- */
function migrate(req, res) {
  readJsonBody(req, MIGRATE_MAX_BYTES, function (body) {
    if (!body || typeof body !== 'object') return fail(res, 400, 'a JSON object is needed');
    var count = 0;
    for (var k in body)
      if (Object.prototype.hasOwnProperty.call(body, k) && typeof body[k] === 'string' && !/^beta_/.test(k)) {
        /* what the native interface already has wins: it is newer */
        if (runtime.storage.getItem(k) === null) runtime.storage.setItem(k, body[k]);
        count++;
      }
    runtime.restart();
    sendJson(res, { ok: true, keys: count });
  });
}

module.exports = {
  routes: {
    '/app/catalog': catalog,
    '/app/home': home,
    '/app/img': appImage,
    '/app/meta': meta,
    '/app/play': function (req, res, q) {
      playback.play(req, res, q, searches);
    },
    '/app/state': state,
    '/app/streams': streams,
    '/app/strings': strings,
    '/app/subtitles': subtitles,
    '/app/title': title
  },
  postRoutes: {
    '/app/migrate': migrate,
    '/app/progress': playback.progress
  }
};
