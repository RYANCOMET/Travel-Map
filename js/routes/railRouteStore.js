import { normalisePlaceKey } from "../utils.js";
import { calculatePathDistanceMetres } from "./geoMath.js";

let railRoutesPromise = null;

export async function getSavedRailRoute(journey) {
  const railRoutes = await loadRailRoutes();

  if (!railRoutes) {
    return null;
  }

  const directKey = getRailRouteKey(journey.from, journey.to);
  const reverseKey = getRailRouteKey(journey.to, journey.from);

  const directRoute = railRoutes.get(directKey);

  if (directRoute) {
    return normaliseSavedRailRoute(directRoute, false);
  }

  const reverseRoute = railRoutes.get(reverseKey);

  if (reverseRoute) {
    return normaliseSavedRailRoute(reverseRoute, true);
  }

  return null;
}

async function loadRailRoutes() {
  if (!railRoutesPromise) {
    railRoutesPromise = fetchRailRoutesFile();
  }

  return await railRoutesPromise;
}

async function fetchRailRoutesFile() {
  try {
    const response = await fetch("rail-routes.json", {
      cache: "no-cache"
    });

    if (response.status === 404) {
      console.info("No rail-routes.json file found. Train routes will use placeholders.");
      return new Map();
    }

    if (!response.ok) {
      throw new Error(`Could not load rail-routes.json: ${response.status}`);
    }

    const rawData = await response.json();
    const routes = parseRailRoutes(rawData);

    console.log(`Loaded ${routes.size} saved rail routes from rail-routes.json`);

    return routes;
  } catch (error) {
    console.warn("Could not load rail-routes.json. Train routes will use placeholders.", error);
    return new Map();
  }
}

function parseRailRoutes(rawData) {
  const routes = new Map();

  if (Array.isArray(rawData)) {
    rawData.forEach((route) => {
      if (!route || !route.from || !route.to) {
        return;
      }

      routes.set(getRailRouteKey(route.from, route.to), route);
    });

    return routes;
  }

  if (rawData && Array.isArray(rawData.routes)) {
    rawData.routes.forEach((route) => {
      if (!route || !route.from || !route.to) {
        return;
      }

      routes.set(getRailRouteKey(route.from, route.to), route);
    });

    return routes;
  }

  if (rawData && typeof rawData === "object") {
    Object.entries(rawData).forEach(([key, route]) => {
      routes.set(normaliseObjectKey(key), route);
    });
  }

  return routes;
}

function normaliseObjectKey(key) {
  const [from, to] = String(key).split("->");

  if (from && to) {
    return getRailRouteKey(from, to);
  }

  const [fromAlt, toAlt] = String(key).split("||");

  if (fromAlt && toAlt) {
    return getRailRouteKey(fromAlt, toAlt);
  }

  return normalisePlaceKey(key);
}

function getRailRouteKey(from, to) {
  return `${normalisePlaceKey(from)}->${normalisePlaceKey(to)}`;
}

function normaliseSavedRailRoute(route, reverse) {
  const rawPoints = route.points || route.coordinates || route.geometry;

  if (!Array.isArray(rawPoints)) {
    return null;
  }

  let points = rawPoints
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
      return point && Number.isFinite(point[0]) && Number.isFinite(point[1]);
    });

  if (reverse) {
    points = points.reverse();
  }

  if (points.length < 2) {
    return null;
  }

  return {
    points,
    distanceMetres: Number(route.distanceMetres) || calculatePathDistanceMetres(points),
    durationSeconds: Number(route.durationSeconds) || null,
    source: route.source || "rail-routes.json"
  };
}
