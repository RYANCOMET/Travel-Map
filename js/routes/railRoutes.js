import { calculatePathDistanceMetres, distanceMetres, getPaddedBounds } from "./geoMath.js";

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter"
];

const OVERPASS_TIMEOUT_SECONDS = 18;
const FETCH_TIMEOUT_MS = 12000;
const MAX_SNAP_DISTANCE_METRES = 30000;

// Keep this short. Huge search boxes are what make Overpass feel frozen.
const RAIL_SEARCH_PADDINGS = [
  0.18,
  0.35
];

export async function fetchRailRoute(fromLocation, toLocation) {
  let lastError = null;

  for (const paddingDegrees of RAIL_SEARCH_PADDINGS) {
    try {
      console.log(`Trying rail route with ${paddingDegrees}° padding`);

      const route = await fetchRailRouteWithPadding(fromLocation, toLocation, paddingDegrees);

      if (route) {
        return route;
      }
    } catch (error) {
      lastError = error;
      console.warn(`Rail route failed with ${paddingDegrees}° padding.`, error);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function fetchRailRouteWithPadding(fromLocation, toLocation, paddingDegrees) {
  const bounds = getPaddedBounds(fromLocation, toLocation, paddingDegrees);
  const overpassQuery = buildRailOverpassQuery(bounds);

  const data = await fetchOverpassRailData(overpassQuery);
  const railGraph = buildRailGraph(data);

  console.log(`Rail graph loaded: ${railGraph.nodes.size} nodes`);

  if (!railGraph || railGraph.nodes.size < 2) {
    return null;
  }

  const startNodeKey = findNearestRailNodeKey(railGraph, fromLocation);
  const endNodeKey = findNearestRailNodeKey(railGraph, toLocation);

  if (!startNodeKey || !endNodeKey || startNodeKey === endNodeKey) {
    return null;
  }

  const routeNodeKeys = findShortestRailPath(railGraph, startNodeKey, endNodeKey);

  if (!routeNodeKeys || routeNodeKeys.length < 2) {
    return null;
  }

  const points = routeNodeKeys.map((nodeKey) => {
    const node = railGraph.nodes.get(nodeKey);
    return [node.lat, node.lng];
  });

  return {
    points,
    distanceMetres: calculatePathDistanceMetres(points),
    durationSeconds: null,
    source: "OpenStreetMap railway lines via Overpass"
  };
}

async function fetchOverpassRailData(overpassQuery) {
  let lastError = null;

  for (const overpassUrl of OVERPASS_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      console.log(`Overpass request: ${overpassUrl}`);

      const response = await fetch(overpassUrl, {
        method: "POST",
        body: overpassQuery,
        signal: controller.signal,
        headers: {
          "Content-Type": "text/plain;charset=UTF-8"
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Overpass rail request failed at ${overpassUrl}: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      lastError = error;
      console.warn(`Overpass server failed, trying next if available: ${overpassUrl}`, error);
    }
  }

  throw lastError || new Error("All Overpass servers failed.");
}

function buildRailOverpassQuery(bounds) {
  const south = bounds.south;
  const west = bounds.west;
  const north = bounds.north;
  const east = bounds.east;

  return `
    [out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];
    (
      way["railway"="rail"]["usage"!~"industrial|military|test"]["service"!~"siding|yard|spur"](${south},${west},${north},${east});
      way["railway"="light_rail"]["service"!~"siding|yard|spur"](${south},${west},${north},${east});
      way["railway"="subway"]["service"!~"siding|yard|spur"](${south},${west},${north},${east});
      way["railway"="tram"]["service"!~"siding|yard|spur"](${south},${west},${north},${east});
    );
    out body geom;
  `;
}

function buildRailGraph(overpassData) {
  const graph = {
    nodes: new Map(),
    edges: new Map()
  };

  const ways = (overpassData.elements || []).filter((element) => {
    return element.type === "way" && Array.isArray(element.geometry);
  });

  ways.forEach((way) => {
    const geometry = way.geometry
      .map((point) => {
        return {
          lat: Number(point.lat),
          lng: Number(point.lon)
        };
      })
      .filter((point) => {
        return Number.isFinite(point.lat) && Number.isFinite(point.lng);
      });

    for (let index = 0; index < geometry.length; index++) {
      const point = geometry[index];
      const nodeKey = getRailNodeKey(point);

      if (!graph.nodes.has(nodeKey)) {
        graph.nodes.set(nodeKey, point);
      }

      if (!graph.edges.has(nodeKey)) {
        graph.edges.set(nodeKey, []);
      }

      if (index === 0) {
        continue;
      }

      const previousPoint = geometry[index - 1];
      const previousNodeKey = getRailNodeKey(previousPoint);
      const distance = distanceMetres(previousPoint, point);

      addRailEdge(graph, previousNodeKey, nodeKey, distance);
      addRailEdge(graph, nodeKey, previousNodeKey, distance);
    }
  });

  return graph;
}

function addRailEdge(graph, fromNodeKey, toNodeKey, distance) {
  if (!graph.edges.has(fromNodeKey)) {
    graph.edges.set(fromNodeKey, []);
  }

  graph.edges.get(fromNodeKey).push({
    to: toNodeKey,
    distance
  });
}

function getRailNodeKey(point) {
  return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
}

function findNearestRailNodeKey(graph, location) {
  let bestNodeKey = null;
  let bestDistance = Infinity;

  graph.nodes.forEach((node, nodeKey) => {
    const distance = distanceMetres(location, node);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestNodeKey = nodeKey;
    }
  });

  if (bestDistance > MAX_SNAP_DISTANCE_METRES) {
    console.warn(
      `Nearest rail node is ${(bestDistance / 1000).toFixed(1)} km away. Refusing rail snap.`
    );

    return null;
  }

  return bestNodeKey;
}

function findShortestRailPath(graph, startNodeKey, endNodeKey) {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const queue = new Set();

  graph.nodes.forEach((_node, nodeKey) => {
    distances.set(nodeKey, Infinity);
    queue.add(nodeKey);
  });

  distances.set(startNodeKey, 0);

  while (queue.size > 0) {
    let currentNodeKey = null;
    let currentDistance = Infinity;

    queue.forEach((nodeKey) => {
      const distance = distances.get(nodeKey);

      if (distance < currentDistance) {
        currentDistance = distance;
        currentNodeKey = nodeKey;
      }
    });

    if (currentNodeKey === null || currentDistance === Infinity) {
      break;
    }

    if (currentNodeKey === endNodeKey) {
      break;
    }

    queue.delete(currentNodeKey);
    visited.add(currentNodeKey);

    const edges = graph.edges.get(currentNodeKey) || [];

    edges.forEach((edge) => {
      if (visited.has(edge.to)) {
        return;
      }

      const alternativeDistance = currentDistance + edge.distance;

      if (alternativeDistance < distances.get(edge.to)) {
        distances.set(edge.to, alternativeDistance);
        previous.set(edge.to, currentNodeKey);
      }
    });
  }

  if (!previous.has(endNodeKey)) {
    return null;
  }

  const path = [];
  let currentNodeKey = endNodeKey;

  while (currentNodeKey) {
    path.unshift(currentNodeKey);

    if (currentNodeKey === startNodeKey) {
      break;
    }

    currentNodeKey = previous.get(currentNodeKey);
  }

  if (path[0] !== startNodeKey) {
    return null;
  }

  return path;
}
