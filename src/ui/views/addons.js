// Addons screen.
/* ================= ADDONS =================
   The account's addons, with three buttons on top: the store, adding one by its address, and
   syncing. OK twice on an installed addon removes it. The store shows the community addons not
   installed yet, most popular first, as cards three to a row with a small picture and the whole
   description; one that needs setting up shows a QR code for the phone instead. Changes are made
   on the account (server/addon-store.js), so they show up on the person's other devices too. */
var STORE_TYPES = ['all', 'streams', 'channels', 'subtitles', 'catalogs'];
var addonPanel = {
  idx: 0,
  els: [],
  list: [],
  armed: -1,
  inStore: false,
  enter: function () {
    this.inStore = false;
    this.draw();
    animIn($('aWrap'));
    if (!addons().length) this.syncNow(true);
  },
  /* the three buttons, then the installed addons */
  draw: function () {
    $('aStore').textContent = tx('addonStore');
    $('aAdd').textContent = tx('addAddon');
    $('aSync').textContent = tx('syncAddons');
    $('aTitle').textContent = this.inStore ? tx('addonStore') : 'Addons';
    $('aHelp').textContent = tx('addonsHint');
    $('aBtns').style.display = this.inStore ? 'none' : '';
    $('aClip').style.display = this.inStore ? 'none' : '';
    $('aStoreWrap').style.display = this.inStore ? 'block' : 'none';
    if (this.inStore) return addonStore.draw();
    this.els = [$('aStore'), $('aAdd'), $('aSync')];
    this.idx = Math.min(this.idx, 2);
    this.armed = -1;
    this.list = addons();
    var host = $('aInner');
    host.innerHTML = '';
    for (var i = 0; i < this.list.length; i++) {
      var m = this.list[i].manifest || {},
        d = document.createElement('div'),
        n = document.createElement('div'),
        info = document.createElement('div');
      d.className = 'addon';
      n.className = 'an';
      n.textContent = m.name || m.id || 'Addon';
      info.className = 'ai';
      info.textContent = [m.id || '', m.version || '', (m.types || []).join(' · ')]
        .join('   ')
        .replace(/\s+/g, ' ');
      d.appendChild(n);
      d.appendChild(info);
      host.appendChild(d);
      this.els.push(d);
    }
    if (!this.list.length) {
      var empty = document.createElement('div');
      empty.className = 'stmsg';
      empty.textContent = tx('noAddons');
      host.appendChild(empty);
    }
    this.paint();
  },
  focusTop: function () {
    topNav.active = false;
    this.idx = 0;
    if (this.inStore) addonStore.paint();
    else this.paint();
    topNav.paint();
  },
  paint: function () {
    if (this.inStore) return addonStore.paint();
    setF(this.els, topNav.active ? -1 : this.idx);
    var y = 0;
    if (this.idx > 6) {
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
      if (!self.inStore) self.draw();
      invalidateBoards();
    });
  },
  /* on the account; the addons are synced again after it */
  change: function (url, remove, done) {
    var self = this;
    toast(tx('saving'));
    postJson(
      '/addons/change',
      { authKey: authKey(), url: url, remove: !!remove },
      function (j) {
        if (!j || !j.ok) return toast(tx('addonNotChanged'));
        toast(tx(remove ? 'addonRemoved' : 'addonInstalled'));
        if (done) done();
        self.syncNow(true);
      },
      30000
    );
  },
  /* the address typed, or pasted from the phone (text-panel.js) */
  askAddress: function () {
    var self = this;
    textPanel.show({
      title: tx('addAddon'),
      hint: tx('addonUrlHint'),
      url: true,
      done: function (url) {
        self.change(url);
      }
    });
  },
  activate: function (i) {
    if (this.inStore) return addonStore.activate();
    if (i === 0) {
      this.inStore = true;
      this.draw();
      return addonStore.open();
    }
    if (i === 1) return this.askAddress();
    if (i === 2) return this.syncNow();
    var ad = this.list[i - 3];
    if (!ad) return;
    /* removing asks for a second OK */
    if (this.armed !== i) {
      this.armed = i;
      return toast(tx('removeAddonConfirm'));
    }
    this.change(ad.transportUrl, true);
  },
  back: function () {
    if (qrPanel.open) return qrPanel.close(), true;
    if (!this.inStore) return false;
    this.inStore = false;
    this.draw();
    return true;
  },
  key: function (k) {
    if (qrPanel.open) return qrPanel.close(), true;
    if (this.inStore) return addonStore.key(k);
    var top = this.idx < 3;
    if (k === 40)
      this.idx = top ? Math.min(this.els.length - 1, 3) : Math.min(this.els.length - 1, this.idx + 1);
    else if (k === 38) {
      if (this.idx > 3) this.idx--;
      else if (this.idx >= 3) this.idx = 0;
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

/* ---------- the store: chips for the kinds, then cards three to a row ---------- */
var addonStore = {
  type: 'all',
  zone: 'grid',
  chipIdx: 0,
  idx: 0,
  items: [],
  more: false,
  loading: false,
  gen: 0,
  open: function () {
    this.type = 'all';
    this.chipIdx = 0;
    this.load(false);
  },
  /* the installed addons are left out: the server is told which */
  load: function (next) {
    var self = this,
      gen = ++this.gen;
    if (!next) {
      this.items = [];
      this.idx = 0;
      this.zone = 'grid';
    }
    this.loading = true;
    var ids = [],
      have = addons();
    for (var i = 0; i < have.length; i++)
      if (have[i].manifest && have[i].manifest.id) ids.push(have[i].manifest.id);
    this.draw();
    xhrJson(
      '/addons/store?type=' +
        this.type +
        '&skip=' +
        this.items.length +
        '&installed=' +
        encodeURIComponent(ids.join(',')),
      function (j) {
        if (gen !== self.gen) return;
        self.loading = false;
        self.items = self.items.concat((j && j.addons) || []);
        self.more = !!(j && j.more);
        self.draw();
      },
      30000
    );
  },
  picture: function (a) {
    if (a.background) return { src: '/app/img?w=480&u=' + encodeURIComponent(a.background), cover: true };
    if (a.logo) return { src: '/app/img?w=240&u=' + encodeURIComponent(a.logo), cover: false };
    return { src: '/logo.png', cover: false };
  },
  draw: function () {
    var chips = '';
    for (var c = 0; c < STORE_TYPES.length; c++)
      chips += '<span class="schip">' + esc(tx('store_' + STORE_TYPES[c])) + '</span>';
    $('aChips').innerHTML = chips;
    var html = '';
    for (var i = 0; i < this.items.length; i++) {
      var a = this.items[i],
        pic = this.picture(a);
      html +=
        '<div class="scard"><div class="simg' +
        (pic.cover ? ' cover' : '') +
        '"><img src="' +
        esc(pic.src) +
        "\" onerror=\"this.onerror=null;this.src='/logo.png';this.parentNode.className='simg'\"></div>" +
        '<div class="sbody"><div class="sname">' +
        esc(a.name) +
        '</div><div class="smeta">' +
        esc([a.version ? 'v' + a.version : '', (a.types || []).join(' · ')].join('   ')) +
        '</div><div class="sdesc">' +
        esc(a.description || '') +
        '</div><div class="sbtn">' +
        esc(tx(a.configure ? 'storeConfigure' : 'installAddon')) +
        '</div></div></div>';
    }
    if (!this.items.length)
      html = '<div class="stmsg">' + esc(this.loading ? tx('searching') : tx('storeUnavailable')) + '</div>';
    $('aGrid').innerHTML = html;
    this.paint();
  },
  paint: function () {
    var off = topNav.active;
    setF($('aChips').children, !off && this.zone === 'chips' ? this.chipIdx : -1);
    var chips = $('aChips').children;
    for (var c = 0; c < chips.length; c++) if (STORE_TYPES[c] === this.type) chips[c].className += ' on';
    var cards = $('aGrid').getElementsByClassName('scard');
    setF(cards, !off && this.zone === 'grid' ? this.idx : -1);
    /* the focused row in view */
    var row = Math.floor(this.idx / 3),
      card = cards[0],
      y = card && row > 0 ? row * (card.offsetHeight + 24) : 0;
    $('aGrid').style.transform = 'translateY(-' + y + 'px)';
    $('aGrid').style.webkitTransform = 'translateY(-' + y + 'px)';
    if (this.more && !this.loading && this.idx >= this.items.length - 6) this.load(true);
  },
  activate: function () {
    if (this.zone === 'chips') {
      this.type = STORE_TYPES[this.chipIdx];
      return this.load(false);
    }
    var a = this.items[this.idx],
      self = this;
    if (!a) return;
    if (a.configure) return qrPanel.show(a.name, tx('storeConfigureHint'), a.configure);
    addonPanel.change(a.url, false, function () {
      self.items.splice(self.idx, 1);
      self.idx = Math.min(self.idx, self.items.length - 1);
      self.draw();
    });
  },
  key: function (k) {
    if (k === 13) return this.activate(), true;
    if (this.zone === 'chips') {
      if (k === 37) {
        if (this.chipIdx > 0) this.chipIdx--;
        else topNav.focus();
      } else if (k === 39) this.chipIdx = Math.min(STORE_TYPES.length - 1, this.chipIdx + 1);
      else if (k === 40 && this.items.length) this.zone = 'grid';
    } else if (k === 39) this.idx = Math.min(this.items.length - 1, this.idx + 1);
    else if (k === 37) {
      if (this.idx % 3) this.idx--;
      else topNav.focus();
    } else if (k === 40) this.idx = Math.min(this.items.length - 1, this.idx + 3);
    else if (k === 38) {
      if (this.idx >= 3) this.idx -= 3;
      else this.zone = 'chips';
    }
    this.paint();
    return true;
  }
};

/* a QR code for the phone (an addon's set-up page), closed by any key */
var qrPanel = {
  open: false,
  show: function (title, hint, url) {
    var self = this;
    xhrJson(
      '/addons/qr?u=' + encodeURIComponent(url),
      function (j) {
        if (!j || !j.svg) return toast(tx('addonNotChanged'));
        $('qrTitle').textContent = title;
        $('qrHint').textContent = hint;
        $('qrCode').innerHTML = j.svg;
        $('qrUrl').textContent = url;
        $('qrPanel').style.display = 'block';
        self.open = true;
      },
      8000
    );
  },
  close: function () {
    this.open = false;
    $('qrPanel').style.display = 'none';
  }
};
