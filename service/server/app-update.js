// /app/update: installing a newer version from inside the app. The server downloads the package
// named by the update manifest and checks its SHA-256; the app then asks its own service
// (launch.js, method install) to hand it to the system installer, which reopens the app.

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var { DIR } = require('./config');
var { fetchUrl, sendJson } = require('./http-util');
var { newerVersion } = require('./update-check');

var PACKAGE_LIMIT = 80 * 1024 * 1024;

function packagePath() {
  return path.join(process.env.HOME || DIR, '.stremcompat', 'update.ipk');
}

var job = { state: 'idle', version: '', error: '' }; /* idle, downloading, ready, failed */

/* GET: whether there is a newer version and how its download goes; POST: download it */
function update(req, res) {
  newerVersion(function (info) {
    if (req.method !== 'POST' || !info.version) {
      return sendJson(res, {
        current: info.current,
        version: info.version || '',
        state: job.state,
        error: job.error,
        path: job.state === 'ready' ? packagePath() : ''
      });
    }
    if (job.state === 'downloading') return sendJson(res, { state: job.state });
    job = { state: 'downloading', version: info.version, error: '' };
    sendJson(res, { state: job.state });
    fetchUrl(
      info.ipkUrl,
      function (body) {
        if (!body) return (job = { state: 'failed', version: info.version, error: 'download' });
        var sum = crypto.createHash('sha256').update(body).digest('hex');
        if (info.sha256 && sum.toLowerCase() !== String(info.sha256).toLowerCase())
          return (job = { state: 'failed', version: info.version, error: 'checksum' });
        try {
          fs.mkdirSync(path.dirname(packagePath()), { recursive: true });
          fs.writeFileSync(packagePath(), body);
          job = { state: 'ready', version: info.version, error: '' };
        } catch (e) {
          job = { state: 'failed', version: info.version, error: 'disk' };
        }
      },
      0,
      PACKAGE_LIMIT
    );
  });
}

module.exports = {
  packagePath: packagePath,
  routes: { '/app/update': update }
};
