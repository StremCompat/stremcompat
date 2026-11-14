// /app/channels: live channels for the native interface. Two kinds: the channel catalogs of the
// installed addons (type tv or channel, opened like any title, with their sources), and the M3U
// lists the viewer adds in Settings, played straight through the local proxy. A list that names
// its programme guide (XMLTV) also tells what is on now.

var zlib = require('zlib');
var { fetchAddonJson, fetchUrl, readJsonBody, sendJson } = require('./http-util');
var { localProxy } = require('./proxy');
var runtime = require('./app-runtime');

var LISTS_KEY = 'm3uLists';
var LIST_LIMIT = 8 * 1024 * 1024;
var GUIDE_LIMIT = 24 * 1024 * 1024;
var KEEP_MS = 6 * 60 * 60 * 1000;
var CHANNELS_MAX = 3000;
var CATALOG_TYPES = ['tv', 'channel'];

/* ---------- M3U ---------- */
function attribute(line, name) {
  var m = new RegExp(name + '="([^"]*)"', 'i').exec(line);
  return m ? m[1] : '';
}

/* #EXTM3U url-tvg="..." / #EXTINF:-1 tvg-id="x" tvg-logo="..." group-title="News",Name / address */
function parseM3u(text) {
  var lines = String(text).split(/\r?\n/),
    out = { guide: '', channels: [] },
    pending = null;
  if (!/^\s*#EXTM3U/.test(lines[0] || '')) return null;
  out.guide = attribute(lines[0], 'url-tvg') || attribute(lines[0], 'x-tvg-url');
  for (var i = 1; i < lines.length && out.channels.length < CHANNELS_MAX; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      pending = {
        name: line.slice(line.lastIndexOf(',') + 1).trim(),
        logo: attribute(line, 'tvg-logo'),
        group: attribute(line, 'group-title'),
        guideId: attribute(line, 'tvg-id')
      };
    } else if (line.charAt(0) !== '#' && pending && /^https?:\/\//i.test(line)) {
      pending.url = line;
      out.channels.push(pending);
      pending = null;
    }
  }
  return out;
}

/* what is on now on each channel of a guide: { guideId: title } */
function nowShowing(xml, ids) {
  var now = new Date(),
    out = {},
    re =
      /<programme[^>]*start="(\d{14})[^"]*"[^>]*stop="(\d{14})[^"]*"[^>]*channel="([^"]*)"[^>]*>[\s\S]*?<title[^>]*>([^<]*)<\/title>/g,
    m;
  function time(s) {
    return new Date(
      Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12))
    );
  }
  while ((m = re.exec(xml)))
    if (ids[m[3]] && !out[m[3]] && time(m[1]) <= now && time(m[2]) > now) out[m[3]] = m[4].trim();
  return out;
}

var cache = {}; /* address -> { at, list } */

function readList(address, cb) {
  var kept = cache[address];
  if (kept && Date.now() - kept.at < KEEP_MS) return cb(kept.list);
  fetchUrl(
    address,
    function (body) {
      var list = body ? parseM3u(body.toString('utf8')) : null;
      if (!list) return cb(null);
      cache[address] = { at: Date.now(), list: list };
      if (!list.guide) return cb(list);
      readGuide(list, function () {
        cb(list);
      });
    },
    0,
    LIST_LIMIT
  );
}

function readGuide(list, cb) {
  fetchUrl(
    list.guide,
    function (body) {
      if (!body) return cb();
      var ids = {};
      list.channels.forEach(function (c) {
        if (c.guideId) ids[c.guideId] = true;
      });
      function apply(text) {
        var now = nowShowing(text, ids);
        list.channels.forEach(function (c) {
          c.now = now[c.guideId] || '';
        });
        cb();
      }
      /* guides often come compressed */
      if (body[0] === 0x1f && body[1] === 0x8b)
        return zlib.gunzip(body, function (err, plain) {
          if (err) return cb();
          apply(plain.toString('utf8'));
        });
      apply(body.toString('utf8'));
    },
    0,
    GUIDE_LIMIT
  );
}

function lists() {
  try {
    return JSON.parse(runtime.storage.getItem(LISTS_KEY) || '[]') || [];
  } catch (e) {
    return [];
  }
}

/* ---------- the channels of both kinds, in groups ---------- */
function addonGroups(L, cb) {
  var cats = [];
  CATALOG_TYPES.forEach(function (type) {
    L.discoverCatalogs(type).forEach(function (c) {
      if (c.type === type && c.base) cats.push(c);
    });
  });
  var groups = [],
    left = cats.length;
  if (!left) return cb(groups);
  cats.forEach(function (c, i) {
    fetchAddonJson(L.discoverPageUrl(c, '', 0), function (j) {
      var items = ((j && j.metas) || []).map(function (m) {
        return {
          id: m.id,
          type: m.type || c.type,
          name: m.name || '',
          logo: m.logo || m.poster || '',
          kind: 'addon'
        };
      });
      if (items.length) groups[i] = { title: c.label, items: items };
      if (--left) return;
      cb(
        groups.filter(function (g) {
          return g;
        })
      );
    });
  });
}

function listGroups(cb) {
  var saved = lists(),
    groups = [],
    left = saved.length;
  if (!left) return cb(groups);
  saved.forEach(function (entry) {
    readList(entry.url, function (list) {
      (list ? list.channels : []).forEach(function (c) {
        var title = c.group || entry.name || '',
          group = groups.filter(function (g) {
            return g.title === title;
          })[0];
        if (!group) groups.push((group = { title: title, items: [] }));
        group.items.push({
          name: c.name,
          logo: c.logo,
          now: c.now || '',
          kind: 'm3u',
          url: localProxy(c.url)
        });
      });
      if (--left) return;
      cb(groups);
    });
  });
}

function channels(req, res) {
  var L = runtime.logic();
  addonGroups(L, function (fromAddons) {
    listGroups(function (fromLists) {
      var groups = fromAddons.concat(fromLists);
      sendJson(res, {
        groups: groups,
        empty: groups.length ? '' : L.tx('channelsEmpty'),
        lists: lists().length
      });
    });
  });
}

/* { url } adds a list (read first, so a wrong address is said at once); { remove: true } drops them all */
function changeLists(req, res) {
  readJsonBody(req, 8192, function (body) {
    var L = runtime.logic();
    if (body && body.remove) {
      runtime.storage.setItem(LISTS_KEY, '[]');
      return sendJson(res, { message: L.tx('m3uRemoved') });
    }
    var address = String((body && body.url) || '').trim();
    if (!/^https?:\/\//i.test(address)) return sendJson(res, { message: L.tx('m3uFailed') });
    delete cache[address];
    readList(address, function (list) {
      if (!list || !list.channels.length) return sendJson(res, { message: L.tx('m3uFailed') });
      var saved = lists().filter(function (e) {
        return e.url !== address;
      });
      saved.push({ url: address, name: address.replace(/^https?:\/\/([^/]+).*$/, '$1') });
      runtime.storage.setItem(LISTS_KEY, JSON.stringify(saved));
      sendJson(res, { message: L.tx('m3uAdded', list.channels.length) });
    });
  });
}

module.exports = {
  parseM3u: parseM3u,
  nowShowing: nowShowing,
  routes: { '/app/channels': channels },
  postRoutes: { '/app/channels/lists': changeLists }
};
