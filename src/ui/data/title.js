// What the title screen says, apart from how it is drawn: the facts line, the first action and
// the episode to land on, and each episode's line and badge. Shared with the native interface.
/* The title's details on one line: who directed it (when the line above names the cast), the
   country and the release date, as Cinemeta gives them. */
function titleFacts(m, castShown) {
  var parts = [];
  if (castShown && m.director && m.director.length)
    parts.push(tx('directedBy', m.director.slice(0, 2).join(', ')));
  if (m.country) parts.push(String(m.country).split(',')[0]);
  var released = m.released ? new Date(m.released) : null;
  if (released && !isNaN(released.getTime()))
    try {
      parts.push(released.toLocaleDateString(UI_LANG, { day: 'numeric', month: 'short', year: 'numeric' }));
    } catch (e) {
      parts.push(String(released.getFullYear()));
    }
  return parts.join('  ·  ');
}
/* saved progress worth offering, in the Continue Watching card shape (account.js) */
function resumeInfoFor(id) {
  var lib = lsJson(PRE + id),
    s = lib && lib.state;
  if (!s) return null;
  var c = cwCard(lib);
  if (c.upNext) return c;
  if (!(s.timeOffset > 60000) || watchFinished(s.timeOffset, s.duration)) return null;
  return c;
}
function resumeLabel(c) {
  var pp = String(c.videoId || '').split(':'),
    ep = pp.length >= 3 ? [pp[pp.length - 2], pp[pp.length - 1]] : null;
  if (c.upNext) return ep ? tx('playEpisode', ep[0], ep[1]) : tx('watch');
  var left = c.minutesLeft ? '  ·  ' + tx('cwLeft', c.minutesLeft) : '';
  return (ep ? tx('continueEpisode', ep[0], ep[1]) : tx('continueLabel')) + left;
}
/* the first released episode not watched yet; once everything released was watched,
   the latest released one (not S1E1, and never an episode that has not aired) */
function firstUnwatched(seasons, watchedMap) {
  var now = Date.now(),
    latest = null;
  for (var s = 0; s < seasons.length; s++) {
    if (seasons[s].n === 0) continue;
    var eps = seasons[s].eps;
    for (var e = 0; e < eps.length; e++) {
      if (!episodeReleased(eps[e], now)) continue;
      if (!watchedMap[eps[e].id]) return eps[e].id;
      latest = eps[e].id;
    }
  }
  if (latest) return latest;
  return seasons[0] && seasons[0].eps[0] ? seasons[0].eps[0].id : null;
}
/* Settings > Spoilers: what of an episode not watched yet stays hidden: nothing ('off'), its
   picture ('pictures'), or its picture and synopsis ('all') */
function spoilerMode() {
  return lsRaw('spoilers', 'off');
}
/* an air date in the viewer's language, "10 Mar 2008" */
function episodeDay(at) {
  try {
    return new Date(at).toLocaleDateString(UI_LANG, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return new Date(at).toISOString().slice(0, 10);
  }
}
/* the focused episode: numbering, air date, length and whether it has aired yet */
function episodeMetaLine(cv) {
  var bits = [
      cv._stremAbsolute
        ? tx('seasonAbsoluteEpisode', cv._stremSeason, cv._stremSeasonEpisode, cv._stremAbsolute)
        : tx('seasonEpisode', cv._stremSeason, cv._stremSeasonEpisode)
    ],
    at = releasedTime(cv);
  if (at) bits.push(episodeDay(at));
  if (cv.runtime) bits.push(cv.runtime);
  if (at > Date.now()) bits.push(tx('badgeSoon'));
  return bits.join('  ·  ');
}
/* Coming soon before release, New during the first week */
function episodeBadge(v, now) {
  var at = releasedTime(v);
  if (!at) return '';
  if (at > now) return tx('badgeSoon');
  return now - at < 7 * 86400000 ? tx('badgeNew') : '';
}
