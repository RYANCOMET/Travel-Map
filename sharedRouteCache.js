let worker = null;
let nextRequestId = 1;
const pendingRequests = new Map();

export function fetchUkRailRoute(journey, fromLocation, toLocation, options = {}) {
  const activeWorker = getWorker(options.workerUrl || new URL("./ukRailWorker.js", import.meta.url));
  const requestId = nextRequestId++;
  const workerOptions = buildWorkerOptions(options);

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject, onLog: options.onLog });

    activeWorker.postMessage({
      type: "route",
      requestId,
      journey,
      fromLocation,
      toLocation,
      options: workerOptions
    });
  });
}

function buildWorkerOptions(options) {
  const workerOptions = {
    cacheUrl: options.cacheUrl || new URL("../../arcgis-rail-network-cache.json", import.meta.url).href,
    refreshCache: Boolean(options.refreshCache)
  };

  copyDefinedOption(workerOptions, options, "arcgisUrl");
  copyDefinedOption(workerOptions, options, "arcgisItemId");
  copyDefinedOption(workerOptions, options, "snapKm");
  copyDefinedOption(workerOptions, options, "gridKm");
  copyDefinedOption(workerOptions, options, "maxRouteKm");
  copyDefinedOption(workerOptions, options, "connectMetres");
  copyDefinedOption(workerOptions, options, "nodeConnectMetres");
  copyDefinedOption(workerOptions, options, "componentConnectMetres");
  copyDefinedOption(workerOptions, options, "componentBridgePenalty");
  copyDefinedOption(workerOptions, options, "pageSize");

  return workerOptions;
}

function copyDefinedOption(target, source, key) {
  if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
    target[key] = source[key];
  }
}

function getWorker(workerUrl) {
  if (worker) {
    return worker;
  }

  worker = new Worker(workerUrl, { type: "module" });

  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    const pending = pendingRequests.get(message.requestId);

    if (!pending) {
      return;
    }

    if (message.type === "log") {
      if (typeof pending.onLog === "function") {
        pending.onLog(message.message);
      }
      return;
    }

    pendingRequests.delete(message.requestId);

    if (message.type === "result") {
      pending.resolve(message.route || null);
      return;
    }

    if (message.type === "error") {
      pending.reject(new Error(message.error || "UK rail worker failed"));
    }
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "UK rail worker crashed");

    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }

    pendingRequests.clear();
    worker = null;
  });

  return worker;
}
