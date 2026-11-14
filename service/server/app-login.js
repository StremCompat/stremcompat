// /app/login/...: signing in from the native interface, as the web sign-in does (views/login.js):
// a code and its QR to open on the phone (Stremio's link page or Nuvio's), asked about until
// the phone approves, or an email and password. The QR comes as rows of modules to draw.

var { fetchJson, readJsonBody, sendJson } = require('./http-util');
var { chooseProfile, profiles, qrPoll, qrStart } = require('./nuvio-account');
var { qrRows } = require('./qr');
var runtime = require('./app-runtime');

var LINK = 'https://link.stremio.com/api/';
var STREMIO_POLL_S = 2.5; /* as the web sign-in asks */

function signedIn(res, ak, user) {
  runtime.logic().completeSignIn(ak, user || null, function (nuvio) {
    /* the library is named after the user: the logic starts again with it */
    runtime.restart();
    sendJson(res, { done: true, profiles: nuvio });
  });
}

/* a new code: { id, code, link, qr: ["0101...", ...], every (seconds) }, or { error } */
function start(req, res, q) {
  if (q.provider === 'nuvio')
    return qrStart(function (j) {
      if (!j) return sendJson(res, { error: 'unavailable' });
      sendJson(res, { id: j.id, code: j.code, link: j.link, qr: qrRows(j.link), every: j.interval });
    });
  fetchJson(LINK + 'create', function (j) {
    if (!j || !j.code || !j.link) return sendJson(res, { error: 'unavailable' });
    sendJson(res, { id: j.code, code: j.code, link: j.link, qr: qrRows(j.link), every: STREMIO_POLL_S });
  });
}

/* asked every few seconds: { waiting }, { expired } (a new code is needed) or { done, profiles } */
function poll(req, res, q) {
  if (q.provider === 'nuvio')
    return qrPoll(String(q.id || ''), function (r) {
      if (r && r.result && r.result.authKey) return signedIn(res, r.result.authKey, r.result.user);
      var over = r && (r.status === 'expired' || r.status === 'used' || r.status === 'cancelled');
      sendJson(res, over ? { expired: true } : { waiting: true });
    });
  fetchJson(LINK + 'read?code=' + encodeURIComponent(String(q.id || '')), function (r) {
    var ak = r && r.result && (r.result.authKey || r.result.auth_key);
    if (ak) return signedIn(res, ak, null);
    sendJson(res, { waiting: true });
  });
}

/* { email, password, provider } -> { done, profiles } or { error: the account's message } */
function email(req, res) {
  readJsonBody(req, 4096, function (body) {
    if (!body || !body.email || !body.password) return sendJson(res, { error: '' });
    var L = runtime.logic(),
      ask = { email: String(body.email), password: String(body.password) };
    if (body.provider === 'nuvio') ask.provider = 'nuvio';
    L.signInRequest(ask, function (r) {
      var result = r && r.result;
      if (!result || !result.authKey)
        return sendJson(res, { error: (r && r.error && r.error.message) || '' });
      signedIn(res, result.authKey, result.user);
    });
  });
}

/* ---------- Nuvio profiles ---------- */
function profileList(req, res) {
  profiles(runtime.logic().authKey() || '', function (list) {
    sendJson(res, list ? { profiles: list } : { error: 'unavailable' });
  });
}

/* Switches to a profile as the web profile screen does (views/profiles.js): the account then
   names that profile's library, and its addons and collections are fetched again. */
function useProfile(req, res, q) {
  var L = runtime.logic(),
    key = L.authKey() || '';
  profiles(key, function (list) {
    var p = (list || []).filter(function (x) {
      return x.index === Number(q.index);
    })[0];
    if (!p || p.locked) return sendJson(res, { ok: false });
    runtime.storage.setItem(
      'profileFace',
      JSON.stringify({ name: p.name, color: p.color, avatar: p.avatar })
    );
    chooseProfile(key, p.index, function (ok) {
      if (!ok) return sendJson(res, { ok: false });
      L.reloadAccount(function () {
        runtime.restart();
        sendJson(res, { ok: true });
      });
    });
  });
}

module.exports = {
  routes: {
    '/app/login/start': start,
    '/app/login/poll': poll,
    '/app/profiles': profileList,
    '/app/profile': useProfile
  },
  postRoutes: { '/app/login/email': email }
};
