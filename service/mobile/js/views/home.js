/* Home: the big pages at the top, then the account's rows (Continue Watching, New episodes,
   Upcoming, My List), Collections and the catalogs, each catalog loaded as it comes near. */
import { $, api, el, enc, esc, ICON, img, t, toast } from '../core.js';
import { makeView, push } from '../nav.js';
import { fillRow, openItem, pullToRefresh, section, stateBox } from '../ui.js';
import { catalogView } from './grids.js';

export function homeView() {
  const v = makeView('StremCompat', { noLargeTitle: true, solidAt: 300, className: 'home' });
  let content = el('<div class="home-content"></div>');
  v.node.appendChild(content);
  let seen = null;

  async function load() {
    const home = await api('/app/home');
    const next = el('<div class="home-content"></div>');
    if (!home) next.appendChild(stateBox(t('noConnectionShort'), t('noConnection'), load));
    else build(next, home);
    /* swapped whole, at the same scroll, so a refresh does not flash */
    const y = v.node.scrollTop;
    content.replaceWith(next);
    content = next;
    v.node.scrollTop = y;
  }

  function build(box, home) {
    if (seen) seen.disconnect();
    const lazy = [];
    let heroDone = false;
    home.rows.forEach((r) => {
      if (r.catalog) {
        const row = section(r.title, null, {
          onMore: () => push(catalogView(r.title, r.catalog, 'StremCompat'))
        });
        box.appendChild(row);
        lazy.push({ row, r });
      } else if (r.items && r.items.length)
        box.appendChild(section(r.title, r.items, { wide: r.wide, collection: r.collection }));
    });
    /* catalog rows load as they come near the screen; the first that has pictures makes the hero */
    seen = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          seen.unobserve(e.target);
          fill(lazy.find((x) => x.row === e.target));
        }),
      { root: v.node, rootMargin: '700px 0px' }
    );
    lazy.forEach((job) => seen.observe(job.row));
    async function fill(job) {
      const c = job.r.catalog;
      const ans = await api(`/app/catalog?url=${enc(c.url)}&key=${enc(c.key)}&type=${enc(c.type)}`);
      const items = (ans && ans.items) || [];
      if (!items.length) return job.row.remove();
      fillRow($('.row', job.row), items);
      const withArt = items.filter((it) => it.backdrop);
      if (!heroDone && withArt.length >= 3) {
        heroDone = true;
        box.prepend(hero(withArt.slice(0, 6)));
      }
    }
    if (!home.rows.length) box.appendChild(stateBox(t('catalogsFailed'), '', load));
  }

  load();
  pullToRefresh(v, load);
  /* back from the player or a menu, the account's rows may have changed */
  v.refresh = load;
  return v;
}

/* the big pages at the top, swiped sideways, each with Watch and My List */
function hero(items) {
  const wrap = el('<div class="hero-wrap"><div class="hero"></div><div class="dots"></div></div>');
  const strip = $('.hero', wrap),
    dots = $('.dots', wrap);
  items.forEach((it, i) => {
    const page = el(`<div class="hero-page">
      <img class="bg" alt="" src="${esc(img(it.backdrop, innerWidth))}">
      <div class="hero-info">
        ${it.logo ? `<img class="logo" alt="${esc(it.name)}" src="${esc(img(it.logo, 260))}">` : `<div class="name">${esc(it.name)}</div>`}
        <div class="hero-actions">
          <button class="btn primary">${ICON.play}<span>${esc(t('watch'))}</span></button>
          <button class="btn round glass mylist" aria-label="${esc(t('myList'))}">${it.inLibrary ? ICON.check : ICON.plus}</button>
        </div>
      </div></div>`);
    $('.btn.primary', page).onclick = () => openItem(it);
    $('.bg', page).onclick = () => openItem(it);
    const logo = $('.logo', page);
    if (logo) logo.onerror = () => logo.replaceWith(el(`<div class="name">${esc(it.name)}</div>`));
    $('.mylist', page).onclick = async (e) => {
      const b = e.currentTarget;
      const ans = await api('/app/act', {
        action: 'library',
        item: {
          id: it.id,
          type: it.type,
          name: it.name,
          poster: it.poster || '',
          background: it.background || ''
        }
      });
      if (!ans) return;
      it.inLibrary = ans.inLibrary;
      b.firstElementChild.outerHTML = ans.inLibrary ? ICON.check : ICON.plus;
      toast(ans.message);
    };
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
