/* Getting around: the tabs, a stack of views per tab, and the phone's back (its button, the
   edge swipe or the system gesture) closing whatever was opened last. */
import { $, el, esc, IOS, ICON } from './core.js';

/* ---------- the phone's back: each thing opened adds a history entry, back closes it ---------- */
const closers = [];
let skipPop = false;
export function opened(close) {
  closers.push(close);
  history.pushState({ depth: closers.length }, '');
}
window.addEventListener('popstate', () => {
  if (skipPop) return (skipPop = false);
  const close = closers.pop();
  if (close) close();
});
export function goBack() {
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
let tabs = [];
const stacks = {};
let currentTab = '';

export function setTabs(list) {
  tabs = list;
  currentTab = list[0].id;
  stacks[currentTab] = [];
  show(list[0].make());
  renderTabs();
}

function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '<div class="tabs-inner"></div>';
  bar.style.display = '';
  tabs.forEach((tab) => {
    const on = tab.id === currentTab;
    const b = el(
      `<button role="tab" aria-selected="${on}" class="${on ? 'on' : ''}"><span class="tab-icon">${tab.icon}</span><span class="tab-label">${esc(tab.label())}</span></button>`
    );
    b.onclick = () => selectTab(tab.id);
    bar.firstChild.appendChild(b);
  });
}

function selectTab(id) {
  /* the tab already shown: back to its first view, or to its top when already there */
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
    show(tabs.find((x) => x.id === id).make());
  }
  compactTabs(false);
  renderTabs();
}

/* the tab bar shrinks while the viewer scrolls down and comes back when scrolling up */
function compactTabs(on) {
  $('#tabs').classList.toggle('compact', on);
}

/* the view on top of the current tab */
export function topView() {
  const s = stacks[currentTab];
  return s && s[s.length - 1];
}

/* ---------- views ---------- */
/* a view: its scrolling node and a navigation bar whose title shows once the large one is gone.
   opts: back (a back button), backLabel (iOS writes where it goes back to), noLargeTitle,
   solidAt (scroll at which the bar gets its background), action (a button on the right) */
export function makeView(title, opts = {}) {
  const node = el(`<section class="view${opts.className ? ' ' + opts.className : ''}"></section>`);
  const backLabel = IOS && opts.backLabel ? `<span class="back-label">${esc(opts.backLabel)}</span>` : '';
  const bar = el(
    `<header class="navbar">${
      opts.back
        ? `<button class="back" aria-label="Back">${IOS ? ICON.chevronBack : ICON.arrowBack}${backLabel}</button>`
        : '<span class="spacer"></span>'
    }<div class="small">${esc(title)}</div><span class="bar-end"></span></header>`
  );
  node.appendChild(bar);
  if (opts.back) $('.back', bar).onclick = goBack;
  if (title && !opts.noLargeTitle) node.appendChild(el(`<h1 class="large-title">${esc(title)}</h1>`));
  let lastY = 0;
  node.addEventListener(
    'scroll',
    () => {
      const y = node.scrollTop;
      bar.classList.toggle('solid', y > (opts.solidAt || 40));
      if (Math.abs(y - lastY) > 8) {
        compactTabs(y > lastY && y > 80);
        lastY = y;
      }
    },
    { passive: true }
  );
  const view = { node, bar, title };
  /* a button at the end of the bar (sort, more) */
  view.setAction = (icon, label, run) => {
    const end = $('.bar-end', bar);
    end.innerHTML = '';
    const b = el(`<button class="bar-btn" aria-label="${esc(label)}">${icon}</button>`);
    b.onclick = run;
    end.appendChild(b);
  };
  view.setTitle = (text) => ($('.small', bar).textContent = text);
  return view;
}

function show(view) {
  $('#views').appendChild(view.node);
  stacks[currentTab].push(view);
}

/* a view pushed on the current tab, sliding in from the right */
export function push(view) {
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
  if (IOS) enableEdgeSwipe(view);
}

/* the left-edge swipe that goes back, following the finger (iOS; Android has its own gesture) */
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

/* the sign-in pages have no tabs */
export function hideTabs() {
  $('#tabs').style.display = 'none';
}
