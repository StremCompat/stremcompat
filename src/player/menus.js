// Settings menu: audio, subtitles, embedded tracks and subtitle style.
// This TV delivers Back as a history pop. We keep ONE dummy entry: popstate closes the
// menu/controls (re-pushing to stay), or exits when nothing is open.
try {
  history.pushState({ tv: 1 }, '');
} catch (e) {}
function onPop() {
  goBack();
}
window.addEventListener('popstate', onPop);
// ---- menus (subtitles = Off + languages, each with the file's own and every addon's; audio = embedded) ----
/* ---- subtitles: languages, then the file's own and each addon's, then an addon's subtitles ----
   Every subtitle, inside the file or from an addon, is an entry with its language; entries of the
   same language (pt, por and pob alike) form one row. */
var subLang = '',
  subLangFrom = 'subsroot',
  subAddon = '',
  embReopenArmed = false;
function subKey(lang) {
  return languageCode(lang) || '?';
}
function subEntries() {
  var list = [],
    i;
  for (i = 0; embTracks && i < embTracks.length; i++)
    list.push({ emb: embTracks[i], lang: embTracks[i].lang });
  for (i = 0; i < extSubs.length; i++) list.push({ ext: extSubs[i], lang: extSubs[i].lang });
  return list;
}
/* the language's name as the server wrote it, without a track's own title ("Portuguese — Forced") */
function entryLanguageName(e) {
  return String((e.emb || e.ext).name || e.lang || '').split(' — ')[0];
}
/* the subtitle language asked for first, then the second one, then the rest as they came */
function subLanguageRank(lang) {
  if (sameLanguage(lang, WANTSUB)) return 0;
  if (sameLanguage(lang, WANTSUB2)) return 1;
  return 2;
}
function subLanguages() {
  var entries = subEntries(),
    byKey = {},
    found = [];
  for (var i = 0; i < entries.length; i++) {
    var key = subKey(entries[i].lang);
    if (!byKey[key]) {
      byKey[key] = {
        key: key,
        name: entryLanguageName(entries[i]),
        wanted: wantedSubtitleLanguage(entries[i].lang),
        rank: subLanguageRank(entries[i].lang),
        subs: []
      };
      found.push(byKey[key]);
    }
    byKey[key].subs.push(entries[i]);
  }
  var out = [];
  for (var rank = 0; rank <= 2; rank++)
    for (var j = 0; j < found.length; j++) if (found[j].rank === rank) out.push(found[j]);
  out.anyWanted = false;
  for (var w = 0; w < out.length; w++) if (out[w].wanted) out.anyWanted = true;
  return out;
}
function subLanguage(key) {
  var langs = subLanguages();
  for (var i = 0; i < langs.length; i++) if (langs[i].key === key) return langs[i];
  return null;
}
/* inside one language: each of the file's own tracks first, then one group per addon */
function subAddons(lang) {
  var groups = [],
    bySrc = {};
  for (var i = 0; i < lang.subs.length; i++) {
    var e = lang.subs[i];
    if (e.emb) {
      var title = String(e.emb.name || '').split(' — ')[1];
      groups.push({ src: 'emb:' + e.emb.n, label: P.embedded + (title ? '  ·  ' + title : ''), subs: [e] });
      continue;
    }
    var src = e.ext.src || P.external;
    if (!bySrc[src]) {
      bySrc[src] = { src: src, label: src, subs: [] };
      groups.push(bySrc[src]);
    }
    bySrc[src].subs.push(e);
  }
  return groups;
}
/* the menu row that picks this subtitle (chooseMenu) */
function subChoice(e) {
  if (e.emb)
    return { k: 'emb', idx: e.emb.n, ti: e.emb.ti, lang: e.emb.lang, on: curSub === 'emb:' + e.emb.n };
  return { k: 'ext', u: e.ext.u, lang: e.ext.lang, src: e.ext.src, on: curSub === 'ext:' + e.ext.u };
}
function subRowName(e, at) {
  return (e.ext ? e.ext.name : e.emb.name) + ' ' + (at + 1);
}
function currentSubKey() {
  var entries = subEntries();
  for (var i = 0; i < entries.length; i++) if (subChoice(entries[i]).on) return subKey(entries[i].lang);
  return '';
}
/* the languages come from two lists read apart: the menu opens again once both are in */
function reopenWhenTracksCome() {
  if (embReopenArmed) return;
  embReopenArmed = true;
  var iv = setInterval(function () {
    if (embTracksLoading || extSubsLoading) return;
    clearInterval(iv);
    embReopenArmed = false;
    if (mode === 'menu' && (subView === 'subsroot' || subView === 'submore')) reopen();
  }, 400);
}
/* The delay moves the lines the player holds: an addon's, or those the server reads out of the
   file. Not the tracks a TV's own player draws line by line as it plays (Samsung, Android TV). */
function canDelaySub() {
  if (curSub.indexOf('ext:') === 0) return true;
  return curSub.indexOf('emb:') === 0 && !v.selectTextTrack;
}
/* the lists of the buttons on the left open on the left, next to them */
var menuAtLeft = false;
function choiceRow(label, on, tail) {
  return '<div class="mi' + (on ? ' on' : '') + '">' + eh(selectedLabel(label, on)) + (tail || '') + '</div>';
}
function openMenu(view) {
  subView = view;
  menuItems = [];
  var html = '';
  if (view === 'subsroot' || view === 'submore') ensureEmbTracks();
  if (view === 'root' || view === 'media' || view === 'audio') ensureTechProbe();
  if (view === 'root') ensureTorrentFiles();
  if (view === 'episodes') ensureSeasonList();
  if (view === 'sources') ensureSources();
  /* each button of the bar opens its own list: audio and subtitles, episodes, sources, and the
     settings with what is left */
  if (view === 'media') {
    html += '<div class=mh>' + P.audioSubs + '</div>';
    html += '<div class=mi>' + P.audio + ': ' + eh(audioName()) + ' \u203a</div>';
    menuItems.push({ k: 'go', to: 'audio' });
    html += '<div class=mi>' + P.subtitles + ': ' + eh(subtitleName()) + ' \u203a</div>';
    menuItems.push({ k: 'go', to: 'subsroot' });
  } else if (view === 'root') {
    html += '<div class=mh>' + P.settings + '</div>';
    if (mediaInfo && mediaInfo.chapters) {
      html += '<div class=mi>' + P.chapters + ' \u203a</div>';
      menuItems.push({ k: 'go', to: 'chapters' });
    }
    if (!SIMPLE && torrentFileList && torrentFileList.length > 1) {
      html += '<div class=mi>' + P.files + ' \u203a</div>';
      menuItems.push({ k: 'go', to: 'files' });
    }
    if (!SIMPLE && IS_VIDEO_ELEMENT) {
      html +=
        '<div class=mi>' +
        P.picture +
        ': ' +
        (pictureMode === 'zoom' ? P.pictureZoom : P.pictureFit) +
        '</div>';
      menuItems.push({ k: 'picture' });
    }
    if (!SIMPLE && canChangeSpeed()) {
      html += '<div class=mi>' + P.speed + ': ' + speedLabel(v.playbackRate) + ' \u203a</div>';
      menuItems.push({ k: 'go', to: 'speed' });
    }
    if (!menuItems.length) html += '<div class=mi style="opacity:.5">' + P.none + '</div>';
  } else if (view === 'episodes') {
    html += '<div class=mh>' + P.episodes + '</div>';
    if (!seasonList) html += '<div class=mi style="opacity:.5">' + P.readingTracks + '</div>';
    else if (!seasonList.length) html += '<div class=mi style="opacity:.5">' + P.none + '</div>';
    for (var se = 0; seasonList && se < seasonList.length; se++) {
      var here = seasonList[se].id === VID;
      html += choiceRow(
        tx('episode', seasonList[se].episode) + (seasonList[se].name ? '  ·  ' + seasonList[se].name : ''),
        here
      );
      menuItems.push({ k: 'episode', vid: seasonList[se].id, on: here });
    }
  } else if (view === 'chapters') {
    html += '<div class=mh>' + P.chapters + '</div>';
    var nowIn = currentChapter();
    for (var ch = 0; ch < mediaInfo.chapters.length; ch++) {
      var mark = mediaInfo.chapters[ch];
      html += choiceRow(fmt(mark.t) + (mark.name ? '  ·  ' + mark.name : ''), ch === nowIn);
      menuItems.push({ k: 'chapter', t: mark.t, on: ch === nowIn });
    }
  } else if (view === 'sources') {
    html += '<div class=mh>' + P.sources + '</div>';
    for (var so = 0; sourceList && so < sourceList.length; so++) {
      var here = sourceList[so].url === URL;
      html += choiceRow(sourceRowText(sourceList[so]), here);
      menuItems.push({ k: 'source', at: so, on: here });
    }
    if (sourcesLeft > 0) html += '<div class=mi style="opacity:.5">' + P.readingTracks + '</div>';
    else if (!sourceList || !sourceList.length)
      html += '<div class=mi style="opacity:.5">' + P.none + '</div>';
  } else if (view === 'files') {
    html += '<div class=mh>' + P.files + '</div>';
    for (var tf = 0; tf < torrentFileList.length; tf++) {
      var file = torrentFileList[tf];
      html += choiceRow(file.name + '  ·  ' + fileSize(file.size), file.playing);
      menuItems.push({ k: 'file', index: file.index, on: file.playing });
    }
  } else if (view === 'speed') {
    html += '<div class=mh>' + P.speed + '</div>';
    for (var sp = 0; sp < SPEEDS.length; sp++) {
      var inUse = Math.abs(v.playbackRate - SPEEDS[sp]) < 0.01;
      html += choiceRow(speedLabel(SPEEDS[sp]), inUse);
      menuItems.push({ k: 'speed', rate: SPEEDS[sp], on: inUse });
    }
  } else if (view === 'audio') {
    html += '<div class=mh>' + P.audio + '</div>';
    try {
      var order = audioOrder();
      for (var a = 0; a < order.length; a++) {
        var at = v.audioTracks[order[a]];
        html += choiceRow(audioLabel(order[a]), at.enabled);
        menuItems.push({ k: 'aud', idx: order[a], on: at.enabled });
      }
    } catch (e) {}
    if (!menuItems.length) html += '<div class=mi style="opacity:.5">' + P.none + '</div>';
  } else if (view === 'subsroot' || view === 'submore') {
    /* the languages of every subtitle, inside the file and from the addons alike; the ones asked
       for come first and the others wait under "More languages" */
    var more = view === 'submore';
    html += '<div class=mh>' + P.subtitles + ': ' + eh(subtitleName()) + '</div>';
    if (!more) {
      html += choiceRow(P.off, curSub === 'off');
      menuItems.push({ k: 'off', on: curSub === 'off' });
    }
    var langs = subLanguages(),
      curKey = currentSubKey(),
      others = 0,
      otherInUse = false;
    for (var g = 0; g < langs.length; g++) {
      var lg = langs[g],
        lgOn = lg.key === curKey;
      if (langs.anyWanted && lg.wanted === more) {
        others++;
        if (lgOn) otherInUse = true;
        continue;
      }
      /* a language with one subtitle is that subtitle */
      if (lg.subs.length === 1) {
        html += choiceRow(lg.name, lgOn);
        menuItems.push(subChoice(lg.subs[0]));
      } else {
        html += choiceRow(lg.name + '  ·  ' + lg.subs.length, lgOn, ' ›');
        menuItems.push({ k: 'sublang', key: lg.key, on: lgOn });
      }
    }
    if (!more && others) {
      html += choiceRow(P.moreLanguages, otherInUse, ' ›');
      menuItems.push({ k: 'go', to: 'submore', on: otherInUse });
    }
    if (embTracksLoading || embTracks === null || extSubsLoading) {
      html += '<div class=mi style="opacity:.5">' + P.readingTracks + '</div>';
      reopenWhenTracksCome();
    } else if (embErr) {
      html +=
        '<div class=mi style="opacity:.6;white-space:normal;font-size:22px">' +
        eh(P.embedded + ': ' + (embTimeout ? P.tracksStillLoading : embErr)) +
        '</div>';
      html += '<div class=mi>' + P.tryAgain + '</div>';
      menuItems.push({ k: 'embretry' });
    } else if (!langs.length) html += '<div class=mi style="opacity:.5">' + P.none + '</div>';
    if (!more) {
      html += '<div class=mi>' + P.style + ' ›</div>';
      menuItems.push({ k: 'go', to: 'style' });
      if (canDelaySub()) {
        html += '<div class=mi>' + P.delay + ' ›</div>';
        menuItems.push({ k: 'go', to: 'delay' });
      }
    }
  } else if (view === 'sublang') {
    /* one language: the file's own subtitles first, then each addon; an addon with several opens them */
    var lang = subLanguage(subLang);
    html += '<div class=mh>' + eh(lang ? lang.name : '') + '</div>';
    var addons = lang ? subAddons(lang) : [];
    for (var ad = 0; ad < addons.length; ad++) {
      var group = addons[ad],
        groupOn = false;
      for (var gs = 0; gs < group.subs.length; gs++) if (subChoice(group.subs[gs]).on) groupOn = true;
      if (group.subs.length === 1) {
        html += choiceRow(group.label, groupOn);
        menuItems.push(subChoice(group.subs[0]));
      } else {
        html += choiceRow(group.label + '  ·  ' + group.subs.length, groupOn, ' ›');
        menuItems.push({ k: 'subaddon', src: group.src, on: groupOn });
      }
    }
  } else if (view === 'subaddon') {
    var lang2 = subLanguage(subLang),
      list = [];
    var groups = lang2 ? subAddons(lang2) : [];
    for (var ga = 0; ga < groups.length; ga++) if (groups[ga].src === subAddon) list = groups[ga].subs;
    html += '<div class=mh>' + eh((lang2 ? lang2.name + '  ·  ' : '') + subAddon) + '</div>';
    for (var sa = 0; sa < list.length; sa++) {
      var item = subChoice(list[sa]);
      html += choiceRow(subRowName(list[sa], sa), item.on);
      menuItems.push(item);
    }
  } else if (view === 'style') {
    html += '<div class=mh>' + P.style + '</div>';
    html += '<div class=mi>' + P.bigger + '</div>';
    menuItems.push({ k: 'size+' });
    html += '<div class=mi>' + P.smaller + '</div>';
    menuItems.push({ k: 'size-' });
    html +=
      '<div class=mi>' +
      P.colour +
      ': ' +
      (subColor.toLowerCase() === '#ffe600' ? P.yellow : P.white) +
      '</div>';
    menuItems.push({ k: 'color' });
    html += '<div class=mi>' + P.background + ': ' + (subBgOp > 0 ? P.on : P.off) + '</div>';
    menuItems.push({ k: 'bg' });
    html += '<div class=mi>' + P.higher + '</div>';
    menuItems.push({ k: 'pos+' });
    html += '<div class=mi>' + P.lower + '</div>';
    menuItems.push({ k: 'pos-' });
    html += '<div class=mi>' + P.opacity + ': ' + Math.round(subOpacity * 100) + '%</div>';
    menuItems.push({ k: 'opacity' });
  } else if (view === 'delay') {
    html += '<div class=mh>' + P.delay + ': ' + (subDelay > 0 ? '+' : '') + subDelay.toFixed(1) + 's</div>';
    html += '<div class=mi>' + P.later + '</div>';
    menuItems.push({ k: 'd+' });
    html += '<div class=mi>' + P.earlier + '</div>';
    menuItems.push({ k: 'd-' });
    html += '<div class=mi>' + P.reset + '</div>';
    menuItems.push({ k: 'd0' });
  }
  menu.innerHTML = html;
  menu.className = menuAtLeft ? 'show atleft' : 'show';
  mode = 'menu';
  /* the list opens on what is in use, not on its first row */
  mIdx = 0;
  for (var r = menuItems.length - 1; r >= 0; r--) if (menuItems[r].on) mIdx = r;
  paintMenu();
}
function paintMenu() {
  var els = menu.querySelectorAll('.mi');
  for (var i = 0; i < els.length; i++)
    els[i].className = 'mi' + (/\bon\b/.test(els[i].className) ? ' on' : '') + (i === mIdx ? ' f' : '');
  if (els[mIdx]) els[mIdx].scrollIntoView(false);
}
function reopen() {
  var keep = mIdx;
  openMenu(subView);
  mIdx = keep;
  paintMenu();
}
function menuBack() {
  if (subView === 'style' || subView === 'delay' || subView === 'submore') openMenu('subsroot');
  else if (subView === 'sublang') openMenu(subLangFrom);
  else if (subView === 'subaddon') openMenu('sublang');
  else if (subView === 'audio' || subView === 'subsroot') openMenu('media');
  else if (subView === 'chapters' || subView === 'files' || subView === 'speed') openMenu('root');
  else {
    menu.className = '';
    mode = 'controls';
    paintBtns();
  }
}
function chooseMenu() {
  var it = menuItems[mIdx];
  if (!it) {
    menuBack();
    return;
  }
  if (it.k === 'go') {
    openMenu(it.to);
    return;
  }
  if (it.k === 'sublang') {
    subLang = it.key;
    subLangFrom = subView;
    openMenu('sublang');
    return;
  }
  if (it.k === 'subaddon') {
    subAddon = it.src;
    openMenu('subaddon');
    return;
  }
  if (it.k === 'embretry') {
    embTracks = null;
    embErr = '';
    ensureEmbTracks();
    reopen();
    return;
  }
  /* every style chosen here is kept as Settings keeps it, so the next video starts with it */
  if (it.k === 'size+' || it.k === 'size-') {
    stepSubSize(it.k === 'size+' ? 1 : -1);
    restyleSub();
    reopen();
    return;
  }
  if (it.k === 'color') {
    subColor = subColor.toLowerCase() === '#ffe600' ? '#ffffff' : '#ffe600';
    keepSetting('subsColor', subColor);
    restyleSub();
    reopen();
    return;
  }
  if (it.k === 'bg') {
    subBgOp = subBgOp > 0 ? 0 : 0.6;
    /* written as Settings writes its Transparent and None */
    keepSetting('subsBgStyle', subBgOp > 0 ? '.6' : '0');
    restyleSub();
    reopen();
    return;
  }
  if (it.k === 'pos+' || it.k === 'pos-') {
    subBottom = Math.max(2, Math.min(42, subBottom + (it.k === 'pos+' ? 4 : -4)));
    subEl.style.bottom = subBottom + '%';
    keepSetting('subsBottom', subBottom);
    reopen();
    return;
  }
  if (it.k === 'opacity') {
    subOpacity = subOpacity <= 0.45 ? 1 : Math.round((subOpacity - 0.2) * 10) / 10;
    restyleSub();
    keepSetting('subsOpacity', subOpacity);
    reopen();
    return;
  }
  if (it.k === 'd+' || it.k === 'd-') {
    subDelay = Math.round((subDelay + (it.k === 'd+' ? 1 : -1) * delayStep()) * 10) / 10;
    saveTitlePref('delay', subDelay);
    restyleSub();
    reopen();
    return;
  }
  if (it.k === 'picture') {
    togglePicture();
    reopen();
    return;
  }
  if (it.k === 'speed') {
    setSpeed(it.rate);
    closeMenu();
    showToast(P.speed + ': ' + speedLabel(it.rate));
    return;
  }
  if (it.k === 'chapter') {
    closeMenu();
    seekTo(it.t);
    return;
  }
  if (it.k === 'source') {
    closeMenu();
    if (!it.on) playOtherSource(sourceList[it.at]);
    return;
  }
  if (it.k === 'episode' || it.k === 'file') {
    closeMenu();
    if (it.on) return;
    if (it.k === 'episode') goToEpisode(it.vid);
    else playTorrentFile(it.index);
    return;
  }
  if (it.k === 'd0') {
    subDelay = 0;
    saveTitlePref('delay', 0);
    restyleSub();
    reopen();
    return;
  }
  if (it.k === 'off') {
    subsOff();
    saveTitlePrefs({ sub: 'off', subUrl: '', subSrc: '', embLang: '' });
  } else if (it.k === 'ext') {
    setExtSub(it.u);
    saveTitlePrefs({ sub: it.lang, subUrl: it.u, subSrc: it.src || '', embLang: '' });
  } else if (it.k === 'emb') {
    setEmbSub(it.idx, it.ti);
    if (it.lang) saveTitlePrefs({ sub: it.lang, subUrl: '', subSrc: '', embLang: it.lang });
  } else if (it.k === 'aud') {
    try {
      for (var j = 0; j < v.audioTracks.length; j++) v.audioTracks[j].enabled = j === it.idx;
      audioChosenAt = Date.now();
      var al = (v.audioTracks[it.idx] && v.audioTracks[it.idx].language) || '';
      if (al) saveTitlePref('aud', al.toLowerCase());
    } catch (e) {}
  }
  var chosen = it.k === 'aud' ? P.audio + ': ' + audioName() : P.subtitles + ': ' + subtitleName();
  closeMenu();
  showToast(chosen);
  if (it.k === 'ext' || it.k === 'emb') holdForSubtitle();
}
function keepSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {}
}
/* a tenth of a second per press; held down, the presses come fast and each one counts for five */
var delayPressedAt = 0,
  delayPresses = 0;
function delayStep() {
  var now = Date.now();
  delayPresses = now - delayPressedAt < 350 ? delayPresses + 1 : 0;
  delayPressedAt = now;
  return delayPresses >= 5 ? 0.5 : 0.1;
}
function closeMenu() {
  menu.className = '';
  mode = 'controls';
  paintBtns();
  showBar();
}
