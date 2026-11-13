// The interface's data logic without its screens, for the native interface: the local server
// runs it (server/app-runtime.js) with its own localStorage, XMLHttpRequest and window, so
// both interfaces share one tested copy of accounts, addons, catalogs, sources and library.
(function () {
'use strict';
/* What the data code tells the screens when something changed. The native interface asks the
   server again instead, so these stand in for the web screens. */
function invalidateBoards() {}
var search = {};
