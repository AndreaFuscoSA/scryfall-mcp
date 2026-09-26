const BASE_URL = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "AndreaScryfallMcp/0.1",
  "Accept": "application/json",
};

export async function scryfallGet(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { headers: HEADERS });
  const data = await res.json();

  if (!res.ok) {
    const error = new Error(`Scryfall ${res.status}: ${data.details}`);
    error.status = res.status;
    throw error;
  }
  return data;
}