// The native interface's data logic: the same code the web interface runs (app-logic.js, built
// from src/ui by scripts/build-ui.js), run here in a context of its own. It finds what a
// browser would give it: a localStorage kept in a file, an XMLHttpRequest that asks this
// server, timers and a window.

var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var { DIR, PORT, PROFILE, PROFILE_MODULE } = require('./config');
var { dbg } = require('./log');

var SAVE_DELAY_MS = 400;

function stateFile() {
  return process.env.SC_APP_STATE || path.join(process.env.HOME || DIR, '.stremcompat', 'app-state.json');
}

/* ---------- localStorage: the same keys the web interface keeps, in one file ---------- */
var items = null,
  saveTimer = null;

function load() {
  if (items) return items;
  try {
    items = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {};
  } catch (e) {
    items = {};
  }
  return items;
}

/* written a moment after the last change, through a temporary file so a power cut never
   leaves half a file */
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var file = stateFile(),
      tmp = file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(items));
      fs.renameSync(tmp, file);
    } catch (e) {
      dbg('app state not saved: ' + e.message);
    }
  }, SAVE_DELAY_MS);
}

var storage = {
  getItem: function (k) {
    var all = load();
    return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null;
  },
  setItem: function (k, v) {
    load()[k] = String(v);
    save();
  },
  removeItem: function (k) {
    delete load()[k];
    save();
  },
  key: function (i) {
    var keys = Object.keys(load());
    return i < keys.length ? keys[i] : null;
  },
  clear: function () {
    items = {};
    save();
  }
};
Object.defineProperty(storage, 'length', {
  get: function () {
    return Object.keys(load()).length;
  }
});

/* ---------- XMLHttpRequest: only what the data code uses, to this same server ---------- */
function LocalRequest() {
  this.readyState = 0;
  this.status = 0;
  this.responseText = '';
  this.onreadystatechange = null;
  this._headers = {};
  this._req = null;
}
LocalRequest.prototype.open = function (method, url, async) {
  this._method = method;
  this._async = async !== false;
  /* the data code sends addresses outside through the server's bridges already; anything
     absolute left over goes through the addon bridge as well */
  this._path = /^https?:\/\//i.test(url) ? '/addon?u=' + encodeURIComponent(url) : url;
  this.readyState = 1;
};
LocalRequest.prototype.setRequestHeader = function (name, value) {
  this._headers[name] = value;
};
LocalRequest.prototype._finish = function (status, text) {
  if (this.readyState === 4) return;
  this.status = status;
  this.responseText = text;
  this.readyState = 4;
  if (this.onreadystatechange) this.onreadystatechange();
};
LocalRequest.prototype.send = function (body) {
  var self = this;
  /* the only request made waiting for the answer: a language file, read straight from disk
     (the server cannot wait for itself) */
  if (!this._async) {
    var lang = /^\/lang\/([a-zA-Z0-9-]{2,6})\.json$/.exec(this._path);
    try {
      this._finish(200, fs.readFileSync(path.join(DIR, 'lang', lang[1] + '.json'), 'utf8'));
    } catch (e) {
      this._finish(404, '');
    }
    return;
  }
  var req = http.request(
    { host: '127.0.0.1', port: PORT, method: this._method, path: this._path, headers: this._headers },
    function (res) {
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        self._finish(res.statusCode, Buffer.concat(chunks).toString('utf8'));
      });
    }
  );
  req.on('error', function () {
    self._finish(0, '');
  });
  this._req = req;
  req.end(body == null ? undefined : body);
};
LocalRequest.prototype.abort = function () {
  if (this._req) this._req.abort();
  this.readyState = 4;
};

/* ---------- the context ---------- */
var logic = null,
  tvLanguage = '';

function start() {
  if (logic) return logic;
  var context = {
    console: { log: dbg, warn: dbg, error: dbg },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    localStorage: storage,
    XMLHttpRequest: LocalRequest,
    navigator: { language: tvLanguage },
    __SC_PROFILE__: PROFILE_MODULE.interfaceProfile(PROFILE),
    __SC_PHASE__: function () {}
  };
  context.window = context;
  vm.createContext(context);
  var file = path.join(DIR, 'app-logic.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: 'app-logic.js' });
  logic = context.__logic;
  return logic;
}

/* the language and the settings read once at the start take effect on the next call */
function restart() {
  logic = null;
}

/* the TV's own language, used until the viewer picks one */
function setTvLanguage(code) {
  if (code === tvLanguage) return;
  tvLanguage = String(code || '');
  restart();
}

module.exports = {
  logic: start,
  restart: restart,
  setTvLanguage: setTvLanguage,
  storage: storage
};
