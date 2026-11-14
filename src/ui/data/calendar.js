// The calendar of the native interface (the web interface has none).
/* The calendar (as Nuvio's): episodes of the followed series from a week ago to two months ahead,
   by air date. done(items) with each item's series, episode and when it airs. */
var CALENDAR_SERIES = 30,
  CALENDAR_BEFORE = 7 * 86400000,
  CALENDAR_AFTER = 60 * 86400000;
function calendarEpisodes(done) {
  var series = followedSeries().slice(0, CALENDAR_SERIES),
    now = Date.now(),
    out = [],
    left = series.length;
  if (!left) return done(out);
  series.forEach(function (it) {
    getMeta('series', it._id, function (m) {
      var videos = (m && m.videos) || [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i],
          at = releasedTime(v);
        if (!at || at < now - CALENDAR_BEFORE || at > now + CALENDAR_AFTER) continue;
        out.push({
          id: it._id,
          type: 'series',
          name: (m && m.name) || it.name || '',
          poster: it.poster || (m && m.poster) || '',
          background: it.background || (m && m.background) || '',
          videoId: v.id,
          season: v.season,
          episode: v.episode,
          title: v.name || v.title || '',
          released: at
        });
      }
      if (--left) return;
      out.sort(function (a, b) {
        return a.released - b.released;
      });
      done(out);
    });
  });
}
