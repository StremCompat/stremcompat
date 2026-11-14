// The first start of 4.0: how the app is used (simple or complete) and how it looks (standard or
// light). Both stay in Settings; skipping keeps everything as it was.
/* Light: no animations or effects, smaller backgrounds and the small-TV caches. */
function applyLook() {
  var light = uiLook() === 'light';
  TV_PROFILE.lowMemory = light || PROFILE_LOW_MEMORY;
  if (light) bodyAdd('lowmem');
  else if (!PROFILE_LOW_MEMORY) bodyRemove('lowmem');
  if (light) bodyAdd('lite');
  else bodyRemove('lite');
}
/* Draws the panel shared by the first-start questions and the interface languages: a title, rows of { name, help, cls } and a hint. Returns the rows' elements. */
function drawChoices(title, rows, hint) {
  var host = $('suOptions'),
    els = [];
  $('setupPanel').style.display = 'block';
  $('suTitle').textContent = title;
  $('suHint').textContent = hint || '';
  host.innerHTML = '';
  for (var i = 0; i < rows.length; i++) {
    var b = document.createElement('div'),
      name = document.createElement('div');
    b.className = 'suopt' + (rows[i].cls ? ' ' + rows[i].cls : '');
    name.className = 'suname';
    name.textContent = rows[i].name;
    b.appendChild(name);
    if (rows[i].help) {
      var help = document.createElement('div');
      help.className = 'suhelp';
      help.textContent = rows[i].help;
      b.appendChild(help);
    }
    host.appendChild(b);
    els.push(b);
  }
  return els;
}
var languagePanel = {
  open: false,
  idx: 0,
  els: [],
  codes: [],
  done: null,
  show: function (done) {
    var rows = [];
    this.codes = Object.keys(UI_LANGUAGES);
    this.done = done;
    this.idx = Math.max(0, this.codes.indexOf(UI_LANG));
    for (var i = 0; i < this.codes.length; i++) rows.push({ name: UI_LANGUAGES[this.codes[i]] });
    this.els = drawChoices(tx('interfaceLanguage'), rows);
    this.open = true;
    setF(this.els, this.idx);
  },
  choose: function (i) {
    setUILanguage(this.codes[i]);
    this.close();
    if (this.done) this.done();
  },
  close: function () {
    this.open = false;
    $('setupPanel').style.display = 'none';
  },
  key: function (k) {
    if (k === 38) this.idx = Math.max(0, this.idx - 1);
    else if (k === 40) this.idx = Math.min(this.els.length - 1, this.idx + 1);
    else if (k === 13) return this.choose(this.idx);
    setF(this.els, this.idx);
  }
};
/* Settings > Organize catalogs: the Home rows in a list; OK picks one up to move it with up and
   down, right shows or hides it. Each change is kept at once; Home is built again on leaving. */
var rowsPanel = {
  open: false,
  idx: 0,
  els: [],
  rows: [],
  moving: false,
  show: function () {
    this.rows = homeRowChoices();
    if (!this.rows.length) return toast(tx('noRows'));
    this.idx = 0;
    this.moving = false;
    this.open = true;
    this.draw();
  },
  draw: function () {
    var shown = [];
    for (var i = 0; i < this.rows.length; i++)
      shown.push({
        name: this.rows[i].title,
        help: tx(this.rows[i].hidden ? 'rowHidden' : 'rowShown'),
        cls: (this.rows[i].hidden ? 'rowoff' : '') + (this.moving && i === this.idx ? ' moving' : '')
      });
    this.els = drawChoices(tx('organizeCatalogs'), shown, tx('rowsHint'));
    this.paint();
  },
  paint: function () {
    setF(this.els, this.idx);
    /* the focused row stays in view */
    var host = $('suOptions'),
      el = this.els[this.idx];
    if (el && el.offsetTop + el.offsetHeight > host.scrollTop + host.clientHeight)
      host.scrollTop = el.offsetTop + el.offsetHeight - host.clientHeight;
    else if (el && el.offsetTop < host.scrollTop) host.scrollTop = el.offsetTop;
  },
  key: function (k) {
    var next = this.idx + (k === 40 ? 1 : k === 38 ? -1 : 0);
    if (next !== this.idx && next >= 0 && next < this.rows.length) {
      if (this.moving) {
        var row = this.rows[this.idx];
        this.rows[this.idx] = this.rows[next];
        this.rows[next] = row;
        saveHomeLayout(this.rows);
      }
      this.idx = next;
    } else if (k === 39 || k === 37) {
      this.rows[this.idx].hidden = !this.rows[this.idx].hidden;
      saveHomeLayout(this.rows);
    } else if (k === 13) this.moving = !this.moving;
    else return;
    this.draw();
  },
  close: function () {
    this.open = false;
    $('setupPanel').style.display = 'none';
    invalidateBoards();
  }
};
/* Settings > Channels > Manage lists: each M3U list with its channels and when it was read; OK
   twice removes one, the last row reads them all again */
var listsPanel = {
  open: false,
  idx: 0,
  els: [],
  lists: [],
  armed: -1,
  show: function () {
    var self = this;
    xhrJson(
      '/app/channels',
      function (j) {
        self.lists = (j && j.lists) || [];
        if (!self.lists.length) return toast(tx('noLists'));
        self.open = true;
        self.idx = 0;
        self.armed = -1;
        self.draw();
      },
      30000
    );
  },
  draw: function () {
    var rows = [];
    for (var i = 0; i < this.lists.length; i++) {
      var l = this.lists[i],
        day = l.updated ? new Date(l.updated) : null;
      rows.push({
        name: l.name,
        help: tx('m3uListInfo', l.count, day ? day.getDate() + '/' + (day.getMonth() + 1) : '-'),
        cls: i === this.armed ? 'moving' : ''
      });
    }
    rows.push({ name: tx('m3uRefreshAll'), cls: 'suskip' });
    this.els = drawChoices(tx('m3uManage'), rows, tx('removeListConfirm'));
    setF(this.els, this.idx);
  },
  choose: function () {
    var self = this;
    if (this.idx === this.lists.length) {
      toast(tx('syncing'));
      for (var i = 0; i < this.lists.length; i++)
        postJson('/app/channels/lists', { refresh: this.lists[i].url }, function () {}, 90000);
      return this.close();
    }
    if (this.armed !== this.idx) {
      this.armed = this.idx;
      toast(tx('removeListConfirm'));
      return this.draw();
    }
    postJson(
      '/app/channels/lists',
      { remove: this.lists[this.idx].url },
      function (j) {
        toast((j && j.message) || tx('m3uRemovedOne'));
        self.lists.splice(self.idx, 1);
        self.armed = -1;
        if (!self.lists.length) return self.close();
        self.idx = Math.min(self.idx, self.lists.length - 1);
        self.draw();
      },
      20000
    );
  },
  close: function () {
    this.open = false;
    $('setupPanel').style.display = 'none';
  },
  key: function (k) {
    if (k === 38) this.idx = Math.max(0, this.idx - 1);
    else if (k === 40) this.idx = Math.min(this.els.length - 1, this.idx + 1);
    else if (k === 13) return this.choose();
    if (this.armed !== this.idx) this.armed = -1;
    this.draw();
  }
};
var setupPanel = {
  open: false,
  step: 0,
  idx: 0,
  els: [],
  /* once, after the first start of this version with an account; Back or Skip keep the defaults */
  maybeShow: function () {
    if (lsRaw('setupDone', '') || !user() || profilePanel.open) return;
    this.open = true;
    this.step = 0;
    this.build();
  },
  questions: function () {
    return [
      {
        key: 'uiMode',
        title: tx('setupUseQuestion'),
        options: [
          ['simple', tx('modeSimple'), tx('modeSimpleHint')],
          ['full', tx('modeFull'), tx('modeFullHint')]
        ],
        current: simpleMode() ? 'simple' : 'full'
      },
      {
        key: 'uiLook',
        title: tx('setupLookQuestion'),
        options: [
          ['standard', tx('lookStandard'), tx('lookStandardHint')],
          ['light', tx('lookLight'), tx('lookLightHint')]
        ],
        current: uiLook()
      }
    ];
  },
  build: function () {
    var q = this.questions()[this.step],
      rows = [];
    this.idx = 0;
    for (var i = 0; i < q.options.length; i++) {
      rows.push({ name: q.options[i][1], help: q.options[i][2] });
      if (q.options[i][0] === q.current) this.idx = i;
    }
    rows.push({ name: tx('setupSkip'), cls: 'suskip' });
    this.els = drawChoices(q.title, rows, tx('setupHint'));
    setF(this.els, this.idx);
  },
  /* an option of this question, or Skip, which closes with what is set now */
  choose: function (i) {
    var q = this.questions()[this.step];
    if (i >= q.options.length) return this.close();
    lsRawSet(q.key, q.options[i][0]);
    if (q.key === 'uiLook') applyLook();
    this.step++;
    if (this.step >= this.questions().length) return this.close();
    this.build();
  },
  close: function () {
    this.open = false;
    lsRawSet('setupDone', '1');
    $('setupPanel').style.display = 'none';
  },
  key: function (k) {
    if (k === 38) this.idx = Math.max(0, this.idx - 1);
    else if (k === 40) this.idx = Math.min(this.els.length - 1, this.idx + 1);
    else if (k === 13) return this.choose(this.idx);
    setF(this.els, this.idx);
  }
};
