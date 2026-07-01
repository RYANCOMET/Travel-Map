const GB_BOUNDS = {
  south: 49.7,
  north: 61.1,
  west: -8.9,
  east: 2.2
};

const EUROPE_BOUNDS = {
  south: 34,
  north: 72,
  west: -25,
  east: 45
};

export function isUkRailJourney(fromLocation, toLocation) {
  return isInsideBounds(fromLocation, GB_BOUNDS) && isInsideBounds(toLocation, GB_BOUNDS);
}

export function isEuropeRailJourney(fromLocation, toLocation) {
  return isInsideBounds(fromLocation, EUROPE_BOUNDS) || isInsideBounds(toLocation, EUROPE_BOUNDS);
}

function isInsideBounds(location, bounds) {
  const lat = Number(location && location.lat);
  const lng = Number(location && location.lng);

  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east;
}
