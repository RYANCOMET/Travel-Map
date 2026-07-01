import { CONFIG } from "./config.js";
import {
  cleanPlaceName,
  normalisePlaceKey,
  containsCountryHint,
  looksProbablyScottishOrUk,
  wait
} from "./utils.js";

export function createGeocoder({ sharedLocations = {}, placeAliases, reviewDialog }) {
  function resolveAlias(placeName) {
    const key = normalisePlaceKey(placeName);
    return placeAliases[key] || cleanPlaceName(placeName);
  }

  async function getLocation(placeName, context = {}) {
    const originalName = cleanPlaceName(placeName);
    const aliasName = resolveAlias(originalName);
    const originalKey = normalisePlaceKey(originalName);
    const aliasKey = normalisePlaceKey(aliasName);

    const shared = sharedLocations[originalKey] || sharedLocations[aliasKey];

    if (shared) {
      return { ...shared, source: "shared" };
    }

    const browserCached =
      getBrowserCachedLocation(originalKey) ||
      getBrowserCachedLocation(aliasKey);

    if (browserCached) {
      if (sharedLocations) {
        sharedLocations[originalKey] = browserCached;
      }

      return { ...browserCached, source: "browser" };
    }

    const candidates = await geocodePlaceCandidates(aliasName);

    let chosen;
    let wasReviewed = false;

    if (candidates.length === 0) {
      chosen = await reviewDialog.promptForLocationChoice(
        originalName,
        aliasName,
        [],
        "No matches were found. Type a clearer search below.",
        context
      );

      wasReviewed = true;
    } else {
      const reason = reviewDialog.getReviewReason(candidates, context.previousLocation);

      chosen = reason
        ? await reviewDialog.promptForLocationChoice(originalName, aliasName, candidates, reason, context)
        : candidates[0];

      wasReviewed = Boolean(reason);
    }

    if (!chosen) {
      return null;
    }

    const location = {
      shortName: originalName,
      searchName: aliasName,
      displayName: chosen.displayName,
      lat: chosen.lat,
      lng: chosen.lng
    };

    saveLocationForKeys(location, originalKey, aliasKey);

    return {
      ...location,
      source: wasReviewed ? "reviewed" : "searched"
    };
  }

  async function chooseReplacementLocation(placeKey, existing) {
    const searchStart = existing.searchName || existing.shortName || placeKey;
    const candidates = await geocodePlaceCandidates(searchStart);

    return await reviewDialog.promptForLocationChoice(
      existing.shortName || placeKey,
      searchStart,
      candidates,
      "Choose the correct replacement point.",
      {
        journey: { from: "Manual correction", to: existing.shortName || placeKey },
        role: "to",
        previousLocation: null
      }
    );
  }

  function saveLocationForKeys(location, ...keys) {
    keys.filter(Boolean).forEach((key) => {
      const normalisedKey = normalisePlaceKey(key);

      if (sharedLocations) {
        sharedLocations[normalisedKey] = location;
      }

      setBrowserCachedLocation(normalisedKey, location);
    });
  }

  function getBrowserCachedLocation(key) {
    const raw = localStorage.getItem(`travel-map-location-${key}`);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setBrowserCachedLocation(key, location) {
    localStorage.setItem(`travel-map-location-${key}`, JSON.stringify(location));
  }

  function clearBrowserLocationCache() {
    const keysToRemove = [];

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);

      if (key && key.startsWith("travel-map-location-")) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }

  async function geocodePlaceCandidates(placeName) {
    const searchAttempts = buildSearchAttempts(placeName);
    const allCandidates = [];

    for (const searchText of searchAttempts) {
      const results = await geocodeSearchText(searchText, placeName, 8);
      await wait(CONFIG.geocodeDelayMs || 250);

      results.forEach((candidate) => {
        const duplicate = allCandidates.some((existing) => {
          return (
            Math.abs(existing.lat - candidate.lat) < 0.000001 &&
            Math.abs(existing.lng - candidate.lng) < 0.000001
          );
        });

        if (!duplicate) {
          allCandidates.push(candidate);
        }
      });

      if (allCandidates.length > 0) {
        break;
      }
    }

    return allCandidates;
  }

  async function geocodeSearchText(searchText, originalPlaceName, limit = 8) {
    const photonResults = await geocodeWithPhoton(searchText, originalPlaceName, limit);

    if (photonResults.length > 0) {
      return photonResults;
    }

    return await geocodeWithNominatim(searchText, originalPlaceName, limit);
  }

  async function geocodeWithPhoton(searchText, originalPlaceName, limit = 8) {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", searchText);
    url.searchParams.set("limit", String(limit));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Photon geocoding failed for ${searchText}: ${response.status}`);
      }

      const data = await response.json();

      return (data.features || [])
        .map((feature, index) => {
          const coordinates = feature.geometry && feature.geometry.coordinates;
          const properties = feature.properties || {};

          if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
          }

          const lng = Number(coordinates[0]);
          const lat = Number(coordinates[1]);

          const displayParts = [
            properties.name,
            properties.street,
            properties.city,
            properties.county,
            properties.state,
            properties.country
          ].filter(Boolean);

          return {
            shortName: cleanPlaceName(originalPlaceName),
            displayName: displayParts.length > 0 ? displayParts.join(", ") : searchText,
            lat,
            lng,
            importance: photonImportance(index, properties),
            type: properties.osm_value || properties.type || "place",
            className: properties.osm_key || "",
            rank: index + 1
          };
        })
        .filter((result) => {
          return result && Number.isFinite(result.lat) && Number.isFinite(result.lng);
        });
    } catch (error) {
      console.warn(`Could not geocode with Photon: ${searchText}`, error);
      return [];
    }
  }

  async function geocodeWithNominatim(searchText, originalPlaceName, limit = 8) {
    const url = new URL("https://nominatim.openstreetmap.org/search");

    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", searchText);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("addressdetails", "1");

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Nominatim geocoding failed for ${searchText}: ${response.status}`);
      }

      const data = await response.json();

      return data
        .map((result, index) => {
          return {
            shortName: cleanPlaceName(originalPlaceName),
            displayName: result.display_name,
            lat: Number(result.lat),
            lng: Number(result.lon),
            importance: Number(result.importance || 0),
            type: result.type || "",
            className: result.class || "",
            rank: index + 1
          };
        })
        .filter((result) => {
          return Number.isFinite(result.lat) && Number.isFinite(result.lng);
        });
    } catch (error) {
      console.warn(`Could not geocode with Nominatim: ${searchText}`, error);
      return [];
    }
  }

  function photonImportance(index, properties) {
    const osmKey = String(properties.osm_key || "").toLowerCase();
    const osmValue = String(properties.osm_value || "").toLowerCase();

    let score = 0.75 - index * 0.06;

    if (osmKey === "place") {
      score += 0.12;
    }

    if (["city", "town", "village", "hamlet", "suburb"].includes(osmValue)) {
      score += 0.08;
    }

    return Math.max(0.1, Math.min(0.95, score));
  }

  function buildSearchAttempts(placeName) {
    const cleaned = cleanPlaceName(placeName);
    const attempts = [cleaned];

    if (!containsCountryHint(cleaned) && looksProbablyScottishOrUk(cleaned)) {
      attempts.push(`${cleaned}, Scotland`);
      attempts.push(`${cleaned}, United Kingdom`);
    }

    return [...new Set(attempts)];
  }

  return {
    getLocation,
    chooseReplacementLocation,
    geocodePlaceCandidates,
    saveLocationForKeys,
    getBrowserCachedLocation,
    clearBrowserLocationCache,
    resolveAlias
  };
}
