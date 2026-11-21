// Source picker overlay.
/* ================= STREAMS OVERLAY ================= */
var streamsUI = {
  open: false,
  items: [],
  idx: 0,
  els: [],
  groups: [],
  pool: [],
  trimmed: {},
  type: '',
  id: '',
  vid: '',
  seq: 0,
  requestSeq: 0,
  autoPref: null,
  zone: 'list',
  filter: 'All',
  langFilter: 'All',
  langs: [],
  chipIdx: 0,
  chips: [],
  chipEls: [],
  /* the addon tabs: their keys (the addon names, 'All' first) and elements */
  addonFilter: 'All',
  addons: [],
  addonIdx: 0,
  addonEls: [],
  failed: [],
  left: [],
  title: '',
  flushT: null,
  bestT: null,
  /* back: where the player returns to, when it is not the title page (a live channel) */
  show: function (type, id, vid, title, bestQuality, bestLanguage, back) {
    var request = ++this.requestSeq;
    this.back = back || '';
    this.open = true;
    this.failed = [];
    this.left = [];
    this.title = title || '';
    this.cancelFlush();
    this.cancelBest();
    this.items = [];
    this.idx = 0;
    this.moved = false;
    this.els = [];
    this.groups = [];
    this.pool = [];
    this.trimmed = {};
    this.type = type;
    this.id = id;
    this.vid = vid;
    this.seq = 0;
    this.autoPref = takeNextSourcePreference(id, vid);
    this.retryPref = takeRetryRequest(id, vid);
    this.zone = 'list';
    this.filter = 'All';
    this.langFilter = 'All';
    this.langs = [];
    this.chipIdx = 0;
    this.chips = [];
    this.chipEls = [];
    this.addonFilter = 'All';
    this.addons = [];
    this.addonIdx = 0;
    this.addonEls = [];
    /* Best source from the title page goes straight to the film, without waiting more than
       BEST_WAIT_MS for the slowest addons; the list only appears if nothing can be chosen */
    this.searching = !!bestQuality;
    if (bestQuality) toast(tx('findingSources'));
    else this.reveal();
    var self = this;
    if (bestQuality)
      this.bestT = setTimeout(function () {
        self.bestT = null;
        /* played: the search's later answers are no longer this screen's */
        if (self.requestSeq === request && self.searching && self.startBest(bestQuality, bestLanguage))
          self.requestSeq++;
      }, BEST_WAIT_MS);
    $('stChips').innerHTML = '';
    $('stAddons').innerHTML = '';
    $('stAddons').style.display = 'none';
    $('stLang').style.display = 'none';
    $('stBest').style.display = 'none';
    $('stBest').innerHTML = ICON.bolt + esc(tx('playBest'));
    $('stSub').textContent =
      (title || '') +
      (vid && vid.indexOf(':') > 0 ? '  ·  T' + vid.split(':')[1] + ' E' + vid.split(':')[2] : '');
    $('stInner').innerHTML = '<div class="stmsg">' + tx('findingSources') + '</div>';
    /* the source played last, while the server still has it */
    var q = resumeSearch(id, vid);
    if (q)
      storedAlive(q, function (alive) {
        if (!alive || !self.open || self.requestSeq !== request) return;
        self.push(
          [
            {
              addon: tx('lastSource'),
              name: tx('continuePlayback'),
              title: tx('sameSource'),
              stored: q,
              quality: 'Recent',
              seeders: 999999,
              compatLabels: [],
              compatRank: 0
            }
          ],
          0,
          tx('lastSource')
        );
      });
    fetchStreams(
      type,
      vid,
      function (part, gi, gn) {
        if (self.open && self.requestSeq === request) self.push(part, gi + 1, gn);
      },
      function (total, failed) {
        if (!self.open || self.requestSeq !== request) return;
        self.cancelBest();
        self.failed = failed || [];
        if (!self.pool.length) {
          self.reveal();
          $('stInner').innerHTML =
            '<div class="stmsg">' +
            (self.failed.length
              ? esc(tx('addonsNoAnswer', self.failed.join(', '))) + '<br>' + tx('pressOkRetry')
              : tx('noSources')) +
            '</div>';
          return;
        }
        self.flush();
        /* a channel with one source plays it at once */
        if (self.back && self.items.length === 1)
          return playUrl(self.items[0], self.type, self.id, self.vid, self.back);
        if (bestQuality) {
          if (!self.startBest(bestQuality, bestLanguage)) self.reveal();
          return;
        }
        if (self.retryPref) {
          var retry = nextSourceAfterFailure(self.items, self.retryPref);
          self.retryPref = null;
          if (retry) {
            toast(tx('tryingNextSource'));
            playUrl(retry, self.type, self.id, self.vid, self.backHash());
          } else toast(tx('noOtherSource'));
          return;
        }
        var matched = matchingNextSource(self.all(), self.autoPref);
        self.autoPref = null;
        if (matched) {
          var backHash = 'beta#detail/' + self.type + '/' + self.id + '/' + self.vid;
          playUrl(matched, self.type, self.id, self.vid, backHash);
        }
      },
      function (left) {
        if (!self.open || self.requestSeq !== request) return;
        self.left = left;
        if (self.items.length) self.flushSoon();
      }
    );
  },
  reveal: function () {
    this.searching = false;
    $('streams').style.display = 'block';
    bodyAdd('streamsopen');
  },
  backHash: function () {
    if (this.back) return this.back;
    return 'beta#detail/' + this.type + '/' + this.id + (this.vid !== this.id ? '/' + this.vid : '');
  },
  chooseBest: function () {
    var self = this;
    cwMenu.withBestChoice(function (quality, language) {
      self.startBest(quality, language);
    });
  },
  /* the source list stays open underneath when nothing can be picked */
  startBest: function (quality, language) {
    var best = bestSource(this.items, quality, language);
    if (!best) return false;
    toast(tx('playingBest', best.quality || best.addon || ''));
    playUrl(best, this.type, this.id, this.vid, this.backHash());
    return true;
  },
  push: function (arr, gIdx, gName) {
    if (!this.open) return;
    for (var i = 0; i < arr.length; i++) {
      arr[i]._seq = this.seq++;
      this.pool.push(arr[i]);
    }
    this.compact();
    /* Every answering addon used to rebuild the whole list while the viewer was moving
       through it. The first answer is drawn at once; later ones are drawn together. */
    if (!this.items.length) this.flush();
    else this.flushSoon();
  },
  flushSoon: function () {
    var self = this;
    if (!this.flushT)
      this.flushT = setTimeout(function () {
        self.flushT = null;
        if (self.open) self.flush();
      }, 300);
  },
  cancelFlush: function () {
    if (this.flushT) clearTimeout(this.flushT);
    this.flushT = null;
  },
  cancelBest: function () {
    if (this.bestT) clearTimeout(this.bestT);
    this.bestT = null;
  },
  flush: function () {
    this.cancelFlush();
    this.renderChips();
    this.rebuild();
  },
  sourceKey: function (s) {
    return streamSourceKey(s);
  },
  compact: function () {
    var cap = TV_PROFILE.sourceCap || 60;
    var result = compactSourcePool(this.pool, cap);
    this.pool = result.items;
    this.trimmed = result.trimmed;
  },
  all: function () {
    return this.pool.slice(0);
  },
  renderChips: function () {
    var host = $('stChips'),
      allItems = this.all(),
      chips = qualityChips(allItems, this.trimmed, this.langFilter, this.addonFilter);
    host.innerHTML = '';
    this.chips = [];
    this.chipEls = [];
    for (var i = 0; i < chips.length; i++) {
      var c = document.createElement('div');
      c.className = 'stchip';
      c.textContent = chips[i].label;
      host.appendChild(c);
      this.chips.push(chips[i].key);
      this.chipEls.push(c);
    }
    var k = this.chips.indexOf(this.filter);
    if (k < 0) {
      this.filter = 'All';
      k = 0;
    }
    this.chipIdx = k;
    $('stBest').style.display = 'inline-block';
    this.renderLangs(allItems);
    this.renderAddons(allItems);
    this.paintChips();
  },
  /* one tab per addon under the quality chips, when more than one addon has sources */
  renderAddons: function (allItems) {
    var host = $('stAddons'),
      tabs = addonChoices(allItems);
    host.innerHTML = '';
    this.addons = [];
    this.addonEls = [];
    for (var i = 0; i < tabs.length; i++) {
      var t = document.createElement('div');
      t.className = 'sttab';
      t.textContent = tabs[i].label;
      host.appendChild(t);
      this.addons.push(tabs[i].key);
      this.addonEls.push(t);
    }
    if (this.addons.indexOf(this.addonFilter) < 0) this.addonFilter = 'All';
    this.addonIdx = Math.max(0, this.addons.indexOf(this.addonFilter));
    if (!this.addons.length && this.zone === 'addons') this.zone = 'chips';
    host.style.display = this.addons.length ? 'block' : 'none';
  },
  /* The language selector stays small in the corner: it appears only when the sources
     come in two or more languages, and OK steps through them. */
  /* The language filter: 'a:pt' for sources in Portuguese audio, 's:pt' for sources that only
     carry Portuguese subtitles, with how many of each; shown when there is a choice. */
  renderLangs: function (allItems) {
    var choice = languageChoices(allItems);
    this.langCounts = choice.counts;
    this.langs = choice.keys;
    if (this.langs.indexOf(this.langFilter) < 0) this.langFilter = 'All';
    if (!this.langs.length && this.zone === 'lang') this.zone = 'chips';
    $('stLang').style.display = this.langs.length ? 'block' : 'none';
  },
  /* The filter in two steps: by audio or by embedded subtitles, then the languages of that kind
     with how many sources each; Back goes from the languages to the first step. */
  chooseLang: function () {
    var self = this,
      kinds = { a: false, s: false };
    this.langs.forEach(function (key) {
      if (key !== 'All') kinds[key.charAt(0)] = true;
    });
    cwMenu.it = null;
    cwMenu.begin(tx('langFilterTitle'), tx('langFilterSub'));
    function row(selected, label, act) {
      cwMenu.add(selected ? ICON.check : '<svg viewBox="0 0 24 24"></svg>', label, act);
    }
    if (kinds.a)
      row(this.langFilter.charAt(0) === 'a', tx('filterByAudio') + '  \u203a', function () {
        self.chooseLangOf('a');
      });
    if (kinds.s)
      row(this.langFilter.charAt(0) === 's', tx('filterBySubs') + '  \u203a', function () {
        self.chooseLangOf('s');
      });
    /* with a filter on, the way back to every source */
    if (this.langFilter !== 'All')
      cwMenu.add(ICON.close, tx('clearLangFilter'), function () {
        self.setLangFilter('All');
      });
    $('cwm').style.display = 'block';
    cwMenu.paint();
  },
  chooseLangOf: function (kind) {
    var self = this;
    cwMenu.begin(tx(kind === 's' ? 'filterBySubs' : 'filterByAudio'), tx('langFilterSub'));
    cwMenu.onBack = function () {
      self.chooseLang();
    };
    this.langs.forEach(function (key) {
      if (key.charAt(0) !== kind) return;
      var on = key === self.langFilter;
      if (on) cwMenu.idx = cwMenu.els.length;
      cwMenu.add(
        on ? ICON.check : '<svg viewBox="0 0 24 24"></svg>',
        sourceLanguageLabel(key.slice(2)) + '  \u00b7  ' + self.langCounts[key],
        function () {
          self.setLangFilter(key);
        }
      );
    });
    cwMenu.paint();
  },
  setLangFilter: function (key) {
    cwMenu.close();
    this.langFilter = key;
    this.refilter();
  },
  refilter: function () {
    this.idx = 0;
    this.moved = false;
    this.renderChips();
    this.rebuild();
  },
  paintChips: function () {
    for (var i = 0; i < this.chipEls.length; i++) {
      var cur = this.chips[i] === this.filter;
      this.chipEls[i].className =
        'stchip' + (cur ? ' cur' : '') + (this.zone === 'chips' && i === this.chipIdx ? ' f' : '');
    }
    for (var a = 0; a < this.addonEls.length; a++)
      this.addonEls[a].className =
        'sttab' +
        (this.addons[a] === this.addonFilter ? ' cur' : '') +
        (this.zone === 'addons' && a === this.addonIdx ? ' f' : '');
    this.revealChip(
      $('stChips'),
      this.chipEls,
      this.zone === 'chips' ? this.chipIdx : this.chips.indexOf(this.filter)
    );
    this.revealChip($('stAddons'), this.addonEls, this.addonIdx);
    $('stBest').className = this.zone === 'best' ? 'f' : '';
    var lang = $('stLang');
    lang.textContent = langFilterName(this.langFilter) + '  \u203a';
    lang.className = (this.langFilter !== 'All' ? 'cur' : '') + (this.zone === 'lang' ? ' f' : '');
  },
  /* When the chips do not fit (All, 4K, 1080p, 720p, SD, Other), the row scrolls so the
     focused one, or the active filter, is fully visible; the first chip keeps the row at
     the start. */
  revealChip: function (host, els, i) {
    var el = els[i];
    if (!el) return;
    var left = el.offsetLeft,
      right = left + el.offsetWidth,
      pad = 24;
    if (i === 0) host.scrollLeft = 0;
    else if (right + pad > host.scrollLeft + host.clientWidth)
      host.scrollLeft = right + pad - host.clientWidth;
    else if (left - pad < host.scrollLeft) host.scrollLeft = Math.max(0, left - pad);
  },
  rebuild: function () {
    var sel = this.moved ? this.items[this.idx] : null,
      list = orderedSources(this.all(), this.filter, this.langFilter, this.addonFilter),
      flat = list.items,
      rec = list.recommended;
    var host = $('stInner');
    host.innerHTML = '';
    this.items = [];
    this.els = [];
    for (var i = 0; i < flat.length; i++) {
      var s = flat[i],
        d = document.createElement('div');
      d.className = 'st';
      if (i === rec) {
        var tag = document.createElement('div');
        tag.className = 'rec';
        tag.textContent = tx('recommendedSource');
        d.appendChild(tag);
      }
      var a = document.createElement('div');
      a.className = 'a';
      a.textContent = sourceHeading(s);
      d.appendChild(a);
      var tags = s.stored ? [] : sourceTags(s);
      if (tags.length) {
        var tg = document.createElement('div');
        tg.className = 'tags';
        for (var ti = 0; ti < tags.length; ti++) {
          var tgi = document.createElement('span');
          tgi.className = 'tg' + (tags[ti].c ? ' ' + tags[ti].c : '');
          tgi.textContent = tags[ti].t;
          tg.appendChild(tgi);
        }
        d.appendChild(tg);
      }
      var warning = compatText(s);
      if (warning) {
        var c = document.createElement('div');
        c.className = 'compat';
        c.textContent = warning;
        d.appendChild(c);
      }
      var b = document.createElement('div');
      b.className = 'b';
      b.textContent = sourceText(s);
      d.appendChild(b);
      host.appendChild(d);
      this.items.push(s);
      this.els.push(d);
    }
    if (!this.items.length) host.innerHTML = '<div class="stmsg">' + tx('noSourcesQuality') + '</div>';
    var notes = [];
    if (this.left.length) notes.push(tx('addonsLeft', this.left.join(', ')));
    if (this.failed.length) notes.push(tx('addonsNoAnswer', this.failed.join(', ')));
    for (var n = 0; n < notes.length; n++) {
      var note = document.createElement('div');
      note.className = 'stmsg';
      note.textContent = notes[n];
      host.appendChild(note);
    }
    /* addons answer at different times: the focus stays on top until the viewer moves it, and
       only then follows the source it is on, so OK never starts another one */
    var at = sel ? this.items.indexOf(sel) : -1;
    this.idx = at >= 0 ? at : Math.min(this.idx, Math.max(0, this.items.length - 1));
    this.paint();
  },
  paint: function () {
    setF(this.els, this.zone === 'list' ? this.idx : -1);
    this.paintChips();
    var y = 0,
      el = this.els[this.idx];
    if (el && el.offsetTop > 260) y = el.offsetTop - 260;
    $('stInner').style.transform = 'translateY(-' + y + 'px)';
    $('stInner').style.webkitTransform = 'translateY(-' + y + 'px)';
  },
  close: function () {
    this.open = false;
    this.cancelFlush();
    this.cancelBest();
    this.requestSeq++;
    $('streams').style.display = 'none';
    bodyRemove('streamsopen');
  },
  choose: function () {
    var s = this.items[this.idx];
    if (!s) {
      if (this.failed.length) this.show(this.type, this.id, this.vid, this.title);
      return true;
    }
    if (s.stored)
      playStored(s.stored, this.backHash(), function () {
        toast(tx('sourcePrepareFailed'));
      });
    else playUrl(s, this.type, this.id, this.vid, this.backHash());
    return true;
  },
  key: function (k) {
    if (this.searching) return true;
    if (this.zone === 'best') {
      if (k === 13) this.chooseBest();
      else if (k === 39 && this.langs.length) {
        this.zone = 'lang';
        this.paint();
      } else if (k === 40) {
        this.zone = 'chips';
        this.paint();
      }
      return true;
    }
    if (this.zone === 'lang') {
      if (k === 13) this.chooseLang();
      else if (k === 37) {
        this.zone = 'best';
        this.paint();
      } else if (k === 40) {
        this.zone = 'chips';
        this.paint();
      }
      return true;
    }
    if (this.zone === 'chips') {
      if (k === 38) {
        this.zone = 'best';
        this.paint();
        return true;
      }
      if (k === 39) this.chipIdx = Math.min(this.chipEls.length - 1, this.chipIdx + 1);
      else if (k === 37) this.chipIdx = Math.max(0, this.chipIdx - 1);
      else if (k === 40 || k === 13) {
        if (this.addons.length || this.items.length) {
          this.zone = this.addons.length ? 'addons' : 'list';
          this.paint();
        }
        return true;
      } else return true;
      this.filter = this.chips[this.chipIdx];
      this.refilter();
      return true;
    }
    if (this.zone === 'addons') {
      if (k === 38) this.zone = 'chips';
      else if ((k === 40 || k === 13) && this.items.length) this.zone = 'list';
      else if (k === 39 || k === 37) {
        this.addonIdx = Math.max(0, Math.min(this.addonEls.length - 1, this.addonIdx + (k === 39 ? 1 : -1)));
        this.addonFilter = this.addons[this.addonIdx];
        this.refilter();
        return true;
      }
      this.paint();
      return true;
    }
    if (k === 40) {
      if (!this.els.length) return true;
      this.idx = Math.min(this.els.length - 1, this.idx + 1);
      this.moved = true;
      this.paint();
    } else if (k === 38) {
      if (this.idx > 0) {
        this.idx--;
        this.moved = true;
        this.paint();
      } else {
        this.zone = this.addons.length ? 'addons' : 'chips';
        this.paint();
      }
    } else if (k === 13) {
      return this.choose();
    } else if (k === 37) this.close();
    return true;
  }
};
