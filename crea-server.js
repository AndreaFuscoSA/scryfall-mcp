import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { scryfallGet } from "./scryfall.js";
import { validaMazzo, REGOLE } from "./validazione.js";

export function createServer() {
  const server = new McpServer({ name: "scryfall", version: "0.1.0" });

  const FORMATI_ARENA = Object.keys(REGOLE);

  server.registerTool(
    "cerca_carte",
    {
      description:
        "Cerca carte di Magic: The Gathering su Scryfall usando la sua sintassi di ricerca " +
        "(es. 't:dragon c<=R mv<=4', 'o:\"draw a card\" t:instant'). " +
        "Per default restituisce solo carte disponibili su MTG Arena. " +
        "Se indichi un formato, restituisce solo carte legali in quel formato. " +
        "Usalo prima di suggerire carte per un mazzo, per verificare che esistano e siano giocabili.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Query in sintassi Scryfall"),
        formato: z.enum(FORMATI_ARENA).optional().describe("Formato in cui le carte devono essere legali"),
        solo_arena: z.boolean().default(true).describe("Se true, solo carte disponibili su MTG Arena"),
        max_risultati: z.number().int().min(1).max(50).default(20),
      }),
    },
    async ({ query, formato, solo_arena, max_risultati }) => {
      let q = `(${query})`;
      if (solo_arena) q += " game:arena";
      if (formato) q += ` legal:${formato}`;

      try {
        const risultati = await scryfallGet("/cards/search", { q, order: "name" });

        const righe = risultati.data
          .slice(0, max_risultati)
          .map((c) => `${c.name} ${c.mana_cost ?? ""} — ${c.type_line}`);

        const intestazione = `Trovate ${risultati.total_cards} carte (query: ${q}). Ne mostro ${righe.length}.`;

        return { content: [{ type: "text", text: [intestazione, "", ...righe].join("\n") }] };
      } catch (err) {
        if (err.status === 404) {
            return {
              content: [{ type: "text", text: `Nessuna carta trovata per: ${q}\nRisposta di Scryfall: ${err.message}` }],
            };
          }
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  server.registerTool(
    "valida_mazzo",
    {
      description:
        "Valida una lista di mazzo per MTG Arena, nel formato di export di Arena (es. '4 Lightning Bolt (STA) 42'). " +
        "Controlla che ogni carta esista e sia legale nel formato (quindi disponibile su Arena), " +
        "il numero di copie, il numero di carte e, nei formati Brawl, l'identità di colore del comandante. " +
        "Usalo sempre prima di proporre una lista completa o modifiche a un mazzo.",
      inputSchema: z.object({
        lista: z.string().min(1).describe("Lista del mazzo, una carta per riga, con eventuali sezioni Deck, Sideboard, Commander"),
        formato: z.enum(FORMATI_ARENA).describe("Formato in cui validare il mazzo"),
      }),
    },
    async ({ lista, formato }) => {
      try {
        const r = await validaMazzo(lista, formato);
        const incompleta = r.nonRiconosciute.length > 0 || r.nonTrovate.length > 0;

        let esito;
        if (r.problemi.length > 0) esito = "NON VALIDO";
        else if (incompleta) esito = "VERIFICA INCOMPLETA: nessun problema trovato, ma alcune righe non sono state controllate";
        else esito = "VALIDO";

        const righe = [`Esito per ${formato}: ${esito} (${r.totaleMazzo} carte nel mazzo).`];
        if (r.problemi.length) righe.push("", "Problemi:", ...r.problemi.map((p) => `- ${p}`));
        if (r.nonTrovate.length) righe.push("", "Carte non trovate su Scryfall:", ...r.nonTrovate.map((n) => `- ${n}`));
        if (r.nonRiconosciute.length) righe.push("", "Righe non riconosciute:", ...r.nonRiconosciute.map((n) => `- ${n}`));

        return { content: [{ type: "text", text: righe.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  server.registerTool(
    "dettagli_carta",
    {
      description:
        "Cerca una carta di Magic: The Gathering per nome su Scryfall e restituisce " +
        "costo in mana, tipo, testo e legalità in Historic, Brawl, Competitive Brawl e Standard. " +
        "Accetta nomi approssimativi o con piccoli errori di battitura.",
      inputSchema: z.object({
        nome: z.string().min(1).describe("Nome della carta in inglese, es. 'Lightning Bolt'"),
      }),
    },
    async ({ nome }) => {
      try {
        // Accettiamo nomi approssimativi o con piccoli errori di battitura
        // per esempio: "Lightnin Bolt" o "Lightning Bolt's"
        const card = await scryfallGet("/cards/named", { fuzzy: nome });

        let suArena = "No";
        try {
          const onArena = await scryfallGet("/cards/search", { q: `!"${card.name}" game:arena` });
          if (onArena) suArena = "Sì";
        } catch (err) {
            if (err.status === 404) {
                suArena = "No";
              } else {
                console.error(err);
                suArena = "Non verificabile (errore Scryfall)";
              }
        }
        if (!card) {
          return { content: [{ type: "text", text: "Carta non trovata" }], isError: true };
        }

        const testo = [
          `${card.name} - ${card.mana_cost ?? ""}`,
          `Tipo: ${card.type_line}`,
          `Testo: ${card.oracle_text ?? ""}`,
          `Presente su Arena: ${suArena}`,
          "",
          `Historic: ${card.legalities.historic}`,
          `Brawl: ${card.legalities.brawl}`,
          `Standard: ${card.legalities.standard}`,
          `Competitive Brawl: ${card.legalities.competitivebrawl}`,
        ].join("\n");

        return { content: [{ type: "text", text: testo }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  return server;
}