import { CONFIG, METHOD_STYLES } from "./config.js";
import { escapeAttribute, escapeHtml, normalisePlaceKey } from "./utils.js";
import { formatDistance, formatDuration } from "./routes/routeFormatting.js";
import {
  getInitialRouteLatLngs,
  loadDetailedRouteForJourney,
  regenerateDetailedRouteForJourney
} from "./routes/routeService.js";
import { isFlightMethod, isTrainMethod } from "./routes/routeMethods.js";

console.log("mapView.js loaded");

export function createMapView({ onFixLocation }) {
  console.log("createMapView started");

  const map = L.map("map").setView([55.8, -4.5], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  map.createPane("visited-countries");
  map.getPane("visited-countries").style.zIndex = 250;

  const placeList = document.querySelector("#place-list");

  let routeLayers = [];
  let markerLayers = [];
  let markerByPlaceKey = {};
  let visitedCountryLayer = null;
  let countriesGeoJsonCache = null;
  let nextRouteId = 1;
  const routeContextById = new Map();

  window.fixTravelLocation = (placeKey) => {
    onFixLocation(placeKey);
  };

  window.regenerateTravelRoute = async (routeId) => {
    const context = routeContextById.get(String(routeId));

    if (!context) {
      console.warn(`No route context found for ${routeId}`);
      return;
    }

    await regenerateRoute(context);
  };

  function drawAllJourneys(journeys, locations) {
    console.log(`Drawing ${journeys.length} journeys`);

    clear();
    updateVisitedCountryLayer(journeys, locations);

    journeys.forEach((journey) => {
      const fromKey = normalisePlaceKey(journey.from);
      const toKey = normalisePlaceKey(journey.to);
      const fromLocation = locations[fromKey];
      const toLocation = locations[toKey];

      if (!fromLocation || !toLocation) {
        addJourneyToSidebar(journey, null, true);
        return;
      }

      const routeLayer = drawRoute(journey, fromLocation, toLocation);
      routeLayers.push(routeLayer);

      addMarker(fromLocation, fromKey);
      addMarker(toLocation, toKey);

      addJourneyToSidebar(journey, routeLayer, false);
    });

    fitMapToRoutes();
  }

  function drawRoute(journey, fromLocation, toLocation) {
    const style = getMethodStyle(journey.method);
    const trainRoute = isTrainMethod(journey.method);
    const routeLatLngs = getInitialRouteLatLngs(journey, fromLocation, toLocation);

    const routeLayer = L.polyline(routeLatLngs, {
      color: style.colour,
      weight: style.weight,
      dashArray: trainRoute ? "2, 10" : style.dashArray,
      opacity: trainRoute ? 0.22 : 0.78,
      smoothFactor: isFlightMethod(journey.method) ? 0 : 1
    }).addTo(map);

    const routeId = String(nextRouteId++);
    routeLayer._travelRouteId = routeId;
    routeLayer._routeRequestVersion = 0;

    const context = {
      routeId,
      routeLayer,
      journey,
      fromLocation,
      toLocation,
      latestRoute: null,
      waitingForRail: trainRoute,
      regenerating: false,
      message: ""
    };

    routeContextById.set(routeId, context);

    bindRoutePopup(context);
    updateDetailedRouteIfNeeded(context);

    return routeLayer;
  }

  async function updateDetailedRouteIfNeeded(context) {
    const { routeLayer, journey, fromLocation, toLocation } = context;
    const requestVersion = ++routeLayer._routeRequestVersion;
    const detailedRoute = await loadDetailedRouteForJourney(journey, fromLocation, toLocation);

    if (requestVersion !== routeLayer._routeRequestVersion) {
      return;
    }

    if (!detailedRoute) {
      if (isTrainMethod(journey.method)) {
        console.warn(`Rail route not found, keeping faint placeholder: ${journey.from} → ${journey.to}`);
        context.latestRoute = null;
        context.waitingForRail = true;
        context.message = "";
        applyPlaceholderStyle(routeLayer, journey);
        bindRoutePopup(context);
      }

      return;
    }

    applyDetailedRoute(context, detailedRoute);
    fitMapToRoutes();
  }

  async function regenerateRoute(context) {
    if (context.regenerating) {
      return;
    }

    const { routeLayer, journey, fromLocation, toLocation } = context;
    const requestVersion = ++routeLayer._routeRequestVersion;

    context.regenerating = true;
    context.message = "Regenerating route…";
    context.waitingForRail = isTrainMethod(journey.method);
    applyRegeneratingStyle(routeLayer, journey);
    bindRoutePopup(context);
    routeLayer.openPopup();

    try {
      const regeneratedRoute = await regenerateDetailedRouteForJourney(journey, fromLocation, toLocation);

      if (requestVersion !== routeLayer._routeRequestVersion) {
        return;
      }

      context.regenerating = false;

      if (!regeneratedRoute) {
        context.latestRoute = null;
        context.waitingForRail = isTrainMethod(journey.method);
        context.message = "Could not regenerate this route. Keeping the current placeholder.";
        applyPlaceholderStyle(routeLayer, journey);
        bindRoutePopup(context);
        routeLayer.openPopup();
        return;
      }

      context.message = "Route regenerated and saved in this browser.";
      applyDetailedRoute(context, regeneratedRoute);
      routeLayer.openPopup();
      fitMapToRoutes();
    } catch (error) {
      if (requestVersion !== routeLayer._routeRequestVersion) {
        return;
      }

      context.regenerating = false;
      context.latestRoute = null;
      context.waitingForRail = isTrainMethod(journey.method);
      context.message = `Could not regenerate this route: ${error.message || error}`;
      applyPlaceholderStyle(routeLayer, journey);
      bindRoutePopup(context);
      routeLayer.openPopup();
    }
  }

  function applyDetailedRoute(context, detailedRoute) {
    const { routeLayer, journey } = context;

    routeLayer.setLatLngs(detailedRoute.points);
    routeLayer.setStyle({
      opacity: 0.78,
      dashArray: getMethodStyle(journey.method).dashArray
    });

    context.latestRoute = detailedRoute;
    context.waitingForRail = false;
    context.regenerating = false;

    bindRoutePopup(context);
  }

  function applyPlaceholderStyle(routeLayer, journey) {
    routeLayer.setStyle({
      opacity: isTrainMethod(journey.method) ? 0.22 : 0.55,
      dashArray: isTrainMethod(journey.method) ? "2, 10" : getMethodStyle(journey.method).dashArray
    });
  }

  function applyRegeneratingStyle(routeLayer, journey) {
    routeLayer.setStyle({
      opacity: 0.38,
      dashArray: "4, 8"
    });
  }

  function bindRoutePopup(context) {
    const {
      routeId,
      routeLayer,
      journey,
      fromLocation,
      toLocation,
      latestRoute,
      waitingForRail,
      regenerating,
      message
    } = context;

    const waitingSection = waitingForRail
      ? `
        <hr>
        <small>
          Rail route is still loading or could not be found. This faint dashed line is only a placeholder.
        </small>
      `
      : "";

    const routedSection = latestRoute
      ? `
        <hr>
        <small>
          Routed distance: ${formatDistance(latestRoute.distanceMetres)}<br>
          ${latestRoute.durationSeconds ? `Estimated time: ${formatDuration(latestRoute.durationSeconds)}<br>` : ""}
          Route source: ${escapeHtml(latestRoute.source)}
        </small>
      `
      : "";

    const messageSection = message
      ? `
        <hr>
        <small>${escapeHtml(message)}</small>
      `
      : "";

    const regenerateButtonLabel = regenerating ? "Regenerating…" : "Regenerate route";
    const regenerateButtonDisabled = regenerating ? "disabled" : "";

    routeLayer.bindPopup(`
      <strong>${escapeHtml(journey.from)} → ${escapeHtml(journey.to)}</strong><br>
      Method: ${escapeHtml(journey.method || "Unknown")}<br>
      Sheet distance: ${escapeHtml(journey.distance || "Unknown")}<br>
      Sheet time: ${escapeHtml(journey.time || "Unknown")}<br>
      Total: ${escapeHtml(journey.total || "Unknown")}<hr>
      <small>
        From resolved as: ${escapeHtml(fromLocation.displayName)}<br>
        To resolved as: ${escapeHtml(toLocation.displayName)}
      </small>
      ${waitingSection}
      ${routedSection}
      ${messageSection}
      <div class="popup-actions">
        <button type="button" ${regenerateButtonDisabled} onclick="window.regenerateTravelRoute('${escapeAttribute(routeId)}')">
          ${escapeHtml(regenerateButtonLabel)}
        </button>
      </div>
    `);
  }

  function addMarker(location, placeKey) {
    const key = normalisePlaceKey(placeKey);

    if (markerByPlaceKey[key]) {
      return;
    }

    const marker = L.circleMarker([location.lat, location.lng], {
      radius: 6,
      weight: 2,
      fillOpacity: 0.85
    }).addTo(map);

    marker.bindPopup(`
      <strong>${escapeHtml(location.shortName)}</strong><br>
      ${escapeHtml(location.displayName)}
      <div class="popup-actions">
        <button type="button" onclick="window.fixTravelLocation('${escapeAttribute(key)}')">
          Fix this location
        </button>
      </div>
    `);

    markerLayers.push(marker);
    markerByPlaceKey[key] = marker;
  }

  function addJourneyToSidebar(journey, routeLayer, failedToMap) {
    const item = document.createElement("li");
    item.classList.toggle("unmapped", failedToMap);

    const fromKey = normalisePlaceKey(journey.from);
    const toKey = normalisePlaceKey(journey.to);

    item.innerHTML = `
      <span class="place-name">
        ${escapeHtml(journey.from)} → ${escapeHtml(journey.to)}
      </span>
      <span class="place-meta">
        ${escapeHtml(journey.method || "Unknown method")}
        ${journey.distance ? ` · ${escapeHtml(journey.distance)}` : ""}
        ${journey.time ? ` · ${escapeHtml(journey.time)}` : ""}
        ${failedToMap ? " · Not mapped yet" : ""}
      </span>
      <div class="sidebar-actions">
        <button type="button" data-action="fix-from">Fix from</button>
        <button type="button" data-action="fix-to">Fix to</button>
        ${failedToMap ? "" : '<button type="button" data-action="zoom">Zoom route</button>'}
      </div>
    `;

    item
      .querySelector('[data-action="fix-from"]')
      .addEventListener("click", () => onFixLocation(fromKey));

    item
      .querySelector('[data-action="fix-to"]')
      .addEventListener("click", () => onFixLocation(toKey));

    const zoomButton = item.querySelector('[data-action="zoom"]');

    if (zoomButton && routeLayer) {
      zoomButton.addEventListener("click", () => {
        const bounds = routeLayer.getBounds();

        if (bounds.isValid()) {
          map.fitBounds(bounds.pad(0.6));
          routeLayer.openPopup();
        }
      });
    }

    placeList.appendChild(item);
  }

  async function updateVisitedCountryLayer(journeys, locations) {
    if (visitedCountryLayer) {
      map.removeLayer(visitedCountryLayer);
      visitedCountryLayer = null;
    }

    const visitedCountries = getVisitedCountriesFromJourneys(journeys, locations);

    if (visitedCountries.size === 0 || !CONFIG.countryGeoJsonUrl) {
      return;
    }

    try {
      const countriesGeoJson = await loadCountriesGeoJson();

      visitedCountryLayer = L.geoJSON(countriesGeoJson, {
        pane: "visited-countries",
        interactive: false,
        style(feature) {
          const countryName = getCountryNameFromFeature(feature);
          const visited = countryName && visitedCountries.has(normaliseCountryName(countryName));

          return {
            fillColor: visited ? "#b7f5b7" : "transparent",
            fillOpacity: visited ? 0.45 : 0,
            color: visited ? "#6abf69" : "transparent",
            weight: visited ? 1 : 0
          };
        }
      }).addTo(map);
    } catch (error) {
      console.warn("Could not load visited-country shading.", error);
    }
  }

  async function loadCountriesGeoJson() {
    if (countriesGeoJsonCache) {
      return countriesGeoJsonCache;
    }

    const separator = CONFIG.countryGeoJsonUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${CONFIG.countryGeoJsonUrl}${separator}t=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`Could not load countries GeoJSON: ${response.status}`);
    }

    countriesGeoJsonCache = await response.json();
    return countriesGeoJsonCache;
  }

  function getVisitedCountriesFromJourneys(journeys, locations) {
    const visitedCountries = new Set();

    journeys.forEach((journey) => {
      [journey.from, journey.to].forEach((placeName) => {
        const location = locations[normalisePlaceKey(placeName)];
        const countryName = getCountryNameFromLocation(location);

        if (countryName) {
          visitedCountries.add(normaliseCountryName(countryName));
        }
      });
    });

    return visitedCountries;
  }

  function getCountryNameFromLocation(location) {
    if (!location) return "";

    if (location.country) {
      return location.country;
    }

    const displayParts = String(location.displayName || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return displayParts[displayParts.length - 1] || "";
  }

  function getCountryNameFromFeature(feature) {
    const properties = feature.properties || {};

    return (
      properties.ADMIN ||
      properties.name ||
      properties.NAME ||
      properties.Country ||
      properties.country ||
      ""
    );
  }

  function normaliseCountryName(countryName) {
    const cleaned = String(countryName || "")
      .trim()
      .toLowerCase()
      .replace(/^the\s+/, "");

    const aliases = {
      "uk": "united kingdom",
      "great britain": "united kingdom",
      "england": "united kingdom",
      "scotland": "united kingdom",
      "wales": "united kingdom",
      "northern ireland": "united kingdom",
      "united states": "united states of america",
      "usa": "united states of america",
      "us": "united states of america",
      "america": "united states of america",
      "czech republic": "czechia",
      "republic of ireland": "ireland",
      "the netherlands": "netherlands",
      "holland": "netherlands"
    };

    return aliases[cleaned] || cleaned;
  }

  function fitMapToRoutes() {
    const allLayers = [...routeLayers, ...markerLayers];

    if (allLayers.length === 0) {
      map.setView([20, 0], 2);
      return;
    }

    const group = L.featureGroup(allLayers);
    map.fitBounds(group.getBounds().pad(0.2));
  }

  function clear() {
    if (visitedCountryLayer) {
      map.removeLayer(visitedCountryLayer);
      visitedCountryLayer = null;
    }

    routeLayers.forEach((layer) => {
      map.removeLayer(layer);
    });

    markerLayers.forEach((layer) => {
      map.removeLayer(layer);
    });

    routeLayers = [];
    markerLayers = [];
    markerByPlaceKey = {};
    routeContextById.clear();
    placeList.innerHTML = "";
  }

  function invalidateSoon() {
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }

  function getMethodStyle(method) {
    const key = String(method || "").trim().toLowerCase();
    return METHOD_STYLES[key] || METHOD_STYLES.default;
  }

  window.addEventListener("load", invalidateSoon);

  window.addEventListener("resize", () => {
    map.invalidateSize();
  });

  return {
    drawAllJourneys,
    clear,
    invalidateSoon
  };
}
