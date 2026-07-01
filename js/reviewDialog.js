import { CONFIG } from "./config.js";
import { cleanPlaceName, distanceKm, escapeHtml } from "./utils.js";

export function createReviewDialog() {
  const reviewDialog = document.querySelector("#location-review-dialog");
  const reviewTitle = document.querySelector("#review-title");
  const reviewReason = document.querySelector("#review-reason");
  const reviewContext = document.querySelector("#review-context");
  const reviewOptions = document.querySelector("#review-options");
  const manualSearchInput = document.querySelector("#manual-search-input");
  const manualSearchButton = document.querySelector("#manual-search-button");
  const skipLocationButton = document.querySelector("#skip-location-button");

  let manualSearchProvider = null;

  function setManualSearchProvider(provider) {
    manualSearchProvider = provider;
  }

  function getReviewReason(candidates, previousLocation) {
    if (candidates.length === 0) return "No possible locations were found.";

    const best = candidates[0];
    const second = candidates[1];

    if (previousLocation) {
      const distance = distanceKm(previousLocation, best);
      if (distance > CONFIG.reviewDistanceKm) {
        return `The best match is ${Math.round(distance)} km from the previous point.`;
      }
    }

    if (best.importance < CONFIG.lowImportanceThreshold) {
      return "The best match looks low-confidence.";
    }

    if (second && Math.abs(best.importance - second.importance) < CONFIG.ambiguousImportanceGap) {
      return "There are several similar-looking matches.";
    }

    return "";
  }

  function promptForLocationChoice(originalName, aliasName, candidates, reason, context = {}) {
    return new Promise((resolve) => {
      reviewTitle.textContent = `Check location: ${originalName}`;
      reviewReason.textContent = reason;

      const aliasLine = aliasName !== originalName
        ? `<br>Search used: <strong>${escapeHtml(aliasName)}</strong>`
        : "";

      const journey = context.journey || {};
      const role = context.role === "from" ? "From" : "To";

      reviewContext.innerHTML = `
        Journey: <strong>${escapeHtml(journey.from || "")} → ${escapeHtml(journey.to || "")}</strong><br>
        Checking: <strong>${escapeHtml(role)}</strong>${aliasLine}
      `;

      renderCandidateButtons(candidates || [], context, resolve, cleanup);

      manualSearchInput.value = aliasName;

      const manualHandler = async () => {
        const manualSearch = cleanPlaceName(manualSearchInput.value);
        if (!manualSearch || !manualSearchProvider) return;

        reviewReason.textContent = `Searching for: ${manualSearch}`;
        const manualCandidates = await manualSearchProvider(manualSearch);

        cleanup();

        const chosen = await promptForLocationChoice(
          originalName,
          manualSearch,
          manualCandidates,
          "Choose the best manual-search result.",
          context
        );

        resolve(chosen);
      };

      const skipHandler = () => {
        cleanup();
        resolve(null);
      };

      function cleanup() {
        manualSearchButton.removeEventListener("click", manualHandler);
        skipLocationButton.removeEventListener("click", skipHandler);
        reviewDialog.close();
      }

      manualSearchButton.addEventListener("click", manualHandler);
      skipLocationButton.addEventListener("click", skipHandler);

      reviewDialog.showModal();
    });
  }

  function renderCandidateButtons(candidates, context, resolve, cleanup) {
    reviewOptions.innerHTML = "";

    if (candidates.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint error";
      empty.textContent = "No matches yet. Try a better manual search below.";
      reviewOptions.appendChild(empty);
      return;
    }

    candidates.slice(0, 8).forEach((candidate) => {
      const distanceText = context.previousLocation
        ? ` · ${Math.round(distanceKm(context.previousLocation, candidate))} km from previous point`
        : "";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-option";
      button.innerHTML = `
        <strong>${escapeHtml(candidate.displayName)}</strong>
        <small>
          ${candidate.type || "place"} · importance ${candidate.importance.toFixed(3)}${distanceText}<br>
          ${candidate.lat.toFixed(5)}, ${candidate.lng.toFixed(5)}
        </small>
      `;

      button.addEventListener("click", () => {
        cleanup();
        resolve(candidate);
      });

      reviewOptions.appendChild(button);
    });
  }

  return {
    setManualSearchProvider,
    getReviewReason,
    promptForLocationChoice
  };
}
