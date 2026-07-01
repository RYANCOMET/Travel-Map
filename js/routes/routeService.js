import { getGreatCirclePoints } from "./flightRoutes.js";
import { calculatePathDistanceMetres } from "./geoMath.js";
import { fetchRoadRoute } from "./roadRoutes.js";
import { getSavedRailRoute } from "./railRouteStore.js";
import { fetchTransitousRailRoute } from "./transitousRoutes.js";
import { fetchUkRailRoute } from "./ukRailWorkerClient.js";
import { isEuropeRailJourney, isUkRailJourney } from "./railRegion.js";
import {
  clearCachedRoute,
  getCachedRoute,
  getRegeneratedRoute,
  hasRecentlyFailedRoute,
  setCachedRoute,
  setFailedRoute,
  setRegeneratedRoute
} from "./routeCache.js";
import { isFlightMethod, isTrainMethod } from "./routeMethods.js";
import { enqueueRouteRequest } from "./routeQueue.js";
import {
  getSharedRoute,
  saveGeneratedRouteToSharedCache
} from "./sharedRouteCache.js";

console.log("routeService.js loaded");

export function getInitialRouteLatLngs(journey, fromLocation, toLocation) {
  if (isFlightMethod(journey.method)) {
    return getGreatCirclePoints(fromLocation, toLocation, 96);
  }

  return [
    [fromLocation.lat, fromLocation.lng],
    [toLocation.lat, toLocation.lng]
  ];
}

export async function loadDetailedRouteForJourney(journey, fromLocation, toLocation) {
  const routeType = getRouteTypeForJourney(journey);

  if (!routeType) {
    return null;
  }

  if (routeType === "rail") {
    return await loadSavedOrGeneratedRailRoute(journey, fromLocation, toLocation);
  }

  if (routeType === "flight") {
    return await loadCachedOrFreshRoute("flight", journey, fromLocation, toLocation, () => {
      return buildFlightRoute(fromLocation, toLocation);
    });
  }

  if (routeType === "road" || routeType === "bus" || routeType === "hitch") {
    return await loadCachedOrFreshRoute(routeType, journey, fromLocation, toLocation, () => {
      return fetchRoadRoute(fromLocation, toLocation);
    });
  }

  return null;
}

export async function regenerateDetailedRouteForJourney(journey, fromLocation, toLocation) {
  const routeType = getRouteTypeForJourney(journey);

  if (!routeType) {
    return null;
  }

  if (routeType === "rail") {
    return await regenerateRailRoute(journey, fromLocation, toLocation);
  }

  if (routeType === "flight") {
    return await regenerateFreshRoute("flight", journey, fromLocation, toLocation, () => {
      return buildFlightRoute(fromLocation, toLocation);
    });
  }

  if (routeType === "road" || routeType === "bus" || routeType === "hitch") {
    return await regenerateFreshRoute(routeType, journey, fromLocation, toLocation, () => {
      return fetchRoadRoute(fromLocation, toLocation);
    });
  }

  return null;
}

async function loadSavedOrGeneratedRailRoute(journey, fromLocation, toLocation) {
  const regeneratedRoute = getRegeneratedRoute("rail", fromLocation, toLocation);

  if (regeneratedRoute) {
    console.log(`Using manually regenerated rail route for ${journey.from} → ${journey.to}`);
    return regeneratedRoute;
  }

  const sharedRoute = await getSharedRoute("rail", journey, fromLocation, toLocation);

  if (sharedRoute) {
    console.log(`Using shared rail route-cache.json route for ${journey.from} → ${journey.to}`);
    return sharedRoute;
  }

  const savedRoute = await getSavedRailRoute(journey);

  if (savedRoute) {
    console.log(`Using saved rail route for ${journey.from} → ${journey.to}`);
    return savedRoute;
  }

  const cachedGeneratedRoute = getCachedRoute("rail", fromLocation, toLocation);

  if (cachedGeneratedRoute) {
    console.log(`Using cached generated rail route for ${journey.from} → ${journey.to}`);
    return cachedGeneratedRoute;
  }

  if (hasRecentlyFailedRoute("rail", fromLocation, toLocation)) {
    console.log(`Skipping recently failed rail route for ${journey.from} → ${journey.to}`);
    return null;
  }

  if (isUkRailJourney(fromLocation, toLocation)) {
    console.log(`Queueing missing UK rail route for ${journey.from} → ${journey.to}`);

    return await loadCachedOrFreshRoute("rail", journey, fromLocation, toLocation, () => {
      return fetchUkRailRoute(journey, fromLocation, toLocation, {
        cacheUrl: new URL("../../arcgis-rail-network-cache.json", import.meta.url).href,
        onLog: (message) => console.log(`[UK rail] ${message}`)
      });
    }, {
      skipSharedLookup: true
    });
  }

  if (isEuropeRailJourney(fromLocation, toLocation)) {
    console.log(`Queueing missing Europe rail route for ${journey.from} → ${journey.to}`);

    return await loadCachedOrFreshRoute("rail", journey, fromLocation, toLocation, () => {
      return fetchTransitousRailRoute(fromLocation, toLocation);
    }, {
      skipSharedLookup: true
    });
  }

  console.log(`No rail generator available for ${journey.from} → ${journey.to}. Keeping placeholder.`);
  return null;
}

async function regenerateRailRoute(journey, fromLocation, toLocation) {
  return await regenerateFreshRoute("rail", journey, fromLocation, toLocation, () => {
    if (isUkRailJourney(fromLocation, toLocation)) {
      return fetchUkRailRoute(journey, fromLocation, toLocation, {
        cacheUrl: new URL("../../arcgis-rail-network-cache.json", import.meta.url).href,
        onLog: (message) => console.log(`[UK rail] ${message}`)
      });
    }

    if (isEuropeRailJourney(fromLocation, toLocation)) {
      return fetchTransitousRailRoute(fromLocation, toLocation);
    }

    return null;
  });
}

async function regenerateFreshRoute(routeType, journey, fromLocation, toLocation, fetchRoute) {
  clearCachedRoute(routeType, fromLocation, toLocation);

  try {
    console.log(`Regenerating ${routeType} route for ${journey.from} → ${journey.to}`);

    const route = await enqueueRouteRequest(async () => {
      return await fetchRoute();
    });

    if (!isUsableRoute(route)) {
      console.warn(`No regenerated ${routeType} route found for ${journey.from} → ${journey.to}.`);
      setFailedRoute(routeType, fromLocation, toLocation, "Regeneration found no route");
      return null;
    }

    const routeWithType = withRouteMetadata(routeType, journey, route);

    setRegeneratedRoute(routeType, fromLocation, toLocation, routeWithType);
    saveGeneratedRouteToSharedCache(routeType, journey, routeWithType);

    return routeWithType;
  } catch (error) {
    console.warn(`Could not regenerate ${routeType} route for ${journey.from} → ${journey.to}.`, error);
    setFailedRoute(routeType, fromLocation, toLocation, error.message || "Regeneration failed");
    return null;
  }
}

async function loadCachedOrFreshRoute(routeType, journey, fromLocation, toLocation, fetchRoute, options = {}) {
  try {
    const regeneratedRoute = getRegeneratedRoute(routeType, fromLocation, toLocation);

    if (regeneratedRoute) {
      console.log(`Using manually regenerated ${routeType} route for ${journey.from} → ${journey.to}`);
      return regeneratedRoute;
    }

    if (!options.skipSharedLookup) {
      const sharedRoute = await getSharedRoute(routeType, journey, fromLocation, toLocation);

      if (sharedRoute) {
        console.log(`Using shared ${routeType} route-cache.json route for ${journey.from} → ${journey.to}`);
        return sharedRoute;
      }
    }

    const cachedRoute = getCachedRoute(routeType, fromLocation, toLocation);

    if (cachedRoute) {
      console.log(`Using cached ${routeType} route for ${journey.from} → ${journey.to}`);
      return cachedRoute;
    }

    if (hasRecentlyFailedRoute(routeType, fromLocation, toLocation)) {
      console.log(`Skipping recently failed ${routeType} route for ${journey.from} → ${journey.to}`);
      return null;
    }

    console.log(`Queueing ${routeType} route for ${journey.from} → ${journey.to}`);

    const route = await enqueueRouteRequest(async () => {
      console.log(`Fetching ${routeType} route for ${journey.from} → ${journey.to}`);
      return await fetchRoute();
    });

    if (!isUsableRoute(route)) {
      console.warn(`No ${routeType} route found for ${journey.from} → ${journey.to}.`);
      setFailedRoute(routeType, fromLocation, toLocation, "No route found");
      return null;
    }

    const routeWithType = withRouteMetadata(routeType, journey, route);

    setCachedRoute(routeType, fromLocation, toLocation, routeWithType);
    saveGeneratedRouteToSharedCache(routeType, journey, routeWithType);

    return routeWithType;
  } catch (error) {
    console.warn(`Could not load ${routeType} route for ${journey.from} → ${journey.to}.`, error);
    setFailedRoute(routeType, fromLocation, toLocation, error.message || "Unknown error");
    return null;
  }
}

function buildFlightRoute(fromLocation, toLocation) {
  const points = getGreatCirclePoints(fromLocation, toLocation, 96);

  return {
    points,
    distanceMetres: calculatePathDistanceMetres(points),
    durationSeconds: null,
    source: "Great-circle flight route"
  };
}

function withRouteMetadata(routeType, journey, route) {
  return {
    ...route,
    type: routeType,
    method: journey.method || route.method || "",
    from: journey.from,
    to: journey.to,
    generatedAt: route.generatedAt || new Date().toISOString()
  };
}

function isUsableRoute(route) {
  return route && Array.isArray(route.points) && route.points.length >= 2;
}

function getRouteTypeForJourney(journey) {
  const method = String(journey.method || "").trim().toLowerCase();

  if (isTrainMethod(method)) {
    return "rail";
  }

  if (isFlightMethod(method)) {
    return "flight";
  }

  if (["bus", "coach", "minibus"].includes(method)) {
    return "bus";
  }

  if (["hitch", "hitchhike", "hitchhiked", "hitchhiking"].includes(method)) {
    return "hitch";
  }

  if (["driven", "drive", "driving", "car", "taxi"].includes(method)) {
    return "road";
  }

  return null;
}
