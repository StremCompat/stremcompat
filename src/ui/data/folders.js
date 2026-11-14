// Collections folders by id, for the native interface (the server opens a folder by its id).
/* a folder of the profile's Collections by its id */
function findFolder(id) {
  var cols = nuvioCollections();
  for (var c = 0; c < cols.length; c++)
    for (var f = 0; f < ((cols[c] && cols[c].folders) || []).length; f++)
      if (String(cols[c].folders[f].id) === String(id)) return cols[c].folders[f];
  return null;
}
