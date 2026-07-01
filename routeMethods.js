const FAILED_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getRegeneratedRoute(routeType, fromLocation, toLocation) {
  const directCacheKey = getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation);
  const directRoute = readCachedRoute(directCacheKey, false);

  if (directRoute) {
    return directRoute;
  }

  const reverseCacheKey = getRegeneratedRouteCacheKey(routeType, toLocation, fromLocation);
  const reverseRoute = readCachedRoute(reverseCacheKey, true);

  if (reverseRoute) {
    return reverseRoute;
  }

  return null;
}

export function setRegeneratedRoute(routeType, fromLocation, toLocation, route) {
  const routeWithMetadata = {
    ...route,
    regeneratedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(
      getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation),
      JSON.stringify(routeWithMetadata)
    );
    setCachedRoute(routeType, fromLocation, toLocation, routeWithMetadata);
  } catch (error) {
    console.warn(`Could not save regenerated ${routeType} route cache.`, error);
  }
}

export function clearCachedRoute(routeType, fromLocation, toLocation) {
  try {
    [
      getRouteCacheKey(routeType, fromLocation, toLocation),
      getRouteCacheKey(routeType, toLocation, fromLocation),
      getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation),
      getRegeneratedRouteCacheKey(routeType, toLocation, fromLocation),
      getFailedRouteCacheKey(routeType, fromLocation, toLocation),
      getFailedRouteCacheKey(routeType, toLocation, fromLocation)
    ].forEach((cacheKey) => localStorage.removeItem(cacheKey));
  } catch (error) {
    console.warn(`Could not clear ${routeType} route cache.`, error);
  }
}

export function getCachedRoute(routeType, fromLocation, toLocation) {
  const directCacheKey = getRouteCacheKey(routeType, fromLocation, toLocation);
  const directRoute = readCachedRoute(directCacheKey, false);

  if (directRoute) {
    return directRoute;
  }

  const reverseCacheKey = getRouteCacheKey(routeType, toLocation, fromLocation);
  const reverseRoute = readCachedRoute(reverseCacheKey, true);

  if (reverseRoute) {
    return reverseRoute;
  }

  return null;
}

export function setCachedRoute(routeType, fromLocation, toLocation, route) {
  const cacheKey = getRouteCacheKey(routeType, fromLocation, toLocation);

  try {
    localStorage.setItem(cacheKey, JSON.stringify(route));
    localStorage.removeItem(getFailedRouteCacheKey(routeType, fromLocation, toLocation));
    localStorage.removeItem(getFailedRouteCacheKey(routeType, toLocation, fromLocation));
  } catch (error) {
    console.warn(`Could not save ${routeType} route cache.`, error);
  }
}

export function hasRecentlyFailedRoute(routeType, fromLocation, toLocation) {
  return hasRecentlyFailedRouteForKey(getFailedRouteCacheKey(routeType, fromLocation, toLocation)) ||
    hasRecentlyFailedRouteForKey(getFailedRouteCacheKey(routeType, toLocation, fromLocation));
}

export function setFailedRoute(routeType, fromLocation, toLocation, reason = "") {
  const cacheKey = getFailedRouteCacheKey(routeType, fromLocation, toLocation);

  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        failedAt: Date.now(),
        reason
      })
    );
  } catch (error) {
    console.warn(`Could not save failed ${routeType} route cache.`, error);
  }
}

function readCachedRoute(cacheKey, reverse) {
  const raw = localStorage.getItem(cacheKey);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.points) ||
      parsed.points.length < 2
    ) {
      return null;
    }

    if (!reverse) {
      return parsed;
    }

    return {
      ...parsed,
      points: [...parsed.points].reverse(),
      source: parsed.source ? `${parsed.source} (reversed from cache)` : "Reversed cached route"
    };
  } catch {
    return null;
  }
}

function hasRecentlyFailedRouteForKey(cacheKey) {
  const raw = localStorage.getItem(cacheKey);

  if (!raw) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || !parsed.failedAt) {
      return false;
    }

    const age = Date.now() - Number(parsed.failedAt);

    if (age > FAILED_ROUTE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function getRegeneratedRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-regenerated-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function getFailedRouteCacheKey(routeType, fromLocation, toLocation) {
  const fromLat = roundCoordinate(fromLocation.lat);
  const fromLng = roundCoordinate(fromLocation.lng);
  const toLat = roundCoordinate(toLocation.lat);
  const toLng = roundCoordinate(toLocation.lng);

  return `travel-map-${routeType}-route-failed-${fromLat},${fromLng}-${toLat},${toLng}`;
}

function roundCoordinate(value) {
  return Number(value).toFixed(5);
}
