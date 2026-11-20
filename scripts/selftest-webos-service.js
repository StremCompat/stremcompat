'use strict';
// The webOS service (service/launch.js) where the TV gives it the least: the system's activity
// manager refuses every activity and the service may not start a Node of its own, so the local
// server runs inside the service (webOS 10). The real webos-service then ends the process 5 s
// after it starts unless it was given --disable-timeouts; the stand-in below does the same.
// The service must answer the app's start and still be running well after those 5 s.

var assert = require('assert');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var root = path.resolve(__dirname, '..');
var work = fs.mkdtempSync(path.join(os.tmpdir(), 'stremcompat-webos-service-'));
var modules = path.join(work, 'node_modules', 'webos-service');
fs.mkdirSync(modules, { recursive: true });

/* webos-service as webOS has it, reduced to what launch.js uses: methods, and the idle exit of its
   ActivityManager, which only an accepted activity or --disable-timeouts stops */
fs.writeFileSync(
  path.join(modules, 'index.js'),
  [
    'var IDLE_MS = 5000;',
    'function Service(id) {',
    '  var exitOnTimeout = process.argv.indexOf("--disable-timeouts") < 0;',
    '  this.methods = {};',
    '  this.activityManager = { create: function (name, cb) { if (cb) cb({ returnValue: false, errorText: "Denied" }); } };',
    '  if (exitOnTimeout) setTimeout(function () { console.log("IDLE EXIT"); process.exit(0); }, IDLE_MS);',
    '  global.__service = this;',
    '}',
    'Service.prototype.register = function (name, fn) { this.methods[name] = fn; };',
    'Service.prototype.call = function () {};',
    'Service.prototype.subscribe = function () { return { on: function () {}, cancel: function () {} }; };',
    'module.exports = Service;'
  ].join('\n')
);

/* runs launch.js with a spawn the TV refuses, then asks for the start like the app does */
fs.writeFileSync(
  path.join(work, 'run.js'),
  [
    'var cp = require("child_process"), EventEmitter = require("events");',
    'cp.spawn = function () {',
    '  var child = new EventEmitter();',
    '  child.pid = 0; child.unref = function () {};',
    '  setTimeout(function () { child.emit("exit", 126, null); }, 100);',
    '  return child;',
    '};',
    'require(process.argv[2]);',
    'global.__service.methods.start({ respond: function (reply) {',
    '  console.log("REPLY " + JSON.stringify(reply));',
    '  setTimeout(function () { console.log("ALIVE"); process.exit(0); }, 7000);',
    '} });'
  ].join('\n')
);

var env = {};
Object.keys(process.env).forEach(function (key) {
  env[key] = process.env[key];
});
/* launch.js adds the TV's module folders after a ':', so the list must end where they begin */
env.NODE_PATH = path.join(work, 'node_modules') + (process.platform === 'win32' ? ';' : ':');
env.HOME = work;
env.SC_SERVER_LOG = path.join(work, 'server.log');

var result = childProcess.spawnSync(
  process.execPath,
  [path.join(work, 'run.js'), path.join(root, 'service', 'launch.js')],
  {
    env: env,
    encoding: 'utf8',
    timeout: 60000
  }
);
var out = String(result.stdout || '') + String(result.stderr || '');
try {
  fs.rmSync(work, { recursive: true, force: true });
} catch (e) {}

assert.ok(out.indexOf('IDLE EXIT') < 0, 'the service ended itself 5 s after it started:\n' + out);
var reply = /REPLY (.*)/.exec(out);
assert.ok(reply, 'the service never answered the start:\n' + out);
assert.strictEqual(
  JSON.parse(reply[1]).ready,
  true,
  'the server inside the service did not come up:\n' + out
);
assert.ok(out.indexOf('ALIVE') >= 0, 'the service did not stay running after the start:\n' + out);

// ---- the launcher asks the service again when it ended mid-start (app/index.html) ----
var vm = require('vm');
var launcherScript = /<script>([\s\S]*?)<\/script>/.exec(
  fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8')
)[1];
/* answers: what each start call gets back, in order */
function launcherRun(answers) {
  var timers = [],
    calls = 0,
    elements = {},
    opened = '';
  function element(id) {
    if (!elements[id]) elements[id] = { id: id, style: {}, innerHTML: '', className: '' };
    return elements[id];
  }
  var ctx = {
    navigator: { language: 'en-US' },
    document: { getElementById: element },
    location: {
      replace: function (url) {
        opened = url;
      }
    },
    setTimeout: function (f) {
      timers.push(f);
    },
    XMLHttpRequest: function () {
      this.open = function () {};
      this.send = function () {};
    },
    PalmServiceBridge: function () {
      var bridge = this;
      this.call = function () {
        var answer = answers[calls++];
        if (answer) bridge.onservicecallback(JSON.stringify(answer));
      };
    },
    Date: Date,
    JSON: JSON,
    String: String
  };
  vm.runInNewContext(launcherScript, ctx);
  /* the retries wait on timers; the health pings never answer here */
  for (var i = 0; i < 20 && timers.length; i++) timers.shift()();
  return {
    calls: calls,
    code: element('code').innerHTML,
    failed: element('box').className.indexOf('failed') >= 0,
    opened: opened
  };
}
var gone = { returnValue: false, errorCode: -1, errorText: 'x.server is not running.' };
var gaveUp = launcherRun([gone, gone, gone]);
assert.strictEqual(gaveUp.calls, 3, 'the launcher must ask a service that ended three times');
assert.ok(
  gaveUp.failed && /SERVICE_ERROR/.test(gaveUp.code) && /3x/.test(gaveUp.code),
  'after three tries the launcher must say what the TV answered'
);
var second = launcherRun([gone, { returnValue: true, ready: true, version: '__APP_VERSION__' }]);
assert.ok(
  !second.failed && /\/beta/.test(second.opened),
  'a service that answers on the second try must open the app'
);

console.log(
  'OK: webOS service keeps running where the TV refuses activities and its own Node, and answers the start; the launcher asks it again before giving up.'
);
