import { normalisePlaceKey } from "../utils.js";
import { calculatePathDistanceMetres } from "./geoMath.js";
import { saveRouteToRemoteCache } from "./remoteRouteSaver.js";

let sharedRouteCachePromise = null;
let sharedRouteCache = null;

export async function getSharedRoute(routeType, journey, fromLocation, toLocation) {
  const cache = await loadSharedRouteCache();
  const routes = cache.routes || {};

  const directKey = getSharedRouteKey(routeType, journey.from, journey.to);
  const reverseKey = getSharedRouteKey(routeType, journey.to, journey.from);

  if (routes[directKey]) {
    return normaliseSharedRoute(routes[directKey], false);
  }

  if (routes[reverseKey]) {
    return normaliseSharedRoute(routes[reverseKey], true);
  }

  // Compatibility with earlier coordinate-only local cache exports, if any are pasted into route-cache.json.
  const coordinateDirectKey = getCoordinateRouteKey(routeType, fromLocation, toLocation);
  const coordinateReverseKey = getCoordinateRouteKey(routeType, toLocation, fromLocation);

  if (routes[coordinateDirectKey]) {
    return normaliseSharedRoute(routes[coordinateDirectKey], false);
  }

  if (routes[coordinateReverseKey]) {
    return normaliseSharedRoute(routes[coordinateReverseKey], true);
  }

  return null;
}

export function saveGeneratedRouteToSharedCache(routeType, journey, route) {
  if (!route || !Array.isArray(route.points) || route.points.length < 2) {
    return;
  }

  const cacheKey = getSharedRouteKey(routeType, journey.from, journey.to);
  const routeForCache = buildRouteForSharedCache(routeType, journey, route);

  updateInMemorySharedCache(cacheKey, routeForCache);

  saveRouteToRemoteCache(cacheKey, routeForCache).then((result) => {
    if (result && result.ok) {
      console.log(`Shared route cache accepted ${cacheKey}.`);
    }
  });
}

export function getSharedRouteKey(routeType, from, to) {
  return `${normaliseRouteType(routeType)}:${normalisePlaceKey(from)}->${normalisePlaceKey(to)}`;
}

async function loadSharedRouteCache() {
  if (!sharedRouteCachePromise) {
    sharedRouteCachePromise = fetchSharedRouteCache();
  }

  return await sharedRouteCachePromise;
}

async function fetchSharedRouteCache() {
  try {
    const cacheUrl = new URL("../../route-cache.json", import.meta.url);
    cacheUrl.searchParams.set("v", String(Date.now()));

    const response = await fetch(cacheUrl.href, {
      cache: "no-store"
    });

    if (response.status === 404) {
      console.info("No route-cache.json file found yet. Generated routes will still be sent to the shared cache worker.");
      sharedRouteCache = makeEmptyCache();
      return sharedRouteCache;
    }

    if (!response.ok) {
      throw new Error(`Could not load route-cache.json: ${response.status}`);
    }

    const rawData = await response.json();
    sharedRouteCache = normaliseSharedRouteCache(rawData);

    console.log(`Loaded ${Object.keys(sharedRouteCache.routes).length} shared routes from route-cache.json.`);

    return sharedRouteCache;
  } catch (error) {
    console.warn("Could not load route-cache.json. Continuing with local/generated routes.", error);
    sharedRouteCache = makeEmptyCache();
    return sharedRouteCache;
  }
}

function updateInMemorySharedCache(cacheKey, route) {
  if (!sharedRouteCache) {
    sharedRouteCache = makeEmptyCache();
  }

  if (!sharedRouteCache.routes || typeof sharedRouteCache.routes !== "object") {
    sharedRouteCache.routes = {};
  }

  sharedRouteCache.routes[cacheKey] = route;
  sharedRouteCache.updatedAt = new Date().toISOString();
}

function buildRouteForSharedCache(routeType, journey, route) {
  const points = normalisePoints(route.points);

  return {
    type: normaliseRouteType(routeType),
    method: journey.method || "",
    from: journey.from,
    to: journey.to,
    points,
    distanceMetres: Number(route.distanceMetres) || calculatePathDistanceMetres(points),
    durationSeconds: Number(route.durationSeconds) || null,
    source: route.source || "Generated route",
    generatedAt: route.generatedAt || route.regeneratedAt || new Date().toISOString(),
    details: Array.isArray(route.details) ? route.details : undefined
  };
}

function normaliseSharedRoute(route, reverse) {
  const points = normalisePoints(route.points || route.coordinates || route.geometry);

  if (points.length < 2) {
    return null;
  }

  const outputPoints = reverse ? [...points].reverse() : points;

  return {
    ...route,
    points: outputPoints,
    distanceMetres: Number(route.distanceMetres) || calculatePathDistanceMetres(outputPoints),
    durationSeconds: Number(route.durationSeconds) || null,
    source: route.source
      ? reverse ? `${route.source} (reversed from shared route-cache.json)` : route.source
      : reverse ? "Shared route-cache.json (reversed)" : "Shared route-cache.json"
  };
}

function normaliseSharedRouteCache(rawData) {
  if (!rawData || typeof rawData !== "object") {
    return makeEmptyCache();
  }

  return {
    version: rawData.version || 1,
    updatedAt: rawData.updatedAt || null,
    routes: rawData.routes && typeof rawData.routes === "object" ? rawData.routes : {}
  };
}

function makeEmptyCache() {
  return {
    version: 1,
    updatedAt: null,
    routes: {}
  };
}

function normalisePoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        return [Number(point[0]), Number(point[1])];
      }

      if (point && typeof point === "object") {
        return [Number(point.lat), Number(point.lng ?? point.lon)];
      }

      return null;
    })
    .filter((point) => {
      return point &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= 90 &&
        Math.abs(point[1]) <= 180;
    })
    .map(([lat, lng]) => [
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6))
    ]);
}

function getCoordinateRouteKey(routeType, fromLocation, toLocation) {
  return [
    normaliseRouteType(routeType),
    roundCoordinate(fromLocation.lat),
    roundCoordinate(fromLocation.lng),
    roundCoordinate(toLocation.lat),
    roundCoordinate(toLocation.lng)
  ].join(":");
}

function roundCoordinate(value) {
  return Number(value).toFixed(5);
}

function normaliseRouteType(routeType) {
  const key = String(routeType || "").trim().toLowerCase();

  if (key === "plane") return "flight";
  if (key === "car" || key === "drive" || key === "driving") return "road";
  if (key === "hitchhike" || key === "hitchhiking" || key === "hitchhiked") return "hitch";

  return key;
}
