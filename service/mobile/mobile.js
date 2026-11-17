/* StremCompat on a phone. The same local server and API as the native TV app (/app/...), drawn
   with iOS conventions: a tab bar, a stack of views per tab with large titles, bottom sheets for
   choices, and the phone's back (button or gesture) closing what was opened last. */
'use strict';

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function api(path, body) {
  try {
    const r = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

/* pictures through the server, about as wide as they are shown on this screen */
function img(url, cssWidth) {
  if (!url) return '';
  const w = Math.min(1280, Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 3)));
  return '/app/img?u=' + encodeURIComponent(url) + '&w=' + w;
}

/* the interface's texts in its language (the TV's strings), with a plain default */
let texts = { lang: {}, fallback: {} };
function t(key, dflt, a0) {
  let s = texts.lang[key] || texts.fallback[key] || dflt || key;
  if (a0 != null) s = String(s).replace('{0}', a0);
  return s;
}

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2 2.8 11h2.7v9.3h5V15h3v5.3h5V11h2.7z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/></svg>',
  library:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h4v16H4zM10 4h4v16h-4zM15.6 4.8l3.8-1 4 15.4-3.8 1z"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4 7 12l8 8"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4zm2 2v2h2V6zm10 0v2h2V6zM6 10v4h12v-4zm0 6v2h2v-2zm10 0v2h2v-2z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h16v2H4z"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>'
};

let toastTimer = 0;
function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 2600);
}

/* ---------- the phone's back: each thing opened adds a history entry, back closes it ---------- */
const closers = [];
let skipPop = false;
function opened(close) {
  closers.push(close);
  history.pushState({ depth: closers.length }, '');
}
window.addEventListener('popstate', () => {
  if (skipPop) return (skipPop = false);
  const close = closers.pop();
  if (close) close();
});
function goBack() {
  if (closers.length) history.back();
}
/* everything opened closes at once, and its history entries go in one step */
function closeAll() {
  const n = closers.length;
  if (!n) return;
  closers
    .splice(0)
    .reverse()
    .forEach((close) => close());
  skipPop = true;
  history.go(-n);
}

/* ---------- tabs and their stacks of views ---------- */
const TABS = [
  { id: 'home', icon: ICON.home, label: () => t('home', 'Home'), make: homeView },
  { id: 'search', icon: ICON.search, label: () => t('search', 'Search'), make: searchView },
  { id: 'library', icon: ICON.library, label: () => t('library', 'Library'), make: libraryView },
  { id: 'settings', icon: ICON.settings, label: () => t('settings', 'Settings'), make: settingsView }
];
const stacks = {};
let currentTab = 'home';

function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  TABS.forEach((tab) => {
    const b = el(`<button role="tab">${tab.icon}<span>${esc(tab.label())}</span></button>`);
    b.classList.toggle('on', tab.id === currentTab);
    b.onclick = () => selectTab(tab.id);
    bar.appendChild(b);
  });
}

function selectTab(id) {
  /* the tab already shown: back to its first view, or to its top when already there (as iOS) */
  if (id === currentTab) {
    if (closers.length) closeAll();
    else stacks[id][0].node.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  closeAll();
  currentTab = id;
  for (const key of Object.keys(stacks))
    stacks[key].forEach((v) => v.node.classList.toggle('hidden', key !== id));
  if (!stacks[id]) {
    stacks[id] = [];
    show(TABS.find((x) => x.id === id).make());
  }
  renderTabs();
}

/* a view: its scrolling node and a navigation bar whose small title shows once the large one is gone */
function makeView(title, opts = {}) {
  const node = el('<section class="view"></section>');
  const bar = el(
    `<header class="navbar">${opts.back ? `<button class="back">${ICON.back}<span>${esc(opts.backLabel || '')}</span></button>` : '<span class="spacer"></span>'}<div class="small">${esc(title)}</div><span class="spacer"></span></header>`
  );
  node.appendChild(bar);
  if (opts.back) $('.back', bar).onclick = goBack;
  if (title && !opts.noLargeTitle) node.appendChild(el(`<h1 class="large-title">${esc(title)}</h1>`));
  node.addEventListener(
    'scroll',
    () => bar.classList.toggle('solid', node.scrollTop > (opts.solidAt || 40)),
    { passive: true }
  );
  return { node, bar, title };
}

function show(view) {
  const stack = stacks[currentTab];
  $('#views').appendChild(view.node);
  stack.push(view);
}

/* a view pushed on the current tab, sliding in from the right */
function push(view) {
  const stack = stacks[currentTab],
    below = stack[stack.length - 1];
  view.node.classList.add('pushed');
  show(view);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      view.node.classList.remove('pushed');
      below.node.classList.add('under');
    })
  );
  const tab = currentTab;
  opened(() => {
    const s = stacks[tab];
    const top = s.pop();
    top.node.classList.add('pushed');
    s[s.length - 1].node.classList.remove('under');
    setTimeout(() => top.node.remove(), 360);
    if (top.leave) top.leave();
  });
  enableEdgeSwipe(view);
}

/* the left-edge swipe that goes back, following the finger */
function enableEdgeSwipe(view) {
  let x0 = -1,
    dx = 0,
    y0 = 0;
  view.node.addEventListener(
    'touchstart',
    (e) => {
      const p = e.touches[0];
      x0 = p.clientX < 24 ? p.clientX : -1;
      y0 = p.clientY;
      dx = 0;
    },
    { passive: true }
  );
  view.node.addEventListener(
    'touchmove',
    (e) => {
      if (x0 < 0) return;
      const p = e.touches[0];
      dx = Math.max(0, p.clientX - x0);
      if (dx < 10 && Math.abs(p.clientY - y0) > 10) return (x0 = -1);
      view.node.style.transition = 'none';
      view.node.style.transform = `translateX(${dx}px)`;
    },
    { passive: true }
  );
  view.node.addEventListener('touchend', () => {
    if (x0 < 0) return;
    view.node.style.transition = '';
    view.node.style.transform = '';
    if (dx > window.innerWidth * 0.33) goBack();
    x0 = -1;
  });
}

/* ---------- cards ---------- */
function card(it, opts = {}) {
  const wide = !!opts.wide,
    width = wide ? Math.min(320, innerWidth * 0.72) : Math.min(150, innerWidth * 0.31),
    progress =
      it.progress > 0 ? `<div class="bar"><i style="width:${Math.round(it.progress * 100)}%"></i></div>` : '',
    check = it.watched ? `<div class="check">${ICON.check}</div>` : '';
  const node = el(`<button class="${wide ? 'wide' : 'poster'} pressable">
    <div class="art skeleton"><div class="fallback">${esc(it.name)}</div>${progress}${check}</div>
    <div class="card-name">${esc(it.name)}</div>${wide && it.subtitle ? `<div class="card-sub">${esc(it.subtitle)}</div>` : ''}
  </button>`);
  const art = it.art || it.poster || it.background;
  if (art) {
    const pic = new Image();
    pic.loading = 'lazy';
    pic.decoding = 'async';
    pic.alt = '';
    pic.onload = () => {
      pic.classList.add('in');
      $('.art', node).classList.remove('skeleton');
      $('.fallback', node).remove();
    };
    pic.onerror = () => $('.art', node).classList.remove('skeleton');
    pic.src = img(art, width);
    $('.art', node).prepend(pic);
  } else $('.art', node).classList.remove('skeleton');
  node.onclick = () => openItem(it);
  return node;
}

function openItem(it) {
  if (it.type === 'folder') return push(folderView(it));
  push(titleView(it.type, it.id, it.name, it.video_id || it.videoId));
}

function section(title, items, opts = {}) {
  const box = el(
    `<div class="section"><div class="section-head"><h2>${esc(title)}</h2></div><div class="row"></div></div>`
  );
  const row = $('.row', box);
  if (items) items.forEach((it) => row.appendChild(card(it, opts)));
  else
    for (let i = 0; i < 6; i++)
      row.appendChild(el('<div class="poster"><div class="art skeleton"></div></div>'));
  return box;
}

/* ---------- Home ---------- */
function homeView() {
  const v = makeView('StremCompat', { noLargeTitle: true, solidAt: 260 });
  const content = el('<div></div>');
  v.node.appendChild(content);
  load();
  async function load() {
    const home = await api('/app/home');
    content.innerHTML = '';
    if (!home)
      return content.appendChild(
        el(`<div class="empty"><b>${esc(t('connectionError', 'No connection'))}</b></div>`)
      );
    const heroItems = [];
    const lazy = [];
    home.rows.forEach((r) => {
      if (r.catalog) {
        const box = section(r.title, null);
        content.appendChild(box);
        lazy.push({ box, r, first: !lazy.length });
      } else if (r.items && r.items.length) content.appendChild(section(r.title, r.items, { wide: r.wide }));
    });
    /* catalog rows load as they come near the screen; the first one also feeds the hero */
    const seen = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          seen.unobserve(e.target);
          const job = lazy.find((x) => x.box === e.target);
          fillCatalog(job);
        }),
      { rootMargin: '600px 0px' }
    );
    lazy.forEach((job) => seen.observe(job.box));
    async function fillCatalog(job) {
      const c = job.r.catalog;
      const ans = await api(
        `/app/catalog?url=${encodeURIComponent(c.url)}&key=${encodeURIComponent(c.key)}&type=${encodeURIComponent(c.type)}`
      );
      const items = (ans && ans.items) || [];
      if (!items.length) return job.box.remove();
      const row = $('.row', job.box);
      row.innerHTML = '';
      items.forEach((it) => row.appendChild(card(it)));
      if (job.first && !heroItems.length) {
        heroItems.push(...items.filter((it) => it.backdrop).slice(0, 6));
        content.prepend(hero(heroItems));
      }
    }
  }
  return v;
}

/* the big pages at the top of Home, swiped sideways (Apple TV and Netflix on phones) */
function hero(items) {
  const wrap = el('<div><div class="hero"></div><div class="dots"></div></div>');
  const strip = $('.hero', wrap),
    dots = $('.dots', wrap);
  items.forEach((it, i) => {
    const page =
      el(`<div class="hero-page"><img class="bg" alt="" src="${esc(img(it.backdrop, innerWidth))}"><div class="hero-info">
      <div class="name">${esc(it.name)}</div><button class="btn primary small">${ICON.play}${esc(t('watch', 'Watch'))}</button></div></div>`);
    page.onclick = () => openItem(it);
    strip.appendChild(page);
    dots.appendChild(el(`<i class="${i ? '' : 'on'}"></i>`));
  });
  strip.addEventListener(
    'scroll',
    () => {
      const at = Math.round(strip.scrollLeft / strip.clientWidth);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === at));
    },
    { passive: true }
  );
  return wrap;
}

/* ---------- a title ---------- */
function titleView(type, id, name, video) {
  const v = makeView(name || '', { back: true, noLargeTitle: true, solidAt: 220 });
  const content = el('<div><div class="spinner"></div></div>');
  v.node.appendChild(content);
  let model = null,
    season = 0;
  load();
  async function load() {
    const ans = await api(`/app/title?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
    model = ans && ans.title;
    if (!model)
      return (content.innerHTML = `<div class="empty"><b>${esc(t('notAvailable', 'Not available'))}</b></div>`);
    $('.small', v.bar).textContent = model.name;
    render();
  }
  function render() {
    const m = model;
    const meta = [m.year, m.runtime, m.genres].filter(Boolean).map((x) => `<span>${esc(x)}</span>`);
    if (m.rating) meta.unshift(`<span><b class="imdb">IMDb</b>${esc(m.rating)}</span>`);
    content.innerHTML = `
      <div class="detail-top">${m.background ? `<img class="bg" alt="" src="${esc(img(m.background, innerWidth))}">` : ''}</div>
      <div class="detail-head">
        ${m.logo ? `<img class="logo" alt="${esc(m.name)}" src="${esc(img(m.logo, 300))}">` : `<h1>${esc(m.name)}</h1>`}
        <div class="meta-line">${meta.join('')}</div>
        <div class="detail-actions"></div>
      </div>
      <div class="icon-btns"></div>
      ${m.description ? `<div class="description"><p>${esc(m.description)}</p><button class="more">${esc(t('more', 'More'))}</button></div>` : ''}
      ${m.people ? `<div class="facts">${esc(m.people)}</div>` : ''}
      <div class="seasons"></div>`;
    const logo = $('.logo', content);
    if (logo) logo.onerror = () => logo.replaceWith(el(`<h1>${esc(m.name)}</h1>`));
    const desc = $('.description', content);
    if (desc) {
      const p = $('p', desc),
        more = $('.more', desc);
      requestAnimationFrame(() => {
        if (p.scrollHeight <= p.clientHeight + 2) more.remove();
      });
      more.onclick = () => {
        desc.classList.add('open');
        more.remove();
      };
    }
    /* the first button is the big one (continue, play the next episode, watch); the rest are icons */
    const big = $('.detail-actions', content),
      icons = $('.icon-btns', content);
    m.actions.forEach((a, i) => {
      const run = () => runAction(a);
      if (i === 0 || (a.kind === 'best' && i === 1)) {
        const b = el(
          `<button class="btn ${i === 0 ? 'primary' : 'secondary'} block">${a.kind === 'best' ? ICON.bolt : ICON.play}${esc(a.label)}</button>`
        );
        b.onclick = run;
        big.appendChild(b);
      } else {
        const icon =
          {
            trailer: ICON.film,
            similar: ICON.grid,
            library: a.icon === 'check' ? ICON.check : ICON.plus,
            sources: ICON.list,
            best: ICON.bolt
          }[a.kind] || ICON.list;
        const b = el(`<button class="icon-btn">${icon}<span>${esc(a.label)}</span></button>`);
        b.onclick = run;
        icons.appendChild(b);
      }
    });
    if (m.series) renderSeasons();
  }
  function renderSeasons() {
    const box = $('.seasons', content),
      seasons = model.series.seasons;
    if (!seasons.length) return;
    if (!season) {
      const landing = video || model.series.landing;
      const found = seasons.find((s) => s.episodes.some((e) => e.id === landing));
      season = (found || seasons.find((s) => s.n > 0) || seasons[0]).n;
    }
    box.innerHTML = `<div class="section-head" style="margin-top:22px"><h2>${esc(t('episodes', 'Episodes'))}</h2></div><div class="pills"></div><div class="episodes"></div>`;
    const pills = $('.pills', box),
      list = $('.episodes', box);
    seasons.forEach((s) => {
      const p = el(`<button class="pill${s.n === season ? ' on' : ''}">${esc(s.label)}</button>`);
      p.onclick = () => {
        season = s.n;
        renderSeasons();
      };
      pills.appendChild(p);
    });
    const cur = seasons.find((s) => s.n === season);
    cur.episodes.forEach((e) => {
      const node = el(`<button class="episode pressable${e.watched ? ' watched' : ''}">
        <div class="art skeleton">${e.progress ? `<div class="bar"><i style="width:${Math.round(e.progress * 100)}%"></i></div>` : ''}${e.watched ? `<div class="check">${ICON.check}</div>` : ''}</div>
        <div><div class="ep-title">${esc(e.title)}</div><div class="ep-line">${esc(e.line)}</div></div>
        ${e.description ? `<div class="ep-desc">${esc(e.description)}</div>` : ''}</button>`);
      if (e.thumbnail) {
        const pic = new Image();
        pic.loading = 'lazy';
        pic.onload = () => {
          pic.classList.add('in');
          $('.art', node).classList.remove('skeleton');
        };
        pic.src = img(e.thumbnail, 136);
        $('.art', node).prepend(pic);
      }
      node.onclick = () => openSources(type, id, e.id, model.name + ' · ' + e.title);
      list.appendChild(node);
    });
    /* the chosen season in the middle of its row, without scrolling the page itself */
    const on = pills.querySelector('.on');
    pills.scrollLeft = on.offsetLeft - (pills.clientWidth - on.offsetWidth) / 2;
  }
  async function runAction(a) {
    const vid = a.video || id;
    if (a.kind === 'resume') return startPlayback({ type, id, vid, resume: true, name: model.name });
    if (a.kind === 'best') return openSources(type, id, vid, model.name, { best: true });
    if (a.kind === 'episode' || a.kind === 'sources') return openSources(type, id, vid, model.name);
    if (a.kind === 'similar') return push(similarView(type, id, model.name));
    if (a.kind === 'trailer') return playTrailer(type, id);
    if (a.kind === 'library') {
      const ans = await api('/app/act', {
        action: 'library',
        item: { id, type, name: model.name, poster: model.poster || '', background: model.background }
      });
      if (ans)
        toast(
          ans.message ||
            (ans.inLibrary ? t('inLibrary', 'In Library') : t('removedFromLibrary', 'Removed from Library'))
        );
      load();
    }
  }
  /* back from the player, the progress and the buttons may have changed */
  v.refresh = load;
  return v;
}

function similarView(type, id, name) {
  const v = makeView(t('similar', 'Similar'), { back: true, backLabel: name });
  const grid = el('<div class="grid"><div class="spinner"></div></div>');
  v.node.appendChild(grid);
  api(`/app/similar?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`).then((ans) => {
    grid.innerHTML = '';
    ((ans && ans.items) || []).forEach((it) => grid.appendChild(card(it)));
    if (!grid.children.length)
      grid.replaceWith(el(`<div class="empty">${esc(t('noResults', 'Nothing found', ''))}</div>`));
  });
  return v;
}

/* a Collections folder: one tab per list, its titles as a grid that grows at the end */
function folderView(it) {
  const v = makeView(it.name, { back: true });
  const tabsBox = el('<div class="tabs-line"></div>'),
    grid = el('<div class="grid"></div>');
  v.node.append(tabsBox, grid);
  let tab = 0,
    skip = 0,
    more = false,
    busy = false,
    gen = 0;
  api(`/app/folder?id=${encodeURIComponent(it.id)}`).then((f) => {
    if (!f) return;
    f.tabs.forEach((tb, i) => {
      const b = el(`<button class="${i ? '' : 'on'}">${esc(tb.title)}</button>`);
      b.onclick = () => {
        [...tabsBox.children].forEach((x) => x.classList.toggle('on', x === b));
        tab = i;
        reset();
      };
      tabsBox.appendChild(b);
    });
    if (f.tabs.length < 2) tabsBox.remove();
    reset();
  });
  function reset() {
    gen++;
    skip = 0;
    grid.innerHTML = '<div class="spinner"></div>';
    page();
  }
  async function page() {
    busy = true;
    const mine = gen;
    const ans = await api(`/app/folder/page?id=${encodeURIComponent(it.id)}&tab=${tab}&skip=${skip}`);
    if (mine !== gen) return;
    busy = false;
    const sp = $('.spinner', grid);
    if (sp) sp.remove();
    const items = (ans && ans.items) || [];
    items.forEach((x) => grid.appendChild(card(x)));
    skip += items.length;
    more = !!(ans && ans.more);
  }
  v.node.addEventListener(
    'scroll',
    () => {
      if (more && !busy && v.node.scrollTop + v.node.clientHeight > v.node.scrollHeight - 800) page();
    },
    { passive: true }
  );
  return v;
}

/* ---------- the sources, in a sheet that fills as the addons answer ---------- */
function openSources(type, id, vid, name, opts = {}) {
  const body = el(`<div>
    <div class="sheet-head"><h3>${esc(t('sources', 'Sources'))}</h3><button class="btn secondary small best">${ICON.bolt}${esc(t('playBest', 'Best source'))}</button></div>
    <div class="sheet-sub">${esc(name)}</div>
    <div class="chips quality"></div><div class="tabs-line addons"></div><div class="list"><div class="spinner"></div></div></div>`);
  let version = 0,
    done = false,
    quality = 'All',
    addon = 'All',
    closed = false,
    gen = 0,
    best = 0,
    autoplay = !!opts.best;
  const close = openSheet(body, () => (closed = true));
  $('.best', body).onclick = () =>
    best ? play(best) : toast(t(done ? 'noSources' : 'findingSources', 'Finding sources…'));
  /* the viewer touching the list takes over from Best */
  body.addEventListener('touchstart', () => (autoplay = false), { passive: true });
  ask();
  async function ask() {
    const mine = gen;
    const ans = await api(
      `/app/streams?have=${version}&type=${encodeURIComponent(type)}&vid=${encodeURIComponent(vid)}&quality=${encodeURIComponent(quality)}&addon=${encodeURIComponent(addon)}`
    );
    if (closed || mine !== gen) return;
    if (!ans) return setTimeout(ask, 1500);
    version = ans.version;
    done = ans.done;
    best = ans.best;
    if (autoplay && ans.bestNow && best) return play(best);
    if (done) autoplay = false;
    render(ans);
    if (!done) ask();
  }
  function chipsInto(box, list, current, choose) {
    box.innerHTML = '';
    list.forEach((c) => {
      const b = el(
        `<button class="${box.classList.contains('chips') ? 'chip' : ''}${c.key === current ? ' on' : ''}">${esc(c.label)}</button>`
      );
      b.onclick = () => {
        autoplay = false;
        choose(c.key);
      };
      box.appendChild(b);
    });
    box.style.display = list.length ? '' : 'none';
  }
  function refilter() {
    gen++;
    version = 0;
    done = false;
    $('.list', body).innerHTML = '<div class="spinner"></div>';
    ask();
  }
  function render(ans) {
    chipsInto($('.quality', body), ans.chips, quality, (k) => {
      quality = k;
      refilter();
    });
    chipsInto($('.addons', body), ans.addons, addon, (k) => {
      addon = k;
      refilter();
    });
    const list = $('.list', body);
    list.innerHTML = '';
    ans.items.forEach((s, i) => {
      const tags = (s.tags || [])
        .map((tg) => `<span class="tag ${esc(tg.c || '')}">${esc(tg.t)}</span>`)
        .join('');
      const node =
        el(`<button class="source pressable">${i === ans.recommended ? `<div class="rec">${esc(t('recommendedSource', 'Recommended'))}</div>` : ''}
        <div class="head">${esc(s.heading)}</div>${tags ? `<div class="tags">${tags}</div>` : ''}
        ${s.compat ? `<div class="compat">${esc(s.compat)}</div>` : ''}<div class="text">${esc(s.text)}</div></button>`);
      node.onclick = () => play(s.seq);
      list.appendChild(node);
    });
    if (!ans.items.length && done)
      list.appendChild(
        el(`<div class="empty">${esc(t(version > 1 ? 'noSourcesQuality' : 'noSources', 'No sources'))}</div>`)
      );
    if (!done) list.appendChild(el('<div class="spinner"></div>'));
    [ans.left, ans.failed]
      .filter(Boolean)
      .forEach((n) => list.appendChild(el(`<div class="note">${esc(n)}</div>`)));
  }
  function play(seq) {
    closed = true;
    close();
    startPlayback({ type, id, vid, seq, name });
  }
}

function openSheet(body, onClose) {
  const sheet = $('#sheet'),
    shade = $('#sheetShade'),
    box = $('#sheetBody');
  box.innerHTML = '';
  box.appendChild(body);
  sheet.classList.add('on');
  shade.classList.add('on');
  let isOpen = true;
  const hide = () => {
    if (!isOpen) return;
    isOpen = false;
    sheet.classList.remove('on');
    shade.classList.remove('on');
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

/* a choice of options as an action sheet */
function chooseFrom(title, options, current, pick) {
  const body = el(
    `<div><div class="sheet-head"><h3>${esc(title)}</h3></div><div class="group action-list"></div></div>`
  );
  const close = openSheet(body);
  options.forEach((o) => {
    const b = el(
      `<button class="cell${o.v === current ? ' on' : ''}"><span class="label">${esc(o.label)}</span>${o.v === current ? ICON.check.replace('<svg', '<svg class="chev" style="color:#fff"') : ''}</button>`
    );
    b.onclick = () => {
      close();
      pick(o.v);
    };
    $('.group', body).appendChild(b);
  });
}

/* ---------- playing ---------- */
/* The Android app plays in its own player (window.StremCompatNative); a browser plays in a
   <video>. Either way the server hears the progress, as from the TV. */
async function startPlayback(p) {
  toast(t('loading', 'Loading…'));
  const q = `type=${encodeURIComponent(p.type)}&id=${encodeURIComponent(p.id)}&vid=${encodeURIComponent(p.vid)}`;
  const ans = await api(`/app/play?${q}${p.resume ? '&resume=1' : `&seq=${p.seq}`}`);
  if (!ans || !ans.info) {
    if (p.resume) return openSources(p.type, p.id, p.vid, p.name);
    return toast(t('playbackError', 'This source could not start'));
  }
  const info = ans.info,
    item = {
      type: p.type,
      id: p.id,
      vid: p.vid,
      name: info.TITLE || p.name,
      poster: info.POSTER || '',
      background: info.BG || '',
      logo: info.LOGO || '',
      next: info.NEXTVID || ''
    };
  if (window.StremCompatNative && window.StremCompatNative.play)
    return window.StremCompatNative.play(info.URL, item.name, ans.resume || 0, JSON.stringify(item));
  playInPage(info.URL, ans.resume || 0, item);
}

function report(item, time, duration, event) {
  if (!item || !(duration > 0)) return;
  api(
    '/app/progress',
    Object.assign({}, item, { time: Math.round(time), duration: Math.round(duration), event })
  );
}

function playInPage(url, resume, item) {
  const box = $('#player'),
    video = $('#video');
  let last = 0;
  box.classList.add('on');
  video.src = url;
  video.onloadedmetadata = () => {
    if (resume > 0) video.currentTime = resume / 1000;
    video.play().catch(() => {});
  };
  video.ontimeupdate = () => {
    if (Date.now() - last < 10000) return;
    last = Date.now();
    report(item, video.currentTime * 1000, video.duration * 1000, 'tick');
  };
  video.onpause = () => report(item, video.currentTime * 1000, video.duration * 1000, 'pause');
  video.onended = () => goBack();
  if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  opened(() => {
    report(item, video.currentTime * 1000, video.duration * 1000, 'leave');
    video.pause();
    video.removeAttribute('src');
    video.load();
    box.classList.remove('on');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    refreshTop();
  });
  $('#playerClose').onclick = goBack;
}

/* the Android player closed (it told the server what was watched): the page shows it */
window.stremcompatPlaybackEnded = () => setTimeout(refreshTop, 400);

function refreshTop() {
  const s = stacks[currentTab],
    top = s && s[s.length - 1];
  if (top && top.refresh) top.refresh();
}

async function playTrailer(type, id) {
  const ans = await api(`/app/trailer?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  if (!ans || !ans.url) return toast((ans && ans.error) || t('trailerUnavailable', 'No trailer'));
  playInPage(ans.url, 0, null);
}

/* ---------- Search ---------- */
function searchView() {
  const v = makeView(t('search', 'Search'), { solidAt: 30 });
  const bar = el(
    `<div class="search-bar"><label class="search-field">${ICON.search}<input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(t('searchPlaceholder', 'Films and series'))}"></label></div>`
  );
  const results = el('<div></div>');
  v.node.append(bar, results);
  const input = $('input', bar);
  let timer = 0,
    gen = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(true), 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      run(false);
    }
  });
  run(true);
  async function run(live) {
    const mine = ++gen,
      text = input.value.trim();
    if (text) results.innerHTML = '<div class="spinner"></div>';
    const ans = await api(`/app/search?q=${encodeURIComponent(text)}${live ? '&live=1' : ''}`);
    if (mine !== gen) return;
    results.innerHTML = '';
    if (!ans) return;
    if (!text) {
      if (!ans.recent || !ans.recent.length) return;
      const box = el(`<div class="recent"><h3>${esc(t('recentSearches', 'Recent searches'))}</h3></div>`);
      ans.recent.forEach((r) => {
        const b = el(`<button>${esc(r)}</button>`);
        b.onclick = () => {
          input.value = r;
          run(false);
        };
        box.appendChild(b);
      });
      return results.appendChild(box);
    }
    if (ans.empty) return results.appendChild(el(`<div class="empty">${esc(ans.empty)}</div>`));
    ans.rows.forEach((r) => {
      results.appendChild(
        el(`<div class="section-head" style="margin-top:12px"><h2>${esc(r.title)}</h2></div>`)
      );
      const grid = el('<div class="grid"></div>');
      r.items.forEach((it) => grid.appendChild(card(it)));
      results.appendChild(grid);
    });
  }
  return v;
}

/* ---------- Library ---------- */
function libraryView() {
  const v = makeView(t('library', 'Library'));
  const seg = el('<div class="segmented"></div>'),
    grid = el('<div class="grid"></div>');
  v.node.append(seg, grid);
  let rows = [],
    at = 0;
  async function load() {
    const ans = await api('/app/library');
    rows = (ans && ans.rows) || [];
    render();
  }
  function render() {
    seg.innerHTML = '';
    rows.forEach((r, i) => {
      const b = el(`<button class="${i === at ? 'on' : ''}">${esc(r.title)}</button>`);
      b.onclick = () => {
        at = i;
        render();
      };
      seg.appendChild(b);
    });
    seg.style.display = rows.length > 1 ? '' : 'none';
    grid.innerHTML = '';
    if (!rows.length)
      return grid.appendChild(
        el(
          `<div class="empty" style="grid-column:1/-1"><b>${esc(t('libraryEmptyTitle', 'Nothing here yet'))}</b>${esc(t('libraryEmpty', 'Titles you add appear here.'))}</div>`
        )
      );
    rows[Math.min(at, rows.length - 1)].items.forEach((it) => grid.appendChild(card(it)));
  }
  load();
  v.refresh = load;
  return v;
}

/* ---------- Settings, as inset grouped lists ---------- */
function settingsView() {
  const v = makeView(t('settings', 'Settings'));
  const content = el('<div></div>');
  v.node.appendChild(content);
  async function load(model) {
    model = model || (await api('/app/settings'));
    if (!model) return;
    content.innerHTML = '';
    content.appendChild(el('<div class="group-title"></div>'));
    const account = el(
      `<div class="group"><div class="cell"><span class="label">${esc(model.account.email)}</span><span class="value">${esc(model.account.plan)}</span></div></div>`
    );
    content.appendChild(account);
    model.groups.forEach((g) => {
      content.appendChild(el(`<div class="group-title">${esc(g.name)}</div>`));
      const box = el('<div class="group"></div>');
      g.items.forEach((it) => box.appendChild(settingCell(it)));
      content.appendChild(box);
    });
  }
  function settingCell(it) {
    if (it.action) {
      const b = el(
        `<button class="cell"><span class="label">${esc(it.label)}</span>${ICON.chevron.replace('<svg', '<svg class="chev"')}</button>`
      );
      b.onclick = async () => {
        const ans = await api('/app/settings/action', { k: it.k });
        if (ans && ans.message) toast(ans.message);
        if (ans && ans.signedOut) location.reload();
      };
      return b;
    }
    if (it.isSwitch) {
      const b = el(
        `<button class="cell"><span class="label">${esc(it.label)}</span><span class="switch${it.on ? ' on' : ''}"></span></button>`
      );
      b.onclick = async () => {
        const opt = it.options.find((o) => o.v !== it.chosen);
        load(await api('/app/settings', { k: it.k, v: opt ? opt.v : it.on ? 'false' : 'true' }));
      };
      return b;
    }
    const b = el(
      `<button class="cell"><span class="label">${esc(it.label)}</span><span class="value">${esc(it.value)}</span>${ICON.chevron.replace('<svg', '<svg class="chev"')}</button>`
    );
    b.onclick = () =>
      chooseFrom(it.label, it.options, it.chosen, async (val) =>
        load(await api('/app/settings', { k: it.k, v: val }))
      );
    return b;
  }
  load();
  return v;
}

/* ---------- signing in: email and password, or a code on another device ---------- */
function signIn() {
  $('#tabs').style.display = 'none';
  let provider = 'stremio';
  const page = el(`<section class="view"><div class="signin">
    <h1>StremCompat</h1><p>${esc(t('loginSubtitle', 'Sign in with your account to see your library and addons.'))}</p>
    <div class="segmented" style="margin:0 0 6px"><button class="on" data-p="stremio">Stremio</button><button data-p="nuvio">Nuvio</button></div>
    <input class="field email" type="email" autocomplete="username" placeholder="Email">
    <input class="field password" type="password" autocomplete="current-password" placeholder="${esc(t('password', 'Password'))}">
    <div class="error"></div>
    <button class="btn primary block go">${esc(t('signIn', 'Sign in'))}</button></div></section>`);
  $('#views').appendChild(page);
  page.querySelectorAll('.segmented button').forEach((b) => {
    b.onclick = () => {
      provider = b.dataset.p;
      page.querySelectorAll('.segmented button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  $('.go', page).onclick = async () => {
    $('.error', page).textContent = '';
    const ans = await api('/app/login/email', {
      email: $('.email', page).value,
      password: $('.password', page).value,
      provider
    });
    if (ans && ans.done) return location.reload();
    $('.error', page).textContent = (ans && ans.error) || t('loginFailed', 'Could not sign in');
  };
}

/* ---------- start ---------- */
async function start() {
  const strings = await api('/app/strings');
  if (strings) texts = strings;
  const state = await api('/app/state');
  if (state && state.language) document.documentElement.lang = state.language;
  if (!state || !state.signedIn) return signIn();
  stacks.home = [];
  show(homeView());
  renderTabs();
}
start();
