/* The Library: its films and series, and the upcoming episodes of the series followed, sorted by
   when they were added or by name. */
import { api, el, esc, ICON, t } from '../core.js';
import { makeView } from '../nav.js';
import { card, menu, pullToRefresh, spinner, stateBox } from '../ui.js';

export function libraryView() {
  const v = makeView(t('navLibrary'));
  const seg = el('<div class="segmented"></div>'),
    body = el('<div></div>');
  v.node.append(seg, body);
  body.appendChild(spinner());
  let rows = [],
    at = 0,
    byName = false,
    upcoming = null;
  v.setAction(ICON.sort, t('sortBy'), () =>
    menu(t('sortBy'), [
      { label: t('sortRecent'), icon: byName ? '' : ICON.check, run: () => sort(false) },
      { label: t('sortAZ'), icon: byName ? ICON.check : '', run: () => sort(true) }
    ])
  );
  function sort(name) {
    byName = name;
    render();
  }

  async function load() {
    const [lib, cal] = await Promise.all([api('/app/library'), api('/app/calendar')]);
    if (!lib) return body.replaceChildren(stateBox(t('noConnectionShort'), '', load));
    rows = lib.rows || [];
    upcoming = cal && cal.days && cal.days.length ? cal.days : null;
    render();
  }

  function render() {
    const tabs = rows.map((r) => r.title);
    if (upcoming) tabs.push(t('upcomingShort'));
    at = Math.min(at, Math.max(0, tabs.length - 1));
    seg.innerHTML = '';
    tabs.forEach((title, i) => {
      const b = el(`<button class="${i === at ? 'on' : ''}">${esc(title)}</button>`);
      b.onclick = () => {
        at = i;
        render();
      };
      seg.appendChild(b);
    });
    seg.hidden = tabs.length < 2;
    body.innerHTML = '';
    if (!tabs.length) return body.appendChild(stateBox(t('emptyLibraryTitle'), t('emptyLibraryPhone')));
    if (upcoming && at === rows.length) return renderUpcoming();
    const items = rows[at].items.slice();
    if (byName) items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const grid = el('<div class="grid"></div>');
    items.forEach((it) => grid.appendChild(card(it)));
    body.appendChild(grid);
  }

  /* the days coming, each with its episodes as wide cards */
  function renderUpcoming() {
    upcoming.forEach((d) => {
      body.appendChild(el(`<div class="section-head"><h2>${esc(d.title)}</h2></div>`));
      const list = el('<div class="wide-list"></div>');
      d.items.forEach((it) => list.appendChild(card(it, { wide: true })));
      body.appendChild(list);
    });
  }

  load();
  pullToRefresh(v, load);
  v.refresh = load;
  return v;
}
