export function cleanPlaceName(placeName) {
  return String(placeName || "").trim().replace(/\s+/g, " ");
}

export function normalisePlaceKey(placeName) {
  return cleanPlaceName(placeName).toLowerCase();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttribute(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", " ");
}

export function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function distanceKm(a, b) {
  const earthRadiusKm = 6371;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = toRadians(Number(b.lat) - Number(a.lat));
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng));

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusKm * centralAngle;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

export function containsCountryHint(placeName) {
  const value = placeName.toLowerCase();

  return [
    "scotland", "england", "wales", "ireland", "united kingdom", "uk",
    "norway", "denmark", "germany", "france", "spain", "italy",
    "netherlands", "belgium", "sweden", "poland"
  ].some((country) => value.includes(country));
}

export function looksProbablyScottishOrUk(placeName) {
  const value = placeName.toLowerCase();

  return [
    "oban", "colonsay", "kennacraig", "inveraray", "glasgow", "edinburgh",
    "manchester", "dunkeld", "pitlochry", "crianlarich", "dalmally",
    "taynuilt", "gogar", "tombreck", "london", "perth", "stirling",
    "fort william", "mallaig", "abington", "dalmeny", "dreghorn", "smethwick"
  ].some((hint) => value.includes(hint));
}

export function normaliseLocationDictionary(locations) {
  const normalised = {};

  Object.entries(locations || {}).forEach(([key, location]) => {
    if (!location) return;

    const lat = Number(location.lat);
    const lng = Number(location.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    normalised[normalisePlaceKey(key)] = {
      shortName: location.shortName || key,
      searchName: location.searchName || location.shortName || key,
      displayName: location.displayName || location.shortName || key,
      lat,
      lng
    };
  });

  return normalised;
}

export function normaliseAliasDictionary(aliases) {
  const normalised = {};

  Object.entries(aliases || {}).forEach(([key, value]) => {
    if (!key || !value) return;
    normalised[normalisePlaceKey(key)] = cleanPlaceName(value);
  });

  return normalised;
}
