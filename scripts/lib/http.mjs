// Retries on network-level failures (connection timeouts, DNS blips, reset
// connections) — not on HTTP error status codes, those come back as a normal
// response and are handled by the caller.
export async function fetchWithRetry(url, options = {}, retries = 2, delayMs = 1000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      console.error(
        `Fetch failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}. Retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
