// Sending an address from the phone: typing a long M3U or addon address with a remote is slow,
// so the address panel shows a QR code. On the same Wi-Fi it opens a small page served by the TV
// itself, where the address is pasted and sent. The main server keeps listening only on the TV
// (127.0.0.1); this page has a port of its own, open only while a panel asks for it, for one
// address or five minutes, behind a random code. It takes an http(s) address and nothing else.

var crypto = require('crypto');
var http = require('http');
var os = require('os');
var { PORT } = require('./config');
var { readJsonBody, sendJson } = require('./http-util');
var { qrRows, qrSvg } = require('./qr');
var runtime = require('./app-runtime');

var LINK_PORT = PORT + 10;
var OPEN_MS = 5 * 60 * 1000;
var VALUE_MAX = 2048;
/* the home network; the tests keep it on the computer itself (no firewall question) */
var LINK_HOST = process.env.SC_PHONE_HOST || '0.0.0.0';

var link = null; /* { server, token, value, timer } while a panel waits */

/* the TV's address on the home network */
function homeAddress() {
  var nets = os.networkInterfaces(),
    found = '';
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (!found && n.family === 'IPv4' && !n.internal && /^(10|172|192)\./.test(n.address))
        found = n.address;
    });
  });
  return found;
}

function close() {
  if (!link) return;
  clearTimeout(link.timer);
  try {
    link.server.close();
  } catch (e) {}
  link = null;
}

function page(L, sent, error) {
  var title = L.tx('phoneTitle'),
    body = sent
      ? '<p class="ok">' + L.tx('phoneSent') + '</p>'
      : (error ? '<p class="err">' + L.tx('phoneInvalid') + '</p>' : '') +
        '<form method="post"><textarea name="value" rows="4" placeholder="https://" autofocus></textarea>' +
        '<button>' +
        L.tx('phoneSend') +
        '</button></form>';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title +
    '</title><style>body{margin:0;padding:28px 20px;font:17px system-ui,sans-serif;background:#0b0b0d;color:#fff}' +
    'h1{font-size:22px}textarea{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:0;font-size:16px;background:#1d1d21;color:#fff}' +
    'button{margin-top:14px;width:100%;padding:16px;border:0;border-radius:12px;font-size:17px;font-weight:700;background:#fff;color:#0b0b0d}' +
    '.ok{font-size:19px}.err{color:#ff9a9a}</style></head><body><h1>' +
    title +
    '</h1>' +
    body +
    '</body></html>'
  );
}

/* the page on the home network: GET the form, POST the address */
function onPhone(req, res) {
  var L = runtime.logic();
  if (!link || req.url.split('?')[0] !== '/' + link.token) {
    res.writeHead(404);
    return res.end();
  }
  function answer(sent, error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(L, sent, error));
  }
  if (req.method !== 'POST') return answer(false, false);
  var chunks = [],
    size = 0;
  req.on('data', function (c) {
    size += c.length;
    if (size <= VALUE_MAX * 3) chunks.push(c);
  });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8'),
      value = '';
    try {
      value = decodeURIComponent((/(?:^|&)value=([^&]*)/.exec(raw) || [])[1] || '').replace(/\+/g, ' ');
    } catch (e) {}
    value = value.trim();
    if (value.length > VALUE_MAX || !/^https?:\/\/\S+$/i.test(value)) return answer(false, true);
    link.value = value;
    answer(true, false);
    /* one address per opening: the page goes away once the TV has it */
  });
}

/* POST: opens the page and answers its address as a QR code (rows for the native interface,
   SVG for the web one) */
function start(req, res) {
  close();
  var address = homeAddress();
  if (!address) return sendJson(res, { ok: false });
  var token = crypto.randomBytes(6).toString('hex'),
    server = http.createServer(onPhone);
  server.on('error', function () {
    close();
  });
  server.listen(LINK_PORT, LINK_HOST, function () {
    var url = 'http://' + address + ':' + LINK_PORT + '/' + token;
    link = { server: server, token: token, value: '', timer: setTimeout(close, OPEN_MS) };
    sendJson(res, { ok: true, url: url, qr: qrRows(url), svg: qrSvg(url) });
  });
}

/* GET: the address sent from the phone, once; { waiting } until then, { closed } after */
function poll(req, res) {
  if (!link) return sendJson(res, { closed: true });
  if (!link.value) return sendJson(res, { waiting: true });
  var value = link.value;
  close();
  sendJson(res, { value: value });
}

function stop(req, res) {
  readJsonBody(req, 64, function () {
    close();
    sendJson(res, { ok: true });
  });
}

module.exports = {
  LINK_PORT: LINK_PORT,
  routes: { '/app/phone/poll': poll },
  postRoutes: { '/app/phone/start': start, '/app/phone/stop': stop }
};
