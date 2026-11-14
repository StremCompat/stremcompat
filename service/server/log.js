// Append-only diagnostic log (local server.log).

var fs = require('fs');
var { LOG_FILE } = require('./config');

var LOG_MAX = 1024 * 1024;
var written = 0;
/* the log keeps about its last megabyte: past it, the old half goes */
function dbg(m) {
  var line = new Date().toISOString() + ' ' + m + '\n';
  try {
    fs.appendFileSync(LOG_FILE, line);
    written += line.length;
    if (written < 65536) return;
    written = 0;
    if (fs.statSync(LOG_FILE).size > LOG_MAX) {
      var text = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, text.slice(text.length - LOG_MAX / 2));
    }
  } catch (e) {}
}

module.exports = {
  dbg: dbg
};
