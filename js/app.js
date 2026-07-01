import { CONFIG } from "./config.js";
import { loadJsonDictionary, loadJourneysFromSheet } from "./data.js";
import {
  normaliseAliasDictionary,
  normaliseLocationDictionary,
  normalisePlaceKey
} from "./utils.js";
import { createReviewDialog } from "./reviewDialog.js";
import { createGeocoder } from "./geocoding.js";
import { createMapView } from "./mapView.js";

const statusMessage = document.querySelector("#status");
const clearCacheButton = document.querySelector("#clear-cache-button");
const exportLocationsButton = document.querySelector("#export-locations-button");

let currentJourneys = [];
let currentLocations = {};
let sharedLocations = {};
let placeAliases = {};

let geocoder;
let mapView;

initialise();

async function initialise() {
  try {
    sharedLocations = normaliseLocationDictionary(
      await loadJsonDictionary(CONFIG.sharedLocationsUrl, "shared locations")
    );

    placeAliases = normaliseAliasDictionary(
      await loadJsonDictionary(CONFIG.placeAliasesUrl, "place aliases")
    );

    const reviewDialog = createReviewDialog();

    geocoder = createGeocoder({
      sharedLocations,
      placeAliases,
      reviewDialog
    });

    reviewDialog.setManualSearchProvider(async (searchText) => {
      return await geocoder.geocodePlaceCandidates(searchText);
    });

    mapView = createMapView({
      onFixLocation: fixLocation
    });

    bindButtons();

    await loadAndRender();
  } catch (error) {
    showError(error.message);
    console.error(error);
  }
}

function bindButtons() {
  clearCacheButton.addEventListener("click", () => {
    geocoder.clearBrowserLocationCache();
    location.reload();
  });

  exportLocationsButton.addEventListener("click", () => {
    exportLocationsJson();
  });
}

async function loadAndRender() {
  try {
    const result = await loadJourneysFromSheet();
    currentJourneys = result.journeys;

    setStatus(result.message);
    await renderJourneys(currentJourneys);
  } catch (error) {
    showError(error.message);
    mapView?.clear();
    console.error(error);
  }
}

async function renderJourneys(journeys) {
  const validJourneys = journeys.filter((journey) => {
    return journey.from && journey.to && journey.from !== "--" && journey.to !== "--";
  });

  if (validJourneys.length === 0) {
    showError(`Read ${journeys.length} rows, but none had both From and To filled in.`);
    return;
  }

  const locations = {};
  const counts = {
    shared: 0,
    browser: 0,
    searched: 0,
    reviewed: 0
  };

  let previousLocation = null;

  for (let index = 0; index < validJourneys.length; index++) {
    const journey = validJourneys[index];
    const points = [
      { role: "from", name: journey.from },
      { role: "to", name: journey.to }
    ];

    for (const point of points) {
      const key = normalisePlaceKey(point.name);

      if (locations[key]) {
        previousLocation = locations[key];
        continue;
      }

      setStatus(
        `Finding ${index + 1}/${validJourneys.length}: ${point.name} · ` +
        `${counts.shared} shared, ${counts.browser} browser, ` +
        `${counts.searched} searched, ${counts.reviewed} reviewed`
      );

      const location = await geocoder.getLocation(point.name, {
        journey,
        role: point.role,
        previousLocation
      });

      if (location) {
        if (location.source === "shared") counts.shared++;
        else if (location.source === "browser") counts.browser++;
        else if (location.source === "reviewed") counts.reviewed++;
        else counts.searched++;

        locations[key] = location;
        previousLocation = location;
      } else {
        counts.searched++;
        console.warn(`Could not find location for: ${point.name}`);
      }
    }
  }

  currentLocations = locations;
  mapView.drawAllJourneys(validJourneys, locations);
  mapView.invalidateSoon();

  const unresolvedJourneys = validJourneys.filter((journey) => {
    return !locations[normalisePlaceKey(journey.from)] || !locations[normalisePlaceKey(journey.to)];
  });

  if (unresolvedJourneys.length > 0) {
    showError(
      `Mapped ${validJourneys.length - unresolvedJourneys.length}/${validJourneys.length} journey legs. ` +
      `${unresolvedJourneys.length} need clearer place names.`
    );
  } else {
    setStatus(
      `Mapped ${validJourneys.length} journey legs · ${counts.shared} shared · ` +
      `${counts.browser} browser · ${counts.searched} searched · ${counts.reviewed} reviewed. ` +
      `Click a marker or sidebar fix button to correct a wrong point.`
    );
  }
}

async function fixLocation(placeKey) {
  const key = normalisePlaceKey(placeKey);
  const existing =
    currentLocations[key] ||
    sharedLocations[key] ||
    geocoder.getBrowserCachedLocation(key);

  if (!existing) {
    showError(`Could not find an existing location for ${placeKey}.`);
    return;
  }

  const chosen = await geocoder.chooseReplacementLocation(key, existing);

  if (!chosen) return;

  const correctedLocation = {
    shortName: existing.shortName || placeKey,
    searchName: existing.searchName || existing.shortName || placeKey,
    displayName: chosen.displayName,
    lat: chosen.lat,
    lng: chosen.lng
  };

  const aliasKey = normalisePlaceKey(correctedLocation.searchName);
  geocoder.saveLocationForKeys(correctedLocation, key, aliasKey);

  currentLocations[key] = {
    ...correctedLocation,
    source: "reviewed"
  };

  setStatus(
    `Updated ${correctedLocation.shortName}. Click Export locations when you are happy, then replace locations.json.`
  );

  const validJourneys = currentJourneys.filter((journey) => {
    return journey.from && journey.to && journey.from !== "--" && journey.to !== "--";
  });

  mapView.drawAllJourneys(validJourneys, currentLocations);
}

function exportLocationsJson() {
  const cleanLocations = {};

  Object.entries(sharedLocations)
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .forEach(([key, location]) => {
      cleanLocations[key] = {
        shortName: location.shortName || key,
        searchName: location.searchName || location.shortName || key,
        displayName: location.displayName || location.shortName || key,
        lat: Number(location.lat),
        lng: Number(location.lng)
      };
    });

  const jsonText = JSON.stringify(cleanLocations, null, 2);
  const blob = new Blob([jsonText], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "locations.json";
  link.click();

  URL.revokeObjectURL(downloadUrl);

  setStatus(
    `Exported ${Object.keys(cleanLocations).length} saved locations. Replace the project's locations.json file with the downloaded file.`
  );
}

function setStatus(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove("error");
}

function showError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.add("error");
}
