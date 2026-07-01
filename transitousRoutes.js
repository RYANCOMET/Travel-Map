const queue = [];
let activeJobs = 0;
let completedJobs = 0;

const MAX_CONCURRENT_ROUTE_REQUESTS = 1;
const GAP_BETWEEN_REQUESTS_MS = 250;

console.log("routeQueue.js loaded");

export function enqueueRouteRequest(job) {
  console.log(`Route queued. Waiting: ${queue.length}, active: ${activeJobs}, completed: ${completedJobs}`);

  return new Promise((resolve, reject) => {
    queue.push({
      job,
      resolve,
      reject
    });

    runNextJobs();
  });
}

function runNextJobs() {
  while (activeJobs < MAX_CONCURRENT_ROUTE_REQUESTS && queue.length > 0) {
    const next = queue.shift();
    activeJobs++;

    console.log(`Route starting. Waiting: ${queue.length}, active: ${activeJobs}, completed: ${completedJobs}`);

    Promise.resolve()
      .then(() => wait(GAP_BETWEEN_REQUESTS_MS))
      .then(next.job)
      .then(next.resolve)
      .catch(next.reject)
      .finally(() => {
        activeJobs--;
        completedJobs++;

        console.log(`Route finished. Waiting: ${queue.length}, active: ${activeJobs}, completed: ${completedJobs}`);

        runNextJobs();
      });
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
