// /app/...: what the native interface asks the server, in JSON. The answers come from the same
// data logic the web interface runs (app-runtime.js); this file only shapes them.

var { APP_VERSION, PROFILE, cinemeta } = require('./config');
var { fetchAddonJson, readJsonBody, sendJson } = require('./http-util');
var { appImage } = require('./app-images');
var { title } = require('./app-title');
var playback = require('./app-playback');
var { addonSubtitles } = require('./subtitle-addons');
var { ytResolve } = require('./youtube');
var { localProxy } = require('./proxy');
var runtime = require('./app-runtime');

var STREAM_WAIT_MS = 8000;
var STREAM_KEEP_MS = 120000;
var MIGRATE_MAX_BYTES = 8 * 1024 * 1024;

function logic() {
  return runtime.logic();
}

function fail(res, status, why) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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
    it.inLibrary = !!L.libHas(it.id);
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

/* ---------- the Library: the films and the series added to it (web: loadLibraryRows) ---------- */
function library(req, res) {
  var L = logic(),
    movies = [],
    series = [];
  L.libGridItems().forEach(function (l) {
    var item = { id: l._id, type: l.type, name: l.name, poster: l.poster, background: l.background };
    (l.type === 'series' ? series : movies).push(item);
  });
  var rows = [];
  if (movies.length) rows.push({ title: L.tx('movies'), items: decorate(movies, false) });
  if (series.length) rows.push({ title: L.tx('series'), items: decorate(series, false) });
  sendJson(res, { rows: rows });
}

/* ---------- the addons of the account (read only: the account decides them) ---------- */
function addonList(req, res) {
  sendJson(res, {
    addons: logic()
      .addons()
      .map(function (ad) {
        var m = ad.manifest || {};
        return {
          name: m.name || m.id || 'Addon',
          info: [m.id || '', m.version || '', (m.types || []).join(' · ')].join('   ').replace(/\s+/g, ' ')
        };
      })
  });
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
function sourceList(s, quality, lang, pref) {
  var L = logic(),
    langs = L.languageChoices(s.items),
    list = L.orderedSources(s.items, quality, lang),
    /* for the next episode: the source like the one just played (matchingNextSource) */
    match = pref ? L.matchingNextSource(s.items, pref) : null;
  return {
    match: match ? match._seq : 0,
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
    sendJson(
      res,
      sourceList(s, q.quality || 'All', q.lang || 'All', q.next && q.id ? playback.nextPref(q.id) : null)
    );
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

/* ---------- search: films and series from Cinemeta, as the web search asks (views/search.js) ---------- */
var SEARCH_RESULTS = 20;

function searchType(type, q, cb) {
  fetchAddonJson(
    cinemeta() + '/catalog/' + type + '/top/search=' + encodeURIComponent(q) + '.json',
    function (j) {
      var metas = ((j && j.metas) || []).slice(0, SEARCH_RESULTS).map(function (m) {
        return {
          id: m.id,
          type: m.type || type,
          name: m.name,
          poster: m.poster,
          background: m.background,
          logo: m.logo,
          description: m.description,
          releaseInfo: m.releaseInfo,
          year: m.year,
          runtime: m.runtime,
          imdbRating: m.imdbRating,
          /* the preview's line: 2026 48 min IMDb 8.1 */
          info: [m.releaseInfo || m.year, m.runtime, m.imdbRating ? 'IMDb ' + m.imdbRating : '']
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        };
      });
      cb(decorate(metas, false));
    }
  );
}

/* q: what was typed; live=1 while typing (only a submitted search is remembered) */
function search(req, res, q) {
  var L = logic(),
    text = String(q.q || '').replace(/^\s+|\s+$/g, '');
  if (!text) return sendJson(res, { rows: [], recent: L.recentSearches() });
  if (!q.live) L.rememberSearch(text);
  searchType('movie', text, function (movies) {
    searchType('series', text, function (series) {
      var rows = [];
      if (movies.length) rows.push({ title: L.tx('movies'), items: movies });
      if (series.length) rows.push({ title: L.tx('series'), items: series });
      sendJson(res, {
        rows: rows,
        empty: rows.length ? '' : L.tx('noResults', text),
        recent: L.recentSearches()
      });
    });
  });
}

/* ---------- Discover: a type, one of its catalogs and a genre, a page at a time ---------- */
/* type, catalog, genre (positions in the lists answered), skip (titles already shown) */
function discover(req, res, q) {
  var L = logic(),
    types = L.discoverTypes(),
    type = (types[parseInt(q.type, 10) || 0] || types[0]).value,
    catalogs = L.discoverCatalogs(type),
    cat = catalogs[parseInt(q.catalog, 10) || 0] || catalogs[0],
    genres = L.discoverGenres(cat),
    genre = genres[parseInt(q.genre, 10) || 0] || { value: '' },
    skip = parseInt(q.skip, 10) || 0;
  function answer(items, ended) {
    sendJson(res, {
      types: types,
      catalogs: catalogs.map(function (c) {
        return { label: c.label };
      }),
      genres: genres,
      items: decorate(items, false),
      ended: ended
    });
  }
  var url = L.discoverPageUrl(cat, genre.value, skip);
  if (!url) return answer([], true);
  fetchAddonJson(url, function (j) {
    var metas = (j && j.metas) || [];
    answer(
      metas.map(function (m) {
        return { id: m.id, type: m.type || type, name: m.name, poster: m.poster, background: m.background };
      }),
      !metas.length
    );
  });
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

/* ---------- similar titles: the top ones of the title's first genre (web: similar.js) ---------- */
var SIMILAR_MAX = 30;
function similar(req, res, q) {
  var L = logic();
  L.getMeta(q.type, q.id, function (m) {
    var genre = m && m.genres && m.genres.length ? m.genres[0] : '';
    fetchAddonJson(
      cinemeta() +
        '/catalog/' +
        q.type +
        '/top' +
        (genre ? '/genre=' + encodeURIComponent(genre) : '') +
        '.json',
      function (j) {
        var items = ((j && j.metas) || [])
          .filter(function (mm) {
            return mm.id !== q.id;
          })
          .slice(0, SIMILAR_MAX)
          .map(function (mm) {
            return {
              id: mm.id,
              type: mm.type || q.type,
              name: mm.name,
              poster: mm.poster,
              background: mm.background
            };
          });
        sendJson(res, {
          title: m && m.name ? L.tx('similarTo', m.name) : L.tx('similar'),
          empty: items.length ? '' : L.tx('nothingFound'),
          items: decorate(items, false)
        });
      }
    );
  });
}

/* ---------- trailers, played inside the app: a direct link an addon gives, otherwise the trailer
   the server can resolve (youtube.js); none means "Trailer unavailable", never another app ---------- */
function trailer(req, res, q) {
  var L = logic();
  L.getMeta(q.type, q.id, function (m) {
    var streams = (m && m.trailerStreams) || [],
      direct = streams.filter(function (t) {
        return /^https?:\/\//i.test(t.url || '');
      })[0];
    if (direct) return sendJson(res, { url: localProxy(direct.url), name: (m && m.name) || '' });
    var yt =
      (m && m.trailers && m.trailers[0] && m.trailers[0].source) || (streams[0] && streams[0].ytId) || '';
    if (!yt) return sendJson(res, { error: L.tx('noTrailer') });
    ytResolve(String(yt), false, function (link) {
      sendJson(res, link ? { url: link, name: (m && m.name) || '' } : { error: L.tx('trailerUnavailable') });
    });
  });
}

/* ---------- the calendar: the followed series' episodes by day ---------- */
var DAY_MS = 86400000;

/* Today, Tomorrow, or the date as the interface's language writes it with numbers (the TV's
   Node has no names of months) */
function dayLabel(L, at, today) {
  var d = new Date(at),
    days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today) / DAY_MS);
  if (days === 0) return L.tx('calendarToday');
  if (days === 1) return L.tx('calendarTomorrow');
  var day = ('0' + d.getDate()).slice(-2),
    month = ('0' + (d.getMonth() + 1)).slice(-2);
  return L.uiLanguage() === 'en-US' ? month + '/' + day : day + '/' + month;
}

function calendar(req, res) {
  var L = logic(),
    now = new Date(),
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  L.calendarEpisodes(function (items) {
    var days = [];
    items.forEach(function (it) {
      var label = dayLabel(L, it.released, today),
        last = days[days.length - 1];
      if (!last || last.title !== label) days.push((last = { title: label, items: [] }));
      last.items.push(it);
    });
    days.forEach(function (d) {
      d.items = decorate(d.items, true).map(function (it) {
        /* the line under the title is the episode, not where the viewer stopped */
        it.subtitle = L.tx('seasonEpisode', it.season, it.episode) + (it.title ? '  ·  ' + it.title : '');
        return it;
      });
    });
    sendJson(res, { days: days, empty: days.length ? '' : L.tx('calendarEmpty') });
  });
}

/* ---------- what can be done with a title (web: card-menu.js and the title page) ----------
   { action, item: { id, type, name, poster, background, videoId }, vids, watched }:
   library (in or out), watched (a film or an episode), season (several episodes), cwWatched,
   cwRemove, hideNew. Answers the message the web interface would show. */
function act(req, res) {
  readJsonBody(req, 65536, function (body) {
    var L = logic(),
      it = (body && body.item) || {},
      done = body && body.watched !== false;
    if (!it.id || !it.type) return fail(res, 400, 'item.id and item.type are needed');
    function answer(message) {
      sendJson(res, { message: message || L.takeMessage(), inLibrary: !!L.libHas(it.id) });
    }
    switch (body.action) {
      case 'library':
        L.libToggle(it);
        return answer();
      case 'watched':
        return L.setItemWatched(it, done, function () {
          answer(L.tx(done ? 'markedWatched' : 'markedUnwatched'));
        });
      case 'season':
        return L.setEpisodesWatched(it, body.vids || [], done, function () {
          answer(L.tx(done ? 'markedWatched' : 'markedUnwatched'));
        });
      case 'cwWatched':
        L.markCwWatched(it);
        return answer(L.tx('markedWatched'));
      case 'cwRemove':
        L.removeFromCw(it);
        return answer(L.tx('removedFromCw'));
      case 'hideNew':
        L.hideNewEpisodes(it.id);
        return answer(L.tx('newEpisodesHidden'));
      default:
        fail(res, 400, 'unknown action');
    }
  });
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
    '/app/addons': addonList,
    '/app/calendar': calendar,
    '/app/catalog': catalog,
    '/app/home': home,
    '/app/img': appImage,
    '/app/library': library,
    '/app/meta': meta,
    '/app/search': search,
    '/app/similar': similar,
    '/app/discover': discover,
    '/app/play': function (req, res, q) {
      playback.play(req, res, q, searches);
    },
    '/app/state': state,
    '/app/streams': streams,
    '/app/strings': strings,
    '/app/subtitles': subtitles,
    '/app/title': title,
    '/app/trailer': trailer
  },
  postRoutes: {
    '/app/act': act,
    '/app/migrate': migrate,
    '/app/progress': playback.progress
  }
};
