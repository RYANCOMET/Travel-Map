import { getUkRailRouter } from "./ukRailBrowserRouter.js";

self.addEventListener("message", async (event) => {
  const message = event.data || {};

  if (message.type !== "route") {
    return;
  }

  try {
    const router = await getUkRailRouter({
      ...(message.options || {}),
      log: (text) => {
        self.postMessage({
          type: "log",
          requestId: message.requestId,
          message: text
        });
      }
    });

    const route = await router.routeJourney(
      message.journey,
      message.fromLocation,
      message.toLocation
    );

    self.postMessage({
      type: "result",
      requestId: message.requestId,
      route
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      error: error && error.message ? error.message : String(error)
    });
  }
});
