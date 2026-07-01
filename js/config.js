export const CONFIG = {
  googleSheetUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQSXnURctzYRbsd72dEPxIrL1pGwL5bQDxJgPnpSBMrpR--DJRm-HEmjJnzyVQwL5ifFvN4XiJHbmFN/pubhtml?gid=0&single=true",

  sharedLocationsUrl: "locations.json",
  placeAliasesUrl: "place-aliases.json",
  countryGeoJsonUrl:
    "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",

  reviewDistanceKm: 1000,
  lowImportanceThreshold: 0.45,
  ambiguousImportanceGap: 0.12,

  geocodeDelayMs: 250
};

export const METHOD_STYLES = {
  train: { colour: "#2563eb", weight: 4, dashArray: null },
  ferry: { colour: "#0891b2", weight: 4, dashArray: "10, 8" },
  bus: { colour: "#16a34a", weight: 4, dashArray: null },
  plane: { colour: "#9333ea", weight: 3, dashArray: "3, 10" },
  hitchhike: { colour: "#ea580c", weight: 4, dashArray: "8, 8" },
  driven: { colour: "#525252", weight: 4, dashArray: null },
  drive: { colour: "#525252", weight: 4, dashArray: null },
  car: { colour: "#525252", weight: 4, dashArray: null },
  default: { colour: "#111827", weight: 3, dashArray: null }
};

export const FALLBACK_JOURNEYS = [
  {
    from: "Tombreck, Scotland",
    to: "Oban, Scotland",
    method: "Hitchhike",
    distance: "98.17 km",
    time: "3:00:00",
    total: "98.17 km"
  },
  {
    from: "Oban, Scotland",
    to: "Colonsay, Scotland",
    method: "Ferry",
    distance: "63.00 km",
    time: "2:30:00",
    total: "161.17 km"
  }
];
