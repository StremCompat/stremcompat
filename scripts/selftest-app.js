'use strict';

// The native interface's API (/app/...): the real local server with a stand-in addon, from
// handing over the web interface's storage to Home, a catalog, a title and its sources.

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var root = path.resolve(__dirname, '..');
/* STREMCOMPAT_SERVICE and STREMCOMPAT_SERVER_NODE run a staged server on another Node, such as
   the TV's 0.12: STREMCOMPAT_SERVICE=.build/lg-armv7/service */
var serviceDir = path.resolve(process.env.STREMCOMPAT_SERVICE || path.join(root, 'service'));
var appPort = require(path.join(serviceDir, 'profile.js')).current.port;

function request(pathName, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request(
      {
        hostname: '127.0.0.1',
        port: appPort,
        path: pathName,
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {}
      },
      function (res) {
        var chunks = [];
        res.on('data', function (d) {
          chunks.push(d);
        });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8'),
            json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {}
          resolve({ status: res.statusCode, json: json, text: text });
        });
      }
    );
    req.setTimeout(15000, function () {
      req.destroy(new Error('request timeout: ' + pathName));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitForServer() {
  for (var i = 0; i < 100; i++) {
    try {
      var r = await request('/health');
      if (r.status === 200) return;
    } catch (e) {}
    await wait(100);
  }
  throw new Error('the local server did not start');
}

/* ---------- a stand-in addon with one catalog, one series and two sources ---------- */
var ADDON_PORT = 9293;
var addonBase = 'http://127.0.0.1:' + ADDON_PORT;
var manifest = {
  id: 'test.addon',
  name: 'Test addon',
  version: '1.0.0',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'tv'],
  idPrefixes: ['tst'],
  catalogs: [
    { type: 'series', id: 'popular', name: 'Popular' },
    /* a live channels catalog as NexoTV makes it: categories as genres, search and pages */
    {
      type: 'tv',
      id: 'live',
      name: 'Live',
      extra: [{ name: 'genre', options: ['News', 'Sports'] }, { name: 'search' }, { name: 'skip' }]
    }
  ]
};
var meta = {
  id: 'tst1',
  type: 'series',
  name: 'Test Show',
  poster: addonBase + '/poster.jpg',
  videos: [
    { id: 'tst1:1:1', season: 1, episode: 1, title: 'Pilot', released: '2020-01-01T00:00:00.000Z' },
    { id: 'tst1:1:2', season: 1, episode: 2, title: 'Second', released: '2020-01-08T00:00:00.000Z' }
  ]
};
var answers = {
  '/manifest.json': manifest,
  '/catalog/series/popular.json': {
    metas: [{ id: 'tst1', type: 'series', name: 'Test Show', poster: meta.poster }]
  },
  '/meta/series/tst1.json': { meta: meta },
  '/catalog/tv/live/genre=News.json': {
    metas: [{ id: 'tvn1', type: 'tv', name: 'News One', poster: 'http://l/n.png' }]
  },
  '/catalog/tv/live/search=sport.json': { metas: [{ id: 'tvs1', type: 'tv', name: 'Sport Max' }] },
  '/stream/series/tst1%3A1%3A1.json': {
    streams: [
      { name: 'Test\n1080p', title: 'Show.S01E01.1080p.WEB.x264', url: addonBase + '/a.mp4' },
      { name: 'Test\n4K', title: 'Show.S01E01.2160p.WEB.HEVC.DTS', url: addonBase + '/b.mp4' }
    ]
  }
};

/* the start of a JPEG is all /app/img looks at */
var POSTER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);

/* a big IPTV list: 20 000 channels in 40 groups, and its guide (gzip) for the first channels */
var CHANNELS = 20000;
function bigList() {
  var lines = ['#EXTM3U url-tvg="' + addonBase + '/guide.xml.gz"'];
  for (var i = 0; i < CHANNELS; i++)
    lines.push(
      '#EXTINF:-1 tvg-id="c' +
        i +
        '" tvg-logo="http://l/' +
        i +
        '.png" group-title="Group ' +
        (i % 40) +
        '",Canal ' +
        i,
      'http://s/' + i + '.m3u8'
    );
  return lines.join('\n');
}
function guide() {
  var at = new Date(Date.now() - 30 * 60000),
    end = new Date(Date.now() + 30 * 60000);
  function stamp(d) {
    /* written as UTC+3, as many guides do */
    var local = new Date(d.getTime() + 3 * 3600000);
    return local.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0300';
  }
  return require('zlib').gzipSync(
    '<?xml version="1.0"?><tv><programme channel="c0" start="' +
      stamp(at) +
      '" stop="' +
      stamp(end) +
      '"><title>Jornal &amp; Cia</title></programme></tv>'
  );
}

/* what the stand-in addon was asked and over how many connections (they are kept open) */
var addonSeen = { requests: 0, connections: 0 };
function addonServer() {
  var server = http.createServer(function (req, res) {
    addonSeen.requests++;
    if (req.url === '/list.m3u') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      return res.end(bigList());
    }
    if (req.url === '/guide.xml.gz') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      return res.end(guide());
    }
    if (req.url === '/poster.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(POSTER);
    }
    var answer = answers[req.url.split('?')[0]];
    res.writeHead(answer ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answer || { error: 'not found' }));
  });
  server.on('connection', function () {
    addonSeen.connections++;
  });
  return server;
}

async function main() {
  /* another server on the port would answer instead of the one started here */
  var busy = await request('/health').then(
    function () {
      return true;
    },
    function () {
      return false;
    }
  );
  if (busy) throw new Error('port ' + appPort + ' is in use: stop the server that holds it first');
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-app-'));
  var addon = addonServer();
  await new Promise(function (resolve) {
    addon.listen(ADDON_PORT, '127.0.0.1', resolve);
  });
  var child = childProcess.spawn(
    process.env.STREMCOMPAT_SERVER_NODE || process.execPath,
    [path.join(serviceDir, 'local-server.js')],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        HOME: home,
        SC_PHONE_HOST: '127.0.0.1',
        SC_CINEMETA_URL: addonBase,
        TV_ENGINE: path.join(__dirname, 'lib', 'fake-engine.js'),
        SC_SERVER_LOG: path.join(home, 'server.log')
      })
    }
  );
  var log = '';
  child.stdout.on('data', function (d) {
    log += d;
  });
  child.stderr.on('data', function (d) {
    log += d;
  });
  try {
    await waitForServer();

    var before = await request('/app/state?tvLanguage=pt-BR');
    assert.strictEqual(before.json.signedIn, false, 'signed in before any account was handed over');
    assert.strictEqual(before.json.language, 'pt-BR', "the TV's language was not used");

    /* the web interface hands over its storage; caches (beta_) stay behind */
    var moved = await request('/app/migrate', {
      authKey: JSON.stringify('test-key'),
      user: JSON.stringify({ _id: 'u1', email: 'viewer@example.com' }),
      addons: JSON.stringify([{ transportUrl: addonBase + '/manifest.json', manifest: manifest }]),
      beta_cat_old: JSON.stringify({ items: [] })
    });
    assert.strictEqual(moved.json.keys, 3, 'the handed-over keys were not counted');
    await wait(700); /* the file is written a moment after the last change */
    var saved = JSON.parse(fs.readFileSync(path.join(home, '.stremcompat', 'app-state.json'), 'utf8'));
    assert.ok(saved.authKey && !saved.beta_cat_old, 'the storage file does not hold what was handed over');

    var state = await request('/app/state');
    assert.deepStrictEqual(
      [state.json.signedIn, state.json.provider, state.json.email],
      [true, 'stremio', 'viewer@example.com'],
      'the account was not read from the handed-over storage'
    );

    var strings = await request('/app/strings');
    assert.ok(
      strings.json.lang.continueWatching && strings.json.fallback.continueWatching,
      'the texts are missing'
    );

    var homeRows = (await request('/app/home')).json.rows;
    var row = homeRows.filter(function (r) {
      return r.catalog;
    })[0];
    assert.ok(
      row && /\/catalog\/series\/popular\.json$/.test(row.catalog.url),
      "the addon's catalog is not on Home"
    );

    var cat = await request('/app/catalog?' + new URLSearchParams(row.catalog).toString());
    assert.strictEqual(cat.json.items[0].id, 'tst1', 'the catalog titles did not come');

    var title = await request('/app/meta?type=series&id=tst1');
    assert.strictEqual(title.json.meta.name, 'Test Show', 'the title did not come');
    assert.ok(title.json.episodes, 'the episodes were not arranged');

    /* the title page: seasons, episodes, the episode it opens on and its buttons */
    var page = (await request('/app/title?type=series&id=tst1')).json.title;
    assert.strictEqual(
      page.series.seasons[0].episodes.length,
      2,
      'the episodes of the title page are missing'
    );
    assert.strictEqual(
      page.series.landing,
      'tst1:1:1',
      'the page does not open on the first unwatched episode'
    );
    assert.deepStrictEqual(
      page.actions.map(function (a) {
        return a.kind;
      }),
      ['episode', 'best', 'similar', 'library'],
      'the title buttons are not the web interface ones'
    );

    /* sources: asked again with the version in hand until every addon answered */
    var have = 0,
      found = null;
    for (var i = 0; i < 5 && !(found && found.done); i++) {
      found = (
        await request('/app/streams?type=series&vid=' + encodeURIComponent('tst1:1:1') + '&have=' + have)
      ).json;
      have = found.version;
    }
    assert.ok(found.done, 'the sources search did not finish');
    assert.strictEqual(found.items.length, 2, 'the sources did not come');
    assert.ok(
      found.chips.length >= 3 && found.items[0].tags.length,
      'the chips and tags of the sources are missing'
    );
    assert.ok(
      found.chips.some(function (c) {
        return c.key === '4K';
      }),
      'the source quality was not read'
    );
    var only4k = (
      await request('/app/streams?type=series&vid=' + encodeURIComponent('tst1:1:1') + '&have=0&quality=4K')
    ).json;
    assert.strictEqual(only4k.items.length, 1, 'the quality chip did not filter the sources');
    var plain = found.items.filter(function (it) {
      return !it.compat;
    })[0];
    assert.strictEqual(found.best, plain.seq, 'Best did not pick the source without a warning');
    assert.ok(found.bestNow && !found.left, 'with every addon answered, Best still waited');
    var oneAddon = (
      await request('/app/streams?type=series&vid=' + encodeURIComponent('tst1:1:1') + '&have=0&addon=Other')
    ).json;
    assert.ok(
      !oneAddon.items.length && !found.addons.length,
      'the addon filter did not filter, or one addon had tabs'
    );

    /* the TV could not decode the DTS source's audio: DTS is kept, and the list warns of it */
    await request(
      '/app/play?type=series&id=tst1&vid=' + encodeURIComponent('tst1:1:1') + '&seq=' + only4k.items[0].seq
    );
    var learned = (await request('/app/learn', { what: 'audio' })).json;
    assert.deepStrictEqual(learned.learned, ['DTS'], 'the audio the TV could not play was not kept');
    var warned = (
      await request('/app/streams?type=series&vid=' + encodeURIComponent('tst1:1:1') + '&have=0&again=1')
    ).json;
    for (var w = 0; !warned.done && w < 20; w++)
      warned = (
        await request(
          '/app/streams?type=series&vid=' + encodeURIComponent('tst1:1:1') + '&have=' + warned.version
        )
      ).json;
    assert.ok(
      warned.items.some(function (it) {
        return /DTS/.test(it.compat) && it.compat !== only4k.items[0].compat;
      }),
      'a source with the audio this TV could not play was not marked'
    );

    /* playing a source, then reports up to 70 % really played: watched, as in the web player */
    var started = (
      await request(
        '/app/play?type=series&id=tst1&vid=' + encodeURIComponent('tst1:1:1') + '&seq=' + found.items[0].seq
      )
    ).json;
    assert.ok(/^http/.test(started.info.URL) && started.ref, 'the chosen source did not start');
    var again = await request(
      '/app/play?type=series&id=tst1&vid=' + encodeURIComponent('tst1:1:1') + '&resume=1'
    );
    assert.strictEqual(again.json.ref, started.ref, 'the last source was not offered again');
    for (var t = 0; t <= 80000; t += 10000)
      await request('/app/progress', {
        type: 'series',
        id: 'tst1',
        vid: 'tst1:1:1',
        name: 'Test Show',
        time: t,
        duration: 100000,
        event: 'tick'
      });
    await wait(700);
    var kept = JSON.parse(fs.readFileSync(path.join(home, '.stremcompat', 'app-state.json'), 'utf8'));
    var item = JSON.parse(kept.lib_u1_tst1 || 'null');
    assert.ok(
      item && item.state.flaggedWatched === 1 && item.state.timeOffset === 80000,
      'the progress was not kept like the web player keeps it'
    );

    /* adding to the library, as the card menu does */
    var added = (
      await request('/app/act', {
        action: 'library',
        item: { id: 'tst2', type: 'movie', name: 'Other Show' }
      })
    ).json;
    assert.ok(
      added.inLibrary && added.message,
      'adding to the library did not answer like the web interface: ' + JSON.stringify(added)
    );

    /* live channels: an M3U list read in one pass, its names, groups and the players' headers */
    var live = require(path.join(serviceDir, 'server', 'app-channels.js'));
    var m3u = live.parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-logo="http://l/a.png" group-title="News, World",Channel A, HD\n' +
        '#EXTVLCOPT:http-user-agent=Box/1\nhttp://s/a.m3u8\n#EXTINF:-1,B\nhttp://s/b.ts|Referer=http%3A%2F%2Fr%2F\n'
    );
    assert.deepStrictEqual(
      [
        m3u.groups[0].title,
        m3u.groups[0].channels[0].n,
        m3u.groups[0].channels[0].u,
        m3u.groups[0].channels[0].h
      ],
      ['News, World', 'Channel A, HD', 'http://s/a.m3u8', { 'User-Agent': 'Box/1' }],
      'an M3U list was not read'
    );
    assert.deepStrictEqual(
      m3u.groups[1].channels[0].h,
      { Referer: 'http://r/' },
      'headers in the address were lost'
    );
    var startedAt = Date.now(),
      big = live.parseM3u(bigList());
    assert.ok(big.count === CHANNELS && big.groups.length === 40, 'a big list was cut or grouped wrong');
    assert.ok(
      Date.now() - startedAt < 1500,
      'a 20 000 channel list took too long to read: ' + (Date.now() - startedAt) + ' ms'
    );
    assert.strictEqual(
      live.guideTime('20261114120000 +0300'),
      Date.UTC(2026, 10, 14, 9, 0, 0),
      'a guide time ignored its offset'
    );
    assert.ok(
      (await request('/app/channels')).json.groups.length === 2,
      "the addon's channel categories are not the channel groups"
    );
    var newsPage = (await request('/app/channels/group?id=' + encodeURIComponent('a:0:News'))).json;
    assert.strictEqual(newsPage.channels[0].name, 'News One', "an addon category's channels did not come");
    var listAdded = (await request('/app/channels/lists', { url: addonBase + '/list.m3u', name: 'Big' }))
      .json;
    assert.ok(listAdded.ok, 'a list could not be listAdded: ' + JSON.stringify(listAdded));
    var lineup = (await request('/app/channels')).json;
    var firstGroup = lineup.groups.filter(function (g) {
      return g.kind === 'm3u';
    })[0];
    assert.ok(
      lineup.lists[0].count === CHANNELS && firstGroup.count === CHANNELS / 40,
      'the list summary is wrong'
    );
    var chPage = (await request('/app/channels/group?id=' + encodeURIComponent(firstGroup.id))).json;
    assert.ok(chPage.channels.length === 60 && chPage.more, 'channels did not come a chPage at a time');
    var second = (await request('/app/channels/group?id=' + encodeURIComponent(firstGroup.id) + '&skip=60'))
      .json;
    assert.strictEqual(second.channels[0].name, 'Canal 2400', 'the next chPage did not follow');
    for (var gw = 0; gw < 50 && !chPage.channels[0].now; gw++) {
      await wait(100);
      chPage = (await request('/app/channels/group?id=' + encodeURIComponent(firstGroup.id))).json;
    }
    assert.strictEqual(chPage.channels[0].now, 'Jornal & Cia', 'what is on now was not read from the guide');
    var foundCh = (await request('/app/channels/group?id=search&q=' + encodeURIComponent('canal 1999'))).json
      .channels;
    assert.ok(
      foundCh.some(function (c) {
        return c.name === 'Canal 1999';
      }) &&
        foundCh.some(function (c) {
          return c.name === 'Sport Max';
        }) === false,
      'the search did not find the channel'
    );
    var sports = (await request('/app/channels/group?id=search&q=sport')).json.channels;
    assert.ok(
      sports.some(function (c) {
        return c.name === 'Sport Max';
      }),
      "the search did not ask the addon's own search"
    );
    var chStarted = (await request('/app/channels/play?key=' + encodeURIComponent(chPage.channels[0].key)))
      .json;
    assert.ok(
      chStarted.ref && /\/proxy\?ref=/.test(chStarted.url),
      'a channel did not become a stream reference'
    );
    assert.strictEqual(
      (await request('/app/channels')).json.recent[0].name,
      'Canal 0',
      'the channel played is not among the recent ones'
    );
    /* a live channel is watched, never kept */
    var liveTick = (
      await request('/app/progress', {
        type: 'tv',
        id: 'tvn1',
        vid: 'tvn1',
        duration: 3600000,
        time: 600000,
        event: 'tick'
      })
    ).json;
    assert.strictEqual(liveTick.kept, false, 'a live channel was kept in the library');

    /* an address from the phone: a chPage of its own, behind a code, for one address */
    var phone = (await request('/app/phone/start', {})).json;
    if (phone.ok) {
      var phonePath = phone.url.replace(/^http:\/\/[^/]+/, ''),
        phonePort = +/:(\d+)\//.exec(phone.url)[1];
      function phoneRequest(pathName, body) {
        return new Promise(function (resolve) {
          var req = http.request(
            { hostname: '127.0.0.1', port: phonePort, path: pathName, method: body ? 'POST' : 'GET' },
            function (res) {
              var chunks = [];
              res.on('data', function (d) {
                chunks.push(d);
              });
              res.on('end', function () {
                resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
              });
            }
          );
          req.on('error', function () {
            resolve({ status: 0, text: '' });
          });
          req.end(body);
        });
      }
      assert.strictEqual(
        (await phoneRequest('/wrongcode')).status,
        404,
        'the phone chPage opened without its code'
      );
      assert.ok(/<form/.test((await phoneRequest(phonePath)).text), 'the phone chPage has no form');
      await phoneRequest(phonePath, 'value=' + encodeURIComponent('javascript:alert(1)'));
      assert.ok((await request('/app/phone/poll')).json.waiting, 'an address that is not http(s) was taken');
      await phoneRequest(phonePath, 'value=' + encodeURIComponent('https://example.com/list.m3u'));
      assert.strictEqual(
        (await request('/app/phone/poll')).json.value,
        'https://example.com/list.m3u',
        'the address from the phone did not reach the TV'
      );
      assert.ok(
        (await request('/app/phone/poll')).json.closed,
        'the phone chPage stayed open after its address'
      );
      assert.strictEqual(
        (await phoneRequest(phonePath)).status,
        0,
        'the phone chPage still answers after its address'
      );
    }

    var removed = (await request('/app/channels/lists', { remove: addonBase + '/list.m3u' })).json;
    assert.ok(
      removed.ok && !(await request('/app/channels')).json.lists.length,
      'a list could not be removed'
    );
    assert.ok((await request('/app/calendar')).json.days, 'the calendar did not answer');

    var diagLines = (await request('/app/diag')).json.lines;
    assert.ok(diagLines.length > 3, 'the diagnostics did not come as lines');
    assert.ok((await request('/app/support')).json.qr.length > 20, 'the support QR did not come');

    /* Settings: the web groups, and a value kept */
    var set = (await request('/app/settings')).json;
    assert.ok(set.groups.length > 3, 'the Settings groups are missing');
    var changed = (await request('/app/settings', { k: 'seekStep', v: '30' })).json;
    var step = [].concat
      .apply(
        [],
        changed.groups.map(function (g) {
          return g.items;
        })
      )
      .filter(function (i) {
        return i.k === 'seekStep';
      })[0];
    assert.strictEqual(step.chosen, '30', 'a Settings value was not kept');

    var poster = await request('/app/img?u=' + encodeURIComponent(meta.poster));
    assert.ok(poster.status === 200 && poster.text.length > 0, 'a JPEG did not pass through /app/img');
    var nothing = await request('/app/img?u=' + encodeURIComponent('file:///etc/passwd'));
    assert.strictEqual(nothing.status, 404, '/app/img read something other than a web address');
    assert.ok(
      addonSeen.requests > 4 && addonSeen.connections < addonSeen.requests / 2,
      'the connections to the addon were not used again: ' + JSON.stringify(addonSeen)
    );

    console.log(
      'OK: storage handed over, account, texts, Home rows, catalog, title with episodes, title page, sources as they arrive, playing and progress, library, channels, calendar, settings, pictures.'
    );
  } catch (e) {
    console.error(log.slice(-3000));
    throw e;
  } finally {
    child.kill();
    addon.close();
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
