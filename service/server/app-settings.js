// /app/settings: Settings for the native interface, the same groups and options as the web
// Settings (data/settings-defs.js), each with its value in use, and what its actions do.

var { readJsonBody, sendJson } = require('./http-util');
var { clearTorrentCache, setUsbFirst } = require('./streaming-server');
var { diagnostics } = require('./diag');
var { qrRows } = require('./qr');
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

/* ---------- the phone's Settings: what concerns a phone, and its own group ---------- */
/* what only means something on a TV: its player's options, its look, its remote, its USB drive */
var TV_ONLY = [
  'scrubPreview',
  'assStyle',
  'embSubsMode',
  'uiMode',
  'uiLook',
  'uiTextSize',
  'bgTrailer',
  'discoverMax',
  'pointer',
  'screensaver',
  'torrentsOnUsb',
  '__m3u',
  '__m3uLists',
  '__server',
  '__speed',
  '__reload'
];
/* "Ask" asks on a TV's Best button; the phone's Best does not ask */
var NO_ASK = ['preferredSourceQuality', 'preferredSourceLanguage'];
function phoneDefs(L) {
  return [
    {
      k: 'phoneAccent',
      lb: L.tx('accentColor'),
      opts: ['violet', 'crimson', 'ocean', 'emerald', 'amber', 'rose', 'white'].map(function (c) {
        return [c, L.tx('accent_' + c)];
      }),
      d: 'violet'
    },
    {
      k: 'phoneAutoBest',
      lb: L.tx('playBestAutomatically'),
      opts: [
        ['false', L.tx('disabled')],
        ['true', L.tx('enabled')]
      ],
      d: 'false'
    },
    {
      k: 'phonePlayer',
      lb: L.tx('playerChoice'),
      opts: [
        ['app', L.tx('playerBuiltIn')],
        ['external', L.tx('playerExternal')]
      ],
      d: 'app'
    }
  ];
}
function phoneCategories(L) {
  var groups = [{ name: L.tx('phoneGroup'), id: 'phone', items: phoneDefs(L) }];
  L.settingsCategories().forEach(function (c) {
    var items = c.items
      .filter(function (d) {
        return TV_ONLY.indexOf(d.k) < 0;
      })
      .map(function (d) {
        if (NO_ASK.indexOf(d.k) < 0) return d;
        var copy = Object.assign({}, d, {
          opts: d.opts.filter(function (o) {
            return o[0] !== 'Ask';
          })
        });
        if (L.setting(d.k, d.d) === 'Ask') copy.d = 'Auto';
        return copy;
      });
    if (items.length) groups.push({ name: c.name, id: c.id, items: items });
  });
  return groups;
}

function model(L, phone) {
  var u = L.user() || {};
  return {
    account: {
      email: u.email || L.tx('connectedAccount'),
      plan: L.tx(L.isNuvioAccount() ? 'nuvioAccountLabel' : 'freeAccount')
    },
    groups: (phone ? phoneCategories(L) : L.settingsCategories()).map(function (c) {
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
  L.settingsCategories()
    .concat([{ items: phoneDefs(L) }])
    .forEach(function (c) {
      c.items.forEach(function (d) {
        if (d.k === key) found = d;
      });
    });
  return found;
}
function show(req, res, q) {
  sendJson(res, model(runtime.logic(), q && q.for === 'phone'));
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
    sendJson(res, model(runtime.logic(), body.for === 'phone'));
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
          L.syncCollections(function () {
            /* the library may have changed too: Home is built again in any case */
            say(L.tx(changed ? 'addonsUpdated' : 'addonsCurrent'), { changed: true });
          });
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

/* Diagnostics as lines (web: settings showDiag), without what only the web interface measures */
function diag(req, res) {
  var L = runtime.logic();
  /* the server's own diagnostics, read as the web interface reads them */
  diagnostics({
    writeHead: function () {},
    end: function (body) {
      var j = null;
      try {
        j = JSON.parse(body);
      } catch (e) {}
      if (!j || !j.server) return sendJson(res, { lines: [L.tx('diagUnavailable')] });
      var events = j.events || [],
        lines = [
          L.tx('diagServer', j.server.rssMb, j.server.heapMb, j.uptimeMin),
          L.tx('diagTv', j.system.availableMb, j.system.totalMb, j.load),
          j.disk ? L.tx('diagDisk', j.disk.freeMb, j.disk.totalMb) : '',
          L.tx('diagStreaming', L.diagStreamingState(j)),
          L.tx('diagPeak', j.peakRssMb, j.minAvailableMb),
          events.length ? L.tx('diagRecent') : L.tx('diagNoProblems')
        ].concat(events.slice(0, 5).map(L.diagEventLine));
      sendJson(res, {
        lines: lines.filter(function (l) {
          return l;
        })
      });
    }
  });
}

var SUPPORT_URL = 'https://buymeacoffee.com/Alexesmm';
function support(req, res) {
  sendJson(res, {
    text: runtime.logic().tx('supportText'),
    address: 'buymeacoffee.com/Alexesmm',
    qr: qrRows(SUPPORT_URL)
  });
}

/* reading and changing share an address: GET reads, POST changes */
function settings(req, res, q) {
  if (req.method === 'POST') return change(req, res);
  show(req, res, q);
}

module.exports = {
  routes: { '/app/settings': settings, '/app/diag': diag, '/app/support': support },
  postRoutes: { '/app/settings/action': act }
};
