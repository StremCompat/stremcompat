// Addons screen.
/* ================= ADDONS =================
   The account's addons, with three buttons on top: the store (Stremio's list of community
   addons, OK installs one), adding one by its address, and syncing. OK twice on an installed
   addon removes it. Changes are made on the account (server/addon-store.js), so they show up
   on the person's other devices too. */
var addonPanel = {
  idx: 0,
  els: [],
  list: [],
  store: null,
  inStore: false,
  armed: -1,
  enter: function () {
    this.inStore = false;
    this.draw();
    animIn($('aWrap'));
    if (!addons().length) this.syncNow(true);
  },
  /* the three buttons, then the list: the installed addons or the store's */
  draw: function () {
    var buttons = [$('aStore'), $('aAdd'), $('aSync')];
    $('aStore').textContent = tx('addonStore');
    $('aAdd').textContent = tx('addAddon');
    $('aSync').textContent = tx('syncAddons');
    $('aTitle').textContent = this.inStore ? tx('addonStore') : 'Addons';
    $('aHelp').textContent = tx('addonsHint');
    $('aBtns').style.display = this.inStore ? 'none' : '';
    this.els = this.inStore ? [] : buttons;
    this.idx = Math.min(this.idx, 2);
    this.armed = -1;
    this.list = this.inStore ? this.store || [] : addons();
    var host = $('aInner'),
      mine = {};
    host.innerHTML = '';
    var have = addons();
    for (var h = 0; h < have.length; h++) mine[String(have[h].transportUrl || '')] = 1;
    for (var i = 0; i < this.list.length; i++) {
      var ad = this.list[i],
        m = this.inStore ? ad : ad.manifest || {},
        d = document.createElement('div'),
        n = document.createElement('div'),
        info = document.createElement('div');
      d.className = 'addon';
      n.className = 'an';
      n.textContent = m.name || m.id || 'Addon';
      info.className = 'ai';
      info.textContent = this.inStore
        ? (mine[ad.url] ? tx('addonIsInstalled') + '  ·  ' : '') +
          (ad.description || (ad.types || []).join(' · '))
        : [m.id || '', m.version || '', (m.types || []).join(' · ')].join('   ').replace(/\s+/g, ' ');
      d.appendChild(n);
      d.appendChild(info);
      host.appendChild(d);
      this.els.push(d);
    }
    if (!this.list.length) {
      var empty = document.createElement('div');
      empty.className = 'stmsg';
      empty.textContent = this.inStore ? tx('storeUnavailable') : tx('noAddons');
      host.appendChild(empty);
    }
    if (this.inStore) this.idx = 0;
    this.paint();
  },
  /* the buttons sit side by side; the list starts after them */
  first: function () {
    return this.inStore ? 0 : 3;
  },
  focusTop: function () {
    topNav.active = false;
    this.idx = 0;
    this.paint();
    topNav.paint();
  },
  paint: function () {
    setF(this.els, topNav.active ? -1 : this.idx);
    var y = 0,
      row = this.idx - this.first();
    if (row > 3) {
      var el = this.els[this.idx];
      if (el) y = Math.max(0, el.offsetTop - 220);
    }
    $('aInner').style.transform = 'translateY(-' + y + 'px)';
    $('aInner').style.webkitTransform = 'translateY(-' + y + 'px)';
  },
  syncNow: function (quiet) {
    var self = this;
    if (!quiet) toast(tx('syncing'));
    syncAddons(function (changed) {
      if (!quiet) toast(changed ? tx('addonsUpdated') : tx('addonsCurrent'));
      self.draw();
      invalidateBoards();
    });
  },
  openStore: function () {
    var self = this;
    this.inStore = true;
    this.draw();
    if (this.store) return;
    xhrJson(
      '/addons/store',
      function (j) {
        self.store = (j && j.addons && j.addons.length && j.addons) || null;
        if (self.inStore) self.draw();
      },
      20000
    );
  },
  /* on the account; the addons are synced again after it */
  change: function (url, remove) {
    var self = this;
    toast(tx('saving'));
    postJson(
      '/addons/change',
      { authKey: authKey(), url: url, remove: !!remove },
      function (j) {
        if (!j || !j.ok) return toast(tx('addonNotChanged'));
        toast(tx(remove ? 'addonRemoved' : 'addonInstalled'));
        self.syncNow(true);
      },
      30000
    );
  },
  askAddress: function () {
    var box = $('aUrl');
    box.value = '';
    box.placeholder = tx('addonUrlHint');
    box.style.display = 'block';
    box.focus();
  },
  activate: function (i) {
    if (!this.inStore && i === 0) return this.openStore();
    if (!this.inStore && i === 1) return this.askAddress();
    if (!this.inStore && i === 2) return this.syncNow();
    var ad = this.list[i - this.first()];
    if (!ad) return;
    if (this.inStore) return this.change(ad.url);
    /* removing asks for a second OK */
    if (this.armed !== i) {
      this.armed = i;
      return toast(tx('removeAddonConfirm'));
    }
    this.change(ad.transportUrl, true);
  },
  back: function () {
    if (!this.inStore) return false;
    this.inStore = false;
    this.draw();
    return true;
  },
  key: function (k) {
    var top = !this.inStore && this.idx < 3;
    if (k === 40)
      this.idx = top ? Math.min(this.els.length - 1, 3) : Math.min(this.els.length - 1, this.idx + 1);
    else if (k === 38) {
      if (this.idx > this.first()) this.idx--;
      else if (!this.inStore && this.idx >= 3) this.idx = 0;
    } else if (k === 39 && top) this.idx = Math.min(2, this.idx + 1);
    else if (k === 37) {
      if (top && this.idx > 0) this.idx--;
      else topNav.focus();
    } else if (k === 13) return this.activate(this.idx), true;
    this.armed = this.armed === this.idx ? this.armed : -1;
    this.paint();
    return true;
  }
};
on($('aUrl'), 'keydown', function (e) {
  if (e.keyCode !== 13 && !isRemoteBack(e.keyCode)) return;
  e.preventDefault();
  e.stopPropagation();
  var url = String($('aUrl').value || '').trim();
  $('aUrl').blur();
  $('aUrl').style.display = 'none';
  if (e.keyCode === 13 && url) addonPanel.change(url);
});
