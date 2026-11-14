// /app/img: a picture for the native interface. JPEG and PNG pass as they are (the interface
// decodes and shrinks them itself, off the drawing thread); anything else, such as WebP, becomes
// a JPEG through FFmpeg, one picture at a time.

var spawn = require('child_process').spawn;
var { FFMPEG } = require('./config');
var { fetchUrl } = require('./http-util');
var { NICE, lowerPriority } = require('./priority');

var IMAGE_LIMIT = 6 * 1024 * 1024;
var CONVERT_TIMEOUT_MS = 9000;
var CONVERT_MAX_WIDTH = 1280;

function isJpeg(b) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPng(b) {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function send(res, type, data) {
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'max-age=86400',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(data);
}

function missing(res) {
  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}

/* ---------- other formats: converted one after another, so the TV keeps its speed ---------- */
var queue = [],
  converting = false;

function convertNext() {
  if (converting || !queue.length) return;
  converting = true;
  var job = queue.shift(),
    parts = [],
    finished = false,
    worker;
  function end(data) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    converting = false;
    job.cb(data);
    convertNext();
  }
  var timer = setTimeout(function () {
    try {
      worker.kill('SIGKILL');
    } catch (e) {}
    end(null);
  }, CONVERT_TIMEOUT_MS);
  try {
    worker = spawn(FFMPEG, [
      '-nostdin',
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-vf',
      "scale='min(" + CONVERT_MAX_WIDTH + ",iw)':-2",
      '-q:v',
      '4',
      '-f',
      'mjpeg',
      'pipe:1'
    ]);
    lowerPriority(worker, NICE.INTERACTIVE);
  } catch (e) {
    return end(null);
  }
  worker.stdout.on('data', function (chunk) {
    parts.push(chunk);
  });
  worker.on('error', function () {
    end(null);
  });
  worker.on('close', function (code) {
    var data = Buffer.concat(parts);
    end(code === 0 && data.length ? data : null);
  });
  worker.stdin.on('error', function () {});
  worker.stdin.end(job.input);
}

function convert(input, cb) {
  queue.push({ input: input, cb: cb });
  convertNext();
}

function appImage(req, res, q) {
  var address = String(q.u || '');
  if (!/^https?:\/\//i.test(address)) return missing(res);
  fetchUrl(
    address,
    function (body) {
      if (!body || !body.length) return missing(res);
      if (isJpeg(body)) return send(res, 'image/jpeg', body);
      if (isPng(body)) return send(res, 'image/png', body);
      convert(body, function (jpeg) {
        if (jpeg) send(res, 'image/jpeg', jpeg);
        else missing(res);
      });
    },
    0,
    IMAGE_LIMIT
  );
}

module.exports = {
  appImage: appImage
};
