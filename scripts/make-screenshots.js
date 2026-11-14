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
      pending = {};
    socket.onopen = function () {
      socket.onmessage = function (event) {
        var m = JSON.parse(event.data);
        if (m.id && pending[m.id]) {
          var p = pending[m.id];
          delete pending[m.id];
          if (m.error) p.reject(new Error(m.error.message));
          else p.resolve(m.result);
        }
      };
      resolve({
        call: function (method, params) {
          return new Promise(function (ok, bad) {
            var id = next++;
            pending[id] = { resolve: ok, reject: bad };
            socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
          });
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
    function run(js) {
      return protocol.call('Runtime.evaluate', { expression: js });
    }
    function key(code) {
      return run("(function(){var e=document.createEvent('Event');e.initEvent('keydown',true,true);e.keyCode=" + code + ';document.dispatchEvent(e);})()');
    }
    await protocol.call('Page.navigate', { url: 'http://127.0.0.1:' + appPort + '/beta?shots=1' });
    await delay(8000);
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
