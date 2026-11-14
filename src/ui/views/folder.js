// A Nuvio Collections folder as Nuvio's apps open it: its cover on top, a tab per source (and
// "All" first, mixing them, when the folder asks for it) over a poster grid that keeps loading.
// A folder set to rows opens as rows instead (boards.js fold).
var folderPage = {
  view: null,
  tabs: [],
  tabIdx: 0,
  zone: 'grid',
  idx: 0,
  els: [],
  cols: 6,
  gen: 0,
  enter: function (folder) {
    var v = folderView(folder);
    this.view = v;
    this.tabs = [];
    if (v.all) this.tabs.push({ title: tx('folderAll'), all: true });
    for (var i = 0; i < v.sources.length; i++)
      this.tabs.push({ source: v.sources[i], title: v.sources[i].title });
    for (var t = 0; t < this.tabs.length; t++) {
      this.tabs[t].items = [];
      this.tabs[t].skip = 0;
      this.tabs[t].ended = false;
    }
    this.tabIdx = 0;
    this.zone = 'grid';
    this.idx = 0;
    $('fdTitle').textContent = v.title;
    var cover = $('fdCover');
    cover.style.display = v.cover ? '' : 'none';
    if (v.cover) cover.src = '/app/img?w=1280&u=' + encodeURIComponent(v.cover);
    $('scrFolder').className = 'scr on' + (v.cover ? ' covered' : '');
    this.drawTabs();
    this.load();
  },
  drawTabs: function () {
    var html = '';
    for (var i = 0; i < this.tabs.length; i++)
      html += '<span class="schip">' + esc(this.tabs[i].title) + '</span>';
    $('fdTabs').innerHTML = html;
  },
  /* the next page of the tab in view; "All" takes the first page of each source, in turn */
  load: function () {
    var tab = this.tabs[this.tabIdx],
      self = this,
      gen = ++this.gen;
    if (!tab || tab.loading || tab.ended) return this.render();
    if (tab.source && tab.source.unavailable) {
      tab.ended = true;
      return this.render();
    }
    tab.loading = true;
    this.render();
    if (!tab.all)
      return xhrJson(discoverPageUrl(tab.source, tab.source.genre, tab.skip), function (j) {
        tab.loading = false;
        var metas = (j && j.metas) || [];
        tab.items = tab.items.concat(metas);
        tab.skip += metas.length;
        tab.ended = !metas.length;
        if (gen === self.gen) self.render();
      });
    var sources = [];
    for (var s = 0; s < this.tabs.length; s++)
      if (this.tabs[s].source && !this.tabs[s].source.unavailable) sources.push(this.tabs[s].source);
    var pages = new Array(sources.length),
      left = sources.length;
    sources.forEach(function (src, si) {
      xhrJson(discoverPageUrl(src, src.genre, 0), function (j) {
        pages[si] = (j && j.metas) || [];
        if (--left) return;
        var seen = {},
          mixed = [];
        for (var row = 0; row < 100; row++)
          for (var p = 0; p < pages.length; p++) {
            var m = pages[p][row];
            if (m && !seen[m.type + ':' + m.id]) {
              seen[m.type + ':' + m.id] = 1;
              mixed.push(m);
            }
          }
        tab.items = mixed;
        tab.loading = false;
        tab.ended = true;
        if (gen === self.gen) self.render();
      });
    });
  },
  render: function () {
    var tab = this.tabs[this.tabIdx] || { items: [] },
      host = $('fdGrid');
    host.innerHTML = '';
    this.els = [];
    for (var i = 0; i < tab.items.length; i++) {
      var c = makeCard(tab.items[i], false, true, false);
      host.appendChild(c);
      this.els.push(c);
    }
    if (!tab.items.length)
      host.innerHTML =
        '<div class="stmsg">' +
        esc(
          tab.loading
            ? tx('searching')
            : tab.source && tab.source.unavailable
              ? tx('folderSourceUnavailable')
              : tx('nothingFound')
        ) +
        '</div>';
    this.idx = Math.min(this.idx, Math.max(0, tab.items.length - 1));
    this.paint();
  },
  focusTop: function () {
    topNav.active = false;
    this.paint();
    topNav.paint();
  },
  paint: function () {
    var off = topNav.active;
    setF($('fdTabs').children, !off && this.zone === 'tabs' ? this.tabIdx : -1);
    var tabs = $('fdTabs').children;
    for (var t = 0; t < tabs.length; t++) if (t === this.tabIdx) tabs[t].className += ' on';
    setF(this.els, !off && this.zone === 'grid' ? this.idx : -1);
    var small = (document.documentElement.clientHeight || 1080) <= 800,
      step = small ? 192 : 288,
      rowH = small ? 288 : 420;
    this.cols = Math.max(3, Math.floor((($('fdGridClip').clientWidth || contentWidth()) - 14) / step));
    var row = Math.floor(this.idx / this.cols);
    /* only the rows near the focus load their posters */
    for (var i = 0; i < this.els.length; i++) {
      var imgs = this.els[i].getElementsByTagName('img'),
        near = Math.abs(Math.floor(i / this.cols) - row) <= 1;
      for (var z = 0; z < imgs.length; z++) if (near && imgs[z]._full) imgs[z].src = imgs[z]._full;
    }
    var y = row > 0 ? row * rowH : 0;
    $('fdGrid').style.transform = 'translateY(-' + y + 'px)';
    $('fdGrid').style.webkitTransform = 'translateY(-' + y + 'px)';
    var tab = this.tabs[this.tabIdx];
    if (tab && !tab.ended && !tab.loading && this.idx >= tab.items.length - this.cols * 2) this.load();
  },
  focusedItem: function () {
    var tab = this.tabs[this.tabIdx];
    return tab && this.zone === 'grid' ? tab.items[this.idx] || null : null;
  },
  key: function (k) {
    var tab = this.tabs[this.tabIdx] || { items: [] };
    if (k === 13) {
      if (this.zone === 'tabs') {
        this.zone = 'grid';
        return this.paint();
      }
      var it = tab.items[this.idx];
      if (it) openItem(it);
      return;
    }
    if (this.zone === 'tabs') {
      var before = this.tabIdx;
      if (k === 37) {
        if (this.tabIdx > 0) this.tabIdx--;
        else return topNav.focus();
      } else if (k === 39) this.tabIdx = Math.min(this.tabs.length - 1, this.tabIdx + 1);
      else if (k === 40 && tab.items.length) this.zone = 'grid';
      if (before !== this.tabIdx) {
        this.idx = 0;
        return this.load();
      }
    } else if (k === 39) this.idx = Math.min(tab.items.length - 1, this.idx + 1);
    else if (k === 37) {
      if (this.idx % this.cols) this.idx--;
      else return topNav.focus();
    } else if (k === 40) this.idx = Math.min(tab.items.length - 1, this.idx + this.cols);
    else if (k === 38) {
      if (this.idx >= this.cols) this.idx -= this.cols;
      else this.zone = 'tabs';
    }
    this.paint();
  }
};
