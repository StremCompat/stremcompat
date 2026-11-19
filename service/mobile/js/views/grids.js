/* Pages of titles in a grid: "See all" of a Home row, a Collections folder and similar titles.
   Each grows as the viewer reaches its end. */
import { $, api, el, enc, esc, t } from '../core.js';
import { makeView } from '../nav.js';
import { card, spinner, stateBox } from '../ui.js';

/* a grid that asks for its next page near its end. page(skip) answers { items, more } or null */
export function pagedGrid(view, page, empty = t('nothingHere')) {
  const grid = el('<div class="grid"></div>');
  let skip = 0,
    more = false,
    busy = false,
    gen = 0;
  async function next() {
    busy = true;
    const mine = gen;
    if (!skip) grid.replaceChildren(spinner());
    const ans = await page(skip);
    if (mine !== gen) return;
    busy = false;
    const sp = $('.spinner', grid);
    if (sp) sp.remove();
    if (!ans && !skip) return grid.appendChild(stateBox(t('noConnectionShort'), '', () => reset()));
    const items = (ans && ans.items) || [];
    items.forEach((x) => grid.appendChild(card(x)));
    skip += items.length;
    more = !!(ans && ans.more) && items.length > 0;
    if (!skip) grid.appendChild(stateBox(empty));
  }
  function reset() {
    gen++;
    skip = 0;
    more = false;
    next();
  }
  view.node.addEventListener(
    'scroll',
    () => {
      const n = view.node;
      if (grid.offsetParent && more && !busy && n.scrollTop + n.clientHeight > n.scrollHeight - 900) next();
    },
    { passive: true }
  );
  return { grid, reset };
}

/* "See all" of a Home catalog: its pages straight from the addon */
export function catalogView(title, c, backLabel) {
  const v = makeView(title, { back: true, backLabel });
  const g = pagedGrid(v, (skip) =>
    api(`/app/catalog/page?url=${enc(c.url)}&type=${enc(c.type)}&skip=${skip}`)
  );
  v.node.appendChild(g.grid);
  g.reset();
  return v;
}

export function similarView(type, id, name) {
  const v = makeView(t('similar'), { back: true, backLabel: name });
  const g = pagedGrid(
    v,
    async (skip) => {
      if (skip) return { items: [], more: false };
      const ans = await api(`/app/similar?type=${enc(type)}&id=${enc(id)}`);
      return ans && { items: ans.items || [], more: false };
    },
    t('similarEmptyHint')
  );
  v.node.appendChild(g.grid);
  g.reset();
  return v;
}

/* a Collections folder: one tab per list, its titles as a grid */
export function folderView(it) {
  const v = makeView(it.name, { back: true });
  const tabsBox = el('<div class="tabs-line"></div>');
  let tab = 0;
  const g = pagedGrid(v, (skip) => api(`/app/folder/page?id=${enc(it.id)}&tab=${tab}&skip=${skip}`));
  v.node.append(tabsBox, g.grid);
  api(`/app/folder?id=${enc(it.id)}`).then((f) => {
    if (!f) return g.grid.replaceChildren(stateBox(t('noConnectionShort'), '', () => location.reload()));
    f.tabs = f.tabs || [];
    f.tabs.forEach((tb, i) => {
      const b = el(`<button class="${i ? '' : 'on'}">${esc(tb.title)}</button>`);
      b.onclick = () => {
        [...tabsBox.children].forEach((x) => x.classList.toggle('on', x === b));
        tab = i;
        g.reset();
      };
      tabsBox.appendChild(b);
    });
    if (f.tabs.length < 2) tabsBox.remove();
    g.reset();
  });
  return v;
}
