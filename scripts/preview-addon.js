'use strict';

// A stand-in addon for screenshots of the phone apps (iOS simulator, Android emulator): real
// series ids, so the pictures are Stremio's public ones, two seasons of episodes, and sources
// that play native/test-subtitles.mkv served from here.
//
//   node scripts/preview-addon.js [base]           serves on :9293; base is how the app reaches it
//                                                  (default http://127.0.0.1:9293)
//   node scripts/preview-addon.js --account <server> [base]
//                                                  signs a throwaway account in on that local
//                                                  server, with this addon and one title half watched

var fs = require('fs');
var http = require('http');
var path = require('path');

var PORT = 9293;
var VIDEO = path.join(__dirname, '..', 'native', 'test-subtitles.mkv');
var NAMES = [
  'Breaking Bad',
  'Game of Thrones',
  'Stranger Things',
  'The Office',
  'Dark',
  'Chernobyl',
  'The Last of Us',
  'Severance'
];
var IDS = [
  'tt0903747',
  'tt0944947',
  'tt4574334',
  'tt0386676',
  'tt5753856',
  'tt7366338',
  'tt3581920',
  'tt11280740'
];
var manifest = {
  id: 'preview.addon',
  name: 'Preview addon',
  version: '1.0.0',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'series', id: 'popular', name: 'Popular' },
    { type: 'series', id: 'new', name: 'New' }
  ]
};

function metaOf(i) {
  return {
    id: IDS[i],
    type: 'series',
    name: NAMES[i],
    description: 'A story told over several seasons.',
    releaseInfo: String(2010 + i),
    imdbRating: '8.' + i
  };
}

function videos(id) {
  var out = [];
  for (var s = 1; s <= 2; s++)
    for (var e = 1; e <= 5; e++)
      out.push({
        id: id + ':' + s + ':' + e,
        season: s,
        episode: e,
        title: 'Chapter ' + e,
        overview: 'Something changes and nobody says it.',
        released: '2020-0' + s + '-0' + e + 'T00:00:00.000Z'
      });
  return out;
}

function answer(u, base) {
  if (u === '/manifest.json') return manifest;
  var all = IDS.map(function (id, i) {
    return metaOf(i);
  });
  if (/^\/catalog\/series\/(popular|new)/.test(u))
    return { metas: u.indexOf('new') > 0 ? all.reverse() : all };
  var m = /^\/meta\/series\/(tt\d+)\.json/.exec(u);
  if (m && IDS.indexOf(m[1]) >= 0)
    return { meta: Object.assign(metaOf(IDS.indexOf(m[1])), { videos: videos(m[1]), genres: ['Drama'] }) };
  if (/^\/stream\//.test(u))
    return {
      streams: [
        {
          name: 'Preview\n1080p',
          title: 'Show.S01E01.1080p.WEB.x264\n👤 120 💾 1.4 GB',
          url: base + '/video.mkv'
        },
        { name: '[RD+] Preview\n4K', title: 'Show.S01E01.2160p.BluRay.HDR.Atmos', url: base + '/video.mkv' }
      ]
    };
  return null;
}

function serve(base) {
  http
    .createServer(function (req, res) {
      var u = req.url.split('?')[0];
      if (u === '/video.mkv') {
        var buf = fs.readFileSync(VIDEO),
          range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''),
          from = range ? +range[1] : 0,
          to = range && range[2] ? +range[2] : buf.length - 1;
        res.writeHead(range ? 206 : 200, {
          'Content-Type': 'video/x-matroska',
          'Content-Length': to - from + 1,
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes ' + from + '-' + to + '/' + buf.length
        });
        return res.end(buf.slice(from, to + 1));
      }
      var j = answer(u, base);
      res.writeHead(j ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(j || {}));
    })
    .listen(PORT, '0.0.0.0', function () {
      console.log('preview addon on :' + PORT + ' as ' + base);
    });
}

function post(server, route, body) {
  return new Promise(function (ok, bad) {
    var req = http.request(server + route, { method: 'POST' }, function (res) {
      res.resume();
      res.on('end', ok);
    });
    req.on('error', bad);
    req.end(JSON.stringify(body));
  });
}

async function account(server, base) {
  await post(server, '/app/migrate', {
    authKey: JSON.stringify('preview-key'),
    user: JSON.stringify({ _id: 'preview', email: 'viewer@example.com' }),
    addons: JSON.stringify([{ transportUrl: base + '/manifest.json', manifest: manifest }])
  });
  await post(server, '/app/progress', {
    type: 'series',
    id: IDS[0],
    vid: IDS[0] + ':1:2',
    name: NAMES[0],
    time: 900000,
    duration: 2900000,
    event: 'pause'
  });
  console.log('account signed in on ' + server);
}

var args = process.argv.slice(2);
if (args[0] === '--account')
  account(args[1], args[2] || 'http://127.0.0.1:' + PORT).catch(function (e) {
    console.error(e.message);
    process.exit(1);
  });
else serve(args[0] || 'http://127.0.0.1:' + PORT);
