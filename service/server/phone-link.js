// Sending an address or a search from the phone: typing with a remote is slow, so the address
// panel and Search show a QR code. On the same Wi-Fi it opens a small page served by the TV
// itself, where the address is pasted and sent. The main server keeps listening only on the TV
// (127.0.0.1); this page has a port of its own, open only while a panel asks for it, for one
// address or five minutes, behind a random code. It takes an http(s) address, or for Search
// (kind "text") a line of text.

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
var TEXT_MAX = 120;
/* the home network; the tests keep it on the computer itself (no firewall question) */
var LINK_HOST = process.env.SC_PHONE_HOST || '0.0.0.0';

var link = null; /* { server, sockets, token, kind, value, timer } while a panel waits */

/* the TV's address on the home network; when the link listens on one given address (tests), that one */
function homeAddress() {
  if (LINK_HOST !== '0.0.0.0') return LINK_HOST;
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

/* the phone's open connections go too: before Node 19, closing a server leaves them answering */
function close() {
  if (!link) return;
  clearTimeout(link.timer);
  try {
    link.server.close();
  } catch (e) {}
  link.sockets.forEach(function (socket) {
    socket.destroy();
  });
  link = null;
}

function page(L, sent, error) {
  var text = link.kind === 'text',
    title = L.tx(text ? 'phoneSearchTitle' : 'phoneTitle'),
    field = text
      ? '<input name="value" type="search" maxlength="' + TEXT_MAX + '" autofocus>'
      : '<textarea name="value" rows="4" placeholder="https://" autofocus></textarea>',
    body = sent
      ? '<p class="ok">' + L.tx('phoneSent') + '</p>'
      : (error ? '<p class="err">' + L.tx('phoneInvalid') + '</p>' : '') +
        '<form method="post">' +
        field +
        '<button>' +
        L.tx('phoneSend') +
        '</button></form>';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title +
    '</title><style>body{margin:0;padding:28px 20px;font:17px system-ui,sans-serif;background:#0b0b0d;color:#fff}' +
    'h1{font-size:22px}textarea,input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:0;font-size:16px;background:#1d1d21;color:#fff}' +
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
    var valid =
      link.kind === 'text'
        ? value.length > 0 && value.length <= TEXT_MAX
        : value.length <= VALUE_MAX && /^https?:\/\/\S+$/i.test(value);
    if (!valid) return answer(false, true);
    link.value = value;
    answer(true, false);
    /* one address per opening: the page goes away once the TV has it */
  });
}

/* POST { kind }: opens the page and answers its address as a QR code (rows for the native
   interface, SVG for the web one) */
function start(req, res) {
  readJsonBody(req, 256, function (body) {
    close();
    var address = homeAddress();
    if (!address) return sendJson(res, { ok: false });
    var token = crypto.randomBytes(6).toString('hex'),
      server = http.createServer(onPhone),
      sockets = [];
    server.on('connection', function (socket) {
      sockets.push(socket);
      socket.on('close', function () {
        sockets.splice(sockets.indexOf(socket), 1);
      });
    });
    server.on('error', function () {
      close();
    });
    server.listen(LINK_PORT, LINK_HOST, function () {
      var url = 'http://' + address + ':' + LINK_PORT + '/' + token;
      link = {
        server: server,
        sockets: sockets,
        token: token,
        kind: body && body.kind === 'text' ? 'text' : 'address',
        value: '',
        timer: setTimeout(close, OPEN_MS)
      };
      sendJson(res, { ok: true, url: url, qr: qrRows(url), svg: qrSvg(url) });
    });
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
