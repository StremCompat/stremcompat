// /app/login/...: signing in from the native interface, as the web sign-in does (views/login.js):
// a code and its QR to open on the phone (Stremio's link page or Nuvio's), asked about until
// the phone approves, or an email and password. The QR comes as rows of modules to draw.

var { fetchJson, readJsonBody, sendJson } = require('./http-util');
var { avatars, chooseProfile, profiles, qrPoll, qrStart, saveProfile, setProfilePin } = require('./nuvio-account');
var { qrRows } = require('./qr');
var runtime = require('./app-runtime');

var LINK = 'https://link.stremio.com/api/';
var STREMIO_POLL_S = 2.5; /* as the web sign-in asks */

/* the account's library (Continue Watching, progress), waited for at most a few seconds */
var LIBRARY_WAIT_MS = 6000;
function withLibrary(L, done) {
  var answered = false;
  function once() {
    if (answered) return;
    answered = true;
    done();
  }
  setTimeout(once, LIBRARY_WAIT_MS);
  L.pullLib(once);
}

function signedIn(res, ak, user) {
  var L = runtime.logic();
  L.completeSignIn(ak, user || null, function (nuvio) {
    /* the library is named after the user: the logic starts again with it */
    withLibrary(L, function () {
      runtime.restart();
      sendJson(res, { done: true, profiles: nuvio });
    });
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
   names that profile's library, and its addons and collections are fetched again. A protected
   one comes with its PIN: { ok: false, reason: 'pin' } asks for it, 'wrong' refuses it. */
function useProfile(req, res, q) {
  var L = runtime.logic(),
    key = L.authKey() || '';
  profiles(key, function (list) {
    var p = (list || []).filter(function (x) {
      return x.index === Number(q.index);
    })[0];
    if (!p) return sendJson(res, { ok: false });
    chooseProfile(key, p.index, q.pin || '', function (ok, reason, retryAfter) {
      if (!ok) return sendJson(res, { ok: false, reason: reason || '', retryAfter: retryAfter || 0 });
      runtime.storage.setItem(
        'profileFace',
        JSON.stringify({ name: p.name, color: p.color, avatar: p.avatar })
      );
      L.reloadAccount(function () {
        withLibrary(L, function () {
          runtime.restart();
          sendJson(res, { ok: true });
        });
      });
    });
  });
}

/* the avatars a profile can have */
function avatarList(req, res) {
  avatars(runtime.logic().authKey() || '', function (list) {
    sendJson(res, { avatars: list || [] });
  });
}

/* { index (none for a new one), name, color, avatar } -> { ok, index } */
function saveOne(req, res) {
  readJsonBody(req, 4096, function (body) {
    if (!body || !body.name) return sendJson(res, { ok: false });
    saveProfile(
      runtime.logic().authKey() || '',
      { index: body.index, name: String(body.name), color: body.color, avatar: body.avatar },
      function (index) {
        sendJson(res, index ? { ok: true, index: index } : { ok: false });
      }
    );
  });
}

/* { index, pin, current } sets or changes a PIN; no pin takes it away */
function pinOne(req, res) {
  readJsonBody(req, 1024, function (body) {
    if (!body || !body.index) return sendJson(res, { ok: false });
    setProfilePin(
      runtime.logic().authKey() || '',
      body.index,
      body.pin || '',
      body.current || '',
      function (ok) {
        sendJson(res, { ok: ok });
      }
    );
  });
}

module.exports = {
  routes: {
    '/app/login/start': start,
    '/app/login/poll': poll,
    '/app/profiles': profileList,
    '/app/profile': useProfile,
    '/app/avatars': avatarList
  },
  postRoutes: { '/app/login/email': email, '/app/profile/save': saveOne, '/app/profile/pin': pinOne }
};
