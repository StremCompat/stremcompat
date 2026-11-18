// The phone interface (service/mobile): its page, styles, modules and fonts, served at /m/ next
// to the API it uses. Only files inside that folder, of the kinds below, are answered.

var fs = require('fs');
var path = require('path');
var { DIR } = require('./config');

var ROOT = path.join(DIR, 'mobile');
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

function isMobilePath(pathname) {
  return pathname === '/m' || pathname.indexOf('/m/') === 0;
}

/* the file a /m/ address names, or '' when it would leave the folder or is not served */
function fileOf(pathname) {
  var rel;
  try {
    rel = decodeURIComponent(pathname.slice(3)) || 'index.html';
  } catch (e) {
    return '';
  }
  if (rel.indexOf('\0') >= 0 || !TYPES[path.extname(rel).toLowerCase()]) return '';
  var full = path.resolve(ROOT, rel);
  return full.indexOf(ROOT + path.sep) === 0 ? full : '';
}

function mobileFile(req, res, pathname) {
  if (pathname === '/m') {
    res.writeHead(302, { Location: '/m/' });
    return res.end();
  }
  var file = fileOf(pathname);
  if (!file) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(file, function (err, buf) {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
}

module.exports = {
  isMobilePath: isMobilePath,
  mobileFile: mobileFile,
  fileOf: fileOf
};
