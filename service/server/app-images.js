// /app/img: a picture for the interfaces. JPEG, PNG and SVG pass as they are (the native interface
// decodes and shrinks them itself, off the drawing thread); anything else, such as WebP, becomes
// a JPEG through FFmpeg, one picture at a time. With ?w= a large picture (an IPTV logo of a few
// megabytes, an addon's background, a collection's cover) is made that wide first, so the TV never
// decodes it whole; a PNG stays a PNG, so a title logo keeps its transparency.
// Addresses that fail are remembered for a while and not asked again. What is sent is kept on disk
// by address and width, so a cover is fetched and converted once instead of at every start.

var spawn = require('child_process').spawn;
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var { DIR, FFMPEG } = require('./config');
var { fetchUrl } = require('./http-util');
var { NICE, lowerPriority } = require('./priority');

var IMAGE_LIMIT = 6 * 1024 * 1024;
var CONVERT_TIMEOUT_MS = 9000;
var CONVERT_MAX_WIDTH = 1280;
var SMALL_ENOUGH = 48 * 1024; /* below this a picture passes as it is, even with ?w= */
var FAILED_KEEP_MS = 30 * 60 * 1000;
var FAILED_MAX = 500;
var failed = {}; /* address -> when it failed */
var DISK = path.join(DIR, '.imgcache');
var DISK_MAX = 600; /* files; the oldest go first, checked every DISK_CHECK writes */
var DISK_CHECK = 50;
var diskWrites = 0;

function isJpeg(b) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPng(b) {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function canBeClear(b) {
  var webp = b.length > 20 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (webp) {
    /* the first chunk says it: plain lossy (VP8) has no alpha; extended (VP8X) has an alpha flag */
    var chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return false;
    if (chunk === 'VP8X') return (b[20] & 0x10) !== 0;
    return true;
  }
  return b.length > 4 && b.toString('ascii', 0, 4) === 'GIF8';
}
function isSvg(b) {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(b.slice(0, 512).toString('utf8'));
}

function sniff(b) {
  if (isJpeg(b)) return 'image/jpeg';
  if (isPng(b)) return 'image/png';
  return isSvg(b) ? 'image/svg+xml' : '';
}

/* ---------- the disk copy: a cover is fetched and converted once ---------- */
function diskFile(address, width) {
  return path.join(
    DISK,
    crypto
      .createHash('md5')
      .update(address + '|' + width)
      .digest('hex')
  );
}

function trimDisk() {
  fs.readdir(DISK, function (err, names) {
    if (err || names.length <= DISK_MAX) return;
    var files = names.map(function (name) {
      var file = path.join(DISK, name);
      try {
        return { file: file, time: fs.statSync(file).mtime.getTime() };
      } catch (e) {
        return { file: file, time: 0 };
      }
    });
    files.sort(function (a, b) {
      return a.time - b.time;
    });
    files.slice(0, files.length - Math.floor(DISK_MAX * 0.8)).forEach(function (f) {
      fs.unlink(f.file, function () {});
    });
  });
}

function keep(file, data) {
  fs.mkdir(DISK, function () {
    fs.writeFile(file + '.tmp', data, function (err) {
      if (err) return;
      fs.rename(file + '.tmp', file, function () {});
      if (++diskWrites % DISK_CHECK === 0) trimDisk();
    });
  });
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
    /* the picture goes to FFmpeg as a file: the TV's FFmpeg has no WebP parser, and without one a
       WebP read from a pipe never learns its size */
    file = path.join(os.tmpdir(), 'sc-img-' + process.pid + '-' + Date.now() + '.bin'),
    worker;
  function end(data) {
    if (finished) return;
    finished = true;
    fs.unlink(file, function () {});
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
    fs.writeFileSync(file, job.input);
    worker = spawn(
      FFMPEG,
      ['-nostdin', '-i', file, '-frames:v', '1', '-vf', "scale='min(" + job.width + ",iw)':-2"].concat(
        job.png ? ['-c:v', 'png', '-f', 'image2pipe'] : ['-q:v', '4', '-f', 'mjpeg'],
        ['pipe:1']
      )
    );
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
}

function convert(input, width, png, cb) {
  queue.push({ input: input, width: width, png: png, cb: cb });
  convertNext();
}

function remember(address) {
  var keys = Object.keys(failed);
  if (keys.length >= FAILED_MAX) delete failed[keys[0]];
  failed[address] = Date.now();
}

function appImage(req, res, q) {
  var address = String(q.u || ''),
    width = Math.max(0, Math.min(CONVERT_MAX_WIDTH, parseInt(q.w, 10) || 0));
  if (!/^https?:\/\//i.test(address)) return missing(res);
  if (failed[address] && Date.now() - failed[address] < FAILED_KEEP_MS) return missing(res);
  var file = diskFile(address, width);
  fs.readFile(file, function (err, kept) {
    var type = !err && kept && kept.length ? sniff(kept) : '';
    if (type) return send(res, type, kept);
    fetchAndSend(
      address,
      width,
      function (type, data) {
        keep(file, data);
        send(res, type, data);
      },
      res
    );
  });
}

function fetchAndSend(address, width, done, res) {
  fetchUrl(
    address,
    function (body) {
      if (!body || !body.length) {
        remember(address);
        return missing(res);
      }
      if (isSvg(body)) return done('image/svg+xml', body);
      var plain = isJpeg(body) ? 'image/jpeg' : isPng(body) ? 'image/png' : '';
      if (plain && (!width || body.length <= SMALL_ENOUGH)) return done(plain, body);
      /* a picture that can be transparent (PNG, WebP, GIF: logos over the artwork) stays a PNG, so
         its transparency is kept; only pictures that have none become JPEG */
      var png = plain === 'image/png' || canBeClear(body);
      convert(body, width || CONVERT_MAX_WIDTH, png, function (made) {
        if (made) return done(png ? 'image/png' : 'image/jpeg', made);
        /* an FFmpeg built without the PNG encoder (runtime 3.0 and older): a JPEG, without the
           transparency, is better than no picture */
        if (png && plain !== 'image/png')
          return convert(body, width || CONVERT_MAX_WIDTH, false, function (jpeg) {
            if (jpeg) return done('image/jpeg', jpeg);
            remember(address);
            missing(res);
          });
        /* without FFmpeg (Samsung) a JPEG or PNG still passes as it is */
        if (plain) return done(plain, body);
        remember(address);
        missing(res);
      });
    },
    0,
    IMAGE_LIMIT
  );
}

module.exports = {
  appImage: appImage
};
