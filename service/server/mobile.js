// The phone interface (service/mobile): its three files, served at /m/ next to the API it uses.

var fs = require('fs');
var path = require('path');
var { DIR } = require('./config');

var FILES = {
  '/m/': ['index.html', 'text/html; charset=utf-8'],
  '/m/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/m/mobile.css': ['mobile.css', 'text/css; charset=utf-8'],
  '/m/mobile.js': ['mobile.js', 'application/javascript; charset=utf-8']
};

function isMobilePath(pathname) {
  return pathname === '/m' || pathname.indexOf('/m/') === 0;
}

function mobileFile(req, res, pathname) {
  if (pathname === '/m') {
    res.writeHead(302, { Location: '/m/' });
    return res.end();
  }
  var file = FILES[pathname];
  if (!file) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(path.join(DIR, 'mobile', file[0]), function (err, buf) {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

module.exports = {
  isMobilePath: isMobilePath,
  mobileFile: mobileFile
};
