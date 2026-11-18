/* A title: its picture, one main button (continue, play the next episode, watch), a row of icon
   buttons, its synopsis and, for a series, its seasons and episodes. */
import { $, api, el, enc, esc, ICON, img, prefs, t, toast } from '../core.js';
import { makeView, push } from '../nav.js';
import { longPress, menu, spinner, stateBox } from '../ui.js';
import { similarView } from './grids.js';
import { openSources } from './sources.js';
import { playTrailer, startPlayback } from './player.js';

export function titleView(type, id, name, video) {
  const v = makeView(name || '', { back: true, noLargeTitle: true, solidAt: 240, className: 'title' });
  const content = el('<div></div>');
  content.appendChild(spinner());
  v.node.appendChild(content);
  let model = null,
    season = 0;

  async function load() {
    const ans = await api(`/app/title?type=${enc(type)}&id=${enc(id)}`);
    if (!ans) return content.replaceChildren(stateBox(t('noConnectionShort'), '', load));
    model = ans.title;
    if (!model) return content.replaceChildren(stateBox(t('titleUnavailable')));
    v.setTitle(model.name);
    render();
  }

  function render() {
    const m = model;
    const meta = [m.year, m.runtime, m.genres].filter(Boolean).map((x) => `<span>${esc(x)}</span>`);
    if (m.rating) meta.unshift(`<span class="rating"><b>IMDb</b>${esc(m.rating)}</span>`);
    content.innerHTML = `
      <div class="detail-top">${m.background ? `<img class="bg" alt="" src="${esc(img(m.background, innerWidth))}">` : ''}</div>
      <div class="detail-head">
        ${m.logo ? `<img class="logo" alt="${esc(m.name)}" src="${esc(img(m.logo, 300))}">` : `<h1>${esc(m.name)}</h1>`}
        <div class="meta-line">${meta.join('')}</div>
        <div class="detail-main"></div>
        <div class="icon-btns"></div>
      </div>
      ${m.description ? `<div class="description"><p>${esc(m.description)}</p><button class="more">${esc(t('moreText'))}</button></div>` : ''}
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
    renderButtons();
    if (m.series) renderSeasons();
  }

  /* the main button is the first of the title's actions; Best is in the sources, so not here */
  function renderButtons() {
    const m = model,
      main = m.actions[0],
      icons = $('.icon-btns', content);
    if (main) {
      /* a film already watched, not left halfway: "Watch again" */
      const label = !m.series && m.watched && main.kind !== 'resume' ? t('watchAgain') : main.label;
      const b = el(
        `<button class="btn primary block">${main.kind === 'best' ? ICON.bolt : ICON.play}<span>${esc(label)}</span></button>`
      );
      b.onclick = () => runAction(main);
      $('.detail-main', content).appendChild(b);
    }
    const add = (icon, label, run, on) => {
      const b = el(
        `<button class="icon-btn${on ? ' on' : ''}" aria-pressed="${!!on}">${icon}<span>${esc(label)}</span></button>`
      );
      b.onclick = run;
      icons.appendChild(b);
    };
    const lib = m.actions.find((a) => a.kind === 'library');
    if (lib)
      add(
        lib.icon === 'check' ? ICON.check : ICON.plus,
        t('myList'),
        () => runAction(lib),
        lib.icon === 'check'
      );
    if (m.actions.some((a) => a.kind === 'trailer'))
      add(ICON.film, t('trailer'), () => playTrailer(type, id));
    const watched = m.series
      ? m.series.seasons.length > 0 && m.series.seasons.every((s) => s.watched)
      : m.watched;
    add(ICON.eye, t('watchedShort'), () => markTitle(!watched), watched);
    if (main && main.kind === 'resume') {
      const sources = m.actions.find((a) => a.kind === 'sources' || a.kind === 'best');
      if (sources) add(ICON.list, t('sources'), () => openSources(type, id, sources.video || id, m.name));
    }
    add(ICON.grid, t('similar'), () => push(similarView(type, id, m.name)));
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
    const cur = seasons.find((s) => s.n === season);
    box.innerHTML = `<div class="section-head"><h2>${esc(t('episodesTitle'))}</h2><button class="see-all season-mark">${esc(t(cur.watched ? 'markSeasonUnwatched' : 'markSeasonWatched'))}</button></div><div class="pills"></div><div class="episodes"></div>`;
    $('.season-mark', box).onclick = () => markSeason(cur, !cur.watched);
    const pills = $('.pills', box),
      list = $('.episodes', box);
    seasons.forEach((s) => {
      const p = el(
        `<button class="pill${s.n === season ? ' on' : ''}">${s.watched ? ICON.check : ''}<span>${esc(s.label)}</span></button>`
      );
      p.onclick = () => {
        season = s.n;
        renderSeasons();
      };
      pills.appendChild(p);
    });
    cur.episodes.forEach((e) => list.appendChild(episodeRow(e, cur)));
    /* the chosen season in the middle of its row, without scrolling the page itself */
    const on = $('.on', pills);
    pills.scrollLeft = on.offsetLeft - (pills.clientWidth - on.offsetWidth) / 2;
  }

  function episodeRow(e, cur) {
    const line = [e.date, e.runtime, e.badge].filter(Boolean).join(' · ');
    const node = el(`<button class="episode pressable${e.watched ? ' watched' : ''}">
      <div class="art skeleton${e.blur ? ' spoil' : ''}">${e.progress ? `<div class="bar"><i style="width:${Math.round(e.progress * 100)}%"></i></div>` : ''}${e.watched ? `<div class="check">${ICON.check}</div>` : ''}</div>
      <div class="ep-text"><div class="ep-title">${esc(e.number ? e.number + '. ' + (e.name || t('episode', e.number)) : e.title)}</div>${line ? `<div class="ep-line">${esc(line)}</div>` : ''}</div>
      ${e.description ? `<div class="ep-desc">${esc(e.description)}</div>` : ''}</button>`);
    if (e.thumbnail) {
      const pic = new Image();
      pic.loading = 'lazy';
      pic.alt = '';
      pic.onload = () => {
        pic.classList.add('in');
        $('.art', node).classList.remove('skeleton');
      };
      /* a spoiler is asked tiny: blurred, it looks the same and costs nothing */
      pic.src = img(e.thumbnail, e.blur ? 24 : 150);
      $('.art', node).prepend(pic);
    } else $('.art', node).classList.remove('skeleton');
    node.onclick = () =>
      openSources(type, id, e.id, model.name + ' · ' + (e.name || e.title), { best: prefs.autoBest });
    longPress(node, () =>
      menu(e.name || e.title, [
        {
          label: t(e.watched ? 'markUnwatched' : 'markWatched'),
          icon: ICON.eye,
          run: () => act({ action: 'watched', watched: !e.watched, item: itemOf(e.id) })
        },
        {
          label: t(cur.watched ? 'markSeasonUnwatched' : 'markSeasonWatched'),
          icon: ICON.check,
          run: () => markSeason(cur, !cur.watched)
        }
      ])
    );
    return node;
  }

  function itemOf(videoId) {
    return {
      id,
      type,
      name: model.name,
      poster: model.poster || '',
      background: model.background || '',
      videoId: videoId || ''
    };
  }
  async function act(body) {
    const ans = await api('/app/act', body);
    if (ans) toast(ans.message);
    load();
  }
  function markSeason(s, watched) {
    act({ action: 'season', watched, vids: s.episodes.map((e) => e.id), item: itemOf() });
  }
  function markTitle(watched) {
    act({ action: type === 'series' ? 'show' : 'watched', watched, item: itemOf() });
  }

  async function runAction(a) {
    const vid = a.video || id;
    if (a.kind === 'resume') return startPlayback({ type, id, vid, resume: true, name: model.name });
    if (a.kind === 'best') return openSources(type, id, vid, model.name, { best: true });
    if (a.kind === 'episode' || a.kind === 'sources')
      return openSources(type, id, vid, model.name, { best: prefs.autoBest });
    if (a.kind === 'library') {
      const ans = await api('/app/act', { action: 'library', item: itemOf() });
      if (ans) toast(ans.message);
      load();
    }
  }

  load();
  /* back from the player, the progress and the buttons may have changed */
  v.refresh = load;
  return v;
}
