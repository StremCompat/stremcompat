/*
 * Bootstrap deliberately limited to ES5 because webOS 3 and 4 run JavaScript services
 * with Node.js 0.12.2. The local server runs on that same Node, as a process of its own,
 * so a crash there does not take this service down and it can start it again.
 */
process.env.NODE_PATH = (process.env.NODE_PATH || '') + ':/usr/lib/node_modules:/usr/lib/nodejs';
require('module').Module._initPaths();

var Service = require('webos-service');
var path = require('path');
var net = require('net');
var fs = require('fs');
var spawn = require('child_process').spawn;
var PROFILE = require('./profile').current;

var DIR = __dirname;
var SUPERVISOR = path.join(DIR, 'local-server.js');
var APP_PORT = PROFILE.port;
var APP_VERSION = PROFILE.version;
/* webos-service leans on the system's activity manager twice: it ends the service 5 s after it
   starts unless an activity was accepted, and it hands a request to its method only once the
   activity manager has answered for it. On webOS 10 (webOS 25) neither happens for apps installed
   in developer mode: the service died mid-start ("... is not running"), and once kept alive the app's
   start request never reached this file (RUNTIME_START_TIMEOUT). The library's own switches turn
   both off: no idle exit, and an activity of its own for each request. Older TVs, where keepAlive
   was accepted, already kept the service running. Read when the Service is created. */
process.argv.push('--disable-timeouts', '--disable-activity-creation');
var service = new Service(PROFILE.serviceId);
var spawned = false;
/* the server has answered at least once since this service started */
var everReady = false;
/* how long a server of its own may take to answer before it runs inside the service */
var OWN_PROCESS_WAIT_MS = 30000;

/* A smaller V8 young generation for the local server, which mostly moves Buffers: those
   live outside the V8 heap, so the TV gets that memory back. */
function runtimeFlags() {
  var semi = parseInt(PROFILE.serverSemiSpaceMB, 10);
  return semi > 0 ? ['--max_semi_space_size=' + semi] : [];
}

var recentLog = [];
function log(message) {
  recentLog.push(message);
  if (recentLog.length > 3) recentLog.shift();
  try {
    fs.appendFileSync(path.join(DIR, 'launch.log'), new Date().toISOString() + ' ' + message + '\n');
  } catch (ignore) {}
}

function isUp(callback) {
  var socket = net.connect(APP_PORT, '127.0.0.1');
  var settled = false;
  var response = '';
  function finish(value) {
    if (settled) return;
    settled = true;
    try {
      socket.destroy();
    } catch (ignore) {}
    callback(value);
  }
  socket.on('connect', function () {
    socket.write('GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    response += chunk.toString();
    if (response.indexOf('"version":"' + APP_VERSION + '"') >= 0) finish(true);
    if (response.length > 8192) finish(false);
  });
  socket.on('end', function () {
    finish(response.indexOf('"version":"' + APP_VERSION + '"') >= 0);
  });
  socket.on('error', function () {
    finish(false);
  });
  setTimeout(function () {
    finish(false);
  }, 1000);
}

/* The version answering /health on the app port, '' when nothing listens there, '?' when something
   holds the port without answering in time: a server stuck after the TV ran out of memory took the
   port and answered nothing, and was taken for no server at all (webos#19). */
function healthVersion(callback, waitMs) {
  var socket = net.connect(APP_PORT, '127.0.0.1');
  var settled = false;
  var connected = false;
  var response = '';
  function finish() {
    var m;
    if (settled) return;
    settled = true;
    try {
      socket.destroy();
    } catch (ignore) {}
    m = response.match(/"version":"([^"]*)"/);
    callback(m ? m[1] : response || connected ? '?' : '');
  }
  socket.on('connect', function () {
    connected = true;
    socket.write('GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  });
  socket.on('data', function (chunk) {
    response += chunk.toString();
    if (/"version":"[^"]*"/.test(response) || response.length > 8192) finish();
  });
  socket.on('end', finish);
  socket.on('error', finish);
  setTimeout(finish, waitMs || 1500);
}

/* The local server runs detached, so after an update the previous version's server can
   still hold the app port: the new one could never start and the launcher waited for
   RUNTIME_START_TIMEOUT until the TV was unplugged. Before starting, every StremCompat
   server of this app (a process whose command line runs this app's local-server.js) is
   stopped. The command line is readable even where another process's open sockets are
   not. What happened is kept for the launcher's error code. */
var takeover = null;
function staleServerPids() {
  var pids = [];
  var names = [];
  var i;
  var cmd;
  try {
    names = fs.readdirSync('/proc');
  } catch (error) {
    takeover.err = 'proc ' + (error.code || 'error');
    return pids;
  }
  for (i = 0; i < names.length; i++) {
    if (!/^\d+$/.test(names[i]) || Number(names[i]) === process.pid) continue;
    try {
      cmd = fs
        .readFileSync('/proc/' + names[i] + '/cmdline')
        .toString()
        .split('\u0000')
        .join(' ');
    } catch (ignore) {
      continue;
    }
    /* versions before 3.0 called the server tvserver.js */
    if (cmd.indexOf(SUPERVISOR) >= 0 || cmd.indexOf(path.join(DIR, 'tvs' + 'erver.js')) >= 0)
      pids.push(Number(names[i]));
  }
  return pids;
}
function stopStaleServers(staleVersion, callback) {
  var pids;
  var waited = 0;
  takeover = { version: staleVersion, found: 0, err: '' };
  pids = staleServerPids();
  takeover.found = pids.length;
  log(
    'Port ' + APP_PORT + ' held by version ' + staleVersion + '; stopping ' + pids.length + ' old server(s)'
  );
  function signal(name) {
    var i;
    for (i = 0; i < pids.length; i++) {
      try {
        process.kill(pids[i], name);
      } catch (error) {
        takeover.err = takeover.err || error.code || 'kill error';
      }
    }
  }
  signal('SIGTERM');
  setTimeout(function () {
    signal('SIGKILL');
    (function waitFree() {
      healthVersion(function (version) {
        if (!version || waited >= 6) {
          if (version) log('Old server still answering after stop: ' + (takeover.err || 'unknown'));
          return callback();
        }
        waited++;
        setTimeout(waitFree, 500);
      });
    })();
  }, 800);
}

/* If the local server exits while this service is alive, start it again so the
   interface does not freeze until the app is reopened. A server that keeps dying is
   left alone after five restarts in ten minutes instead of looping. */
var restarts = [];
function scheduleRestart() {
  var now = Date.now();
  restarts = restarts.filter(function (at) {
    return now - at < 600000;
  });
  if (restarts.length >= 5) {
    log('Runtime keeps exiting; automatic restart paused');
    return;
  }
  restarts.push(now);
  setTimeout(function () {
    isUp(function (up) {
      if (!up && !spawned) startRuntime();
    });
  }, 1500);
}

/* Where a TV does not let this service start the Node it runs on, the server runs in this
   process instead. It then cannot be restarted, but the app opens. */
var insideService = false;
function runInsideService(reason) {
  if (insideService) return;
  insideService = true;
  spawned = true;
  log('Running the local server inside the service: ' + reason);
  /* the server then never ends this process (server/takeover.js) */
  process.env.SC_IN_SERVICE = '1';
  try {
    require(SUPERVISOR);
  } catch (error) {
    log('Local server failed: ' + error.message);
  }
}

function startRuntime() {
  var env;
  var child;
  var key;
  if (spawned) return;
  spawned = true;
  env = {};
  for (key in process.env) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) env[key] = process.env[key];
  }
  env.HOME = env.HOME || '/home/root';
  env.USER = env.USER || 'root';
  /* Node's own helper threads (4 by default) do every name lookup and disk read: with a Home asking
     for dozens of catalogs and covers at once, a cover's disk copy waited behind addons' lookups */
  env.UV_THREADPOOL_SIZE = env.UV_THREADPOOL_SIZE || '16';

  log('Starting the local server on Node ' + process.version);
  try {
    child = spawn(process.execPath, runtimeFlags().concat([SUPERVISOR]), {
      cwd: DIR,
      env: env,
      detached: true,
      stdio: 'ignore'
    });
  } catch (error) {
    log('Spawn failed: ' + error.message);
    runInsideService(error.message);
    return;
  }
  child.on('error', function (error) {
    log('Runtime error: ' + error.message);
    runInsideService(error.message);
  });
  child.on('exit', function (code, signal) {
    if (insideService) return;
    spawned = false;
    log('Runtime exit code=' + code + ' signal=' + signal);
    /* A server that never answered: this TV does not let the service run a Node of its own
       (webOS 10, where 2.1's bundled Node still ran). It runs inside the service instead. */
    if (!everReady) return runInsideService('exit ' + code + ' ' + signal);
    scheduleRestart();
  });
  log('Runtime pid=' + child.pid);
  child.unref();
  setTimeout(function () {
    if (everReady || insideService) return;
    healthVersion(function (version) {
      if (version === APP_VERSION || insideService) return;
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch (ignore) {}
      runInsideService('no answer in ' + OWN_PROCESS_WAIT_MS / 1000 + ' s');
    });
  }, OWN_PROCESS_WAIT_MS);
}

/* callback(ready, staleVersion). A normal start gets READY_WAIT_MS, less than the launcher's own
   90 s, so the launcher always gets an answer with the log to show. Only while ANOTHER version keeps
   answering (the old server could not be stopped) the wait ends after 30 s, so the launcher can
   explain it. */
var READY_WAIT_MS = 75000;
function waitUntilReady(callback, startedAt) {
  startedAt = startedAt || Date.now();
  healthVersion(function (version) {
    var waited = Date.now() - startedAt;
    if (version === APP_VERSION) {
      everReady = true;
      return callback(true, '');
    }
    if (version && version !== '?' && waited >= 30000) return callback(false, version);
    if (waited >= READY_WAIT_MS) return callback(false, '');
    if (!spawned) startRuntime();
    setTimeout(function () {
      waitUntilReady(callback, startedAt);
    }, 500);
  });
}

service.activityManager.create('keepAlive', function () {});
/* Tell a running server of another version (1.3.3 and later) that this version takes
   over: it watches this file in the app's home folder and leaves by itself (takeover.js).
   The new server writes it again once it listens. */
function claimPort() {
  var home = process.env.HOME || '';
  if (!home) return;
  try {
    fs.writeFileSync(path.join(home, '.stremcompat-' + PROFILE.serviceId + '.version'), APP_VERSION);
  } catch (error) {
    log('Claim not written: ' + (error.code || error.message));
  }
}

/* This version's server on its way: a server of another version asked to leave or stopped first,
   then this one started; done() once it is started or already up. It runs as soon as the service
   loads, so the server comes up even where the app's start request is held back, and the launcher
   finds it by its own /health checks. */
var PREPARE_IDLE = 0,
  PREPARE_RUNNING = 1,
  PREPARE_DONE = 2;
var prepareState = PREPARE_IDLE,
  prepareWaiting = [];
function prepareServer(done) {
  if (prepareState === PREPARE_DONE) return done();
  prepareWaiting.push(done);
  if (prepareState === PREPARE_RUNNING) return;
  prepareState = PREPARE_RUNNING;
  claimPort();
  function prepared() {
    prepareState = PREPARE_DONE;
    prepareWaiting.splice(0).forEach(function (fn) {
      fn();
    });
  }
  function stopThenStart(version) {
    stopStaleServers(version, function () {
      startRuntime();
      prepared();
    });
  }
  healthVersion(function (version) {
    if (version === APP_VERSION) return prepared();
    if (version === '?' && !spawned)
      /* a busy server may just be slow: it counts as stuck only if it stays silent 5 s more */
      return healthVersion(function (again) {
        if (again === APP_VERSION) return prepared();
        if (again) return stopThenStart(again === '?' ? 'silent' : again);
        startRuntime();
        prepared();
      }, 5000);
    if (version && !spawned) return stopThenStart(version);
    if (!spawned) startRuntime();
    prepared();
  });
}

service.register('start', function (message) {
  prepareServer(function () {
    waitUntilReady(function (ready, staleVersion) {
      var reply = {
        returnValue: ready,
        ready: ready,
        version: APP_VERSION,
        runtime: 'system-node-' + process.version,
        target: PROFILE.targetLabel
      };
      /* what the service saw last, for the launcher's error code */
      if (!ready) reply.log = recentLog.join(' | ');
      if (!ready && staleVersion) {
        reply.reason = 'STALE_SERVICE';
        reply.staleVersion = staleVersion;
        reply.detail = takeover
          ? 'found ' + takeover.found + (takeover.err ? ' ' + takeover.err : '')
          : 'no stop';
      }
      message.respond(reply);
    });
  });
});

/* The native interface's update: the package the local server downloaded and checked
   (server/app-update.js) goes to the system installer; once installed the app opens again. */
var UPDATE_PACKAGE = path.join(process.env.HOME || '/home/root', '.stremcompat', 'update.ipk');
service.register('install', function (message) {
  if (!fs.existsSync(UPDATE_PACKAGE)) return message.respond({ returnValue: false, error: 'no package' });
  var finished = false;
  var installing = service.subscribe('luna://com.webos.appInstallService/dev/install', {
    id: PROFILE.appId,
    ipkUrl: UPDATE_PACKAGE,
    subscribe: true
  });
  function finish(reply) {
    if (finished) return;
    finished = true;
    try {
      installing.cancel();
    } catch (ignore) {}
    message.respond(reply);
  }
  installing.on('response', function (answer) {
    var payload = answer.payload || {};
    var state = String((payload.details && payload.details.state) || payload.state || '');
    log('install: ' + (state || JSON.stringify(payload).slice(0, 200)));
    if (payload.returnValue === false || /fail|error/i.test(state))
      return finish({ returnValue: false, error: payload.errorText || state || 'refused' });
    if (/installed/i.test(state)) {
      finish({ returnValue: true, installed: true });
      service.call('luna://com.webos.applicationManager/launch', { id: PROFILE.appId }, function () {});
    }
  });
});

log('Legacy bootstrap loaded on system Node ' + process.version);
prepareServer(function () {});
