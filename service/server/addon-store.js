// Addons from the TV: a store of community addons (stremio-addons.net's catalog and Stremio's own
// list, in order of popularity), and adding or removing one by its address, on the account in use. A Stremio account keeps its collection
// on api.strem.io (addonCollectionGet / addonCollectionSet); a Nuvio account keeps a list per
// profile (nuvio-account.js). Both interfaces sync their addons again after a change.

var { APP_VERSION } = require('./config');
var {
  fetchAddonJson,
  fetchJson,
  fetchUrl,
  postJsonUpstream,
  readJsonBody,
  sendJson
} = require('./http-util');
var { changeNuvioAddons, isNuvioKey, manifestUrl } = require('./nuvio-account');
var runtime = require('./app-runtime');

var fs = require('fs');
var path = require('path');
var { DIR } = require('./config');
var { qrRows, qrSvg } = require('./qr');

/* ---------- the store: Stremio's community list and stremio-addons.net's catalog, joined ---------- */
var CATALOG_URL = 'https://stremio-addons.net/api/addon_catalog/all/stremio-addons.net.json';
var OFFICIAL_URL = 'https://api.strem.io/addonscollection.json';
var POPULAR_URL = 'https://stremio-addons.net/addons?sort=popular&page=';
var POPULAR_PAGES = 3;
var STORE_KEEP_MS = 24 * 3600 * 1000;
var STORE_PAGE = 30;
var store = null; /* { at, list }, also kept on disk */
var building = null; /* callbacks waiting for the store being made */

function storeFile() {
  return path.join(process.env.HOME || DIR, '.stremcompat', 'store.json');
}

function resourceNames(m) {
  return (m.resources || []).map(function (r) {
    return typeof r === 'string' ? r : (r && r.name) || '';
  });
}

/* what a card needs, or null for what the store leaves out (adult addons, broken entries) */
function card(row) {
  var m = (row && row.manifest) || {},
    url = manifestUrl(row && row.transportUrl),
    hints = m.behaviorHints || {},
    types = (m.types || []).map(String);
  if (!m.id || !m.name || !url) return null;
  if (hints.adult || types.indexOf('porn') >= 0 || /\bporn|xxx\b/i.test(m.name)) return null;
  var needsSetup = !!hints.configurationRequired;
  return {
    id: String(m.id),
    name: String(m.name).slice(0, 80),
    version: String(m.version || '').slice(0, 20),
    description: String(m.description || '').slice(0, 900),
    logo: /^https?:\/\//i.test(m.logo || '') ? m.logo : '',
    background: /^https?:\/\//i.test(m.background || '') ? m.background : '',
    types: types.slice(0, 5),
    resources: resourceNames(m),
    url: url,
    configure: needsSetup ? hints.configureUrl || url.replace(/manifest\.json(\?.*)?$/i, 'configure') : ''
  };
}

/* the manifest ids of the "Popular" page, in their order; best effort: the page is HTML */
function popularIds(cb) {
  var ids = [],
    seen = {},
    page = 1;
  function next() {
    if (page > POPULAR_PAGES) return cb(ids);
    fetchUrl(
      POPULAR_URL + page++,
      function (body) {
        var text = body ? body.toString('utf8').replace(/\\"/g, '"') : '',
          re = /"manifest":\{"id":"([^"]+)"/g,
          m;
        while ((m = re.exec(text))) if (!seen[m[1]]) ids.push((seen[m[1]] = m[1]));
        if (!body) return cb(ids);
        next();
      },
      0,
      2 * 1024 * 1024
    );
  }
  next();
}

/* joined without repeats: the popular ones first, then Stremio's own order, then the rest */
function makeStore(cb) {
  if (building) return building.push(cb);
  building = [cb];
  fetchJson(CATALOG_URL, function (catalog) {
    fetchJson(OFFICIAL_URL, function (official) {
      popularIds(function (popular) {
        var byId = {},
          order = [];
        function add(rows) {
          (rows || []).forEach(function (row) {
            var c = card(row);
            if (c && !byId[c.id]) {
              byId[c.id] = c;
              order.push(c.id);
            }
          });
        }
        add(official);
        add((catalog && catalog.addons) || []);
        var rank = {};
        popular.forEach(function (id, i) {
          rank[id] = i;
        });
        var officialCount = (official || []).length;
        var list = order
          .map(function (id, i) {
            return { c: byId[id], r: id in rank ? rank[id] : 100000 + (i < officialCount ? i : 50000 + i) };
          })
          .sort(function (a, b) {
            return a.r - b.r;
          })
          .map(function (x) {
            return x.c;
          });
        var waiting = building;
        building = null;
        if (list.length) {
          store = { at: Date.now(), list: list };
          try {
            fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
            fs.writeFileSync(storeFile(), JSON.stringify(store));
          } catch (e) {}
        }
        waiting.forEach(function (fn) {
          fn(store ? store.list : []);
        });
      });
    });
  });
}

function storeNow(cb) {
  if (!store)
    try {
      store = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    } catch (e) {}
  if (store && Date.now() - store.at < STORE_KEEP_MS) return cb(store.list);
  /* an old copy answers at once; a new one is made for the next time */
  if (store) {
    makeStore(function () {});
    return cb(store.list);
  }
  makeStore(cb);
}

var FILTERS = {
  all: function () {
    return true;
  },
  streams: function (c) {
    return (
      c.resources.indexOf('stream') >= 0 && (c.types.indexOf('movie') >= 0 || c.types.indexOf('series') >= 0)
    );
  },
  channels: function (c) {
    return c.types.indexOf('tv') >= 0 || c.types.indexOf('channel') >= 0;
  },
  subtitles: function (c) {
    return c.resources.indexOf('subtitles') >= 0;
  },
  catalogs: function (c) {
    return c.resources.indexOf('catalog') >= 0 && c.resources.indexOf('stream') < 0;
  }
};

/* GET ?type=&skip=&installed=id,id: a page of the store without the addons already installed
   (the web interface says which; the native one is the server's own account) */
function storeList(req, res, q) {
  var filter = FILTERS[q.type] || FILTERS.all,
    skip = Math.max(0, parseInt(q.skip, 10) || 0),
    have = {};
  var installed = q.installed !== undefined ? String(q.installed).split(',') : null;
  if (!installed)
    installed = runtime
      .logic()
      .addons()
      .map(function (a) {
        return (a.manifest && a.manifest.id) || '';
      });
  installed.forEach(function (id) {
    if (id) have[id] = 1;
  });
  storeNow(function (list) {
    var shown = list.filter(function (c) {
      return !have[c.id] && filter(c);
    });
    sendJson(res, {
      addons: shown.slice(skip, skip + STORE_PAGE),
      more: skip + STORE_PAGE < shown.length,
      error: list.length ? '' : 'store'
    });
  });
}

/* GET ?u=: the QR code of an addon's configure page, for the phone */
function configureQr(req, res, q) {
  var u = String(q.u || '');
  if (!/^https?:\/\//i.test(u)) return sendJson(res, { error: 'address' });
  sendJson(res, { url: u, qr: qrRows(u), svg: qrSvg(u) });
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
  card: card,
  routes: { '/addons/store': storeList, '/addons/qr': configureQr },
  postRoutes: { '/addons/change': change }
};
