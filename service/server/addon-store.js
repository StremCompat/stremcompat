// Addons from the TV: Stremio's own list of community addons as a small store, and adding or
// removing one by its address, on the account in use. A Stremio account keeps its collection
// on api.strem.io (addonCollectionGet / addonCollectionSet); a Nuvio account keeps a list per
// profile (nuvio-account.js). Both interfaces sync their addons again after a change.

var { APP_VERSION } = require('./config');
var { fetchAddonJson, fetchJson, postJsonUpstream, readJsonBody, sendJson } = require('./http-util');
var { changeNuvioAddons, isNuvioKey, manifestUrl } = require('./nuvio-account');
var runtime = require('./app-runtime');

var STORE_URL = 'https://api.strem.io/addonscollection.json';
var STORE_KEEP_MS = 6 * 3600 * 1000;
var STORE_MAX = 80;
var store = { at: 0, list: null };

/* GET: the store, each addon with what a card shows */
function storeList(req, res) {
  if (store.list && Date.now() - store.at < STORE_KEEP_MS) return sendJson(res, { addons: store.list });
  fetchJson(STORE_URL, function (rows) {
    if (!rows || !rows.length)
      return sendJson(res, { addons: store.list || [], error: store.list ? '' : 'store' });
    store.list = rows
      .filter(function (r) {
        return r && r.manifest && r.manifest.name && manifestUrl(r.transportUrl);
      })
      .slice(0, STORE_MAX)
      .map(function (r) {
        var m = r.manifest;
        return {
          name: String(m.name),
          description: String(m.description || '').slice(0, 240),
          logo: String(m.logo || ''),
          types: (m.types || []).slice(0, 4),
          url: manifestUrl(r.transportUrl)
        };
      });
    store.at = Date.now();
    sendJson(res, { addons: store.list });
  });
}

function stremioApi(path, body, cb) {
  var raw = JSON.stringify(body);
  postJsonUpstream(
    'api.strem.io',
    path,
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(raw),
      'User-Agent': 'Stremio-UJ3/' + APP_VERSION,
      'Accept': 'application/json'
    },
    raw,
    cb
  );
}

/* the Stremio collection with the addon added (its manifest read first) or taken away */
function changeStremioAddons(key, url, remove, cb) {
  stremioApi('/api/addonCollectionGet', { authKey: key, update: true }, function (got) {
    var list = got && got.result && got.result.addons;
    if (!list) return cb('account');
    function save(next) {
      stremioApi('/api/addonCollectionSet', { authKey: key, addons: next }, function (done) {
        cb(done && done.result ? '' : 'account');
      });
    }
    if (remove)
      return save(
        list.filter(function (a) {
          return manifestUrl(a.transportUrl) !== url || (a.flags && a.flags.protected);
        })
      );
    fetchAddonJson(url, function (manifest) {
      if (!manifest || !manifest.id) return cb('manifest');
      var next = list.filter(function (a) {
        return !(a.manifest && a.manifest.id === manifest.id);
      });
      next.push({ transportUrl: url, transportName: 'http', manifest: manifest, flags: {} });
      save(next);
    });
  });
}

/* POST { url, remove, authKey }: the account in use when no key comes (the native interface) */
function change(req, res) {
  readJsonBody(req, 4096, function (body) {
    var url = manifestUrl(body && body.url),
      key = (body && body.authKey) || runtime.logic().authKey() || '';
    if (!url || !key) return sendJson(res, { ok: false, error: url ? 'account' : 'address' });
    function done(error) {
      sendJson(res, { ok: !error, error: error || '' });
    }
    if (isNuvioKey(key)) return changeNuvioAddons(key, url, !!body.remove, done);
    changeStremioAddons(key, url, !!body.remove, done);
  });
}

module.exports = {
  routes: { '/addons/store': storeList },
  postRoutes: { '/addons/change': change }
};
