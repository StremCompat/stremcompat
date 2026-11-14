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

async function main() {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-shots-')),
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-shots-chrome-')),
    debugPort = 9300 + Math.floor(Math.random() * 400);
  var server = childProcess.spawn(process.execPath, [path.join(stage, 'service', 'local-server.js')], {
    cwd: stage,
    windowsHide: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { HOME: home, SC_SERVER_LOG: path.join(home, 'server.log') })
  });
  var browser, protocol;
  try {
    await waitJson(appPort, '/health');
    /* the addons a new Stremio account has */
    var official = await new Promise(function (ok) {
      require('https').get('https://api.strem.io/addonsofficialcollection.json', function (res) {
        var chunks = [];
        res.on('data', function (d) {
          chunks.push(d);
        });
        res.on('end', function () {
          ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        });
      });
    });
    /* a film the Public Domain Movies addon has sources for */
    var publicDomainId = await new Promise(function (ok) {
      require('https').get('https://caching.stremio.net/publicdomainmovies.now.sh/catalog/movie/publicdomainmovies.json', function (res) {
        var chunks = [];
        res.on('data', function (d) {
          chunks.push(d);
        });
        res.on('end', function () {
          try {
            ok(JSON.parse(Buffer.concat(chunks).toString('utf8')).metas[0].id);
          } catch (e) {
            ok('tt0032138');
          }
        });
      }).on('error', function () {
        ok('tt0032138');
      });
    });
    /* live channels from a public list */
    await post('/app/channels/lists', { url: 'https://iptv-org.github.io/iptv/countries/br.m3u', name: 'iptv-org Brasil' });
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
    async function shot(name, wait) {
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
    await open();
    await delay(10000);
    /* the first row in focus, its posters loaded; the README's top picture is Home itself, as a PNG */
    await key(40);
    await delay(6000);
    var hero = await protocol.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'docs', 'assets', 'stremcompat-hero-en.png'), Buffer.from(hero.data, 'base64'));
    await shot('home', 100);
    /* who is watching, as a Nuvio account with profiles shows it: the profile list is answered here */
    var profiles = [
      { index: 1, name: 'Ana', color: '#1E88E5', current: true },
      { index: 2, name: 'Bruno', color: '#43A047' },
      { index: 3, name: 'Kids', color: '#FB8C00' },
      { index: 4, name: 'Carla', color: '#8E24AA', locked: true }
    ];
    protocol.on('Fetch.requestPaused', function (e) {
      protocol.call('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ profiles: profiles })).toString('base64')
      });
    });
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
    await key(39);
    await shot('store', 1500);
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
    if (protocol) protocol.close();
    if (browser) browser.kill();
    server.kill();
  }
}

main().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
