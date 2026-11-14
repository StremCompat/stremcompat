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
  types: ['series'],
  idPrefixes: ['tst'],
  catalogs: [{ type: 'series', id: 'popular', name: 'Popular' }]
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
  '/stream/series/tst1%3A1%3A1.json': {
    streams: [
      { name: 'Test\n1080p', title: 'Show.S01E01.1080p.WEB.x264', url: addonBase + '/a.mp4' },
      { name: 'Test\n4K', title: 'Show.S01E01.2160p.WEB.HEVC', url: addonBase + '/b.mp4' }
    ]
  }
};

/* the start of a JPEG is all /app/img looks at */
var POSTER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);

function addonServer() {
  return http.createServer(function (req, res) {
    if (req.url === '/poster.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(POSTER);
    }
    var answer = answers[req.url.split('?')[0]];
    res.writeHead(answer ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answer || { error: 'not found' }));
  });
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

    /* live channels: an M3U list is read with its groups and logos; none yet says what to do */
    var m3u = require(path.join(serviceDir, 'server', 'app-channels.js')).parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-logo="http://l/a.png" group-title="News",Channel A\nhttp://s/a.m3u8\n'
    );
    assert.deepStrictEqual(
      [m3u.channels[0].name, m3u.channels[0].group, m3u.channels[0].url],
      ['Channel A', 'News', 'http://s/a.m3u8'],
      'an M3U list was not read'
    );
    assert.ok(
      (await request('/app/channels')).json.empty,
      'with no channels the screen does not say what to do'
    );
    assert.ok((await request('/app/calendar')).json.days, 'the calendar did not answer');

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
