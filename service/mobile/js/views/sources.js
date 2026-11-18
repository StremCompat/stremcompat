/* The sources of a video, in a sheet that fills as the addons answer: how many addons are still
   answering, quality and quick filters, one tab per addon, a search once the list is long, and
   each source with its addon's logo and badges. A long press copies its link or opens it in
   another app. */
import { $, api, el, enc, esc, ICON, img, t, toast } from '../core.js';
import { longPress, menu, openSheet, spinner } from '../ui.js';
import { playExternal, sourceUrl, startPlayback } from './player.js';

const SEARCH_FROM = 15;

/* opts.best: play the best source as soon as it is known (the viewer touching the list stops it) */
export function openSources(type, id, vid, name, opts = {}) {
  const body = el(`<div class="sources">
    <div class="sheet-head"><h3>${esc(t('sources'))}</h3><button class="btn tonal small best">${ICON.bolt}<span>${esc(t('playBest'))}</span></button></div>
    <div class="sheet-sub">${esc(name)}</div>
    <div class="answering" hidden><i></i><span></span></div>
    <div class="chips quality"></div><div class="tabs-line addons"></div>
    <label class="search-field source-search" hidden>${ICON.search}<input type="search" autocomplete="off" placeholder="${esc(t('searchInSources'))}"></label>
    <div class="list"></div></div>`);
  $('.list', body).appendChild(spinner());
  let version = 0,
    done = false,
    quality = 'All',
    addon = 'All',
    closed = false,
    gen = 0,
    best = 0,
    last = null,
    autoplay = !!opts.best;
  const close = openSheet(body, () => (closed = true));
  $('.best', body).onclick = () => (best ? play(best) : toast(t(done ? 'noSources' : 'findingSources')));
  /* the viewer touching the list takes over from Best */
  body.addEventListener('touchstart', () => (autoplay = false), { passive: true });
  const search = $('.source-search input', body);
  search.addEventListener('input', () => last && renderList(last));
  ask();

  async function ask() {
    const mine = gen;
    const ans = await api(
      `/app/streams?have=${version}&type=${enc(type)}&vid=${enc(vid)}&quality=${enc(quality)}&addon=${enc(addon)}`
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

  function chipsInto(box, list, current, choose, chip) {
    box.innerHTML = '';
    list.forEach((c) => {
      const b = el(
        `<button class="${chip ? 'chip' : ''}${c.key === current ? ' on' : ''}">${esc(c.label)}</button>`
      );
      b.onclick = () => {
        autoplay = false;
        choose(c.key);
      };
      box.appendChild(b);
    });
    box.hidden = !list.length;
  }
  function refilter() {
    gen++;
    version = 0;
    done = false;
    $('.list', body).replaceChildren(spinner());
    ask();
  }

  function render(ans) {
    last = ans;
    const answering = $('.answering', body);
    answering.hidden = done || !ans.leftCount;
    $('span', answering).textContent = ans.left;
    chipsInto(
      $('.quality', body),
      ans.chips.length > 1 ? ans.chips : [],
      quality,
      (k) => {
        quality = quality === k && k.indexOf('f:') === 0 ? 'All' : k;
        refilter();
      },
      true
    );
    chipsInto($('.addons', body), ans.addons, addon, (k) => {
      addon = k;
      refilter();
    });
    $('.source-search', body).hidden = ans.items.length < SEARCH_FROM && !search.value;
    renderList(ans);
  }

  function renderList(ans) {
    const list = $('.list', body),
      words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    list.innerHTML = '';
    ans.items.forEach((s, i) => {
      const hay = (s.heading + ' ' + s.text + ' ' + (s.tags || []).map((x) => x.t).join(' ')).toLowerCase();
      if (words.some((w) => hay.indexOf(w) < 0)) return;
      list.appendChild(sourceCard(s, i === ans.recommended));
    });
    if (!list.children.length && done)
      list.appendChild(
        el(
          `<div class="state"><b>${esc(t(quality !== 'All' || addon !== 'All' ? 'noSourcesQuality' : 'noSources'))}</b></div>`
        )
      );
    if (!done) list.appendChild(spinner());
    if (ans.failed) list.appendChild(el(`<div class="note">${esc(ans.failed)}</div>`));
  }

  function sourceCard(s, recommended) {
    const tags = (s.tags || [])
      .map((tg) => `<span class="tag ${esc(tg.c || '')}">${esc(tg.t)}</span>`)
      .join('');
    const node = el(`<button class="source pressable${recommended ? ' recommended' : ''}">
      ${recommended ? `<div class="rec">${ICON.bolt}${esc(t('recommendedSource'))}</div>` : ''}
      <div class="source-top"><span class="addon-logo">${s.logo ? `<img alt="" src="${esc(img(s.logo, 28))}">` : ICON.film}</span><div class="head">${esc(s.heading)}</div></div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${s.compat ? `<div class="compat">${esc(s.compat)}</div>` : ''}
      ${s.text ? `<div class="text">${esc(s.text).replace(/\./g, '.<wbr>')}</div>` : ''}</button>`);
    const logo = $('.addon-logo img', node);
    if (logo) logo.onerror = () => (logo.parentNode.innerHTML = ICON.film);
    node.onclick = () => play(s.seq);
    longPress(node, () =>
      menu(s.heading, [
        { label: t('copyLink'), icon: ICON.link, run: () => copyLink(s.seq) },
        { label: t('openInOtherApp'), icon: ICON.external, run: () => external(s.seq) }
      ])
    );
    return node;
  }

  async function copyLink(seq) {
    const url = await sourceUrl(type, id, vid, seq);
    if (!url) return toast(t('sourcePrepareFailed'));
    try {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied'));
    } catch (e) {
      prompt(t('copyLink'), url);
    }
  }
  async function external(seq) {
    const url = await sourceUrl(type, id, vid, seq);
    if (!url) return toast(t('sourcePrepareFailed'));
    playExternal(url, name);
  }

  function play(seq) {
    closed = true;
    close();
    startPlayback({ type, id, vid, seq, name });
  }
}
