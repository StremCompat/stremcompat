// The screensaver: after some minutes without a key on the menus (Settings), the backdrops of what
// the viewer watches drift slowly behind their names and a clock, which also keeps an OLED panel
// from holding still pictures. Any key brings the app back, and only does that (input/keys.js).
var saver = { el: null, items: [], at: 0, layer: 0, timer: null };
var SAVER_SLIDE_MS = 12000;
function saverOn() {
  return !!saver.el;
}
function saverClock() {
  var d = new Date(),
    m = d.getMinutes();
  return d.getHours() + ':' + (m < 10 ? '0' : '') + m;
}
function nextSaverSlide() {
  var it = saver.items[saver.at++ % saver.items.length],
    layers = saver.el.getElementsByClassName('svl'),
    show = layers[saver.layer],
    hide = layers[1 - saver.layer];
  saver.layer = 1 - saver.layer;
  show.className = 'svl';
  show.style.backgroundImage = 'url("' + it.background + '")';
  /* on the next frame, so the drift starts from the beginning */
  setTimeout(function () {
    show.className = 'svl on';
    hide.className = 'svl';
  }, 50);
  $('svName').textContent = it.name;
  $('svClock').textContent = saverClock();
}
function showSaver() {
  var items = screensaverItems();
  if (!items.length) return;
  var el = document.createElement('div');
  el.id = 'saver';
  el.innerHTML =
    '<div class="svl"></div><div class="svl"></div><div class="svs"></div><div id="svName"></div><div id="svClock"></div>';
  document.body.appendChild(el);
  saver.el = el;
  saver.items = items;
  saver.at = Math.floor(Math.random() * items.length);
  nextSaverSlide();
  saver.timer = setInterval(nextSaverSlide, SAVER_SLIDE_MS);
}
function hideSaver() {
  clearInterval(saver.timer);
  if (saver.el && saver.el.parentNode) saver.el.parentNode.removeChild(saver.el);
  saver.el = null;
}
setInterval(function () {
  var minutes = screensaverMinutes();
  if (saver.el || !minutes || Date.now() - lastIn < minutes * 60000) return;
  if ($('boot').style.display !== 'none') return;
  stopIdleTrailer();
  showSaver();
}, 15000);
