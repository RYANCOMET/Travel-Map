/*
  Browser-safe UK rail router converted from uk-rail-polyline-builder v8.

  What changed from the Node builder:
  - no fs/path/process/require
  - no CLI args
  - no file writing
  - no forbidden browser headers such as User-Agent/Origin/Referer
  - optional cacheUrl for a prebuilt ArcGIS rail network cache JSON
  - route one journey on demand instead of generating a whole output file

  Recommended use: run this inside ukRailWorker.js so the large graph build does not
  block the map UI.
*/

const GB_BBOX = { minLat: 49.7, maxLat: 61.1, minLng: -8.9, maxLng: 2.2 };

const DEFAULTS = {
  arcgisUrl: "",
  arcgisItemId: "2222d85aa25d479c864beb0efe14a012",
  cacheUrl: "arcgis-rail-network-cache.json",
  refreshCache: false,
  snapKm: 12,
  gridKm: 5,
  maxRouteKm: 900,
  connectMetres: 35,
  nodeConnectMetres: 25,
  componentConnectMetres: 180,
  componentBridgePenalty: 3,
  pageSize: 1000,
  log: null
};

let singletonRouterPromise = null;

export async function fetchUkRailRoute(journey, fromLocation, toLocation, options = {}) {
  const router = await getUkRailRouter(options);
  return router.routeJourney(journey, fromLocation, toLocation);
}

export async function getUkRailRouter(options = {}) {
  const mergedOptions = { ...DEFAULTS, ...options };

  if (!mergedOptions.refreshCache && singletonRouterPromise) {
    return singletonRouterPromise;
  }

  singletonRouterPromise = createUkRailRouter(mergedOptions);
  return singletonRouterPromise;
}

export function clearUkRailRouter() {
  singletonRouterPromise = null;
}

export async function createUkRailRouter(options = {}) {
  const args = { ...DEFAULTS, ...options };
  const log = makeLogger(args.log);

  const railGraph = await loadRailGraph(args, log);

  return {
    railGraph,
    routeJourney(journey, fromLocation, toLocation) {
      return routeUkRailJourney(journey, fromLocation, toLocation, railGraph, args, log);
    }
  };
}

async function routeUkRailJourney(journey, fromLocation, toLocation, railGraph, args, log) {
  if (!looksUkLocation(fromLocation) || !looksUkLocation(toLocation)) {
    return null;
  }

  const fromSnap = snapToGraph(fromLocation, railGraph, Number(args.snapKm) || DEFAULTS.snapKm);
  const toSnap = snapToGraph(toLocation, railGraph, Number(args.snapKm) || DEFAULTS.snapKm);

  if (!fromSnap || !toSnap) {
    log(`UK rail failed to snap ${journey.from} → ${journey.to}`);
    return null;
  }

  const pathResult = astar(
    fromSnap.node.id,
    toSnap.node.id,
    railGraph,
    Number(args.maxRouteKm) || DEFAULTS.maxRouteKm
  );

  if (!pathResult) {
    log(`UK rail found no graph path for ${journey.from} → ${journey.to}`);
    return null;
  }

  const points = routeToPoints(pathResult, railGraph);

  if (points.length < 2) {
    return null;
  }

  return {
    from: journey.from,
    to: journey.to,
    method: journey.method || "Train",
    points,
    distanceMetres: Math.round(pathResult.distanceMetres),
    durationSeconds: null,
    source: "ArcGIS Rail_Network FeatureServer browser router",
    generatedAt: new Date().toISOString(),
    diagnostics: {
      fromSnapMetres: Math.round(fromSnap.distanceMetres),
      toSnapMetres: Math.round(toSnap.distanceMetres),
      graphNodeCount: pathResult.ids.length,
      outputPointCount: points.length,
      searchedNodes: pathResult.visited
    }
  };
}

async function loadRailGraph(args, log) {
  let cached = null;

  if (!args.refreshCache && args.cacheUrl) {
    cached = await fetchRailCache(args.cacheUrl, log);
  }

  if (!cached) {
    const layerUrl = await resolveArcgisLayerUrl(args, log);
    log("Downloading ArcGIS rail layer in browser. This can be slow; a static cacheUrl is better for the live site.");
    cached = await downloadArcgisFeatures(layerUrl, args.pageSize, log);
  }

  const lines = arcgisFeaturesToLines(cached.features || [], cached.spatialReference);
  log(`Usable GB rail lines: ${lines.length.toLocaleString()}`);

  return loadRailGraphFromLines(
    lines,
    Number(args.gridKm) || DEFAULTS.gridKm,
    Number(args.connectMetres) || DEFAULTS.connectMetres,
    Number(args.nodeConnectMetres) || DEFAULTS.nodeConnectMetres,
    Number(args.componentConnectMetres) || DEFAULTS.componentConnectMetres,
    Number(args.componentBridgePenalty) || DEFAULTS.componentBridgePenalty,
    log
  );
}

async function fetchRailCache(cacheUrl, log) {
  try {
    const response = await fetch(cacheUrl, { cache: "force-cache" });

    if (response.status === 404) {
      log(`No UK rail cache found at ${cacheUrl}.`);
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    log(`Loading UK rail cache: ${cacheUrl}`);
    return await response.json();
  } catch (error) {
    log(`Could not load UK rail cache ${cacheUrl}: ${error.message || error}`);
    return null;
  }
}

async function resolveArcgisLayerUrl(args, log) {
  if (args.arcgisUrl) {
    const supplied = String(args.arcgisUrl).replace(/\/+$/, "");
    if (/\/FeatureServer\/\d+$/i.test(supplied) || /\/MapServer\/\d+$/i.test(supplied)) {
      return supplied;
    }
    if (/\/FeatureServer$/i.test(supplied) || /\/MapServer$/i.test(supplied)) {
      return `${supplied}/0`;
    }
    return supplied;
  }

  if (!args.arcgisItemId) {
    throw new Error("No ArcGIS source. Provide arcgisItemId, arcgisUrl, or cacheUrl.");
  }

  const itemUrl = `https://www.arcgis.com/sharing/rest/content/items/${encodeURIComponent(args.arcgisItemId)}?f=json`;
  log(`Resolving ArcGIS item: ${args.arcgisItemId}`);
  const item = await fetchJson(itemUrl);

  if (!item || !item.url) {
    throw new Error("ArcGIS item did not provide a service URL.");
  }

  let serviceUrl = String(item.url).replace(/\/+$/, "");
  log(`ArcGIS item title: ${item.title || "unknown"}`);

  if (/\/FeatureServer$/i.test(serviceUrl) || /\/MapServer$/i.test(serviceUrl)) {
    serviceUrl = `${serviceUrl}/0`;
  }

  return serviceUrl;
}

async function downloadArcgisFeatures(layerUrl, pageSize, log) {
  const baseUrl = layerUrl.replace(/\/+$/, "");
  const meta = await fetchJson(`${baseUrl}?f=json`);
  const countData = await fetchJson(`${baseUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const count = Number(countData.count || 0);
  const features = [];
  const actualPageSize = Math.min(Number(pageSize) || 1000, Number(meta.maxRecordCount) || 1000);

  log(`ArcGIS layer: ${meta.name || baseUrl}`);
  log(`Feature count: ${count.toLocaleString()}`);

  for (let offset = 0; offset < count; offset += actualPageSize) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      f: "json",
      resultOffset: String(offset),
      resultRecordCount: String(actualPageSize)
    });

    const page = await fetchJson(`${baseUrl}/query?${params.toString()}`);
    const pageFeatures = page.features || [];
    features.push(...pageFeatures);
    log(`Downloaded UK rail features ${features.length.toLocaleString()} / ${count.toLocaleString()}`);

    if (!page.exceededTransferLimit && pageFeatures.length < actualPageSize && features.length >= count) {
      break;
    }
  }

  return {
    sourceUrl: baseUrl,
    downloadedAt: new Date().toISOString(),
    spatialReference: meta.extent && meta.extent.spatialReference ? meta.extent.spatialReference : meta.spatialReference,
    features
  };
}

async function fetchJson(url, tries = 3) {
  let lastError = null;

  for (let index = 0; index < tries; index++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        const error = data.error;
        throw new Error(`ArcGIS error ${error.code || ""}: ${error.message || JSON.stringify(error)}`);
      }

      return data;
    } catch (error) {
      lastError = error;
      await wait(750 * (index + 1));
    }
  }

  throw lastError;
}

function arcgisFeaturesToLines(features, spatialReference) {
  const lines = [];

  for (const feature of features) {
    const geom = feature.geometry || {};
    const sr = geom.spatialReference || spatialReference;
    const paths = geom.paths || [];

    for (const path of paths) {
      if (!Array.isArray(path) || path.length < 2) {
        continue;
      }

      const clean = [];

      for (const pair of path) {
        if (!Array.isArray(pair) || pair.length < 2) {
          continue;
        }

        const point = normaliseArcgisPoint(pair[0], pair[1], sr);

        if (!isFiniteCoord(point.lat, point.lng) || !inGbBbox(point.lat, point.lng)) {
          continue;
        }

        clean.push([point.lat, point.lng]);
      }

      if (clean.length >= 2) {
        lines.push(clean);
      }
    }
  }

  return lines;
}

function loadRailGraphFromLines(lines, gridKm, connectMetres, nodeConnectMetres, componentConnectMetres, componentBridgePenalty, log) {
  const nodes = new Map();
  const graph = new Map();
  const edgeSeen = new Set();
  const grid = new Map();
  const endpoints = [];

  function getNode(lat, lng) {
    const key = coordKey(lat, lng);
    let node = nodes.get(key);

    if (!node) {
      node = { id: key, lat, lng };
      nodes.set(key, node);
      graph.set(key, []);

      const cell = gridCell(lat, lng, gridKm);
      if (!grid.has(cell)) {
        grid.set(cell, []);
      }
      grid.get(cell).push(node);
    }

    return node;
  }

  function addEdge(a, b, reason = "line") {
    if (!a || !b || a.id === b.id) {
      return false;
    }

    const key = edgeKey(a.id, b.id);

    if (edgeSeen.has(key)) {
      return false;
    }

    const weight = distanceMetres(a, b);

    if (!Number.isFinite(weight) || weight <= 0 || weight > 10000) {
      return false;
    }

    edgeSeen.add(key);
    graph.get(a.id).push({ to: b.id, w: weight, reason });
    graph.get(b.id).push({ to: a.id, w: weight, reason });
    return true;
  }

  let segmentCount = 0;

  for (const line of lines) {
    const lineNodes = [];

    for (let index = 0; index < line.length; index++) {
      lineNodes.push(getNode(line[index][0], line[index][1]));
    }

    for (let index = 1; index < lineNodes.length; index++) {
      if (addEdge(lineNodes[index - 1], lineNodes[index], "line")) {
        segmentCount++;
      }
    }

    if (lineNodes.length >= 2) {
      endpoints.push(lineNodes[0]);
      endpoints.push(lineNodes[lineNodes.length - 1]);
    }
  }

  const stitched = stitchNearbyEndpoints(endpoints, graph, edgeSeen, gridKm, connectMetres);
  const nodeStitched = stitchNearbyNodes(nodes, graph, edgeSeen, nodeConnectMetres);
  const beforeComponents = countComponents(nodes, graph);
  const componentStitched = bridgeNearbyComponents(nodes, graph, edgeSeen, componentConnectMetres, componentBridgePenalty);
  const afterComponents = countComponents(nodes, graph);

  log(`Components before bridge: ${beforeComponents.count.toLocaleString()} total; largest ${beforeComponents.largest.toLocaleString()} nodes.`);
  log(`Components after bridge: ${afterComponents.count.toLocaleString()} total; largest ${afterComponents.largest.toLocaleString()} nodes.`);
  log(`Track graph: ${nodes.size.toLocaleString()} nodes, ${segmentCount.toLocaleString()} line edges, ${stitched.toLocaleString()} endpoint links, ${nodeStitched.toLocaleString()} node links, ${componentStitched.toLocaleString()} component bridge links.`);

  return { nodes, graph, grid, gridKm };
}

function snapToGraph(point, railGraph, maxKm) {
  const radiusCells = Math.max(1, Math.ceil(maxKm / railGraph.gridKm));
  let best = null;

  for (const cell of nearbyCells(point.lat, point.lng, railGraph.gridKm, radiusCells)) {
    const nodes = railGraph.grid.get(cell) || [];

    for (const node of nodes) {
      const distance = distanceMetres(point, node);

      if (distance <= maxKm * 1000 && (!best || distance < best.distanceMetres)) {
        best = { node, distanceMetres: distance };
      }
    }
  }

  return best;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (!this.items.length) {
      return null;
    }

    const top = this.items[0];
    const last = this.items.pop();

    if (this.items.length) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return top;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;

      if (this.items[parent].priority <= this.items[index].priority) {
        break;
      }

      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  bubbleDown(index) {
    for (;;) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;

      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }

      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }

  get size() {
    return this.items.length;
  }
}

function astar(startId, goalId, railGraph, maxRouteKm) {
  const { nodes, graph } = railGraph;
  const goal = nodes.get(goalId);
  const open = new MinHeap();
  const dist = new Map();
  const previous = new Map();
  const closed = new Set();
  const maxMetres = maxRouteKm * 1000;
  let visited = 0;

  dist.set(startId, 0);
  open.push({ id: startId, priority: 0 });

  while (open.size) {
    const current = open.pop();

    if (!current || closed.has(current.id)) {
      continue;
    }

    if (current.id === goalId) {
      break;
    }

    closed.add(current.id);
    visited++;

    const currentDistance = dist.get(current.id);

    if (currentDistance > maxMetres) {
      continue;
    }

    for (const edge of graph.get(current.id) || []) {
      if (closed.has(edge.to)) {
        continue;
      }

      const nextDistance = currentDistance + edge.w;

      if (nextDistance > maxMetres) {
        continue;
      }

      if (nextDistance < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nextDistance);
        previous.set(edge.to, current.id);
        const node = nodes.get(edge.to);
        const heuristic = distanceMetres(node, goal);
        open.push({ id: edge.to, priority: nextDistance + heuristic });
      }
    }
  }

  if (!previous.has(goalId) && startId !== goalId) {
    return null;
  }

  const ids = [];
  let id = goalId;
  ids.push(id);

  while (id !== startId) {
    id = previous.get(id);

    if (!id) {
      return null;
    }

    ids.push(id);
  }

  ids.reverse();

  return {
    ids,
    distanceMetres: dist.get(goalId) || 0,
    visited
  };
}

function routeToPoints(pathResult, railGraph) {
  const points = pathResult.ids.map((id) => {
    const node = railGraph.nodes.get(id);
    return [Number(node.lat.toFixed(6)), Number(node.lng.toFixed(6))];
  });

  return simplifyPoints(points, 15);
}

function simplifyPoints(points, minMetres = 15) {
  if (!points.length) {
    return [];
  }

  const output = [points[0]];

  for (let index = 1; index < points.length - 1; index++) {
    if (distanceMetres(output[output.length - 1], points[index]) >= minMetres) {
      output.push(points[index]);
    }
  }

  output.push(points[points.length - 1]);
  return output;
}

function stitchNearbyEndpoints(endpoints, graph, edgeSeen, gridKm, connectMetres) {
  const limit = Number(connectMetres) || 0;

  if (limit <= 0) {
    return 0;
  }

  const unique = [];
  const seen = new Set();

  for (const node of endpoints) {
    if (!node || seen.has(node.id)) {
      continue;
    }

    seen.add(node.id);
    unique.push(node);
  }

  const stitchGridKm = Math.max(0.05, Math.min(0.25, limit / 1000));
  const tinyGrid = new Map();

  for (const node of unique) {
    const cell = gridCell(node.lat, node.lng, stitchGridKm);
    if (!tinyGrid.has(cell)) {
      tinyGrid.set(cell, []);
    }
    tinyGrid.get(cell).push(node);
  }

  let added = 0;
  const radiusCells = 2;

  for (const a of unique) {
    for (const cell of nearbyCells(a.lat, a.lng, stitchGridKm, radiusCells)) {
      const candidates = tinyGrid.get(cell) || [];

      for (const b of candidates) {
        if (!b || a.id >= b.id) {
          continue;
        }

        const key = edgeKey(a.id, b.id);

        if (edgeSeen.has(key)) {
          continue;
        }

        const distance = distanceMetres(a, b);

        if (distance > 0 && distance <= limit) {
          edgeSeen.add(key);
          graph.get(a.id).push({ to: b.id, w: distance, reason: "stitched-endpoint" });
          graph.get(b.id).push({ to: a.id, w: distance, reason: "stitched-endpoint" });
          added++;
        }
      }
    }
  }

  return added;
}

function stitchNearbyNodes(nodes, graph, edgeSeen, nodeConnectMetres) {
  const limit = Number(nodeConnectMetres) || 0;

  if (limit <= 0) {
    return 0;
  }

  const all = Array.from(nodes.values());
  const stitchGridKm = Math.max(0.025, Math.min(0.15, limit / 1000));
  const tinyGrid = new Map();

  for (const node of all) {
    const cell = gridCell(node.lat, node.lng, stitchGridKm);
    if (!tinyGrid.has(cell)) {
      tinyGrid.set(cell, []);
    }
    tinyGrid.get(cell).push(node);
  }

  let added = 0;
  const radiusCells = 2;

  for (const a of all) {
    for (const cell of nearbyCells(a.lat, a.lng, stitchGridKm, radiusCells)) {
      const candidates = tinyGrid.get(cell) || [];

      for (const b of candidates) {
        if (!b || a.id >= b.id) {
          continue;
        }

        const key = edgeKey(a.id, b.id);

        if (edgeSeen.has(key)) {
          continue;
        }

        const distance = distanceMetres(a, b);

        if (distance > 0 && distance <= limit) {
          edgeSeen.add(key);
          graph.get(a.id).push({ to: b.id, w: distance, reason: "stitched-nearby-node" });
          graph.get(b.id).push({ to: a.id, w: distance, reason: "stitched-nearby-node" });
          added++;
        }
      }
    }
  }

  return added;
}

function bridgeNearbyComponents(nodes, graph, edgeSeen, componentConnectMetres, bridgePenalty) {
  const limit = Number(componentConnectMetres) || 0;

  if (limit <= 0) {
    return 0;
  }

  const labelled = labelComponents(nodes, graph);
  const componentByNode = labelled.componentByNode;
  const all = Array.from(nodes.values());
  const stitchGridKm = Math.max(0.05, Math.min(0.5, limit / 1000));
  const tinyGrid = new Map();

  for (const node of all) {
    const cell = gridCell(node.lat, node.lng, stitchGridKm);
    if (!tinyGrid.has(cell)) {
      tinyGrid.set(cell, []);
    }
    tinyGrid.get(cell).push(node);
  }

  const bestPairByComponents = new Map();
  const radiusCells = 2;

  for (const a of all) {
    const componentA = componentByNode.get(a.id);

    for (const cell of nearbyCells(a.lat, a.lng, stitchGridKm, radiusCells)) {
      const candidates = tinyGrid.get(cell) || [];

      for (const b of candidates) {
        if (!b || a.id >= b.id) {
          continue;
        }

        const componentB = componentByNode.get(b.id);

        if (componentA === componentB) {
          continue;
        }

        const key = edgeKey(a.id, b.id);

        if (edgeSeen.has(key)) {
          continue;
        }

        const distance = distanceMetres(a, b);

        if (distance > 0 && distance <= limit) {
          const componentKey = componentA < componentB ? `${componentA}|${componentB}` : `${componentB}|${componentA}`;
          const previous = bestPairByComponents.get(componentKey);

          if (!previous || distance < previous.distance) {
            bestPairByComponents.set(componentKey, { a, b, distance });
          }
        }
      }
    }
  }

  let added = 0;
  const penalty = Math.max(1, Number(bridgePenalty) || 1);
  const pairs = Array.from(bestPairByComponents.values()).sort((a, b) => a.distance - b.distance);

  for (const pair of pairs) {
    const key = edgeKey(pair.a.id, pair.b.id);

    if (edgeSeen.has(key)) {
      continue;
    }

    edgeSeen.add(key);
    graph.get(pair.a.id).push({ to: pair.b.id, w: pair.distance * penalty, reason: "component-bridge" });
    graph.get(pair.b.id).push({ to: pair.a.id, w: pair.distance * penalty, reason: "component-bridge" });
    added++;
  }

  return added;
}

function labelComponents(nodes, graph) {
  const componentByNode = new Map();
  const sizes = new Map();
  let componentId = 0;

  for (const start of nodes.values()) {
    if (componentByNode.has(start.id)) {
      continue;
    }

    const id = componentId++;
    let size = 0;
    const stack = [start.id];
    componentByNode.set(start.id, id);

    while (stack.length) {
      const current = stack.pop();
      size++;

      for (const edge of graph.get(current) || []) {
        if (!componentByNode.has(edge.to)) {
          componentByNode.set(edge.to, id);
          stack.push(edge.to);
        }
      }
    }

    sizes.set(id, size);
  }

  return { componentByNode, sizes, count: componentId };
}

function countComponents(nodes, graph) {
  const labelled = labelComponents(nodes, graph);
  let largest = 0;

  for (const size of labelled.sizes.values()) {
    if (size > largest) {
      largest = size;
    }
  }

  return { count: labelled.count, largest };
}

function webMercatorToLonLat(x, y) {
  const radius = 6378137;
  const lng = (x / radius) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI;
  return [lng, lat];
}

function normaliseArcgisPoint(x, y, spatialReference) {
  const wkid = spatialReference && (spatialReference.wkid || spatialReference.latestWkid);

  if (wkid === 3857 || wkid === 102100 || Math.abs(x) > 180 || Math.abs(y) > 90) {
    const [lng, lat] = webMercatorToLonLat(Number(x), Number(y));
    return { lat, lng };
  }

  return {
    lat: Number(y),
    lng: Number(x)
  };
}

function distanceMetres(a, b) {
  const lat1 = Array.isArray(a) ? Number(a[0]) : Number(a.lat);
  const lng1 = Array.isArray(a) ? Number(a[1]) : Number(a.lng);
  const lat2 = Array.isArray(b) ? Number(b[0]) : Number(b.lat);
  const lng2 = Array.isArray(b) ? Number(b[1]) : Number(b.lng);
  const radius = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lng1) * Math.PI / 180;
  const haversine = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function coordKey(lat, lng) {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function gridCell(lat, lng, km) {
  const degLat = km / 111;
  const degLng = km / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  return `${Math.floor(lat / degLat)},${Math.floor(lng / degLng)}`;
}

function nearbyCells(lat, lng, gridKm, radiusCells) {
  const degLat = gridKm / 111;
  const degLng = gridKm / Math.max(20, 111 * Math.cos(lat * Math.PI / 180));
  const cellY = Math.floor(lat / degLat);
  const cellX = Math.floor(lng / degLng);
  const cells = [];

  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      cells.push(`${cellY + dy},${cellX + dx}`);
    }
  }

  return cells;
}

function isFiniteCoord(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function inGbBbox(lat, lng) {
  return lat >= GB_BBOX.minLat && lat <= GB_BBOX.maxLat && lng >= GB_BBOX.minLng && lng <= GB_BBOX.maxLng;
}

function looksUkLocation(location) {
  if (!location) {
    return false;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);

  if (!isFiniteCoord(lat, lng) || !inGbBbox(lat, lng)) {
    return false;
  }

  return true;
}

function makeLogger(log) {
  if (typeof log === "function") {
    return log;
  }

  return () => {};
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
