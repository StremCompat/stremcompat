// Card and row construction, with texture virtualization for low-memory TVs.
/* ---- image virtualization: this TV has ~38MB free RAM; keeping EVERY row's decoded
   posters pinned (Discover = 200+) is what caused blockiness then OOM crashes. Only rows
   near the cursor keep real textures; far rows hold a 1px placeholder and reload from the
   HTTP cache when you scroll back. ---- */
var BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/* Pictures the local server makes (/app/img) take their turn, a few at a time: each one holds one of
   the six connections the TV's browser opens to the server while FFmpeg makes it, and Home's
   catalogs waited behind a row of collection covers until they timed out and their rows went. */
var imgBusy = 0,
  imgWaiting = [];
function imgNext() {
  var lanes = TV_PROFILE.lowMemory ? 2 : 3;
  while (imgBusy < lanes && imgWaiting.length) {
    var im = imgWaiting.shift(),
      url = im._queued;
    if (!url) continue;
    im._queued = null;
    startImg(im, url);
  }
}
/* a picture of its own fetches it (into the HTTP cache), and the card shows it once it came: events
   of the card's own picture can belong to the blank it had before */
function startImg(im, url) {
  var loader = new Image(),
    finished = false;
  function free() {
    if (finished) return;
    finished = true;
    loader.onload = loader.onerror = null;
    imgBusy--;
    if (im._loading === url) {
      im._loading = null;
      im.src = url;
    }
    imgNext();
  }
  imgBusy++;
  im._loading = url;
  loader.onload = loader.onerror = free;
  setTimeout(free, 20000);
  loader.src = url;
}
function showImg(im, url) {
  if (url.indexOf('/app/img?') < 0) {
    im._queued = im._loading = null;
    im.src = url;
    return;
  }
  if (im._loading === url) return;
  if (!im._queued) imgWaiting.push(im);
  im._queued = url;
  imgNext();
}
/* a picture near the focus is shown; one far from it gives its memory back and keeps where it was */
function setImgNear(im, near) {
  if (near) {
    if (!im._full) return;
    var url = im._full;
    im._full = null;
    showImg(im, url);
  } else if (im._queued || im._loading) {
    im._full = im._queued || im._loading;
    im._queued = im._loading = null;
  } else if (im.src && im.src !== BLANK_IMG) {
    im._full = im.src;
    im.src = BLANK_IMG;
  }
}
function setRowLoaded(row, on) {
  if (!row || !row.cardsEl) return;
  if (row._loaded === on && on !== true) return;
  row._loaded = on;
  /* within a row only the cards near its focus keep their pictures, so a row of hundreds of titles
     (a big Library) costs no more than a short one */
  var cards = row.cardEls && row.cardEls.length ? row.cardEls : [row.cardsEl],
    col = row.col || 0;
  for (var c = 0; c < cards.length; c++) {
    var near = on && (cards === row.cardEls ? c >= col - 8 && c <= col + 16 : true),
      imgs = cards[c].getElementsByTagName('img');
    for (var i = imgs.length - 1; i >= 0; i--) setImgNear(imgs[i], near);
  }
}
function virtualizeBoard(b, center, fast) {
  for (var r = 0; r < b.rows.length; r++) {
    var d = Math.abs(r - center);
    var radius = TV_PROFILE.lowMemory ? (fast ? 0 : 1) : fast ? 1 : 2;
    if (d <= radius) setRowLoaded(b.rows[r], true);
    else if (d > radius) setRowLoaded(b.rows[r], false);
  }
}
function unloadBoard(b) {
  if (!b) return;
  for (var r = 0; r < b.rows.length; r++) setRowLoaded(b.rows[r], false);
}
/* a Collections folder tile: its cover, else its emoji or first letters, and its name under it */
/* A folder's cover as the local server shrinks it to the tile's width (a pack's covers are often
   large and decoding them whole is what made the tiles slow and blurry); a PNG keeps its alpha. */
function folderArtUrl(it) {
  var w = it.shape === 'wide' ? 420 : 240; /* the 1080p tiles are 412 and 232 wide */
  return /^https?:\/\//i.test(it.poster)
    ? '/app/img?w=' + w + '&u=' + encodeURIComponent(it.poster)
    : it.poster;
}
function makeFolderCard(it, eager) {
  var d = document.createElement('div'),
    art = document.createElement('div');
  d.className = 'card folder f-' + (it.shape || 'poster');
  art.className = 'fart';
  if (it.poster) {
    var img = new Image();
    img.onerror = function () {
      art.innerHTML = '<div class="fglyph">' + esc(it.glyph || '') + '</div>';
    };
    if (eager) showImg(img, folderArtUrl(it));
    else {
      img._full = folderArtUrl(it);
      img.src = BLANK_IMG;
    }
    art.appendChild(img);
  } else art.innerHTML = '<div class="fglyph">' + esc(it.glyph || '') + '</div>';
  d.appendChild(art);
  if (it.name) {
    var label = document.createElement('div');
    label.className = 'flabel';
    label.textContent = it.name;
    d.appendChild(label);
  }
  return d;
}
function makeCard(it, wide, label, eager) {
  if (it.folder) return makeFolderCard(it, eager);
  var d = document.createElement('div');
  d.className =
    'card' + (wide ? ' wide' : '') + (label && !wide ? ' labeled' + (titleUnder(it) ? ' tunder' : '') : '');
  /* no artwork: drop the broken image and show the title on a gradient instead */
  function noArt(img) {
    if (img && img.parentNode) img.parentNode.removeChild(img);
    if (d.className.indexOf('noart') < 0) d.className += ' noart';
    nm.style.display = 'block';
  }
  /* dark placeholder only — the title text is HIDDEN until/unless the art fails to load,
     so scrolling never flashes text before the poster paints (that was the glitch) */
  var nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = it.name || it.id;
  nm.style.display = 'none';
  d.appendChild(nm);
  var src = wide ? bgSmall(it) : posterOf(it);
  if (src) {
    var img = new Image();
    img.onload = function () {
      d.insertBefore(img, d.firstChild);
      img.onload = null;
    };
    img.onerror = function () {
      if (img.src !== BLANK_IMG) noArt(img);
    };
    /* LAZY by default: rows away from the cursor never even START their downloads/decodes
       (the boot flood of ~100 posters was part of the slow/unstable startup) */
    if (eager) showImg(img, src);
    else {
      img._full = src;
      img.src = BLANK_IMG;
      d.insertBefore(img, d.firstChild);
      img.onload = null;
    }
  } else noArt(null);
  if (label && !wide) {
    var tl = document.createElement('div');
    tl.className = 'titlelabel';
    tl.textContent = it.name || '';
    d.appendChild(tl);
  }
  if (!wide && itemWatched(it)) {
    var wb = document.createElement('div');
    wb.className = 'wbadge';
    wb.innerHTML = ICON.check;
    d.appendChild(wb);
  }
  if (wide) {
    var lb = document.createElement('div');
    lb.className = 'cwlabel';
    lb.textContent = it.name || '';
    var sub = cwSubtitle(it);
    if (sub) {
      var sl = document.createElement('div');
      sl.className = 'sub' + (it.upNext || it.fresh || it.airsAt ? ' next' : '');
      sl.textContent = sub;
      lb.appendChild(sl);
    }
    d.appendChild(lb);
    if (it.progress > 0) {
      var pb = document.createElement('div');
      pb.className = 'pbar';
      var fill = document.createElement('div');
      fill.style.width = Math.min(100, Math.round(it.progress * 100)) + '%';
      pb.appendChild(fill);
      d.appendChild(pb);
    }
  }
  return d;
}

/* An empty screen says what happened and what to do next. */
function emptyState(title, hint) {
  return (
    '<div class="empty"><div class="emptyic">' +
    ICON.info +
    '</div><div class="emptyt">' +
    esc(title) +
    '</div><div class="emptyh">' +
    esc(hint) +
    '</div></div>'
  );
}
/* Static grey cards the size of real ones while a catalog loads, so the board does not
   jump when it arrives. No images and no animation: nothing to decode or repaint. */
function placeholderCards(row) {
  var n = Math.min(8, Math.ceil(contentWidth() / (row.wide ? 454 : 288)) + 1);
  for (var i = 0; i < n; i++) {
    var c = document.createElement('div');
    c.className = 'card ph' + (row.wide ? ' wide' : '');
    row.cardsEl.appendChild(c);
  }
  row.el.className = 'row in';
}
function buildRow(title, items, wide, label, eager) {
  var row = { title: title, items: items, col: 0, wide: !!wide };
  var el = document.createElement('div');
  el.className = 'row';
  var tt = document.createElement('div');
  tt.className = 'rowtitle';
  tt.textContent = title;
  el.appendChild(tt);
  var cards = document.createElement('div');
  cards.className = 'cards';
  el.appendChild(cards);
  row.el = el;
  row.cardsEl = cards;
  row.cardEls = [];
  for (var i = 0; i < items.length; i++) {
    var c = makeCard(items[i], wide, label, eager);
    cards.appendChild(c);
    row.cardEls.push(c);
  }
  return row;
}
