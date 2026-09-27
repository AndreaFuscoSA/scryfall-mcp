import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { createServer } from "./server/crea-server.js";

const ORIGINI_CONSENTITE = ["localhost", "127.0.0.1"];

export default {
  async fetch(request, env) {
    // Fail closed anche sul database: senza binding D1 i tool non funzionano.
    if (!env.PERCORSO_SEGRETO || !env.scryfall_cards) {
      return new Response("Configurazione mancante", { status: 500 });
    }

    const url = new URL(request.url);
    if (url.pathname !== `/mcp/${env.PERCORSO_SEGRETO}`) {
      return new Response("Not found", { status: 404 });
    }

    const rifiutata = originValidationResponse(request, ORIGINI_CONSENTITE);
    if (rifiutata) return rifiutata;

    // Prima l'handler veniva creato una volta sola, fuori da fetch. Ma env
    // (e con lui il database) esiste solo qui dentro: creiamo l'handler per
    // ogni richiesta, con una funzione che "ricorda" env (una closure).
    const handler = createMcpHandler(() => createServer({ db: env.scryfall_cards }));
    return handler.fetch(request);
  },
};