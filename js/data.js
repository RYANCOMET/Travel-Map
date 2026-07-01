import { CONFIG, FALLBACK_JOURNEYS } from "./config.js";
import { csvToJourneys } from "./csv.js";

export async function loadJsonDictionary(url, label) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const fetchUrl = `${url}${separator}t=${Date.now()}`;
    const response = await fetch(fetchUrl);

    if (!response.ok) {
      throw new Error(`No ${label} file found: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`Could not load ${url}.`, error);
    return {};
  }
}

export async function loadJourneysFromSheet() {
  if (!CONFIG.googleSheetUrl) {
    return {
      journeys: FALLBACK_JOURNEYS,
      message: "Using example journeys. Add your published Google Sheets link in config.js."
    };
  }

  const csvUrl = getGoogleSheetCsvUrl(CONFIG.googleSheetUrl);
  const separator = csvUrl.includes("?") ? "&" : "?";
  const cacheBustUrl = `${csvUrl}${separator}t=${Date.now()}`;

  const response = await fetch(cacheBustUrl);

  if (!response.ok) {
    throw new Error(`Could not load sheet: ${response.status}`);
  }

  const csvText = await response.text();

  if (csvText.trim().startsWith("<")) {
    throw new Error("Google returned an HTML page instead of CSV. Check the published sheet link.");
  }

  const journeys = csvToJourneys(csvText);

  if (journeys.length === 0) {
    throw new Error("The CSV loaded, but no journeys were found. Check that the published tab contains From and To columns.");
  }

  return {
    journeys,
    message: `Read ${journeys.length} journey rows. Finding locations...`
  };
}

function getGoogleSheetCsvUrl(sheetUrl) {
  const trimmedUrl = String(sheetUrl || "").trim();
  if (!trimmedUrl) return "";

  let csvUrl = trimmedUrl
    .replace("/pubhtml", "/pub")
    .replace("pubhtml?", "pub?");

  const url = new URL(csvUrl);
  url.searchParams.set("single", "true");
  url.searchParams.set("output", "csv");

  return url.toString();
}
