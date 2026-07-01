import { getGreatCirclePoints } from "./flightRoutes.js";
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
import { isDrivingMethod, isFlightMethod, isTrainMethod } from "./routeMethods.js";
import { enqueueRouteRequest } from "./routeQueue.js";

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
  if (isDrivingMethod(journey.method)) {
    return await loadCachedOrFreshRoute("road", journey, fromLocation, toLocation, () => {
      return fetchRoadRoute(fromLocation, toLocation);
    });
  }

  if (isTrainMethod(journey.method)) {
    return await loadSavedOrGeneratedRailRoute(journey, fromLocation, toLocation);
  }

  return null;
}

export async function regenerateDetailedRouteForJourney(journey, fromLocation, toLocation) {
  if (isDrivingMethod(journey.method)) {
    return await regenerateFreshRoute("road", journey, fromLocation, toLocation, () => {
      return fetchRoadRoute(fromLocation, toLocation);
    });
  }

  if (isTrainMethod(journey.method)) {
    return await regenerateRailRoute(journey, fromLocation, toLocation);
  }

  if (isFlightMethod(journey.method)) {
    const points = getGreatCirclePoints(fromLocation, toLocation, 96);

    return {
      points,
      distanceMetres: null,
      durationSeconds: null,
      source: "Great-circle flight route"
    };
  }

  return null;
}

async function loadSavedOrGeneratedRailRoute(journey, fromLocation, toLocation) {
  const regeneratedRoute = getRegeneratedRoute("rail", fromLocation, toLocation);

  if (regeneratedRoute) {
    console.log(`Using manually regenerated rail route for ${journey.from} → ${journey.to}`);
    return regeneratedRoute;
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
    });
  }

  if (isEuropeRailJourney(fromLocation, toLocation)) {
    console.log(`Queueing missing Europe rail route for ${journey.from} → ${journey.to}`);

    return await loadCachedOrFreshRoute("rail", journey, fromLocation, toLocation, () => {
      return fetchTransitousRailRoute(fromLocation, toLocation);
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

    if (!route || !Array.isArray(route.points) || route.points.length < 2) {
      console.warn(`No regenerated ${routeType} route found for ${journey.from} → ${journey.to}.`);
      setFailedRoute(routeType, fromLocation, toLocation, "Regeneration found no route");
      return null;
    }

    setRegeneratedRoute(routeType, fromLocation, toLocation, route);
    return route;
  } catch (error) {
    console.warn(`Could not regenerate ${routeType} route for ${journey.from} → ${journey.to}.`, error);
    setFailedRoute(routeType, fromLocation, toLocation, error.message || "Regeneration failed");
    return null;
  }
}

async function loadCachedOrFreshRoute(routeType, journey, fromLocation, toLocation, fetchRoute) {
  try {
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

    if (!route || !Array.isArray(route.points) || route.points.length < 2) {
      console.warn(`No ${routeType} route found for ${journey.from} → ${journey.to}.`);
      setFailedRoute(routeType, fromLocation, toLocation, "No route found");
      return null;
    }

    setCachedRoute(routeType, fromLocation, toLocation, route);

    return route;
  } catch (error) {
    console.warn(`Could not load ${routeType} route for ${journey.from} → ${journey.to}.`, error);
    setFailedRoute(routeType, fromLocation, toLocation, error.message || "Unknown error");
    return null;
  }
}
