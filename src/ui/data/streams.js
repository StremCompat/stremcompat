// Source discovery, quality/seeder/codec classification and per-profile source budget.
/* ================= streams (generic: any addon that declares them) ================= */
function streamAddons(type) {
  return streamAddonsIn(remoteAddons(), type);
}
function qualityLabel(value) {
  return value === 'All'
    ? tx('all')
    : value === 'Other'
      ? tx('other')
      : value === 'Recent'
        ? tx('recent')
        : value;
}
window.__SC_STREAM_COMPAT__ = streamCompatibility;
/* Short tags for the source list, read from the same advisory text: quality, language, what
   stands out in picture and sound (Dolby Vision, HDR, Atmos, DTS:X, IMAX, Remux, 5.1/7.1), size
   and seeders. Other codecs only show when they are a compatibility warning. */
function sourceTags(s) {
  var t = streamText(s),
    low = t.toLowerCase(),
    out = [],
    m;
  if (s.cached) out.push({ t: s.cached === 'debrid' ? tx('cachedTag') : s.cached, c: 'cached' });
  if (s.quality && s.quality !== 'Other' && s.quality !== 'Recent') out.push({ t: s.quality, c: 'q' });
  /* where the release comes from; a camera copy is a warning */
  var origin = /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|\btelesync\b/.test(low)
    ? 'CAM'
    : /\bremux\b/.test(low)
      ? ''
      : /\b(blu[ ._-]?ray|bdrip|brrip)\b/.test(low)
        ? 'BluRay'
        : /\bweb[ ._-]?dl\b/.test(low)
          ? 'WEB-DL'
          : /\bweb[ ._-]?rip\b/.test(low)
            ? 'WEBRip'
            : /\bhdtv\b/.test(low)
              ? 'HDTV'
              : '';
  if (origin) out.push({ t: origin, c: origin === 'CAM' ? 'warn' : 'src' });
  /* what makes a release stand out, as badges of their own */
  if (/(dolby[ ._-]?vision|\bdovi\b|\bdv\b)/.test(low)) out.push({ t: 'DOLBY VISION', c: 'fx' });
  if (/hdr10\+/.test(low)) out.push({ t: 'HDR10+', c: 'fx' });
  else if (/\bhdr(10)?\b/.test(low)) out.push({ t: 'HDR', c: 'fx' });
  if (/\batmos\b/.test(low)) out.push({ t: 'ATMOS', c: 'fx' });
  if (/\bdts[ ._-]?x\b/.test(low)) out.push({ t: 'DTS:X', c: 'fx' });
  if (/\bimax\b/.test(low)) out.push({ t: 'IMAX', c: 'fx' });
  if (/\bremux\b/.test(low)) out.push({ t: 'REMUX', c: 'fx' });
  m = low.match(/(?:^|[^0-9])([57])[ ._]1(?![0-9])/);
  if (m) out.push({ t: m[1] + '.1' });
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (m) out.push({ t: m[1].replace(',', '.') + ' ' + m[2].charAt(0).toUpperCase() + 'B', c: 'size' });
  if (s.seeders >= 0) out.push({ t: tx('seedsTag', s.seeders), c: 'seed' });
  /* the audio and subtitle languages go right after the quality */
  var langTags = [];
  if (s.langs && s.langs.length) langTags.push({ t: langTagText(s.langs), c: 'lang' });
  if (s.subLangs && s.subLangs.length) langTags.push(subTag(s.subLangs));
  var at = 0;
  while (at < out.length && (out[at].c === 'cached' || out[at].c === 'q')) at++;
  Array.prototype.splice.apply(out, [at, 0].concat(langTags));
  return out;
}
window.__SC_SOURCE_TAGS__ = sourceTags;
window.__SC_SOURCE_ITEM__ = sourceItem;
window.__SC_SOURCE_TEXT__ = sourceText;
window.__SC_STREAM_LANGUAGES__ = streamLanguages;
window.__SC_LANGUAGE_INFO__ = streamLanguageInfo;
/* 'PT-BR', 'ES-LA · EN', 'MULTI', or the first two and '+2' when there are more */
function langTagText(langs) {
  var names = [];
  for (var i = 0; i < langs.length; i++)
    names.push(langs[i] === 'es-419' ? 'ES-LA' : langs[i] === 'multi' ? 'MULTI' : langs[i].toUpperCase());
  return names.length > 2 ? names.slice(0, 2).join(' · ') + ' +' + (names.length - 2) : names.join(' · ');
}
/* 'LEG EN · PT +4' (subtitles), without the multi marker the words already imply */
function subTag(langs) {
  var named = [];
  for (var i = 0; i < langs.length; i++) if (langs[i] !== 'multi') named.push(langs[i]);
  return { t: tx('subsTag') + ' ' + (named.length ? langTagText(named) : 'MULTI'), c: 'sublang' };
}
/* filter groups of a source: language bases, 'multi', or 'none' when nothing was detected */
function langGroups(s) {
  var langs = s.langs || [],
    out = [];
  for (var i = 0; i < langs.length; i++) {
    var g = langBase(langs[i]);
    if (out.indexOf(g) < 0) out.push(g);
  }
  if (!out.length) out.push('none');
  return out;
}
/* whether a source passes the language filter of the source list (views/streams.js) */
function inLangFilter(s, key) {
  if (key === 'All') return true;
  var lang = key.slice(2);
  if (key.charAt(0) === 's') return subtitleGroups(s).indexOf(lang) >= 0;
  return langGroups(s).indexOf(lang) >= 0;
}
/* the language groups of a source's subtitles */
function subtitleGroups(s) {
  var out = [],
    subs = s.subLangs || [];
  for (var i = 0; i < subs.length; i++) {
    var g = langBase(subs[i]);
    if (g !== 'multi' && out.indexOf(g) < 0) out.push(g);
  }
  return out;
}
/* a language group by its own name, as in the lists of languages */
function sourceLanguageLabel(code) {
  if (code === 'none') return tx('langOther');
  if (code === 'multi') return 'Multi';
  for (var i = 0; i < SOURCE_LANGUAGES.length; i++)
    if (SOURCE_LANGUAGES[i][0] === code) return SOURCE_LANGUAGES[i][1];
  return { ru: 'Русский', hi: 'हिन्दी', zh: '中文' }[code] || code.toUpperCase();
}
window.__SC_IN_LANG_FILTER__ = inLangFilter;
/* the languages a source can be chosen in, by their own names (Settings, Best source) */
var SOURCE_LANGUAGES = [
  ['pt', 'Português'],
  ['es', 'Español'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['de', 'Deutsch'],
  ['ko', '한국어'],
  ['ja', '日本語']
];
function sourceLanguageName(code) {
  for (var i = 0; i < SOURCE_LANGUAGES.length; i++)
    if (SOURCE_LANGUAGES[i][0] === code) return SOURCE_LANGUAGES[i][1];
  return tx('anyLanguage');
}
/* the language the source list is ordered by: only one fixed in Settings, so the one chosen in
   Best source does not reorder the whole list */
function fixedSourceLanguage() {
  var set = lsRaw('preferredSourceLanguage', 'Ask');
  return set === 'Ask' ? 'Auto' : set;
}
/* the language Best source looks for: the one in Settings, or with Ask the last one chosen */
function preferredSourceLanguage() {
  var set = lsRaw('preferredSourceLanguage', 'Ask');
  return set === 'Ask' ? lsRaw('bestLanguage', 'Auto') : set;
}
/* 0 when the source has the preferred audio language, 1 for multi audio, 2 otherwise. A torrent
   with almost no seeders counts as otherwise: the language does not put one that would hardly
   load above the rest. */
var LANGUAGE_MIN_SEEDERS = 5;
function langRank(s, pref) {
  if (!pref || pref === 'Auto') return 0;
  if (s.seeders != null && s.seeders < LANGUAGE_MIN_SEEDERS) return 2;
  var g = langGroups(s);
  return g.indexOf(pref) >= 0 ? 0 : g.indexOf('multi') >= 0 ? 1 : 2;
}
/* What to play without choosing from the list, whose order already puts compatibility and seeders
   first: in the language asked for when there is one, the first without a warning in the quality
   asked for, or else in any known quality, and a low or unknown quality only when nothing better
   has none. A format this TV already failed to play is never picked. */
function bestSource(items, quality, language) {
  var playable = items.filter(function (s) {
    return !s.stored && !(s.compatRank > 0) && !(s.compatLabels || []).length;
  });
  if (!playable.length)
    playable = items.filter(function (s) {
      return !s.stored && s.compatRank < 4 && !(s.unsupported || []).length;
    });
  /* the language asked for first, then multi-audio, keeping the list's order within each */
  if (language && language !== 'Auto')
    playable = playable
      .map(function (s, i) {
        return { s: s, i: i, r: langRank(s, language) };
      })
      .sort(function (a, b) {
        return a.r - b.r || a.i - b.i;
      })
      .map(function (x) {
        return x.s;
      });
  var asked = playable.filter(function (s) {
    return s.quality === quality;
  });
  var known = playable.filter(function (s) {
    return s.quality !== 'Other' && s.quality !== 'SD';
  });
  return asked[0] || healthyBest(playable, language) || known[0] || playable[0] || null;
}
/* With no quality asked for: among the sources that will start well (cached, a direct link, or a
   torrent with enough seeders) in the best language there is, 1080p first (it plays on every TV
   and phone), then 4K, then 720p, each in the list's order. The most seeded 720p used to win over
   a healthy 1080p. */
var HEALTHY_SEEDERS = 10,
  BEST_QUALITIES = ['1080p', '4K', '720p'];
function healthyBest(playable, language) {
  /* a torrent (a seeder count, or the engine's address) starts well with enough seeders; one whose
     addon gave no count is not known to */
  var healthy = playable.filter(function (s) {
    var counted = s.seeders != null && s.seeders >= 0,
      torrent = counted || /:11470\/[0-9a-f]{32,64}\//i.test(s.url || '');
    return s.cached || !torrent || (counted && s.seeders >= HEALTHY_SEEDERS);
  });
  if (!healthy.length) return null;
  var rank = function (s) {
    return language && language !== 'Auto' ? langRank(s, language) : 0;
  };
  var best = Math.min.apply(
    null,
    healthy.map(function (s) {
      return rank(s);
    })
  );
  healthy = healthy.filter(function (s) {
    return rank(s) === best;
  });
  for (var q = 0; q < BEST_QUALITIES.length; q++)
    for (var i = 0; i < healthy.length; i++) if (healthy[i].quality === BEST_QUALITIES[q]) return healthy[i];
  return null;
}
window.__SC_BEST_SOURCE__ = bestSource;
/* Best from the title page plays once every addon answered, or this long after the search began
   when a source is already there, so one slow addon does not hold it up */
var BEST_WAIT_MS = 10000;

/* ---- the formats this TV failed to play ----
   The native player says when the TV could not decode a source's audio; the audio formats that
   source named (DTS, TrueHD, E-AC-3) are kept (learnUnsupported), and sources with them go down
   the list with a warning and are never picked by Best. */
function unsupportedFormats() {
  return lsJson('unsupportedFormats') || [];
}
function markUnsupported(item, known) {
  item.unsupported = (item.compatLabels || []).filter(function (l) {
    return known.indexOf(l) >= 0;
  });
  if (item.unsupported.length) item.compatRank = Math.max(item.compatRank || 0, 3);
}
/* the warning line of a source: what this TV failed to play, or what may not play */
function compatText(s) {
  if (s.unsupported && s.unsupported.length) return tx('notOnThisTv', s.unsupported.join(' · '));
  return s.compatLabels && s.compatLabels.length ? tx('compatibilityCheck', s.compatLabels.join(' · ')) : '';
}
/* The addon tabs over the list: All, then each addon with how many sources it has, in name order
   so they do not move as answers arrive; offered when more than one addon has sources. */
function addonChoices(pool) {
  var counts = {},
    names = [];
  for (var n = 0; n < pool.length; n++) {
    if (pool[n].stored) continue;
    var k = pool[n].addon || '';
    if (!counts[k]) names.push(k);
    counts[k] = (counts[k] || 0) + 1;
  }
  if (names.length < 2) return [];
  names.sort(function (a, b) {
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
  return [{ key: 'All', label: tx('all') }].concat(
    names.map(function (k) {
      return { key: k, label: (k || 'Addon') + ' ' + counts[k] };
    })
  );
}
function streamSourceKey(s) {
  if (s.stored) return 'stored';
  var u = String(s.url || '').replace(/#.*$/, '');
  var m = u.match(/127\.0\.0\.1:11470\/([0-9a-f]{32,64})\/(\d+)/i);
  return m
    ? 'torrent:' + m[1].toLowerCase() + ':' + m[2]
    : 'url:' + u + '|' + JSON.stringify(s.headers || {}) + '|' + (s.notWebReady ? '1' : '0');
}
function sourceOrder(a, b) {
  if (a.stored && !b.stored) return -1;
  if (b.stored && !a.stored) return 1;
  var ar = a.compatRank || 0,
    br = b.compatRank || 0;
  if (ar !== br) return ar - br;
  if (!a.cached !== !b.cached) return a.cached ? -1 : 1;
  var as = a.seeders == null ? -1 : a.seeders,
    bs = b.seeders == null ? -1 : b.seeders;
  if (as !== bs) return bs - as;
  return (a._seq || 0) - (b._seq || 0);
}
function compactSourcePool(input, cap) {
  var best = {},
    unique = [],
    i,
    s,
    k,
    old,
    buckets = {},
    order = ['Recent', '4K', '1440p', '1080p', '720p', 'SD', 'Other'],
    selected = [],
    kept = {},
    trimmed = {},
    rest = [];
  cap = Math.max(1, cap || 60);
  for (i = 0; i < input.length; i++) {
    s = input[i];
    k = streamSourceKey(s);
    old = best[k];
    if (!old) {
      best[k] = s;
      unique.push(s);
    } else if (sourceOrder(s, old) < 0) {
      for (var u = 0; u < unique.length; u++)
        if (unique[u] === old) {
          unique[u] = s;
          break;
        }
      best[k] = s;
    }
  }
  for (i = 0; i < unique.length; i++) {
    s = unique[i];
    k = s.quality || 'Other';
    if (!buckets[k]) {
      buckets[k] = [];
      if (order.indexOf(k) < 0) order.push(k);
    }
    buckets[k].push(s);
  }
  for (i = 0; i < order.length; i++) {
    k = order[i];
    if (buckets[k]) buckets[k].sort(sourceOrder);
  }
  /* Keep one representative of every available quality, then fill the remaining
     global budget by compatibility and reliable seeder metadata. */
  for (i = 0; i < order.length && selected.length < cap; i++) {
    k = order[i];
    if (buckets[k] && buckets[k].length) {
      selected.push(buckets[k][0]);
      kept[k] = 1;
    }
  }
  for (i = 0; i < order.length; i++) {
    k = order[i];
    if (!buckets[k]) continue;
    for (var r = kept[k] || 0; r < buckets[k].length; r++) rest.push(buckets[k][r]);
  }
  rest.sort(sourceOrder);
  /* One torrent addon with hundreds of results (Torrentio) filled the whole list by seeders, and
     every other addon vanished from it. Each addon keeps a share (half of the list, split evenly
     among all addons) of its best sources; the rest of the list is filled by rank as before. */
  var share = {},
    addons = 0,
    left = [];
  for (i = 0; i < unique.length; i++) {
    k = unique[i].addon || '';
    if (share[k] === undefined) {
      share[k] = 0;
      addons++;
    }
  }
  for (i = 0; i < selected.length; i++)
    share[selected[i].addon || ''] = (share[selected[i].addon || ''] || 0) + 1;
  var floor = Math.floor(cap / (2 * Math.max(1, addons)));
  for (i = 0; i < rest.length; i++) {
    s = rest[i];
    k = s.addon || '';
    if (selected.length < cap && share[k] < floor) {
      share[k]++;
      selected.push(s);
      kept[s.quality || 'Other'] = (kept[s.quality || 'Other'] || 0) + 1;
    } else left.push(s);
  }
  rest = left;
  for (i = 0; i < rest.length && selected.length < cap; i++) {
    s = rest[i];
    selected.push(s);
    k = s.quality || 'Other';
    kept[k] = (kept[k] || 0) + 1;
  }
  for (k in buckets)
    if (Object.prototype.hasOwnProperty.call(buckets, k) && buckets[k].length > (kept[k] || 0))
      trimmed[k] = true;
  return { items: selected, trimmed: trimmed };
}
window.__SC_COMPACT_SOURCES__ = compactSourcePool;
/* onDone(total, failed): failed lists the addons that did not answer, so the picker can
   tell "nothing found" apart from "the addon is down". */
/* the quality chips over the list: All, then each quality with how many sources it has (a +
   when the list was cut) */
/* Quick filters after the quality chips, offered when a source has what they look for: cached
   by a debrid service, HDR or Dolby Vision, Atmos, Remux, and Hide CAM when camera copies came.
   Their keys start with 'f:' and take the quality chip's place in orderedSources. */
var QUICK_FILTERS = [
  [
    'cached',
    'filterCached',
    function (s) {
      return !!s.cached;
    }
  ],
  [
    'hdr',
    'filterHdr',
    function (s) {
      return /(dolby[ ._-]?vision|\bdovi\b|\bdv\b|\bhdr)/i.test(streamText(s));
    }
  ],
  [
    'atmos',
    'filterAtmos',
    function (s) {
      return /\batmos\b/i.test(streamText(s));
    }
  ],
  [
    'remux',
    'filterRemux',
    function (s) {
      return /\bremux\b/i.test(streamText(s));
    }
  ],
  [
    'nocam',
    'filterNoCam',
    function (s) {
      return !isCamCopy(s);
    }
  ]
];
function isCamCopy(s) {
  return /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|\btelesync\b/i.test(streamText(s));
}
function quickFilterTest(key) {
  for (var i = 0; i < QUICK_FILTERS.length; i++)
    if ('f:' + QUICK_FILTERS[i][0] === key) return QUICK_FILTERS[i][2];
  return null;
}
/* the counts are of the sources the language and addon filters keep (langKey, addon: 'All' or none
   for every one) */
function qualityChips(pool, trimmed, langKey, addon) {
  var counts = {},
    out = [],
    order = ['All', '4K', '1440p', '1080p', '720p', 'SD', 'Other'];
  pool = pool.filter(function (s) {
    return (
      s.stored || (inLangFilter(s, langKey || 'All') && (!addon || addon === 'All' || s.addon === addon))
    );
  });
  for (var n = 0; n < pool.length; n++) {
    var q = pool[n].quality || 'Other';
    counts[q] = (counts[q] || 0) + 1;
  }
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    if (key !== 'All' && !counts[key]) continue;
    out.push({
      key: key,
      label:
        qualityLabel(key) +
        (key === 'All' ? '' : ' \u00b7 ' + counts[key] + ((trimmed || {})[key] ? '+' : ''))
    });
  }
  var playable = pool.filter(function (s) {
    return !s.stored;
  });
  for (var f = 0; f < QUICK_FILTERS.length; f++) {
    var test = QUICK_FILTERS[f][2],
      n = playable.filter(test).length;
    /* Hide CAM only when there is a camera copy to hide */
    var offered = QUICK_FILTERS[f][0] === 'nocam' ? n < playable.length && n > 0 : n > 0;
    if (offered)
      out.push({ key: 'f:' + QUICK_FILTERS[f][0], label: tx(QUICK_FILTERS[f][1]) + ' \u00b7 ' + n });
  }
  return out;
}
/* The language filter: 'a:pt' for sources in Portuguese audio, 's:pt' for sources that only
   carry Portuguese subtitles, with how many of each; offered when there is a choice. Audio
   first, then subtitles; within each English, Portuguese, Spanish, the other languages, multi
   audio, then sources with no language. */
function languageChoices(pool) {
  var counts = {},
    order = [];
  function count(key) {
    if (!counts[key]) order.push(key);
    counts[key] = (counts[key] || 0) + 1;
  }
  for (var n = 0; n < pool.length; n++) {
    var s = pool[n];
    if (s.stored) continue;
    var audio = langGroups(s);
    for (var a = 0; a < audio.length; a++) count('a:' + audio[a]);
    var subs = subtitleGroups(s);
    for (var b = 0; b < subs.length; b++) count('s:' + subs[b]);
  }
  var rank = ['en', 'pt', 'es', 'fr', 'it', 'de', 'ja', 'ko', 'zh', 'ru', 'hi', 'multi', 'none'];
  function place(key) {
    return (key.charAt(0) === 's' ? 100 : 0) + rank.indexOf(key.slice(2));
  }
  order.sort(function (x, y) {
    return place(x) - place(y);
  });
  return { keys: order.length > 1 ? ['All'].concat(order) : [], counts: counts };
}
/* 'Audio: Português', 'Subtitles: English', or 'Language: all' */
function langFilterName(key) {
  if (key === 'All') return tx('langChipAll');
  return tx(key.charAt(0) === 's' ? 'subsFilter' : 'langFilter', sourceLanguageLabel(key.slice(2)));
}
/* The list as it is shown: the chosen quality and language, the last source first, then the
   preferred language, then the preferred quality; and the one likely the best choice, named
   only when there is a choice (the same source the Best source button starts), else -1. addon
   keeps one addon's sources ('All' or none: every addon's). */
function orderedSources(pool, quality, langKey, addon) {
  var pref = lsRaw('preferredSourceQuality', 'Auto'),
    langPref = fixedSourceLanguage();
  /* a quick filter chip stands for 'All' qualities with its own test */
  var quick = quickFilterTest(quality);
  if (quick) quality = 'All';
  var flat = pool.filter(function (s) {
    if (s.stored) return quality === 'All' || s.quality === quality;
    if (quick && !quick(s)) return false;
    return (
      (quality === 'All' || s.quality === quality) &&
      inLangFilter(s, langKey) &&
      (!addon || addon === 'All' || s.addon === addon)
    );
  });
  flat.sort(function (a, b) {
    if (!a.stored !== !b.stored) return a.stored ? -1 : 1;
    var al = langRank(a, langPref),
      bl = langRank(b, langPref);
    if (al !== bl) return al - bl;
    if (pref !== 'Auto') {
      var ap = a.quality === pref ? 0 : 1,
        bp = b.quality === pref ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    return sourceOrder(a, b);
  });
  var choices = flat.filter(function (s) {
    return !s.stored;
  }).length;
  /* the source the Best button would start, in the language it looks for */
  return {
    items: flat,
    recommended: choices < 2 ? -1 : flat.indexOf(bestSource(flat, pref, preferredSourceLanguage()))
  };
}
/* a source's heading and its text, as the list shows them */
function sourceHeading(s) {
  return s.stored ? tx('continuePlayback') : s.addon || 'Addon';
}
/* The release name, as the list shows it: without what the badges already say (Torrentio's
   "👤 120 💾 1.4 GB ⚙️ ThePirateBay" and the lines of flags), so the name is what remains. */
function sourceText(s) {
  var raw = String(s.title || s.name || ''),
    lines = raw.split('\n').map(function (line) {
      return line
        .replace(/(\uD83D\uDC64|\uD83D\uDC65)\s*\d+/g, '')
        .replace(/\uD83D\uDCBE\s*[\d.,]+\s*[KMGT]i?B/gi, '')
        .replace(/\u2699\uFE0F?\s*\S+/g, '')
        .replace(/(\uD83C[\uDDE6-\uDDFF]){2}/g, '')
        .replace(/^[\s|/·-]+|[\s|/·-]+$/g, '');
    });
  var text = lines
    .filter(function (line) {
      return line.length > 0;
    })
    .join('  ');
  return text || raw.replace(/\n/g, '  ');
}
/* onLeft(names), when given, hears which addons are still to answer each time one does */
function fetchStreams(type, vid, onPart, onDone, onLeft) {
  var list = streamAddons(type);
  var pending = list.length;
  var total = 0;
  var failed = [];
  var known = unsupportedFormats();
  var waiting = list.map(function (ad) {
    return ad.name;
  });
  if (!pending) {
    onDone(0, failed);
    return;
  }
  if (onLeft) onLeft(waiting.slice());
  for (var i = 0; i < list.length; i++)
    (function (ad, idx) {
      /* an addon that fails at once (a server error from a busy host, or no answer) is asked once
         more; not one that has no such title, nor one that timed out, which would double the wait */
      function ask(again) {
        xhrJson(
          streamUrl(ad, type, vid),
          function (j, failure, status) {
            if ((failure === 'offline' || status >= 500) && !again)
              return setTimeout(function () {
                ask(true);
              }, 1200);
            if (failure) failed.push(ad.name);
            var st = (j && j.streams) || [];
            var out = [];
            for (var k = 0; k < st.length; k++) {
              var item = sourceItem(st[k], ad.name, ad.base);
              if (!item) continue;
              markUnsupported(item, known);
              out.push(item);
            }
            total += out.length;
            waiting.splice(waiting.indexOf(ad.name), 1);
            if (onLeft) onLeft(waiting.slice());
            if (out.length) onPart(out, idx, ad.name);
            pending--;
            if (pending <= 0) onDone(total, failed);
          },
          45000,
          true
        ); /* slow debrid addons can take 20-30s; phone/PC wait too — 15s was dropping them */
      }
      ask(false);
    })(list[i], i);
}
