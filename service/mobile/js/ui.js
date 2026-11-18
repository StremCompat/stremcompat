/* The pieces the screens are made of: cards and rows, sheets, choices, menus, empty and error
   states, pull to refresh and the press feedback of each platform. */
import { $, $$, api, el, esc, haptic, ICON, img, IOS, t, toast } from './core.js';
import { goBack, makeView, opened, push, topView } from './nav.js';
import { titleView } from './views/title.js';
import { folderView } from './views/grids.js';

/* ---------- a long press (touch, or the right button) opens a menu instead of the tap ---------- */
export function longPress(node, run) {
  let timer = 0,
    x0 = 0,
    y0 = 0,
    fired = false;
  const cancel = () => clearTimeout(timer);
  node.addEventListener(
    'touchstart',
    (e) => {
      fired = false;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      timer = setTimeout(() => {
        fired = true;
        haptic();
        run();
      }, 480);
    },
    { passive: true }
  );
  node.addEventListener(
    'touchmove',
    (e) => {
      const p = e.touches[0];
      if (Math.abs(p.clientX - x0) > 10 || Math.abs(p.clientY - y0) > 10) cancel();
    },
    { passive: true }
  );
  node.addEventListener('touchend', cancel);
  node.addEventListener('touchcancel', cancel);
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!fired) run();
  });
  /* the tap that ends a long press does not also open the card */
  node.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopImmediatePropagation();
        e.preventDefault();
        fired = false;
      }
    },
    true
  );
}

/* ---------- cards ---------- */
function picture(node, url, width, onDone) {
  const art = $('.art', node);
  if (!url) return art.classList.remove('skeleton');
  const pic = new Image();
  pic.loading = 'lazy';
  pic.decoding = 'async';
  pic.alt = '';
  pic.onload = () => {
    pic.classList.add('in');
    art.classList.remove('skeleton');
    if (onDone) onDone();
  };
  pic.onerror = () => art.classList.remove('skeleton');
  pic.src = img(url, width);
  art.prepend(pic);
}

/* opts.wide: a landscape card with a line under its name (Continue Watching, Upcoming) */
export function card(it, opts = {}) {
  const shape = opts.wide || it.shape === 'wide' ? 'wide' : it.shape === 'square' ? 'square' : 'poster',
    width = shape === 'wide' ? Math.min(320, innerWidth * 0.72) : Math.min(150, innerWidth * 0.31),
    progress =
      it.progress > 0 ? `<div class="bar"><i style="width:${Math.round(it.progress * 100)}%"></i></div>` : '',
    check = it.watched ? `<div class="check">${ICON.check}</div>` : '',
    /* posters speak for themselves (their name is read out, and shown if the picture fails); a
       wide card names its title and the episode under it */
    name = shape === 'wide' && !it.hideName ? `<div class="card-name">${esc(it.name)}</div>` : '',
    sub = shape === 'wide' && it.subtitle ? `<div class="card-sub">${esc(it.subtitle)}</div>` : '';
  const node = el(`<button class="card ${shape} pressable" aria-label="${esc(it.name)}">
    <div class="art skeleton"><div class="fallback">${esc(it.name)}</div>${progress}${check}</div>${name}${sub}</button>`);
  picture(node, it.art || it.poster || it.background, width, () => {
    const f = $('.fallback', node);
    if (f) f.remove();
  });
  node.onclick = () => openItem(it);
  if (it.type !== 'folder') longPress(node, () => itemMenu(it));
  return node;
}

export function openItem(it) {
  if (it.type === 'folder') return push(folderView(it));
  push(titleView(it.type, it.id, it.name, it.video_id || it.videoId));
}

/* a titled row of cards; items null shows its skeleton. opts.onMore adds "See all" */
export function section(title, items, opts = {}) {
  const box = el(
    `<div class="section"><div class="section-head"><h2>${esc(title)}</h2></div><div class="row${opts.wide ? ' wide-row' : ''}"></div></div>`
  );
  if (opts.onMore) {
    const more = el(
      `<button class="see-all">${esc(t('seeAll').replace(/\s*›$/, ''))}${ICON.chevron}</button>`
    );
    more.onclick = opts.onMore;
    $('.section-head', box).appendChild(more);
  }
  fillRow($('.row', box), items, opts);
  return box;
}
export function fillRow(row, items, opts = {}) {
  row.innerHTML = '';
  if (items) items.forEach((it) => row.appendChild(card(it, opts)));
  else
    for (let i = 0; i < 6; i++)
      row.appendChild(
        el(`<div class="card ${opts.wide ? 'wide' : 'poster'}"><div class="art skeleton"></div></div>`)
      );
}

/* ---------- empty and error states ---------- */
export function stateBox(title, text, retry) {
  const box = el(
    `<div class="state"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}${retry ? `<button class="btn tonal small">${esc(t('retry'))}</button>` : ''}</div>`
  );
  if (retry) $('button', box).onclick = retry;
  return box;
}
export const spinner = () => el('<div class="spinner" role="progressbar"></div>');

/* ---------- pull to refresh, at the top of a view ---------- */
export function pullToRefresh(view, run) {
  const node = view.node,
    mark = el(`<div class="ptr"><div class="spinner"></div></div>`);
  node.prepend(mark);
  let y0 = -1,
    dy = 0;
  node.addEventListener(
    'touchstart',
    (e) => {
      y0 = node.scrollTop <= 0 ? e.touches[0].clientY : -1;
      dy = 0;
    },
    { passive: true }
  );
  node.addEventListener(
    'touchmove',
    (e) => {
      if (y0 < 0) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      mark.style.setProperty('--pull', Math.min(dy, 110) + 'px');
      mark.classList.toggle('ready', dy > 80);
    },
    { passive: true }
  );
  node.addEventListener('touchend', async () => {
    if (y0 < 0) return;
    y0 = -1;
    mark.style.removeProperty('--pull');
    if (dy <= 80) return mark.classList.remove('ready');
    mark.classList.add('busy');
    haptic();
    await run();
    mark.classList.remove('busy', 'ready');
  });
}

/* ---------- the sheet from the bottom ---------- */
export function openSheet(body, onClose) {
  const sheet = $('#sheet'),
    shade = $('#sheetShade'),
    box = $('#sheetBody');
  /* a sheet opened from a sheet (a source's menu) takes its place, and gives it back on closing */
  const under = sheet.classList.contains('on') ? box.firstElementChild : null,
    underScroll = box.scrollTop;
  box.replaceChildren(body);
  box.scrollTop = 0;
  sheet.classList.add('on');
  shade.classList.add('on');
  let isOpen = true;
  const hide = () => {
    if (!isOpen) return;
    isOpen = false;
    if (under) {
      box.replaceChildren(under);
      box.scrollTop = underScroll;
    } else {
      sheet.classList.remove('on');
      shade.classList.remove('on');
    }
    if (onClose) onClose();
  };
  opened(hide);
  shade.onclick = goBack;
  /* dragged down from the top of its content, it follows the finger and closes past a third */
  let y0 = -1,
    dy = 0;
  sheet.ontouchstart = (e) => {
    y0 = box.scrollTop <= 0 ? e.touches[0].clientY : -1;
    dy = 0;
  };
  sheet.ontouchmove = (e) => {
    if (y0 < 0) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) {
      sheet.classList.add('dragging');
      sheet.style.transform = `translateY(${dy}px)`;
    }
  };
  sheet.ontouchend = () => {
    if (y0 < 0) return;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (dy > sheet.clientHeight / 3) goBack();
    y0 = -1;
  };
  /* closing it from code goes through history, so back stays in step */
  return () => {
    if (isOpen) goBack();
  };
}

/* ---------- one choice among options ----------
   iOS: a pushed page with the chosen one ticked on the right. Android: a dialog of radio buttons. */
export function chooseFrom(title, options, current, pick, backLabel) {
  if (IOS) {
    const v = makeView(title, { back: true, backLabel });
    const group = el('<div class="group choice-list" role="radiogroup"></div>');
    v.node.appendChild(group);
    options.forEach((o) => {
      const on = o.v === current;
      const b = el(
        `<button class="cell" role="radio" aria-checked="${on}"><span class="label">${esc(o.label)}</span><span class="tick">${on ? ICON.check : ''}</span></button>`
      );
      b.onclick = () => {
        goBack();
        if (!on) pick(o.v);
      };
      group.appendChild(b);
    });
    return push(v);
  }
  const shade = $('#dialogShade'),
    box = $('#dialog');
  box.innerHTML = '';
  box.appendChild(el(`<h3>${esc(title)}</h3>`));
  const list = el('<div class="radio-list" role="radiogroup"></div>');
  box.appendChild(list);
  let isOpen = true;
  const hide = () => {
    if (!isOpen) return;
    isOpen = false;
    box.classList.remove('on');
    shade.classList.remove('on');
  };
  options.forEach((o) => {
    const on = o.v === current;
    const b = el(
      `<button class="radio-row" role="radio" aria-checked="${on}"><span class="radio${on ? ' on' : ''}"></span><span>${esc(o.label)}</span></button>`
    );
    b.onclick = () => {
      $$('.radio', list).forEach((r) => r.classList.toggle('on', r === $('.radio', b)));
      setTimeout(() => {
        goBack();
        if (!on) pick(o.v);
      }, 140);
    };
    list.appendChild(b);
  });
  const cancel = el(
    `<div class="dialog-actions"><button class="text-btn">${esc(t('cancel'))}</button></div>`
  );
  $('button', cancel).onclick = goBack;
  box.appendChild(cancel);
  box.classList.add('on');
  shade.classList.add('on');
  shade.onclick = goBack;
  opened(hide);
}

/* ---------- a menu of actions (long press): iOS action sheet, Android bottom sheet ----------
   entries: { label, icon, run, danger } */
export function menu(title, entries) {
  const body = el(
    `<div class="menu">${title ? `<div class="menu-title">${esc(title)}</div>` : ''}<div class="menu-list"></div></div>`
  );
  const close = openSheet(body);
  entries.forEach((e) => {
    const b = el(
      `<button class="menu-item${e.danger ? ' danger' : ''}">${e.icon || ''}<span>${esc(e.label)}</span></button>`
    );
    b.onclick = () => {
      close();
      e.run();
    };
    $('.menu-list', body).appendChild(b);
  });
  if (IOS) {
    const cancel = el(`<button class="menu-cancel">${esc(t('cancel'))}</button>`);
    cancel.onclick = close;
    body.appendChild(cancel);
  }
}

/* what a long press on a title offers, as the TV's hold menu: Continue Watching first, then the
   Library and watched */
export function itemMenu(it) {
  const item = {
    id: it.id,
    type: it.type,
    name: it.name,
    poster: it.poster || '',
    background: it.background || ''
  };
  const run = async (body) => {
    const ans = await api('/app/act', Object.assign({ item }, body));
    if (ans) toast(ans.message);
    const top = topView();
    if (top && top.refresh) top.refresh();
  };
  const entries = [];
  if (it.cw) {
    entries.push({ label: t('markWatched'), icon: ICON.check, run: () => run({ action: 'cwWatched' }) });
    entries.push({
      label: t('removeFromCw'),
      icon: ICON.close,
      run: () => run({ action: 'cwRemove' }),
      danger: true
    });
  }
  entries.push(
    it.inLibrary
      ? { label: t('removeLibrary'), icon: ICON.remove, run: () => run({ action: 'library' }) }
      : { label: t('addLibrary'), icon: ICON.plus, run: () => run({ action: 'library' }) }
  );
  if (it.type === 'series')
    entries.push({ label: t('markSeriesWatched'), icon: ICON.eye, run: () => run({ action: 'show' }) });
  else if (!it.cw)
    entries.push({
      label: t(it.watched ? 'markUnwatched' : 'markWatched'),
      icon: ICON.eye,
      run: () => run({ action: 'watched', watched: !it.watched })
    });
  menu(it.name, entries);
}

/* ---------- press feedback: Android's ripple from the finger ---------- */
const RIPPLED =
  '.cell, .btn, .chip, .icon-btn, .source, .episode, #tabs button, .pill, .tabs-line button, .menu-item, .radio-row, .see-all, .text-btn, .bar-btn';
if (!IOS)
  document.addEventListener(
    'pointerdown',
    (e) => {
      const host = e.target.closest(RIPPLED);
      if (!host) return;
      const r = host.getBoundingClientRect(),
        size = Math.max(r.width, r.height) * 2,
        dot = el('<span class="ripple"></span>');
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      host.classList.add('ripple-host');
      host.appendChild(dot);
      setTimeout(() => dot.remove(), 600);
    },
    { passive: true }
  );

/* ---------- a QR code from the server's rows of modules ("0101…") ---------- */
export function qrSvg(rows) {
  const n = rows.length,
    q = 2;
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') d += `M${x + q} ${y + q}h1v1h-1z`;
  });
  return `<svg class="qr" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
