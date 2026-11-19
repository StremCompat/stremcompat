'use strict';

// What the Android and iOS packages share: nodejs-mobile's Node for the platform (downloaded once
// into .cache), the local server staged with the android-tv profile, and the torrent engine
// (WebTorrent, bundled into one file: platforms/android/engine).

var cp = require('child_process');
var fs = require('fs');
var https = require('https');
var path = require('path');

var root = path.resolve(__dirname, '..', '..');
var PROFILE = 'android-tv';
var NODE_VERSION = 'v18.20.4';

function run(command, args, options) {
  /* Windows runs .bat files only through its shell */
  var r = cp.spawnSync(
    command,
    args,
    Object.assign({ stdio: 'inherit', shell: /\.bat$/.test(command) }, options || {})
  );
  if (r.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' failed');
}

function download(url, file) {
  return new Promise(function (ok, bad) {
    https
      .get(url, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return download(res.headers.location, file).then(ok, bad);
        if (res.statusCode !== 200) return bad(new Error(url + ': ' + res.statusCode));
        var out = fs.createWriteStream(file);
        res.pipe(out);
        out.on('finish', function () {
          out.close(ok);
        });
      })
      .on('error', bad);
  });
}

/* nodejs-mobile for 'android' or 'ios', unpacked once; answers its folder. `ready` is a file that
   exists once it is unpacked. */
async function nodeMobile(platform, ready) {
  var cache = path.join(root, '.cache', 'nodejs-mobile-' + NODE_VERSION + '-' + platform);
  if (fs.existsSync(path.join(cache, ready))) return cache;
  fs.mkdirSync(cache, { recursive: true });
  var zipName = 'nodejs-mobile-' + NODE_VERSION + '-' + platform + '.zip',
    zip = path.join(cache, zipName),
    url = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/' + NODE_VERSION + '/' + zipName;
  console.log('Downloading ' + url);
  await download(url, zip);
  /* bsdtar opens zip files; on Windows it is the system's own, not the tar of Git's tools */
  run(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', [
    '-xf',
    zip,
    '-C',
    cache
  ]);
  var inner = path.join(cache, 'nodejs-mobile');
  if (fs.existsSync(inner)) {
    fs.readdirSync(inner).forEach(function (name) {
      fs.renameSync(path.join(inner, name), path.join(cache, name));
    });
    fs.rmdirSync(inner);
  }
  fs.unlinkSync(zip);
  return cache;
}

/* the pages and the local server into `dest`, without the TV's programs and leftovers, and the
   torrent engine bundled next to them; answers the profile */
function stageService(dest) {
  run(process.execPath, [path.join(root, 'scripts', 'build-ui.js')]);
  run(process.execPath, [path.join(root, 'scripts', 'build-stage.js'), PROFILE]);
  var service = path.join(root, '.build', PROFILE, 'service');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(service, dest, {
    recursive: true,
    filter: function (source) {
      var name = path.relative(service, source).split(path.sep)[0];
      return name !== 'bin' && name !== 'subcache' && name !== '.imgcache' && !/\.log$/i.test(source);
    }
  });
  /* esbuild's own interface: its command is a script on Windows and a program on macOS */
  require('esbuild').buildSync({
    entryPoints: [path.join(root, 'platforms', 'android', 'engine', 'torrent-engine.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    logLevel: 'warning',
    external: ['utp-native', 'bufferutil', 'utf-8-validate', 'wrtc'],
    outfile: path.join(dest, 'engine', 'torrent-engine.js')
  });
  return JSON.parse(fs.readFileSync(path.join(root, 'profiles', PROFILE + '.json'), 'utf8'));
}

module.exports = { root: root, run: run, nodeMobile: nodeMobile, stageService: stageService };
