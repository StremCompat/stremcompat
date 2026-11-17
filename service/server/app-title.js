// /app/title: a title's page for the native interface, decided as the web interface decides it
// (views/detail.js): its lines, its buttons in order, and for a series every season with its
// episodes, which ones were watched, and the episode the page opens on.

var { sendJson } = require('./http-util');
var { decodeField } = require('./watched');
var runtime = require('./app-runtime');

/* the episodes watched here (watchedEpisodes) and, from the bits Stremio keeps, on any other app */
function watchedMap(L, lib, videos) {
  var map = {},
    s = (lib && lib.state) || {},
    list = s.watchedEpisodes || [];
  for (var i = 0; i < list.length; i++) map[list[i]] = true;
  if (s.watched) {
    var fromBits = L.watchedFromBits(decodeField(s.watched), videos);
    for (var id in fromBits) if (Object.prototype.hasOwnProperty.call(fromBits, id)) map[id] = true;
  }
  return map;
}

function episodeOf(L, v, m, st, watched, now, showDates, spoilers) {
  var own = L.episodeImage(v, m),
    name = v.name || v.title || '',
    inSeason = L.tx('episode', v._stremSeasonEpisode),
    overall = L.tx('absoluteEpisode', v._stremAbsolute);
  function label(base) {
    return !name || name.toLowerCase() === base.toLowerCase() ? base : base + '  ·  ' + name;
  }
  var hide = spoilers !== 'off' && !watched[v.id],
    aired = showDates ? L.releasedTime(v) : 0,
    inProgress = v.id === st.video_id && st.duration > 0 && st.timeOffset > 60000;
  return {
    id: v.id,
    title: label(inSeason),
    titleOverall: label(overall),
    absolute: v._stremAbsolute || 0,
    line: L.episodeMetaLine(v),
    /* Settings > Spoilers: an episode not watched yet keeps its synopsis, and its picture (blur), hidden */
    description: hide && spoilers === 'all' ? L.tx('spoilerHidden') : v.overview || v.description || '',
    blur: hide,
    thumbnail: own || L.episodeFallback(m, true),
    ownThumbnail: !!own,
    badge: L.episodeBadge(v, now),
    date: aired ? L.episodeDay(aired) : '',
    progress: inProgress && !L.watchFinished(st.timeOffset, st.duration) ? st.timeOffset / st.duration : 0,
    watched: !!watched[v.id]
  };
}

function seriesModel(L, id, m, lib) {
  var model = L.buildEpisodeModel(m.videos || []),
    watched = watchedMap(L, lib, m.videos || []),
    st = (lib && lib.state) || {},
    now = Date.now(),
    showDates = L.setting('episodeDates', 'true') !== 'false',
    spoilers = L.spoilerMode();
  var seasons = model.seasons.map(function (se) {
    return {
      n: se.n,
      label: se.n === 0 ? L.tx('specials') : L.tx('season', se.n),
      /* every episode of it watched: a mark beside its name */
      watched:
        se.eps.length > 0 &&
        se.eps.every(function (v) {
          return !!watched[v.id];
        }),
      episodes: se.eps.map(function (v) {
        return episodeOf(L, v, m, st, watched, now, showDates, spoilers);
      })
    };
  });
  var landing =
    (lib && lib.state && (L.upNextPointer(lib) || (lib.state.timeOffset > 60000 && lib.state.video_id))) ||
    L.firstUnwatched(model.seasons, watched);
  return { seasons: seasons, landing: landing || null };
}

/* the buttons in the web interface's order: continue or play, the source list, best source,
   trailer, similar titles, library */
function actions(L, type, id, m, landing) {
  var out = [],
    simple = L.simpleMode(),
    resume = L.resumeInfoFor(id),
    primary = resume && (type !== 'series' || !landing || resume.videoId === landing) ? resume : null;
  function add(kind, label, icon, video) {
    out.push({ kind: kind, label: label, icon: icon || '', video: video || '' });
  }
  if (primary) add('resume', L.resumeLabel(primary), '', primary.videoId);
  else if (type === 'series' && landing)
    add('episode', L.resumeLabel({ videoId: landing, upNext: true }), '', landing);
  var bestFirst = simple && !primary && type !== 'series';
  if (bestFirst) add('best', L.tx('playBest'), 'bolt', id);
  if (type !== 'series')
    add('sources', L.tx(simple ? 'sourcesButton' : 'watch'), primary || simple ? 'similar' : '', id);
  var bestVideo = type === 'series' ? landing : id;
  if (bestVideo && !bestFirst) add('best', L.tx('playBest'), 'bolt', bestVideo);
  if ((m.trailers && m.trailers.length) || (m.trailerStreams && m.trailerStreams.length))
    add('trailer', L.tx('trailer'), 'trailer');
  add('similar', L.tx('similar'), 'grid');
  var inLib = L.libHas(id);
  add('library', L.tx(inLib ? 'inLibrary' : 'libraryButton'), inLib ? 'check' : 'plus');
  return { list: out, resumed: !!primary };
}

function titleModel(type, id, m) {
  var L = runtime.logic(),
    lib = L.libItem(id),
    people = m.cast && m.cast.length ? m.cast : m.director || [],
    series = type === 'series' ? seriesModel(L, id, m, lib) : null,
    acts = actions(L, type, id, m, series && series.landing);
  return {
    id: id,
    type: type,
    name: m.name || '',
    logo: m.logo || '',
    background: m.background || L.bgOf({ id: id, poster: m.poster }),
    runtime: m.runtime || '',
    year: m.releaseInfo || m.year || '',
    rating: m.imdbRating || '',
    genres: (m.genres || []).slice(0, 3).join(' · '),
    people: people.slice(0, 4).join(', '),
    facts: L.titleFacts(m, people === m.cast),
    awards: m.awards || '',
    description: m.description || '',
    actions: acts.list,
    /* a new film opens its sources at once; one in progress waits on its buttons */
    openSources: type !== 'series' && !acts.resumed,
    series: series
  };
}

/* the page as soon as the title is known; a series asks the addons for more episode details
   (pictures, synopses), and those come with the next request */
function title(req, res, q) {
  if (!q.type || !q.id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end('{"error":"type and id are needed"}');
  }
  var L = runtime.logic(),
    answered = false;
  L.getMeta(q.type, q.id, function (m) {
    if (answered) return;
    answered = true;
    if (!m) return sendJson(res, { title: null });
    sendJson(res, { title: titleModel(q.type, q.id, m) });
    L.enrichEpisodeMetadata(q.type, q.id, m, function () {});
  });
}

module.exports = {
  title: title
};
