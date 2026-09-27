import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { createServer } from "./server/crea-server.js";

const handler = createMcpHandler(createServer);

const ORIGINI_CONSENTITE = ["localhost", "127.0.0.1"];

export default {
  async fetch(request, env) {
    if (!env.PERCORSO_SEGRETO) {
      return new Response("Configurazione mancante", { status: 500 });
    }

    const url = new URL(request.url);
    if (url.pathname !== `/mcp/${env.PERCORSO_SEGRETO}`) {
      return new Response("Not found", { status: 404 });
    }

    const rifiutata = originValidationResponse(request, ORIGINI_CONSENTITE);
    if (rifiutata) return rifiutata;

    return handler.fetch(request);
  },
};