'use strict';

// Writes the Homebrew Channel repository of this app, for GitHub Pages: the list the channel reads,
// the manifest it and the app's update check read, the icon and the package. Anyone can add its address
// in the channel's settings; it needs nobody's approval.
//
// Usage: node scripts/make-homebrew-repo.js <the .ipk> <output folder> <address it will be served from> <profile>
// (a profile with nativeApp, such as lg-native, makes the native app's repository)

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var ipk = process.argv[2];
var out = process.argv[3];
/* the profile is required: app/appinfo.json is only a template, its version is not the release's */
if (!ipk || !out || !process.argv[4] || !process.argv[5])
  throw new Error('Usage: node make-homebrew-repo.js <the .ipk> <output folder> <address> <profile>');
var base = process.argv[4].replace(/\/$/, '');
var profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', process.argv[5] + '.json'), 'utf8'));
var native = !!profile.nativeApp;
var id = profile.appId;
var version = profile.version;
var title = profile.title;
var fileName = id + '_' + version + (native ? '_arm.ipk' : '_all.ipk');
var data = fs.readFileSync(ipk);
var summary = native
  ? 'The native StremCompat: faster, drawn by the TV itself, still in test. Your Stremio or Nuvio account and addons, no root.'
  : 'Your Stremio or Nuvio account and addons on older LG TVs (webOS 3 and newer). Unofficial, and it needs no root.';

var manifest = {
  id: id,
  version: version,
  type: native ? 'native' : 'web',
  title: title,
  appDescription: summary,
  iconUri: base + '/icon.png',
  sourceUrl: 'https://github.com/StremCompat/stremcompat',
  rootRequired: false,
  ipkUrl: base + '/' + fileName,
  ipkHash: { sha256: crypto.createHash('sha256').update(data).digest('hex') }
};
var listing = {
  paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1 },
  packages: [
    {
      id: id,
      title: title,
      iconUri: manifest.iconUri,
      pool: 'main',
      manifestUrl: base + '/api/apps/' + id + '/manifest.json',
      shortDescription: summary,
      fullDescriptionUrl: 'api/apps/' + id + '/full_description.html',
      manifest: manifest
    }
  ]
};

function write(relative, content) {
  var file = path.join(out, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

write(fileName, data);
write('icon.png', fs.readFileSync(path.join(root, 'app', 'icon.png')));
write('apps.json', JSON.stringify(listing, null, 2) + '\n');
write('api/apps.json', JSON.stringify(listing, null, 2) + '\n');
write('api/apps/' + id + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
write(
  'api/apps/' + id + '/full_description.html',
  '<p>' +
    summary +
    '</p><p><a href="' +
    manifest.sourceUrl +
    '">Source, compatibility list and notes</a></p>\n'
);
write(
  'index.html',
  '<!doctype html><meta charset="utf-8"><title>StremCompat repository</title><p>Homebrew Channel repository of <a href="' +
    manifest.sourceUrl +
    '">StremCompat</a>. Add this address in the channel\'s settings:</p><pre>' +
    base +
    '/apps.json</pre>\n'
);
console.log('Homebrew repository of ' + id + ' ' + version + ' written to ' + out);
