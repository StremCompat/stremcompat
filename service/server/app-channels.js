// /app/channels: live channels for both interfaces. Two kinds: the channel catalogs of the
// installed addons (type tv or channel; NexoTV and the like), split by the categories they offer,
// and the M3U lists the viewer adds. Big IPTV lists (tens of thousands of channels) stay light:
// each list is read once into an index kept on disk and, for at most two lists, in memory; the
// interfaces get the categories first and the channels a page at a time. A list's programme
// guide (XMLTV) is read as it downloads, keeping only the next hours of its own channels, so
// what is on now is worked out at each request and never goes stale.

var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var urlmod = require('url');
var zlib = require('zlib');
var StringDecoder = require('string_decoder').StringDecoder;
var { DIR, PORT, PROFILE } = require('./config');
var { fetchAddonJson, fetchJson, fetchUrl, readJsonBody, sendJson } = require('./http-util');
var { storeStreamRef } = require('./stream-refs');
var runtime = require('./app-runtime');

var LISTS_KEY = 'm3uLists';
var RECENT_KEY = 'recentChannels';
var LIST_LIMIT = 32 * 1024 * 1024;
var CHANNELS_MAX = 50000;
var FRESH_MS = 12 * 3600 * 1000;
var PAGE = 60;
var RECENT_MAX = 12;
var IN_MEMORY = PROFILE.lowMemory ? 1 : 2;
var GUIDE_LIMIT = (PROFILE.lowMemory ? 20 : 60) * 1024 * 1024;
var GUIDE_AHEAD_MS = 24 * 3600 * 1000;
var GUIDE_PER_CHANNEL = 48;
var ADDON_PAGE_MS = 5 * 60 * 1000;
var CATALOG_TYPES = ['tv', 'channel'];

function folder() {
  return path.join(process.env.HOME || DIR, '.stremcompat', 'channels');
}
function hashOf(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
}

/* ---------- M3U: one pass, the attributes read with patterns made once ---------- */
var ATTR = {
  logo: /tvg-logo="([^"]*)"/i,
  group: /group-title="([^"]*)"/i,
  id: /tvg-id="([^"]*)"/i,
  guide: /(?:url-tvg|x-tvg-url)="([^"]*)"/i
};
var OPTION = /^#EXTVLCOPT:\s*http-(user-agent|referrer|referer)\s*=\s*(.+)$/i;

function attribute(line, re) {
  var m = re.exec(line);
  return m ? m[1] : '';
}

/* the name follows the comma after the last attribute ("group-title="A, B",Name") */
function channelName(line) {
  var quote = line.lastIndexOf('"'),
    comma = line.indexOf(',', quote < 0 ? 0 : quote);
  return comma < 0 ? '' : line.slice(comma + 1).trim();
}

/* "address|User-Agent=x&Referer=y" (Kodi) carries the headers in the address */
function addressAndHeaders(line, headers) {
  var bar = line.indexOf('|');
  if (bar < 0) return line;
  line
    .slice(bar + 1)
    .split('&')
    .forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq > 0) headers[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    });
  return line.slice(0, bar);
}

/* { guide, count, groups: [{ title, channels: [{ n name, l logo, u address, g guide id, h headers }] }] } */
function parseM3u(text, fallbackGroup) {
  var lines = String(text).split(/\r?\n/),
    out = { guide: '', count: 0, groups: [] },
    byTitle = {},
    pending = null;
  if (!/^\s*#EXTM3U/.test(lines[0] || '')) return null;
  out.guide = attribute(lines[0], ATTR.guide);
  for (var i = 1; i < lines.length && out.count < CHANNELS_MAX; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === '#') {
      if (/^#EXTINF/i.test(line))
        pending = {
          n: channelName(line),
          l: attribute(line, ATTR.logo),
          g: attribute(line, ATTR.id),
          group: attribute(line, ATTR.group),
          h: {}
        };
      else if (pending) {
        var opt = OPTION.exec(line);
        if (opt) pending.h[/agent/i.test(opt[1]) ? 'User-Agent' : 'Referer'] = opt[2].trim();
      }
      continue;
    }
    if (!pending || !/^https?:\/\//i.test(line)) continue;
    var channel = { n: pending.n, l: pending.l, u: addressAndHeaders(line, pending.h) };
    if (pending.g) channel.g = pending.g;
    if (Object.keys(pending.h).length) channel.h = pending.h;
    var title = pending.group || fallbackGroup || '';
    if (!(title in byTitle)) {
      byTitle[title] = out.groups.length;
      out.groups.push({ title: title, channels: [] });
    }
    out.groups[byTitle[title]].channels.push(channel);
    out.count++;
    pending = null;
  }
  return out;
}

/* ---------- the programme guide, read while it downloads ---------- */
/* "20261114120000 +0300" -> milliseconds */
function guideTime(s) {
  var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(String(s || ''));
  if (!m) return 0;
  var at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) at -= (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000;
  return at;
}

var PROGRAMME = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
var START = /\bstart="([^"]*)"/,
  STOP = /\bstop="([^"]*)"/,
  CHANNEL = /\bchannel="([^"]*)"/,
  TITLE = /<title[^>]*>([^<]*)<\/title>/;

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/* the programmes of the parts read so far; what is left is the start of the next one */
function takeProgrammes(text, ids, guide, from, to) {
  PROGRAMME.lastIndex = 0;
  var m,
    last = 0;
  while ((m = PROGRAMME.exec(text))) {
    last = PROGRAMME.lastIndex;
    var id = attribute(m[1], CHANNEL);
    if (!ids[id]) continue;
    var start = guideTime(attribute(m[1], START)),
      stop = guideTime(attribute(m[1], STOP));
    if (!start || stop <= from || start >= to) continue;
    var list = guide[id] || (guide[id] = []);
    if (list.length < GUIDE_PER_CHANNEL) list.push([start, stop, unescapeXml(attribute(m[2], TITLE))]);
  }
  /* a part with no whole programme yet keeps only its tail */
  return last ? text.slice(last) : text.length > 65536 ? text.slice(-65536) : text;
}

/* cb(guide): { guide id: [[start, stop, title]] }, sorted; stops at GUIDE_LIMIT with what it has */
function readGuide(address, ids, cb, hops) {
  var guide = {},
    rest = '',
    bytes = 0,
    finished = false,
    now = Date.now(),
    from = now - 3600 * 1000,
    to = now + GUIDE_AHEAD_MS;
  function finish() {
    if (finished) return;
    finished = true;
    Object.keys(guide).forEach(function (id) {
      guide[id].sort(function (a, b) {
        return a[0] - b[0];
      });
    });
    cb(guide);
  }
  var target = urlmod.parse(String(address || ''));
  if (!/^https?:$/.test(target.protocol || '') || (hops || 0) > 5) return cb({});
  var request = (target.protocol === 'https:' ? https : http).get(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      headers: { 'Accept-Encoding': 'gzip' }
    },
    function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        finished = true;
        return readGuide(urlmod.resolve(address, res.headers.location), ids, cb, (hops || 0) + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return finish();
      }
      var gz =
        /gzip/i.test(res.headers['content-encoding'] || '') || /\.gz(\?|$)/i.test(target.pathname || '');
      var source = gz ? res.pipe(zlib.createGunzip()) : res,
        decoder = new StringDecoder('utf8');
      source.on('data', function (chunk) {
        if (finished) return;
        bytes += chunk.length;
        rest = takeProgrammes(rest + decoder.write(chunk), ids, guide, from, to);
        if (bytes > GUIDE_LIMIT) {
          request.abort();
          finish();
        }
      });
      source.on('end', finish);
      source.on('error', finish);
    }
  );
  request.on('error', finish);
  request.setTimeout(30000, function () {
    request.abort();
    finish();
  });
}

/* what is on now and next on a channel of a guide */
function nowNext(guide, id, at) {
  var list = (guide && id && guide[id]) || [];
  for (var i = 0; i < list.length; i++)
    if (list[i][0] <= at && list[i][1] > at)
      return { now: list[i][2], start: list[i][0], end: list[i][1], next: list[i + 1] ? list[i + 1][2] : '' };
  return null;
}

/* ---------- the saved lists and their indexes ---------- */
function lists() {
  try {
    return JSON.parse(runtime.storage.getItem(LISTS_KEY) || '[]') || [];
  } catch (e) {
    return [];
  }
}
function saveLists(all) {
  runtime.storage.setItem(LISTS_KEY, JSON.stringify(all));
}

var memory = []; /* [{ url, index }], the most recent last */
var loading = {}; /* url -> callbacks waiting for the same download */

function remember(url, index) {
  memory = memory.filter(function (m) {
    return m.url !== url;
  });
  memory.push({ url: url, index: index });
  while (memory.length > IN_MEMORY) memory.shift();
}
function forget(url) {
  memory = memory.filter(function (m) {
    return m.url !== url;
  });
  fs.unlink(path.join(folder(), hashOf(url) + '.json'), function () {});
}
function writeIndex(url, index) {
  var file = path.join(folder(), hashOf(url) + '.json');
  try {
    fs.mkdirSync(folder(), { recursive: true });
  } catch (e) {}
  fs.writeFile(file + '.tmp', JSON.stringify(index), function (err) {
    if (!err) fs.rename(file + '.tmp', file, function () {});
  });
}

/* downloads and reads a list (once at a time per address), then its guide in the background */
function download(entry, cb) {
  if (loading[entry.url]) return loading[entry.url].push(cb);
  loading[entry.url] = [cb];
  fetchUrl(
    entry.url,
    function (body) {
      var parsed = body ? parseM3u(body.toString('utf8'), entry.name) : null,
        waiting = loading[entry.url] || [];
      delete loading[entry.url];
      if (parsed && parsed.count) {
        parsed.url = entry.url;
        parsed.at = Date.now();
        parsed.epg = {};
        remember(entry.url, parsed);
        writeIndex(entry.url, parsed);
        if (parsed.guide) guideFor(parsed);
      }
      waiting.forEach(function (fn) {
        fn(parsed && parsed.count ? parsed : null);
      });
    },
    0,
    LIST_LIMIT
  );
}

function guideFor(index) {
  var ids = {};
  index.groups.forEach(function (g) {
    g.channels.forEach(function (c) {
      if (c.g) ids[c.g] = true;
    });
  });
  if (!Object.keys(ids).length) return;
  readGuide(index.guide, ids, function (guide) {
    index.epg = guide;
    index.epgAt = Date.now();
    writeIndex(index.url, index);
  });
}

/* cb(index or null): memory, then disk, then the network; an old copy answers at once while a
   new one downloads */
function indexOf(entry, cb, fresh) {
  if (fresh) return download(entry, cb);
  var kept = memory.filter(function (m) {
    return m.url === entry.url;
  })[0];
  function stale(index) {
    if (Date.now() - (index.at || 0) > FRESH_MS) download(entry, function () {});
  }
  if (kept) {
    stale(kept.index);
    return cb(kept.index);
  }
  fs.readFile(path.join(folder(), hashOf(entry.url) + '.json'), 'utf8', function (err, text) {
    var index = null;
    try {
      index = !err && JSON.parse(text);
    } catch (e) {}
    if (!index || !index.groups) return download(entry, cb);
    remember(entry.url, index);
    stale(index);
    cb(index);
  });
}

/* every saved list's index, in the saved order */
function allIndexes(cb) {
  var saved = lists(),
    out = new Array(saved.length),
    left = saved.length;
  if (!left) return cb([]);
  saved.forEach(function (entry, i) {
    indexOf(entry, function (index) {
      out[i] = { entry: entry, index: index };
      if (!--left) cb(out);
    });
  });
}

/* ---------- the addons' channel catalogs, split by their categories ---------- */
function addonCatalogs(L) {
  var searchable = {};
  L.addons().forEach(function (a) {
    ((a.manifest && a.manifest.catalogs) || []).forEach(function (cat) {
      (cat.extra || []).forEach(function (x) {
        if (x && x.name === 'search') searchable[cat.type + '|' + cat.id] = true;
      });
    });
  });
  var out = [];
  CATALOG_TYPES.forEach(function (type) {
    L.discoverCatalogs(type).forEach(function (c) {
      if (c.type !== type || !c.base) return;
      c.search = !!searchable[type + '|' + c.id];
      out.push(c);
    });
  });
  return out;
}

var pages = {}; /* url -> { at, metas }, a few minutes */
function addonPage(url, cb) {
  var hit = pages[url];
  if (hit && Date.now() - hit.at < ADDON_PAGE_MS) return cb(hit.metas);
  fetchAddonJson(url, function (j) {
    var metas = (j && j.metas) || [];
    var keys = Object.keys(pages);
    if (keys.length > 24) delete pages[keys[0]];
    pages[url] = { at: Date.now(), metas: metas };
    cb(metas);
  });
}

function addonChannel(m, type) {
  return {
    key: 'a|' + (m.type || type) + '|' + m.id,
    name: m.name || '',
    logo: m.logo || m.poster || '',
    kind: 'addon',
    type: m.type || type,
    id: m.id
  };
}

/* ---------- what the interfaces get ---------- */
function m3uChannel(c, listKey, gi, ci, at, guide) {
  var out = { key: 'm|' + listKey + '|' + gi + '|' + ci, name: c.n, logo: c.l || '', kind: 'm3u' };
  var on = nowNext(guide, c.g, at);
  if (on) {
    out.now = on.now;
    out.next = on.next;
    out.start = on.start;
    out.end = on.end;
  }
  return out;
}

function recent() {
  try {
    return JSON.parse(runtime.storage.getItem(RECENT_KEY) || '[]') || [];
  } catch (e) {
    return [];
  }
}

/* GET: the categories, the lists and the recent channels; no channel of a category comes yet */
function channels(req, res) {
  var L = runtime.logic(),
    groups = [];
  var cats = addonCatalogs(L);
  cats.forEach(function (c, i) {
    var name = cats.length > 1 ? ' · ' + c.label : '';
    if (c.genres && c.genres.length)
      c.genres.forEach(function (g) {
        groups.push({ id: 'a:' + i + ':' + g, title: g + name, count: -1, kind: 'addon' });
      });
    else groups.push({ id: 'a:' + i + ':', title: c.label, count: -1, kind: 'addon' });
  });
  allIndexes(function (all) {
    var summary = [];
    all.forEach(function (one) {
      var index = one.index,
        key = hashOf(one.entry.url).slice(0, 8);
      summary.push({
        url: one.entry.url,
        name: one.entry.name,
        count: index ? index.count : 0,
        updated: index ? index.at : 0
      });
      if (!index) return;
      index.groups.forEach(function (g, gi) {
        groups.push({
          id: 'm:' + key + ':' + gi,
          title: g.title || one.entry.name,
          count: g.channels.length,
          kind: 'm3u'
        });
      });
    });
    sendJson(res, {
      groups: groups,
      lists: summary,
      recent: recent(),
      search: cats.length > 0 || summary.length > 0,
      empty: groups.length ? '' : L.tx('channelsEmpty')
    });
  });
}

function listByKey(all, key) {
  return all.filter(function (one) {
    return one.index && hashOf(one.entry.url).slice(0, 8) === key;
  })[0];
}

/* the same name with and without accents and case, for the search */
function plain(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[à-å]/g, 'a')
    .replace(/[è-ë]/g, 'e')
    .replace(/[ì-ï]/g, 'i')
    .replace(/[ò-ö]/g, 'o')
    .replace(/[ù-ü]/g, 'u')
    .replace(/ç/g, 'c');
}

/* GET ?id=&skip= (or id=search&q=): a page of a category's channels, with what is on now */
function group(req, res, q) {
  var id = String(q.id || ''),
    skip = Math.max(0, parseInt(q.skip, 10) || 0),
    now = Date.now(),
    L = runtime.logic();
  function answer(items, more) {
    sendJson(res, { channels: items, more: !!more });
  }
  if (id === 'recent') return answer(recent(), false);
  if (id === 'search') {
    var wanted = plain(q.q).trim();
    if (!wanted) return answer([], false);
    return allIndexes(function (all) {
      var found = [];
      all.forEach(function (one) {
        if (!one.index) return;
        var key = hashOf(one.entry.url).slice(0, 8);
        one.index.groups.forEach(function (g, gi) {
          for (var ci = 0; ci < g.channels.length && found.length < PAGE; ci++)
            if (plain(g.channels[ci].n).indexOf(wanted) >= 0)
              found.push(m3uChannel(g.channels[ci], key, gi, ci, now, one.index.epg));
        });
      });
      /* addons that search their own channels (NexoTV) */
      var cats = addonCatalogs(L).filter(function (c) {
          return c.search;
        }),
        left = cats.length;
      if (!left) return answer(found, false);
      cats.forEach(function (c) {
        var url =
          c.base +
          '/catalog/' +
          c.type +
          '/' +
          encodeURIComponent(c.id) +
          '/search=' +
          encodeURIComponent(q.q) +
          '.json' +
          (c.query || '');
        addonPage(url, function (metas) {
          metas.slice(0, 30).forEach(function (m) {
            found.push(addonChannel(m, c.type));
          });
          if (!--left) answer(found, false);
        });
      });
    });
  }
  var parts = id.split(':');
  if (parts[0] === 'a') {
    var c = addonCatalogs(L)[+parts[1]];
    if (!c) return answer([], false);
    return addonPage(L.discoverPageUrl(c, parts.slice(2).join(':'), skip), function (metas) {
      answer(
        metas.map(function (m) {
          return addonChannel(m, c.type);
        }),
        metas.length >= 20
      );
    });
  }
  allIndexes(function (all) {
    var one = listByKey(all, parts[1]),
      g = one && one.index.groups[+parts[2]];
    if (!g) return answer([], false);
    var items = [];
    for (var ci = skip; ci < g.channels.length && items.length < PAGE; ci++)
      items.push(m3uChannel(g.channels[ci], parts[1], +parts[2], ci, now, one.index.epg));
    answer(items, skip + PAGE < g.channels.length);
  });
}

function rememberRecent(item) {
  var keep = recent().filter(function (r) {
    return r.name !== item.name || r.kind !== item.kind;
  });
  keep.unshift(item);
  runtime.storage.setItem(RECENT_KEY, JSON.stringify(keep.slice(0, RECENT_MAX)));
}

/* GET ?key=: an M3U channel becomes a stream reference with its headers, played through the proxy
   (which rewrites its HLS playlists); an addon channel answers its title, whose sources the
   interface opens. Either way it goes to the recent ones, never to the library. */
function play(req, res, q) {
  var key = String(q.key || ''),
    parts = key.split('|');
  if (parts[0] === 'a')
    return (function () {
      var item = {
        key: key,
        name: String(q.name || ''),
        logo: String(q.logo || ''),
        kind: 'addon',
        type: parts[1],
        id: parts.slice(2).join('|')
      };
      rememberRecent(item);
      sendJson(res, { type: item.type, id: item.id, name: item.name });
    })();
  allIndexes(function (all) {
    var c = null;
    if (parts[0] === 'm') {
      var one = listByKey(all, parts[1]),
        g = one && one.index.groups[+parts[2]];
      c = g && g.channels[+parts[3]];
    } else if (parts[0] === 'r') c = (recent()[+parts[1]] || {}).play;
    if (!c) return sendJson(res, { error: 'gone' });
    var ref = storeStreamRef({
      url: c.u,
      headers: c.h,
      title: c.n,
      name: c.n,
      meta: { name: c.n, logo: c.l }
    });
    if (!ref) return sendJson(res, { error: 'gone' });
    rememberRecent({ key: 'r|0', name: c.n, logo: c.l || '', kind: 'm3u', play: c });
    /* the recent list's keys follow its order */
    var again = recent();
    again.forEach(function (r, i) {
      if (r.kind === 'm3u') r.key = 'r|' + i;
    });
    runtime.storage.setItem(RECENT_KEY, JSON.stringify(again));
    sendJson(res, { ref: ref, url: 'http://127.0.0.1:' + PORT + '/proxy?ref=' + ref, name: c.n });
  });
}

/* ---------- suggested lists: free channels, added with one OK ---------- */
/* iptv-org's public lists are stable; the free FAST services (LG Channels, Samsung TV Plus, Pluto)
   only exist through community lists that move often, so those come from a small file of the
   project, read at most once a day, that can change without a new version */
var SUGGESTED_URL = 'https://stremcompat.github.io/webos/suggested-lists.json';
var SUGGESTED_KEEP_MS = 24 * 3600 * 1000;
var suggestedFetched = { at: 0, lists: [] };
function suggested(req, res) {
  var L = runtime.logic();
  var fixed = [
    { name: L.tx('suggestCountry'), url: 'https://iptv-org.github.io/iptv/countries/br.m3u' },
    { name: L.tx('suggestLanguage'), url: 'https://iptv-org.github.io/iptv/languages/por.m3u' },
    { name: L.tx('suggestWorld'), url: 'https://iptv-org.github.io/iptv/index.m3u' }
  ];
  function answer() {
    var saved = lists().map(function (e) {
      return e.url;
    });
    sendJson(res, {
      lists: suggestedFetched.lists.concat(fixed).filter(function (s) {
        return saved.indexOf(s.url) < 0;
      })
    });
  }
  if (Date.now() - suggestedFetched.at < SUGGESTED_KEEP_MS) return answer();
  fetchJson(SUGGESTED_URL, function (j) {
    suggestedFetched = {
      at: Date.now(),
      lists: ((j && j.lists) || [])
        .filter(function (s) {
          return s && s.name && /^https?:\/\//i.test(s.url || '');
        })
        .slice(0, 20)
        .map(function (s) {
          return { name: String(s.name).slice(0, 80), url: String(s.url) };
        })
    };
    answer();
  });
}

/* { url } adds a list (read first, so a wrong address is said at once); { remove: url } drops one,
   { remove: true } all of them; { refresh: url } reads one again */
function changeLists(req, res) {
  readJsonBody(req, 8192, function (body) {
    var L = runtime.logic(),
      saved = lists();
    body = body || {};
    if (body.remove === true) {
      saved.forEach(function (e) {
        forget(e.url);
      });
      saveLists([]);
      return sendJson(res, { ok: true, message: L.tx('m3uRemoved') });
    }
    if (body.remove) {
      forget(String(body.remove));
      saveLists(
        saved.filter(function (e) {
          return e.url !== String(body.remove);
        })
      );
      return sendJson(res, { ok: true, message: L.tx('m3uRemovedOne') });
    }
    var address = String(body.url || body.refresh || '').trim(),
      name = String(body.name || '').trim() || address.replace(/^https?:\/\/([^/]+).*$/, '$1');
    if (!/^https?:\/\//i.test(address)) return sendJson(res, { ok: false, message: L.tx('m3uFailed') });
    var known = saved.filter(function (e) {
      return e.url === address;
    })[0];
    indexOf(
      known || { url: address, name: name },
      function (index) {
        if (!index) return sendJson(res, { ok: false, message: L.tx('m3uFailed') });
        if (!known) saveLists(saved.concat([{ url: address, name: name }]));
        sendJson(res, { ok: true, message: L.tx(body.refresh ? 'm3uRefreshed' : 'm3uAdded', index.count) });
      },
      true
    );
  });
}

module.exports = {
  guideTime: guideTime,
  nowNext: nowNext,
  parseM3u: parseM3u,
  takeProgrammes: takeProgrammes,
  routes: {
    '/app/channels': channels,
    '/app/channels/group': group,
    '/app/channels/play': play,
    '/app/channels/suggested': suggested
  },
  postRoutes: { '/app/channels/lists': changeLists }
};
