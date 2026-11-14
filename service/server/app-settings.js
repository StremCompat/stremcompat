// /app/settings: Settings for the native interface, the same groups and options as the web
// Settings (data/settings-defs.js), each with its value in use, and what its actions do.

var { readJsonBody, sendJson } = require('./http-util');
var { clearTorrentCache, setUsbFirst } = require('./streaming-server');
var runtime = require('./app-runtime');

/* an option as the screen needs it: a switch, a list of values or an action */
function itemOf(L, def) {
  var item = { k: def.k, label: def.lb, action: !!def.action };
  if (def.action) return item;
  item.isSwitch = L.isSwitch(def);
  item.on = L.setting(def.k, def.d) === 'true';
  item.value = L.settingValueLabel(def);
  item.options = def.opts.map(function (o) {
    return { v: o[0], label: o[1] };
  });
  item.chosen = L.setting(def.k, def.d);
  return item;
}

function model(L) {
  var u = L.user() || {};
  return {
    account: {
      email: u.email || L.tx('connectedAccount'),
      plan: L.tx(L.isNuvioAccount() ? 'nuvioAccountLabel' : 'freeAccount')
    },
    groups: L.settingsCategories().map(function (c) {
      return {
        name: c.name,
        id: c.id,
        items: c.items.map(function (d) {
          return itemOf(L, d);
        })
      };
    })
  };
}

function findDef(L, key) {
  var found = null;
  L.settingsCategories().forEach(function (c) {
    c.items.forEach(function (d) {
      if (d.k === key) found = d;
    });
  });
  return found;
}

function show(req, res) {
  sendJson(res, model(runtime.logic()));
}

/* { k, v }: keeps a value; the language and the mode change the logic's texts and lists */
function change(req, res) {
  readJsonBody(req, 4096, function (body) {
    var L = runtime.logic(),
      def = body && findDef(L, String(body.k || ''));
    if (!def || def.action) return sendJson(res, { error: 'unknown setting' });
    L.storeSetting(def, String(body.v));
    if (def.k === 'torrentsOnUsb') setUsbFirst(String(body.v) === 'true');
    if (def.k === 'uiLanguage' || def.k === 'uiMode') runtime.restart();
    sendJson(res, model(runtime.logic()));
  });
}

/* { k }: an action of Settings; answers a message to show, and signedOut when it signed out */
function act(req, res) {
  readJsonBody(req, 4096, function (body) {
    var L = runtime.logic(),
      k = String((body && body.k) || '');
    function say(message, extra) {
      var answer = extra || {};
      answer.message = message;
      sendJson(res, answer);
    }
    if (k === '__sync')
      return L.pullLib(function () {
        L.syncAddons(function (changed) {
          say(L.tx(changed ? 'addonsUpdated' : 'addonsCurrent'), { changed: !!changed });
        });
      });
    if (k === '__clearSearches') {
      L.clearRecentSearches();
      return say(L.tx('searchesCleared'));
    }
    if (k === '__clearCw') {
      var n = L.clearContinueWatching();
      return say(n ? L.tx('cwCleared', n) : L.tx('nothingToClear'));
    }
    if (k === '__showNew') {
      var hidden = L.hiddenNewEpisodes().length;
      L.showHiddenNewEpisodes();
      return say(hidden ? L.tx('newEpisodesShown', hidden) : L.tx('nothingToClear'));
    }
    if (k === '__clearCache')
      return clearTorrentCache(function (j) {
        if (!j) say(L.tx('diagUnavailable'));
        else if (j.running) say(L.tx('cacheInUse'));
        else say(j.mb ? L.tx('cacheCleared', j.mb) : L.tx('nothingToClear'));
      });
    if (k === '__logout') {
      L.signOut();
      runtime.restart();
      return say(L.tx('signingOut'), { signedOut: true });
    }
    say('', { unknown: true });
  });
}

module.exports = {
  routes: { '/app/settings': show },
  postRoutes: { '/app/settings': change, '/app/settings/action': act }
};
