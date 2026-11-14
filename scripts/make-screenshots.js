'use strict';

// The README screenshots of the web interface, from the real interface at 1920x1080: the staged
// server with Cinemeta and the official addons as a demo account would have them, opened in
// headless Chrome (nothing shows on screen). Writes docs/assets/screens/<name>.jpg.
//
// Usage: node scripts/make-screenshots.js <stage folder> <port>
//   (after powershell scripts/build.ps1 -Profile lg-armv7-1080 -SkipPackage; stop other servers first)

var childProcess = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var root = path.resolve(__dirname, '..');
var stage = path.resolve(process.argv[2] || path.join(root, '.build', 'lg-armv7-1080'));
var appPort = parseInt(process.argv[3], 10) || 8082;
var chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var out = path.join(root, 'docs', 'assets', 'screens');
/* a new release for Home's featured titles (The Odyssey, 2026) */
var FEATURED_ID = 'tt33764258';
var W = 1920,
  H = 1080;

function delay(ms) {
  return new Promise(function (ok) {
    setTimeout(ok, ms);
  });
}
function getJson(port, pathname) {
  return new Promise(function (ok, bad) {
    var req = http.get({ hostname: '127.0.0.1', port: port, path: pathname }, function (res) {
      var chunks = [];
      res.on('data', function (d) {
        chunks.push(d);
      });
      res.on('end', function () {
        try {
          ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          bad(e);
        }
      });
    });
    req.setTimeout(3000, function () {
      req.destroy(new Error('timeout'));
    });
    req.on('error', bad);
  });
}
async function waitJson(port, pathname) {
  for (var i = 0; i < 150; i++) {
    try {
      return await getJson(port, pathname);
    } catch (e) {
      await delay(150);
    }
  }
  throw new Error('no answer on ' + port + pathname);
}
function post(pathname, body) {
  return new Promise(function (ok) {
    var req = http.request({ hostname: '127.0.0.1', port: appPort, path: pathname, method: 'POST' }, function (res) {
      res.resume();
      res.on('end', ok);
    });
    req.on('error', ok);
    req.end(JSON.stringify(body));
  });
}
function devtools(url) {
  return new Promise(function (resolve, reject) {
    var socket = new WebSocket(url),
      next = 1,
      pending = {},
      handlers = {};
    socket.onopen = function () {
      socket.onmessage = function (event) {
        var m = JSON.parse(event.data);
        if (m.id && pending[m.id]) {
          var p = pending[m.id];
          delete pending[m.id];
          if (m.error) p.reject(new Error(m.error.message));
          else p.resolve(m.result);
        } else if (m.method && handlers[m.method]) handlers[m.method](m.params);
      };
      resolve({
        call: function (method, params) {
          return new Promise(function (ok, bad) {
            var id = next++;
            pending[id] = { resolve: ok, reject: bad };
            socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
          });
        },
        on: function (method, handler) {
          handlers[method] = handler;
        },
        close: function () {
          socket.close();
        }
      });
    };
    socket.onerror = function () {
      reject(new Error('DevTools websocket failed'));
    };
  });
}

/* GET a JSON address, following redirects; null when it fails */
function fetchJson(address, hops) {
  return new Promise(function (ok) {
    var lib = /^https:/.test(address) ? require('https') : http;
    var req = lib.get(address, { headers: { 'User-Agent': 'StremCompat-screenshots' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 4) {
        res.resume();
        return ok(fetchJson(new URL(res.headers.location, address).href, (hops || 0) + 1));
      }
      var chunks = [];
      res.on('data', function (d) {
        chunks.push(d);
      });
      res.on('end', function () {
        try {
          ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          ok(null);
        }
      });
    });
    req.on('error', function () {
      ok(null);
    });
  });
}
/* a made-up channel list, so no real channel shows in the pictures */
function demoList() {
  var groups = { News: 6, Movies: 9, Series: 8, Kids: 7, Sports: 5, Music: 6, Documentary: 5, Cooking: 4 };
  var lines = ['#EXTM3U'];
  Object.keys(groups).forEach(function (g) {
    for (var i = 1; i <= groups[g]; i++)
      lines.push('#EXTINF:-1 group-title="' + g + '",Demo ' + g + ' ' + i, 'http://127.0.0.1/demo/' + g.toLowerCase() + i + '.m3u8');
  });
  return lines.join('\n') + '\n';
}

async function main() {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-shots-')),
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-shots-chrome-')),
    debugPort = 9300 + Math.floor(Math.random() * 400);
  var server = childProcess.spawn(process.execPath, [path.join(stage, 'service', 'local-server.js')], {
    cwd: stage,
    windowsHide: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { HOME: home, SC_SERVER_LOG: path.join(home, 'server.log'), SC_PHONE_HOST: '127.0.0.1' })
  });
  var browser, protocol, listServer;
  try {
    await waitJson(appPort, '/health');
    /* the addons a new Stremio account has */
    var official = await fetchJson('https://api.strem.io/addonsofficialcollection.json');
    /* without the YouTube channels addon, whose rows would show real channels */
    official = (official || []).filter(function (a) {
      return !/stremiochannels/.test((a.manifest && a.manifest.id) || '');
    });
    /* a film the Public Domain Movies addon has sources for */
    var pd = await fetchJson('https://caching.stremio.net/publicdomainmovies.now.sh/catalog/movie/publicdomainmovies.json');
    var publicDomainId = (pd && pd.metas && pd.metas[0] && pd.metas[0].id) || 'tt0012349';
    /* live channels from a made-up list, served here */
    listServer = http.createServer(function (req, res) {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      res.end(demoList());
    });
    await new Promise(function (ok) {
      listServer.listen(0, '127.0.0.1', ok);
    });
    await post('/app/channels/lists', { url: 'http://127.0.0.1:' + listServer.address().port + '/demo.m3u', name: 'Demo channels' });
    /* Nuvio's own avatars, for the profiles and the profile in use */
    var avatarRows = await new Promise(function (ok) {
      var key = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
      var req = require('https').request(
        'https://api.nuvio.tv/rest/v1/rpc/get_avatar_catalog',
        { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } },
        function (res) {
          var chunks = [];
          res.on('data', function (d) {
            chunks.push(d);
          });
          res.on('end', function () {
            try {
              ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (e) {
              ok([]);
            }
          });
        }
      );
      req.on('error', function () {
        ok([]);
      });
      req.end('{}');
    });
    var avatars = (avatarRows || []).slice(0, 4).map(function (row) {
      return { url: 'https://api.nuvio.tv/storage/v1/object/public/avatars/' + row.storage_path, color: row.bg_color };
    });
    function avatar(i) {
      return avatars[i] || { url: '', color: ['#1E88E5', '#43A047', '#FB8C00', '#8E24AA'][i] };
    }
    browser = childProcess.spawn(
      chrome,
      ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--lang=en-US', '--remote-debugging-port=' + debugPort,
        '--window-size=' + W + ',' + H, '--user-data-dir=' + profile, 'http://127.0.0.1:' + appPort + '/beta'],
      { windowsHide: true, stdio: 'ignore' }
    );
    var pages = await waitJson(debugPort, '/json');
    var page = pages.filter(function (p) {
      return p.type === 'page';
    })[0];
    protocol = await devtools(page.webSocketDebuggerUrl);
    await protocol.call('Page.enable');
    await protocol.call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await delay(1500);
    var seed =
      "localStorage.setItem('user',JSON.stringify({_id:'demo-user',email:'demo@example.com'}));" +
      "localStorage.setItem('authKey',JSON.stringify('demo-key'));localStorage.setItem('setupDone','1');" +
      "localStorage.setItem('signedInFor40','1');localStorage.setItem('uiLanguage','en-US');" +
      "localStorage.setItem('addons'," + JSON.stringify(JSON.stringify(official)) + ');';
    await protocol.call('Runtime.evaluate', { expression: seed });
    /* the profile in use, with its picture, as a Nuvio profile shows in the menu */
    function showFace() {
      var a = avatar(0);
      return protocol.call('Runtime.evaluate', {
        expression:
          "(function(){var f=document.getElementById('navFace'),n=document.getElementById('navName');if(!f)return;" +
          "f.style.backgroundColor='" + a.color + "';f.textContent='A';if(n)n.textContent='Ana';" +
          (a.url ? "var i=new Image();i.onload=function(){f.textContent='';f.appendChild(i);};i.src='" + a.url + "';" : '') +
          '})()'
      });
    }
    async function shot(name, wait) {
      await showFace();
      await delay(wait || 2500);
      var s = await protocol.call('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(s.data, 'base64'));
      console.log('  ' + name + '.jpg');
    }
    async function run(js) {
      var r = await protocol.call('Runtime.evaluate', { expression: js });
      if (r.exceptionDetails) console.log('  (page error: ' + (r.exceptionDetails.exception || {}).description + ')');
      return r;
    }
    function key(code) {
      return run("(function(){var e=document.createEvent('Event');e.initEvent('keydown',true,true);e.keyCode=" + code + ';document.dispatchEvent(e);})()');
    }
    function open(hash) {
      return protocol.call('Page.navigate', { url: 'http://127.0.0.1:' + appPort + '/beta?shots=1' + (hash || '') });
    }
    /* Home with its featured titles; the popular films start with a new release (its real Cinemeta
       data, put first here so the picture shows it) */
    var featuredMeta = await fetchJson('https://v3-cinemeta.strem.io/meta/movie/' + FEATURED_ID + '.json');
    var featured = featuredMeta && featuredMeta.meta ? Object.assign({ id: FEATURED_ID }, featuredMeta.meta) : null;
    if (!featured) console.log('  (could not read the featured title)');
    var profiles = [
      { index: 1, name: 'Ana', color: avatar(0).color, avatar: avatar(0).url, current: true },
      { index: 2, name: 'Bruno', color: avatar(1).color, avatar: avatar(1).url },
      { index: 3, name: 'Kids', color: avatar(2).color, avatar: avatar(2).url },
      { index: 4, name: 'Carla', color: avatar(3).color, avatar: avatar(3).url, locked: true }
    ];
    function fulfill(id, body) {
      return protocol.call('Fetch.fulfillRequest', {
        requestId: id,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64')
      });
    }
    protocol.on('Fetch.requestPaused', async function (e) {
        if (/nuvioprofiles/.test(e.request.url)) return fulfill(e.requestId, { profiles: profiles });
      try {
        if (!/catalog\/movie\/top\.json/.test(decodeURIComponent(e.request.url))) throw new Error('not the catalog');
        var r = await protocol.call('Fetch.getResponseBody', { requestId: e.requestId });
        var j = JSON.parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body);
        if (featured && j && j.metas)
          j.metas = [featured].concat(j.metas.filter(function (m) {
            return m.id !== featured.id;
          }));
        fulfill(e.requestId, j);
      } catch (err) {
        if (err.message !== 'not the catalog') console.log('  (featured title not placed: ' + err.message + ')');
        protocol.call('Fetch.continueRequest', { requestId: e.requestId }).catch(function () {});
      }
    });
    if (featured)
      await protocol.call('Fetch.enable', {
        patterns: [{ urlPattern: '*/addon?u=*', requestStage: 'Response' }]
      });
    /* the first page load already cached the catalogs: start Home from the network */
    await run("for(var k=localStorage.length-1;k>=0;k--){var n=localStorage.key(k);if(/^beta_(cat|discover|meta)/.test(n))localStorage.removeItem(n);}");
    await open();
    await delay(4000);
    await showFace();
    await delay(5000);
    /* wait for the featured title to come round, with the posters of the rows below shown (on a
       weak TV only the rows near the focus keep theirs, so a picture taken now would have them blank) */
    for (var wait = 0; wait < 60; wait++) {
      await delay(1000);
      await run("var im=document.querySelectorAll('img');for(var i=0;i<im.length;i++)if(im[i]._full){im[i].src=im[i]._full;im[i]._full=null;}");
      var onHero = await protocol.call('Runtime.evaluate', {
        expression: "document.getElementById('hero').innerHTML.indexOf('" + FEATURED_ID + "')>=0||document.getElementById('heroTitle').textContent==='" + (featured ? featured.name : '') + "'",
        returnByValue: true
      });
      if (onHero.result.value) break;
    }
    await showFace();
    await delay(2500);
    var hero = await protocol.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'docs', 'assets', 'stremcompat-hero-en.png'), Buffer.from(hero.data, 'base64'));
    await shot('home', 100);
    await protocol.call('Fetch.disable');
    /* who is watching, as a Nuvio account with profiles shows it: the profile list is answered above */
    await protocol.call('Fetch.enable', { patterns: [{ urlPattern: '*nuvioprofiles*' }] });
    await run("localStorage.setItem('authKey',JSON.stringify('nuvio:demo'));document.getElementById('chipProfile').click()");
    await shot('profiles', 2500);
    await protocol.call('Fetch.disable');
    await run("localStorage.setItem('authKey',JSON.stringify('demo-key'))");
    await open();
    await delay(9000);
    await run("document.getElementById('chipDisc').click()");
    await delay(5000);
    await key(39);
    await shot('discover', 2500);
    await run("document.getElementById('chipTv').click()");
    await delay(5000);
    await key(39);
    await key(40);
    await shot('channels', 4000);
    await run("document.getElementById('chipAddons').click()");
    await delay(600);
    await run("document.getElementById('aStore').click()");
    await delay(6000);
    /* the Catalogs kind: the first cards of the whole store are torrent addons */
    await key(38);
    for (var c = 0; c < 4; c++) await key(39);
    await key(13);
    await delay(5000);
    await key(40);
    await key(39);
    await shot('store', 2500);
    await run("document.getElementById('chipSet').click()");
    await delay(600);
    await run("var c=document.querySelectorAll('#setCats .setcat');for(var i=0;i<c.length;i++)if(c[i].textContent==='Interface')c[i].click();var r=document.querySelectorAll('#setItems .set');for(var j=0;j<r.length;j++)if(r[j].textContent.indexOf('Organize catalogs')>=0)r[j].click();");
    await shot('organize', 1500);
    await key(461);
    await run("var c=document.querySelectorAll('#setCats .setcat');for(var i=0;i<c.length;i++)if(c[i].textContent==='Channels')c[i].click();var r=document.querySelectorAll('#setItems .set');for(var j=0;j<r.length;j++)if(r[j].textContent.indexOf('Add an M3U list')>=0)r[j].click();");
    await shot('add-list', 3000);
    await key(461);
    await run("var c=document.querySelectorAll('#setCats .setcat');for(var i=0;i<c.length;i++)if(c[i].textContent==='Playback')c[i].click();");
    await key(39);
    await shot('settings', 1500);
    /* a series page with its episodes, from Cinemeta */
    await open('#detail/series/tt0903747');
    await delay(9000);
    await key(40);
    await shot('series', 4000);
    /* the sources of a public domain film, from Stremio's own Public Domain Movies addon */
    await open('#detail/movie/' + publicDomainId);
    await delay(9000);
    /* the button with the whole source list (another one plays the best source at once) */
    await run("var b=document.querySelectorAll('#dBtns > *');for(var i=0;i<b.length;i++)if(/^(Sources|Watch)$/.test(b[i].textContent.trim()))b[i].click();");
    await shot('sources', 8000);
  } finally {
    if (listServer) listServer.close();
    if (protocol) protocol.close();
    if (browser) browser.kill();
    server.kill();
  }
}

main().catch(function (e) {
  console.error(e.stack || e.message);
  process.exit(1);
});
