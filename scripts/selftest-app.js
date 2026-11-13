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

function addonServer() {
  return http.createServer(function (req, res) {
    var answer = answers[req.url.split('?')[0]];
    res.writeHead(answer ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answer || { error: 'not found' }));
  });
}

async function main() {
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
      found.items.some(function (s) {
        return s.quality === '4K';
      }),
      'the source quality was not read'
    );

    console.log(
      'OK: storage handed over, account, texts, Home rows, catalog, title with episodes, sources as they arrive.'
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
