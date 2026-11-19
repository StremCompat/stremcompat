/* Search: results as the viewer types; with nothing typed, the recent searches and Discover
   (a type, a genre and its titles, a page at a time). */
import { $, api, el, enc, esc, ICON, t, toast } from '../core.js';
import { makeView } from '../nav.js';
import { card, spinner, stateBox } from '../ui.js';
import { pagedGrid } from './grids.js';

export function searchView() {
  const v = makeView(t('navSearch'), { solidAt: 30 });
  const bar = el(
    `<div class="search-bar"><label class="search-field">${ICON.search}<input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(t('searchPlaceholder'))}"><button class="clear" aria-label="${esc(t('serverClear'))}" hidden>${ICON.close}</button></label></div>`
  );
  const results = el('<div class="results"></div>');
  const idle = el('<div class="idle"><div class="recent-box"></div><div class="discover"></div></div>');
  v.node.append(bar, results, idle);
  const input = $('input', bar),
    clear = $('.clear', bar);
  let timer = 0,
    gen = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    clear.hidden = !input.value;
    timer = setTimeout(() => run(true), 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      run(false);
    }
  });
  clear.onclick = (e) => {
    e.preventDefault();
    input.value = '';
    clear.hidden = true;
    run(true);
    input.focus();
  };

  async function run(live) {
    const mine = ++gen,
      text = input.value.trim();
    idle.hidden = !!text;
    results.hidden = !text;
    if (text) results.replaceChildren(spinner());
    const ans = await api(`/app/search?q=${enc(text)}${live ? '&live=1' : ''}`);
    if (mine !== gen) return;
    if (!text) return recent(ans);
    results.innerHTML = '';
    if (!ans) return results.appendChild(stateBox(t('noConnectionShort'), '', () => run(false)));
    if (ans.empty || !(ans.rows || []).length)
      return results.appendChild(stateBox(ans.empty || t('noResults', text)));
    ans.rows.forEach((r) => {
      results.appendChild(el(`<div class="section-head"><h2>${esc(r.title)}</h2></div>`));
      const grid = el('<div class="grid"></div>');
      r.items.forEach((it) => grid.appendChild(card(it)));
      results.appendChild(grid);
    });
  }

  function recent(ans) {
    const box = $('.recent-box', idle);
    box.innerHTML = '';
    if (!ans || !ans.recent || !ans.recent.length) return;
    const head = el(
      `<div class="section-head"><h2>${esc(t('recentSearches'))}</h2><button class="see-all">${esc(t('serverClear'))}</button></div>`
    );
    $('button', head).onclick = async () => {
      const done = await api('/app/settings/action', { k: '__clearSearches' });
      if (done) toast(done.message);
      run(true);
    };
    const chips = el('<div class="chips wrap"></div>');
    ans.recent.forEach((r) => {
      const b = el(`<button class="chip">${ICON.search}<span>${esc(r)}</span></button>`);
      b.onclick = () => {
        input.value = r;
        clear.hidden = false;
        run(false);
      };
      chips.appendChild(b);
    });
    box.append(head, chips);
  }

  discover(v, $('.discover', idle));
  run(true);
  return v;
}

/* Discover: a type (segmented), its genres (chips) and the titles of the first catalog */
function discover(v, box) {
  let type = 0,
    genre = 0,
    first = true;
  const seg = el('<div class="segmented"></div>'),
    genres = el('<div class="chips"></div>');
  const g = pagedGrid(v, async (skip) => {
    const ans = await api(`/app/discover?type=${type}&genre=${genre}&skip=${skip}`);
    if (ans && first) {
      first = false;
      controls(ans);
    }
    return ans && { items: ans.items, more: !ans.ended && skip + ans.items.length < (ans.max || 200) };
  });
  box.append(el(`<div class="section-head"><h2>${esc(t('discoverTitle'))}</h2></div>`), seg, genres, g.grid);
  function controls(ans) {
    seg.innerHTML = '';
    ans.types.forEach((ty, i) => {
      const b = el(`<button class="${i === type ? 'on' : ''}">${esc(ty.label)}</button>`);
      b.onclick = () => {
        type = i;
        genre = 0;
        first = true;
        g.reset();
      };
      seg.appendChild(b);
    });
    seg.hidden = ans.types.length < 2;
    genres.innerHTML = '';
    ans.genres.forEach((ge, i) => {
      const b = el(`<button class="chip${i === genre ? ' on' : ''}">${esc(ge.label)}</button>`);
      b.onclick = () => {
        genre = i;
        [...genres.children].forEach((x) => x.classList.toggle('on', x === b));
        g.reset();
      };
      genres.appendChild(b);
    });
    genres.hidden = ans.genres.length < 2;
  }
  g.reset();
}
