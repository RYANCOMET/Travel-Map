import { isRouteQueueIdle, onRouteQueueIdle } from "./routeQueue.js";

const ROUTE_SAVE_ENDPOINT = "https://travel-map-route-cache.ryancomet.workers.dev/save-route";
const ROUTE_BATCH_SAVE_ENDPOINT = "https://travel-map-route-cache.ryancomet.workers.dev/save-routes";

const FLUSH_AFTER_IDLE_MS = 5000;
const MAX_SAVE_ATTEMPTS = 5;
const MAX_PENDING_ROUTES = 500;

const pendingSaves = new Map();

let flushTimer = null;
let flushRunning = false;
let idleListenerRegistered = false;

export function saveRouteToRemoteCache(cacheKey, route) {
  if (!cacheKey || !route) {
    return Promise.resolve({
      ok: false,
      skipped: true,
      error: "Missing cache key or route"
    });
  }

  if (pendingSaves.size >= MAX_PENDING_ROUTES && !pendingSaves.has(cacheKey)) {
    console.warn(`Remote route save batch is full. Skipping ${cacheKey}.`);

    return Promise.resolve({
      ok: false,
      skipped: true,
      error: "Remote save batch full"
    });
  }

  const existing = pendingSaves.get(cacheKey);

  if (existing) {
    existing.route = route;
    return existing.promise;
  }

  let resolvePromise;

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  pendingSaves.set(cacheKey, {
    cacheKey,
    route,
    resolve: resolvePromise,
    promise
  });

  registerIdleFlushListener();
  scheduleFlushWhenSafe();

  console.log(`Queued route for shared GitHub batch save: ${cacheKey}. Pending: ${pendingSaves.size}`);

  return promise;
}

export function flushPendingRemoteRouteSaves() {
  return flushNow("manual flush");
}

export function getRouteSaveEndpoint() {
  return ROUTE_SAVE_ENDPOINT;
}

export function getRouteBatchSaveEndpoint() {
  return ROUTE_BATCH_SAVE_ENDPOINT;
}

function registerIdleFlushListener() {
  if (idleListenerRegistered) {
    return;
  }

  idleListenerRegistered = true;

  onRouteQueueIdle(() => {
    scheduleFlushAfterIdleDelay();
  });
}

function scheduleFlushWhenSafe() {
  if (isRouteQueueIdle()) {
    scheduleFlushAfterIdleDelay();
  }
}

function scheduleFlushAfterIdleDelay() {
  if (pendingSaves.size === 0 || flushRunning) {
    return;
  }

  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;

    if (!isRouteQueueIdle()) {
      return;
    }

    flushNow("route queue idle");
  }, FLUSH_AFTER_IDLE_MS);
}

async function flushNow(reason) {
  if (flushRunning || pendingSaves.size === 0) {
    return {
      ok: true,
      skipped: true,
      reason: flushRunning ? "already flushing" : "nothing pending"
    };
  }

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  flushRunning = true;

  const batch = Array.from(pendingSaves.values());
  pendingSaves.clear();

  console.log(`Saving ${batch.length} generated routes to shared GitHub cache after ${reason}.`);

  try {
    const result = await sendRouteBatchWithRetry(batch);

    batch.forEach((item) => {
      item.resolve({
        ...result,
        cacheKey: item.cacheKey
      });
    });

    if (result && result.ok) {
      console.log(`Saved ${batch.length} routes to shared GitHub cache in one commit.`);
    }

    return result;
  } catch (error) {
    console.warn("Could not save generated route batch to shared GitHub cache.", error);

    batch.forEach((item) => {
      item.resolve({
        ok: false,
        cacheKey: item.cacheKey,
        error: error.message || "Remote batch save failed"
      });
    });

    return {
      ok: false,
      error: error.message || "Remote batch save failed"
    };
  } finally {
    flushRunning = false;

    if (pendingSaves.size > 0) {
      scheduleFlushWhenSafe();
    }
  }
}

async function sendRouteBatchWithRetry(batch) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    try {
      return await sendRouteBatch(batch);
    } catch (error) {
      lastError = error;
      const message = error.message || "Remote batch save failed";

      if (isPermanentSaveError(message)) {
        throw error;
      }

      if (attempt < MAX_SAVE_ATTEMPTS) {
        const backoffMs = 1500 * attempt * attempt;
        console.warn(`Remote route batch save failed; retrying in ${backoffMs}ms.`, error);
        await wait(backoffMs);
      }
    }
  }

  throw lastError || new Error("Remote batch save failed");
}

async function sendRouteBatch(batch) {
  const routes = {};

  batch.forEach((item) => {
    routes[item.cacheKey] = item.route;
  });

  const response = await fetch(ROUTE_BATCH_SAVE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      routes
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.ok !== true) {
    const errorMessage = data && data.error
      ? data.error
      : `Remote route batch save failed: ${response.status}`;

    throw new Error(errorMessage);
  }

  return data;
}

function isPermanentSaveError(message) {
  return message.includes("Invalid cacheKey") ||
    message.includes("Invalid route type") ||
    message.includes("Invalid coordinate") ||
    message.includes("Route needs") ||
    message.includes("too many points") ||
    message.includes("too long") ||
    message.includes("Missing route") ||
    message.includes("Missing cacheKey") ||
    message.includes("No valid routes");
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
