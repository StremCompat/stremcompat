// Row loaders for Home, Discover and Library, and opening a focused item.
/* When every catalog answered and none has titles, Home says so instead of staying blank,
   and says the TV has no connection when Stremio itself cannot be reached. */
function paintBoardMessage(board) {
  var msg = $('boardMsg');
  if (curBoard() !== board) return;
  var text = board.netCode ? tx('noConnection', board.netCode) : tx('catalogsFailed');
  msg.innerHTML = board.empty ? esc(text) + '<br>' + tx('pressOkRetry') : '';
  msg.style.display = board.empty ? 'block' : 'none';
}
function settleBoardMessage(board) {
  var any = false;
  for (var i = 0; i < board.rows.length; i++) if (board.rows[i].items.length) any = true;
  board.empty = !any;
  board.netCode = '';
  paintBoardMessage(board);
  if (any) return;
  checkConnection(function (code) {
    if (!board.empty || !code) return;
    board.netCode = code;
    paintBoardMessage(board);
  });
}
/* The opening screen stays until Home has its first rows (boot.js), so Home appears once,
   filled, instead of empty rows that fill in and blink. */
var homeFilled = false,
  onHomeFilled = null;
function markHomeFilled() {
  if (homeFilled) return;
  homeFilled = true;
  if (onHomeFilled) onHomeFilled();
}
/* generic catalog-backed board loader (rows fill in asynchronously, cache-first) */
function loadCatalogRows(board, defs, includeCW, keepFocus) {
  var oldRow = board.rowIdx,
    oldCols = [],
    loadGen = (board._loadGen || 0) + 1;
  board._loadGen = loadGen;
  board.empty = false;
  var waiting = defs.length,
    firstRows = Math.min(3, defs.length),
    started = Date.now();
  if (board === home && !firstRows) markHomeFilled();
  if (keepFocus) for (var i0 = 0; i0 < board.rows.length; i0++) oldCols.push(board.rows[i0].col);
  board.rows = [];
  function reveal(row, delay) {
    if (keepFocus) {
      row.el.className = 'row in';
      return;
    }
    setTimeout(function () {
      row.el.className = 'row in';
    }, delay);
  }
  if (includeCW) {
    var local = homeLibraryRows();
    for (var lr = 0; lr < local.length; lr++) {
      var libRow = buildRow(local[lr].title, local[lr].items, local[lr].wide);
      board.rows.push(libRow);
      reveal(libRow, 70 + lr * 20);
    }
  }
  for (var d = 0; d < defs.length; d++)
    (function (def, di) {
      /* a Collections row: folder tiles, already known, nothing to fetch */
      if (def.tiles) {
        var tileRow = buildRow(def.title, def.tiles, true, false, di < 3);
        board.rows.push(tileRow);
        reveal(tileRow, 120 + di * 80);
        waiting--;
        if (di < 3) firstRows--;
        if (board === home && (!firstRows || !waiting)) markHomeFilled();
        return;
      }
      var row = buildRow(def.title, [], false);
      row.catalog = def;
      board.rows.push(row);
      /* only the rows that start on screen get placeholders; a rebuild keeps its rows */
      if (!keepFocus && di < 3) placeholderCards(row);
      else row.el.style.display = 'none';
      getCatalogUrl(def.url, def.key, def.type, function (items, cached) {
        if (board._loadGen !== loadGen) return; /* ignore callbacks from a superseded rebuild */
        /* A row already shown from the cache keeps it once Home is on screen: the fresher
           list is saved for the next start instead of redrawing the row under the viewer. */
        if (!cached && row.fromCache && homeFilled && row.items.length) return;
        row.fromCache = !!cached;
        if (!row.answered) {
          row.answered = true;
          waiting--;
          if (di < 3) firstRows--;
          if (board === home && (!firstRows || !waiting)) markHomeFilled();
          /* shown by Settings > Diagnostics */
          if (!waiting && board === home) window.__SC_HOME_LOAD_MS__ = Date.now() - started;
        }
        if (def.skip)
          items = items.filter(function (x) {
            return x.id !== def.skip;
          });
        row.items = items.slice(0);
        row.cardsEl.innerHTML = '';
        row.cardEls = [];
        for (var i = 0; i < items.length; i++) {
          var cd = makeCard(items[i], false, false, false);
          /* the most popular catalog shows its first ten as a ranking */
          if (def.ranked && i < 10) {
            var rank = document.createElement('div');
            rank.className = 'rank';
            rank.textContent = String(i + 1);
            cd.appendChild(rank);
          }
          row.cardsEl.appendChild(cd);
          row.cardEls.push(cd);
        }
        if (items.length >= 6) addSeeAll(row, def);
        row.el.style.display = items.length ? '' : 'none';
        if (items.length) reveal(row, 180 + di * 120);
        if (row.col >= items.length) row.col = 0;
        if (curBoard() === board) {
          board.paint(true);
          board.hero();
        }
        if (!waiting || items.length) settleBoardMessage(board);
      });
    })(defs[d], d);
  if (!waiting) settleBoardMessage(board);
  if (keepFocus) {
    board.rowIdx = Math.min(oldRow, board.rows.length - 1);
    for (var j = 0; j < board.rows.length && j < oldCols.length; j++)
      board.rows[j].col = Math.min(oldCols[j] || 0, Math.max(0, board.rows[j].items.length - 1));
  } else board.rowIdx = 0;
}
/* the last card of a catalog row opens the whole catalog in Discover */
function addSeeAll(row, def) {
  var it = { more: true, catalog: def, type: def.type, name: def.title, description: tx('seeAllHint') };
  var cd = document.createElement('div');
  cd.className = 'card more';
  var lb = document.createElement('div');
  lb.className = 'morelbl';
  lb.textContent = tx('seeAll');
  cd.appendChild(lb);
  row.items.push(it);
  row.cardsEl.appendChild(cd);
  row.cardEls.push(cd);
}
/* "Because you watched X": the popular titles of the genre of what was watched last, from
   Cinemeta. Only when that title's details are already on the TV, so Home never waits for it. */
function becauseYouWatchedDef() {
  var last = cwItems(1)[0];
  if (!last || !last.id) return null;
  var kept = lsJson('beta_meta_' + last.type + '_' + last.id),
    meta = kept && kept.meta,
    genre = meta && meta.genres && meta.genres[0];
  if (!genre) return null;
  return {
    title: tx('becauseYouWatched', meta.name || last.name || ''),
    type: last.type,
    url: CIN + '/catalog/' + last.type + '/top/genre=' + encodeURIComponent(genre) + '.json',
    key: 'byw_' + last.type + '_' + genre,
    skip: last.id
  };
}
/* LIBRARY rows = Continue Watching + your added Movies + Series (all local) */
/* Continue Watching lives on Home only, as in the Stremio apps */
function loadLibraryRows(board) {
  board.rows = [];
  var all = libGridItems(),
    mv = [],
    sr = [];
  for (var i = 0; i < all.length; i++) {
    var l = all[i];
    var o = { id: l._id, type: l.type, name: l.name, poster: l.poster, background: l.background };
    if (l.type === 'series') sr.push(o);
    else mv.push(o);
  }
  if (mv.length) {
    var rm = buildRow(tx('movies'), mv, false, true);
    rm.el.className = 'row in';
    board.rows.push(rm);
  }
  if (sr.length) {
    var rs = buildRow(tx('series'), sr, false, true);
    rs.el.className = 'row in';
    board.rows.push(rs);
  }
  if (!board.rows.length) {
    var e = document.createElement('div');
    e.className = 'row in';
    e.innerHTML = emptyState(tx('emptyLibraryTitle'), tx('emptyLibraryHint'));
    board.rows.push({ el: e, items: [], cardEls: [], cardsEl: document.createElement('div'), col: 0 });
  }
  board.rowIdx = 0;
}
/* rows the server lays out ({ title, items }) */
function loadServerRows(board, path, key) {
  board.rows = [];
  xhrJson(
    path,
    function (j) {
      var groups = (j && j[key]) || [];
      board.rows = [];
      for (var g = 0; g < groups.length; g++) {
        var items = [];
        for (var i = 0; i < groups[g].items.length; i++) {
          var it = groups[g].items[i];
          items.push({
            id: it.id || it.url,
            type: it.type || 'tv',
            name: it.name,
            poster: it.art || it.poster || it.logo,
            background: it.backdrop || it.background || ''
          });
        }
        var row = buildRow(groups[g].title, items, false, true);
        row.el.className = 'row in';
        board.rows.push(row);
      }
      if (!board.rows.length) {
        var e = document.createElement('div');
        e.className = 'row in';
        e.innerHTML = emptyState((j && j.empty) || '', '');
        board.rows.push({ el: e, items: [], cardEls: [], cardsEl: document.createElement('div'), col: 0 });
      }
      board.rowIdx = 0;
      if (curBoard() === board) {
        board.mount();
        board.paint(true);
      }
    },
    60000
  );
}
/* rebuild boards that surface library/CW state after a change */
function invalidateBoards() {
  home.built = false;
  disc.built = false;
  lib.built = false;
}
function refreshCurBoard() {
  var b = curBoard();
  if (b) {
    b.built = false;
    b.enter();
  }
}
/* back-compat shim (addon sync + boot) */
function buildHomeRows(keep) {
  home.built = false;
  if (SCR === 'home') home.enter();
}

function openItem(it) {
  /* a channel of an addon's row plays live (its sources), with no title page */
  if (isLiveType(it.type)) return playChannel(it, 'beta#home');
  if (it.folder) {
    goScr('fold', { folder: it.folder });
    return;
  }
  if (it.more) {
    disc.openCatalog(it.catalog);
    return;
  }
  if (it.cw) {
    var q = resumeSearch(it.id, it.videoId);
    var backHash =
      'beta#detail/' + it.type + '/' + it.id + (it.videoId && it.videoId !== it.id ? '/' + it.videoId : '');
    if (q) {
      playStored(q, backHash);
      return;
    }
  }
  goScr('detail', { type: it.type, id: it.id, vid: it.videoId || null });
}
