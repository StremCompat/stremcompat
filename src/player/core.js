// Element references, XHR helper, loading artwork and the startup watchdog.
var v = createVideo(),
  bar = document.getElementById('bar'),
  fill = document.getElementById('fill'),
  timeEl = document.getElementById('time'),
  menu = document.getElementById('menu'),
  subEl = document.getElementById('sub'),
  load = document.getElementById('load'),
  lname = document.getElementById('lname');
document.getElementById('title').textContent = TITLE;
document.getElementById('pvLbl').textContent = P.paused;
document.getElementById('npL').textContent = P.nextEpisode;
document.getElementById('npB').textContent = P.playNext;
document.getElementById('npH').textContent = P.dismissHint;
document.getElementById('b_next').textContent = P.nextEpisode;
[
  ['b_media', P.audioSubs],
  ['b_ep', P.episodes],
  ['b_src', P.sources],
  ['b_set', P.settings]
].forEach(function (b) {
  document.getElementById(b[0]).getElementsByTagName('span')[0].textContent = b[1];
});
function xhr(u, cb) {
  try {
    var x = new XMLHttpRequest();
    x.open('GET', u, true);
    x.onreadystatechange = function () {
      if (x.readyState === 4) {
        var j = null;
        try {
          j = JSON.parse(x.responseText);
        } catch (e) {}
        cb(j);
      }
    };
    x.send();
  } catch (e) {
    cb(null);
  }
}
function setArt(host, u) {
  if (!host) return;
  host.textContent = '';
  if (!u) return;
  var im = document.createElement('img');
  im.src = u;
  host.appendChild(im);
}
// ---- loading art is embedded server-side (no flash): show logo+backdrop now ----
if (BG) load.style.backgroundImage = 'url("' + BG + '")';
var bufArt = document.getElementById('bufart');
if (LOGO) {
  setArt(document.getElementById('tlogo'), LOGO);
  setArt(lname, LOGO);
  setArt(bufArt, LOGO);
} else {
  lname.textContent = TITLE;
  bufArt.textContent = TITLE;
}
if (SE) {
  document.getElementById('tse').textContent = SE;
}
var mediaUsable = false,
  startupRetry = 0,
  startupResetting = false,
  startupWatch = null;
var IS_TORRENT = /:11470\/[0-9a-f]{40}\//i.test(URL);
/* a torrent can take over a minute to find its peers, and starting over would not help it */
var STARTUP_LIMIT_MS = IS_TORRENT ? 45000 : 18000;
function armStartupWatch() {
  if (startupWatch) clearTimeout(startupWatch);
  startupWatch = setTimeout(function () {
    if (!mediaUsable && !retryStartup('timeout') && ID && BACK.indexOf('beta#detail/') === 0)
      showSourceFailed();
  }, STARTUP_LIMIT_MS);
}
function mediaReady() {
  mediaUsable = true;
  startupResetting = false;
  hideSourceFailed();
  if (startupWatch) {
    clearTimeout(startupWatch);
    startupWatch = null;
  }
}
/* lets go of the video: the TV's decoder and the connection to the source */
function unloadVideo() {
  try {
    v.pause();
    v.removeAttribute('src');
    v.load();
  } catch (e) {}
}
/* leaving this video for good: the server stops its previews and subtitle reading, and a torrent goes
   after a short grace (streaming-server.js), so a stalled one does not keep the TV's memory while
   another source plays (webos#19). then() runs once the server has the message (a page change would
   cancel it), or after 400 ms at the latest. */
function releaseVideo(then) {
  var done = false;
  function next() {
    if (done) return;
    done = true;
    if (then) then();
  }
  xhr('/release', next);
  setTimeout(next, 400);
}
function retryStartup(reason) {
  if (mediaUsable || startupRetry >= 1 || startupResetting) return false;
  startupRetry++;
  startupResetting = true;
  diag('media_start_retry', { reason: reason });
  showToast(P.retrying);
  unloadVideo();
  setTimeout(function () {
    startupResetting = false;
    try {
      v.src = URL;
      v.load();
      var rp = v.play();
      if (rp && rp.catch) rp.catch(function () {});
    } catch (e) {}
    armStartupWatch();
  }, 650);
  return true;
}
v.addEventListener('loadedmetadata', mediaReady);
v.addEventListener('playing', mediaReady);
v.src = URL;
armStartupWatch();
