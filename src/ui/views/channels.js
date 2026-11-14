// Channels: live channels as IPTV apps show them, the categories on the left and the focused
// category's channels on the right, with what is on now. The server sends the categories first
// and the channels a page at a time (server/app-channels.js); only the rows in view are built, so
// a list of tens of thousands of channels costs the same as a small one.
var CHANNEL_PAGE = 60;
var channelsView = {
  zone: 'cats',
  cats: [],
  catIdx: 0,
  catTop: 0,
  list: [],
  chIdx: 0,
  chTop: 0,
  more: false,
  loading: false,
  query: '',
  gen: 0,
  badLogos: {},
  enter: function () {
    var self = this;
    this.zone = 'cats';
    this.list = [];
    $('tvMsg').textContent = '';
    $('tvList').innerHTML = '';
    xhrJson(
      '/app/channels',
      function (j) {
        if (SCR !== 'tv') return;
        j = j || {};
        var cats = [{ id: 'search', title: tx('channelSearch') }];
        if (j.recent && j.recent.length)
          cats.push({ id: 'recent', title: tx('channelRecent'), count: j.recent.length });
        cats = cats.concat(j.groups || []);
        cats.push({ id: 'add', title: tx('m3uAdd') });
        self.cats = cats;
        var last = lsRaw('tvLastCat', ''),
          any = cats.length > 2,
          at = 1; /* the first category after Search, unless another was chosen before */
        for (var i = 0; i < cats.length; i++) if (cats[i].id === last) at = i;
        self.catIdx = any ? at : cats.length - 1;
        if (!any) $('tvMsg').textContent = j.empty || '';
        self.paintCats();
        self.choose(false);
      },
      60000
    );
    this.paintCats();
  },
  focusTop: function () {
    topNav.active = false;
    this.zone = 'cats';
    this.paintCats();
    this.paintList();
    topNav.paint();
  },
  /* the channels of the focused category, from the first page (or the next one) */
  choose: function (next) {
    var cat = this.cats[this.catIdx],
      self = this;
    if (!cat || cat.id === 'add' || (cat.id === 'search' && !cat.q)) return;
    if (!next) {
      this.list = [];
      this.chIdx = 0;
      this.chTop = 0;
      this.more = false;
      lsRawSet('tvLastCat', cat.id);
    }
    var gen = ++this.gen;
    this.loading = true;
    this.paintList();
    xhrJson(
      '/app/channels/group?id=' +
        encodeURIComponent(cat.id) +
        '&skip=' +
        this.list.length +
        (cat.q ? '&q=' + encodeURIComponent(cat.q) : ''),
      function (j) {
        if (gen !== self.gen) return;
        self.loading = false;
        self.list = self.list.concat((j && j.channels) || []);
        self.more = !!(j && j.more);
        self.paintList();
      },
      60000
    );
  },
  search: function () {
    var self = this;
    textPanel.show({
      title: tx('channelSearch'),
      done: function (q) {
        /* the results take the search's place in the list */
        self.cats[0] = { id: 'search', title: tx('channelSearch') + ': ' + q, q: q };
        self.catIdx = 0;
        self.paintCats();
        self.choose(false);
        self.zone = 'list';
      }
    });
  },
  rowsIn: function (host, height) {
    return Math.max(4, Math.floor(host.clientHeight / height) || 8);
  },
  paintCats: function () {
    var host = $('tvCats'),
      rows = this.rowsIn(host, host.firstChild ? host.firstChild.offsetHeight + 8 : 74),
      html = '';
    if (this.catIdx < this.catTop) this.catTop = this.catIdx;
    if (this.catIdx >= this.catTop + rows) this.catTop = this.catIdx - rows + 1;
    for (var i = this.catTop; i < Math.min(this.cats.length, this.catTop + rows); i++) {
      var c = this.cats[i],
        f = i === this.catIdx;
      html +=
        '<div class="tvcat' +
        (f ? (this.zone === 'cats' && !topNav.active ? ' f' : ' on') : '') +
        (c.id === 'add' || c.id === 'search' ? ' act' : '') +
        '"><span>' +
        esc(c.title) +
        '</span>' +
        (c.count > 0 ? '<b>' + c.count + '</b>' : '') +
        '</div>';
    }
    host.innerHTML = html;
  },
  logo: function (u) {
    if (!u || this.badLogos[u]) return '';
    return '/app/img?w=120&u=' + encodeURIComponent(u);
  },
  paintList: function () {
    var host = $('tvList'),
      rows = this.rowsIn(host, host.firstChild ? host.firstChild.offsetHeight + 10 : 112),
      html = '',
      now = Date.now();
    if (this.chIdx < this.chTop) this.chTop = this.chIdx;
    if (this.chIdx >= this.chTop + rows) this.chTop = this.chIdx - rows + 1;
    for (var i = this.chTop; i < Math.min(this.list.length, this.chTop + rows); i++) {
      var ch = this.list[i],
        logo = this.logo(ch.logo),
        pct =
          ch.start && ch.end
            ? Math.max(0, Math.min(100, ((now - ch.start) / (ch.end - ch.start)) * 100))
            : -1;
      html +=
        '<div class="tvch' +
        (i === this.chIdx && this.zone === 'list' && !topNav.active ? ' f' : '') +
        '"><div class="tvlogo">' +
        (logo
          ? '<img src="' + esc(logo) + '" data-u="' + esc(ch.logo) + '">'
          : esc((ch.name || '?').charAt(0))) +
        '</div><div class="tvtext"><div class="tvname">' +
        esc(ch.name) +
        '</div>' +
        (ch.now ? '<div class="tvnow">' + esc(ch.now) + '</div>' : '') +
        (pct >= 0 ? '<div class="tvbar"><i style="width:' + pct + '%"></i></div>' : '') +
        (ch.next ? '<div class="tvnext">' + esc(tx('channelNext', ch.next)) + '</div>' : '') +
        '</div></div>';
    }
    if (!this.list.length)
      html = '<div class="tvempty">' + esc(this.loading ? tx('searching') : tx('noChannels')) + '</div>';
    host.innerHTML = html;
    /* a logo that does not load is not asked for again */
    var self = this,
      imgs = host.getElementsByTagName('img');
    for (var m = 0; m < imgs.length; m++)
      imgs[m].onerror = function () {
        self.badLogos[this.getAttribute('data-u')] = 1;
        this.parentNode.textContent = '';
      };
    /* the next page comes before the end is reached */
    if (this.more && !this.loading && this.chIdx >= this.list.length - 10) this.choose(true);
  },
  activate: function () {
    var cat = this.cats[this.catIdx],
      self = this;
    if (this.zone === 'cats') {
      if (cat.id === 'search' && !this.list.length) return this.search();
      if (cat.id === 'search' && this.zone === 'cats' && cat.q && !this.list.length) return this.search();
      if (cat.id === 'add')
        return askM3uList(function (ok) {
          if (ok) self.enter();
        });
      if (this.list.length) this.zone = 'list';
      this.paintCats();
      return this.paintList();
    }
    var ch = this.list[this.chIdx];
    if (ch) playChannel(ch, 'beta#tv');
  },
  back: function () {
    if (this.zone !== 'list') return false;
    this.zone = 'cats';
    this.paintCats();
    this.paintList();
    return true;
  },
  key: function (k) {
    if (k === 13) return this.activate();
    if (this.zone === 'cats') {
      var before = this.catIdx;
      if (k === 40) this.catIdx = Math.min(this.cats.length - 1, this.catIdx + 1);
      else if (k === 38) this.catIdx = Math.max(0, this.catIdx - 1);
      else if (k === 39 && this.list.length) this.zone = 'list';
      else if (k === 37) return topNav.focus();
      if (before !== this.catIdx) {
        var self = this;
        /* the channels follow the focus after a short pause, so scrolling stays light */
        clearTimeout(this.chooseT);
        this.chooseT = setTimeout(function () {
          self.choose(false);
        }, 250);
      }
    } else {
      if (k === 40) this.chIdx = Math.min(this.list.length - 1, this.chIdx + 1);
      else if (k === 38) this.chIdx = Math.max(0, this.chIdx - 1);
      else if (k === 37) this.zone = 'cats';
    }
    this.paintCats();
    this.paintList();
  }
};
