// Opaque stream references that keep provider URLs and headers out of the browser.

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var { DIR } = require('./config');
var { safeText } = require('./text');
var { streamingUrl } = require('./server-address');

// Stream references keep provider cookies/auth headers out of URLs and browser
// storage. Only a short opaque id crosses the webview boundary.
var streamRefs = {};

var streamRefOrder = [];
var KEEP = 40,
  IDLE_LIMIT_MS = 12 * 3600 * 1000;

/* The references are also kept in the app's own folder: Continue reopens the last one, and a server
   started again (an update, the TV turned off, a server that left while idle) knew none of them, so
   the player only showed its loading screen and went back. */
function refsFile() {
  return path.join(process.env.HOME || DIR, '.stremcompat', 'stream-refs.json');
}
function loadRefs() {
  try {
    var kept = JSON.parse(fs.readFileSync(refsFile(), 'utf8')) || {};
    (kept.order || []).forEach(function (ref) {
      var s = kept.refs && kept.refs[ref];
      if (s && s.url && Date.now() - s.at <= IDLE_LIMIT_MS) {
        streamRefs[ref] = s;
        streamRefOrder.push(ref);
      }
    });
  } catch (e) {}
}
function saveRefs() {
  var file = refsFile(),
    temp = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ order: streamRefOrder, refs: streamRefs }));
    fs.renameSync(temp, file);
  } catch (e) {}
}
loadRefs();

function safeProxyHeaders(raw) {
  var out = {},
    allow = {
      'user-agent': 'User-Agent',
      'referer': 'Referer',
      'origin': 'Origin',
      'cookie': 'Cookie',
      'authorization': 'Authorization',
      'accept': 'Accept',
      'accept-language': 'Accept-Language'
    };
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach(function (key) {
    var lk = String(key).toLowerCase(),
      name = allow[lk];
    if (!name) return;
    var value = safeText(raw[key], 2048);
    if (value) out[name] = value;
  });
  return out;
}

/* the title's name and artwork as the interface knew them, or null */
function safeArtwork(raw) {
  if (!raw || typeof raw !== 'object') return null;
  function link(u) {
    var v = safeText(u, 2048);
    return /^https?:\/\//i.test(v) ? v : '';
  }
  var art = {
    name: safeText(raw.name, 200),
    logo: link(raw.logo),
    background: link(raw.background),
    poster: link(raw.poster)
  };
  return art.name || art.background || art.logo ? art : null;
}

function storeStreamRef(raw) {
  raw = raw || {};
  var streamUrl = safeText(raw.url, 8192);
  if (!/^https?:\/\//i.test(streamUrl)) return '';
  var ref = crypto.randomBytes(12).toString('hex');
  streamRefs[ref] = {
    url: streamingUrl(streamUrl),
    addon: safeText(raw.addon, 160),
    addonBase: safeText(raw.addonBase, 2048),
    name: safeText(raw.name, 300),
    title: safeText(raw.title, 700),
    description: safeText(raw.description, 700),
    behaviorHints: { filename: safeText(raw.filename, 500) },
    bingeGroup: safeText(raw.bingeGroup, 200),
    quality: safeText(raw.quality, 40),
    compat: safeText(raw.compat, 160),
    headers: safeProxyHeaders(raw.headers),
    notWebReady: !!raw.notWebReady,
    artwork: safeArtwork(raw.meta),
    at: Date.now()
  };
  streamRefOrder.push(ref);
  while (streamRefOrder.length > KEEP) delete streamRefs[streamRefOrder.shift()];
  saveRefs();
  return ref;
}

function getStreamRef(ref) {
  ref = String(ref || '');
  var s = streamRefs[ref];
  if (!s || Date.now() - s.at > IDLE_LIMIT_MS) return null;
  s.at = Date.now();
  var at = streamRefOrder.indexOf(ref);
  if (at >= 0) streamRefOrder.splice(at, 1);
  streamRefOrder.push(ref);
  saveRefs();
  return s;
}

/* the source played most recently, or null */
function lastStreamRef() {
  return streamRefs[streamRefOrder[streamRefOrder.length - 1]] || null;
}

module.exports = {
  getStreamRef: getStreamRef,
  lastStreamRef: lastStreamRef,
  storeStreamRef: storeStreamRef
};
