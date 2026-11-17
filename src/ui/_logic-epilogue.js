/* ---------- what only the native server uses (the web interface has its own ways) ---------- */
/* the source Best plays from a whole search, in the quality and language preferred in Settings */
function bestOf(pool) {
  return bestSource(
    orderedSources(pool, 'All', 'All').items,
    lsRaw('preferredSourceQuality', 'Auto'),
    preferredSourceLanguage()
  );
}
/* labels: the compatibility labels of the source that failed; returns the formats newly kept */
var AUDIO_FORMATS = ['TrueHD', 'DTS', 'E-AC-3'];
function learnUnsupported(labels, what) {
  var known = unsupportedFormats(),
    added = (labels || []).filter(function (l) {
      return what === 'audio' && AUDIO_FORMATS.indexOf(l) >= 0 && known.indexOf(l) < 0;
    });
  if (added.length) lsSet('unsupportedFormats', known.concat(added));
  return added;
}

/* what the server may call (server/app-api.js); nothing else is reachable from outside */
window.__logic = {
  addonChoices: addonChoices,
  addons: addons,
  addonsFor: addonsFor,
  BEST_WAIT_MS: BEST_WAIT_MS,
  allLib: allLib,
  authKey: authKey,
  bestOf: bestOf,
  bestSource: bestSource,
  bgOf: bgOf,
  bgSmall: bgSmall,
  buildEpisodeModel: buildEpisodeModel,
  calendarEpisodes: calendarEpisodes,
  checkNewEpisodes: checkNewEpisodes,
  clearContinueWatching: clearContinueWatching,
  clearRecentSearches: clearRecentSearches,
  compactSourcePool: compactSourcePool,
  compatText: compatText,
  completeSignIn: completeSignIn,
  cwItems: cwItems,
  cwCard: cwCard,
  cwSubtitle: cwSubtitle,
  defaultMediaLanguage: defaultMediaLanguage,
  diagEventLine: diagEventLine,
  diagStreamingState: diagStreamingState,
  discoverCatalogs: discoverCatalogs,
  discoverGenres: discoverGenres,
  discoverPageUrl: discoverPageUrl,
  discoverTypes: discoverTypes,
  enrichEpisodeMetadata: enrichEpisodeMetadata,
  episodesUpTo: episodesUpTo,
  episodeBadge: episodeBadge,
  episodeDay: episodeDay,
  episodeFallback: episodeFallback,
  episodeImage: episodeImage,
  episodeMetaLine: episodeMetaLine,
  firstUnwatched: firstUnwatched,
  fetchStreams: fetchStreams,
  getCatalogUrl: getCatalogUrl,
  getMeta: getMeta,
  hiddenNewEpisodes: hiddenNewEpisodes,
  hideNewEpisodes: hideNewEpisodes,
  homeDefs: homeDefs,
  homeLibraryRows: homeLibraryRows,
  homeRowChoices: homeRowChoices,
  folderView: folderView,
  folderSources: folderSources,
  discoverMax: discoverMax,
  findFolder: findFolder,
  dropLiveFromLibrary: dropLiveFromLibrary,
  saveHomeLayout: saveHomeLayout,
  isNuvioAccount: isNuvioAccount,
  isSwitch: isSwitch,
  knownArtwork: knownArtwork,
  langFilterName: langFilterName,
  spoilerMode: spoilerMode,
  learnUnsupported: learnUnsupported,
  languageChoices: languageChoices,
  itemWatched: itemWatched,
  libGridItems: libGridItems,
  libHas: libHas,
  libKey: function (id) {
    return PRE + id;
  },
  libItem: function (id) {
    return lsJson(PRE + id);
  },
  libToggle: libToggle,
  /* the last toast the data code said, then forgotten */
  takeMessage: function () {
    var m = lastMessage;
    lastMessage = '';
    return m;
  },
  markCwWatched: markCwWatched,
  matchingNextSource: matchingNextSource,
  newEpisodeItems: newEpisodeItems,
  nuvioCollections: nuvioCollections,
  orderedSources: orderedSources,
  posterOf: posterOf,
  pullLib: pullLib,
  pruneCaches: pruneCaches,
  pushLib: pushLib,
  qualityChips: qualityChips,
  /* after another profile was chosen: its user, addons and collections */
  reloadAccount: function (done) {
    postJson(API + '/api/getUser', { authKey: authKey() }, function (u) {
      if (u && u.result) lsSet('user', u.result);
      lsRawSet('addons', '');
      syncAddons(function () {
        syncCollections(function () {
          done();
        });
      });
    });
  },
  recentSearches: recentSearches,
  releasedTime: releasedTime,
  rememberSearch: rememberSearch,
  resumeInfoFor: resumeInfoFor,
  resumeLabel: resumeLabel,
  setting: lsRaw,
  settingValueLabel: settingValueLabel,
  settingsCategories: settingsCategories,
  showHiddenNewEpisodes: showHiddenNewEpisodes,
  signOut: signOut,
  storeSetting: storeSetting,
  signInRequest: function (body, cb) {
    postJson(API + '/api/login', body, cb);
  },
  simpleMode: simpleMode,
  removeFromCw: removeFromCw,
  setEpisodesWatched: setEpisodesWatched,
  setItemWatched: setItemWatched,
  sourceHeading: sourceHeading,
  sourceTags: sourceTags,
  sourceText: sourceText,
  streamLanguages: streamLanguages,
  streamRefBody: streamRefBody,
  syncAddons: syncAddons,
  syncCollections: syncCollections,
  titleFacts: titleFacts,
  tx: tx,
  uiLanguage: function () {
    return UI_LANG;
  },
  uiText: function () {
    return { lang: UI_TEXT[UI_LANG] || {}, fallback: UI_TEXT['en-US'] };
  },
  upNextPointer: upNextPointer,
  user: user,
  watchedFromBits: watchedFromBits,
  watchFinished: watchFinished
};
})();
