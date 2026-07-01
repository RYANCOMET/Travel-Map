export function isFlightMethod(method) {
  const key = normaliseMethod(method);

  return [
    "plane",
    "flight",
    "flights",
    "fly",
    "flying",
    "air",
    "airplane",
    "aeroplane"
  ].includes(key);
}

export function isDrivingMethod(method) {
  const key = normaliseMethod(method);

  return [
    "driven",
    "drive",
    "driving",
    "car",
    "taxi",
    "bus",
    "coach",
    "minibus",
    "hitch",
    "hitchhike",
    "hitchhiked",
    "hitchhiking"
  ].includes(key);
}

export function isTrainMethod(method) {
  const key = normaliseMethod(method);

  return [
    "train",
    "rail",
    "railway",
    "subway",
    "metro",
    "tram",
    "light rail",
    "light_rail"
  ].includes(key);
}

function normaliseMethod(method) {
  return String(method || "").trim().toLowerCase();
}
