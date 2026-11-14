// The calendar, for both interfaces (the server lays it out: app-api.js calendar).
/* The calendar (as Nuvio's): episodes of the followed series from a week ago to two months ahead,
   by air date. done(items) with each item's series, episode and when it airs. */
var CALENDAR_SERIES = 30,
  CALENDAR_BEFORE = 7 * 86400000,
  CALENDAR_AFTER = 60 * 86400000,
  CALENDAR_AT_ONCE = 4,
  CALENDAR_KEEP_MS = 6 * 3600 * 1000,
  calendarKept = null;
/* the series are asked four at a time, and the answer kept six hours */
function calendarEpisodes(done) {
  if (calendarKept && Date.now() - calendarKept.at < CALENDAR_KEEP_MS) return done(calendarKept.items);
  var series = followedSeries().slice(0, CALENDAR_SERIES),
    now = Date.now(),
    out = [],
    next = 0,
    left = series.length;
  if (!left) return done(out);
  function ask() {
    if (next >= series.length) return;
    var it = series[next++];
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
      ask();
      if (--left) return;
      out.sort(function (a, b) {
        return a.released - b.released;
      });
      calendarKept = { at: Date.now(), items: out };
      done(out);
    });
  }
  for (var n = 0; n < CALENDAR_AT_ONCE; n++) ask();
}
