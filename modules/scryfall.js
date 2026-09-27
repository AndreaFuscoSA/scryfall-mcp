const BASE_URL = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "AndreaScryfallMcp/0.1",
  "Accept": "application/json",
};

async function gestisciRisposta(res) {
    if (res.status === 429) {
      const error = new Error(
        "Scryfall ha applicato un limite di frequenza (429). " +
        "Non riprovare prima di 60 secondi e non fare chiamate in parallelo a questo connettore."
      );
      error.status = 429;
      throw error;
    }
    const data = await res.json();
    if (!res.ok) {
      const avvisi = data.warnings?.length ? ` Avvisi: ${data.warnings.join(" ")}` : "";
      const error = new Error(`Scryfall ${res.status}: ${data.details}${avvisi}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

export async function scryfallGet(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: HEADERS });
  return gestisciRisposta(res);
}

export async function scryfallPost(path, body) {
  const url = new URL(path, BASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return gestisciRisposta(res);
}

const MAX_PER_RICHIESTA = 75;
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function recuperaCarte(nomi) {
  const unici = [...new Set(nomi)];
  const trovate = [];
  const nonTrovate = [];

  for (let i = 0; i < unici.length; i += MAX_PER_RICHIESTA) {
    if (i > 0) await pausa(500);

    const blocco = unici.slice(i, i + MAX_PER_RICHIESTA);
    const risposta = await scryfallPost("/cards/collection", {
      identifiers: blocco.map((nome) => ({ name: nome })),
    });

    trovate.push(...risposta.data);
    nonTrovate.push(...risposta.not_found.map((id) => id.name));
  }

  return { trovate, nonTrovate };
}