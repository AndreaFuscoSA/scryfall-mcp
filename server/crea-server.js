import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { validaMazzo, REGOLE } from "../modules/validazione.js";
import { trovaCartePerNome, cercaCarte } from "../modules/carte-db.js";

// Costo di mana da mostrare in un elenco. Le carte a più facce non hanno
// il costo "in cima": lo prendiamo dalle facce ("{1}{W} // {1}{G}{W}{U}").
// Le reversible_card hanno due facce identiche: ne basta una.
function costoDiMana(card) {
  if (card.mana_cost) return card.mana_cost;
  if (!card.card_faces) return "";
  const facce = card.layout === "reversible_card" ? card.card_faces.slice(0, 1) : card.card_faces;
  return facce.map((f) => f.mana_cost).filter(Boolean).join(" // ");
}

// Testo leggibile di una carta per dettagli_carta.
// Le carte a più facce (split, avventure, modal_dfc, transform...) non hanno
// testo e costo "in cima": stanno dentro card_faces, faccia per faccia.
// Le reversible_card hanno due facce identiche: ne mostriamo una sola.
function descriviCarta(card, formati) {
  const costo = (c) => (c.mana_cost ? ` — ${c.mana_cost}` : "");
  const righe = [`${card.name}${costo(card)}`, `Layout: ${card.layout}`];

  if (card.card_faces) {
    const facce = card.layout === "reversible_card" ? card.card_faces.slice(0, 1) : card.card_faces;
    for (const faccia of facce) {
      righe.push(
        "",
        `Faccia: ${faccia.name}${costo(faccia)}`,
        `Tipo: ${faccia.type_line ?? ""}`,
        `Testo: ${faccia.oracle_text ?? ""}`,
      );
    }
  } else {
    righe.push(`Tipo: ${card.type_line}`, `Testo: ${card.oracle_text ?? ""}`);
  }

  righe.push("", "Legalità:", ...formati.map((f) => `- ${f}: ${card.legalities[f] ?? "sconosciuta"}`));
  return righe.join("\n");
}

export function createServer({ db } = {}) {
  // Fail closed: senza database i tool non possono funzionare, meglio
  // fermarsi subito con un messaggio chiaro che fallire più tardi a metà
  // di una chiamata. Succede per esempio avviando server.js via stdio,
  // che non ha accesso al binding D1.
  if (!db) {
    throw new Error("createServer richiede { db }: il binding D1 non è stato passato");
  }

  const server = new McpServer({ name: "scryfall", version: "0.3.0" });

  const FORMATI_ARENA = Object.keys(REGOLE);
  const COLORE = z.enum(["W", "U", "B", "R", "G"]);

  server.registerTool(
    "cerca_carte",
    {
      description:
        "Cerca carte di Magic: The Gathering giocabili su MTG Arena con filtri strutturati. " +
        "Tutti i filtri sono facoltativi e si combinano tra loro (devono valere tutti). " +
        "nome, tipo e testo cercano una parte del testo, senza distinguere maiuscole e minuscole, in inglese. " +
        "Colori: W bianco, U blu, B nero, R rosso, G verde. " +
        "Usalo prima di suggerire carte per un mazzo, invece di proporle a memoria.",
      inputSchema: z.object({
        nome: z.string().min(1).optional().describe("Parte del nome, es. 'Bolt'"),
        tipo: z.string().min(1).optional().describe("Parte della riga del tipo, es. 'Creature', 'Dragon', 'Legendary Enchantment'"),
        testo: z.string().min(1).optional().describe("Parte del testo delle regole, es. 'draw a card'"),
        colori: z.array(COLORE).optional()
          .describe("La carta deve avere almeno questi colori, es. ['R'] per le carte rosse (anche multicolore)"),
        identita_entro: z.array(COLORE).optional()
          .describe("L'identità di colore deve essere contenuta in questi colori, come per un comandante Brawl; [] = solo carte incolori"),
        cmc_min: z.number().min(0).optional().describe("Costo di mana convertito minimo"),
        cmc_max: z.number().min(0).optional().describe("Costo di mana convertito massimo"),
        formato: z.enum(FORMATI_ARENA).optional().describe("Formato in cui le carte devono essere legali"),
        max_risultati: z.number().int().min(1).max(50).default(20),
      }),
    },
    async (filtri) => {
      try {
        const { totale, carte } = await cercaCarte(db, {
          nome: filtri.nome,
          tipo: filtri.tipo,
          testo: filtri.testo,
          colori: filtri.colori,
          identitaEntro: filtri.identita_entro,
          cmcMin: filtri.cmc_min,
          cmcMax: filtri.cmc_max,
          formato: filtri.formato,
          maxRisultati: filtri.max_risultati,
        });

        if (totale === 0) {
          return { content: [{ type: "text", text: `Nessuna carta giocabile su Arena con questi filtri: ${JSON.stringify(filtri)}` }] };
        }

        const righe = carte.map((c) => `${c.name} ${costoDiMana(c)} — ${c.type_line}`);
        const intestazione =
          `${totale === 1 ? "Trovata 1 carta" : `Trovate ${totale} carte`} ` +
          `(filtri: ${JSON.stringify(filtri)}). Ne mostro ${righe.length}.`;

        return { content: [{ type: "text", text: [intestazione, "", ...righe].join("\n") }] };
      } catch (err) {
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
        const r = await validaMazzo(lista, formato, db);
        const incompleta = r.nonRiconosciute.length > 0 || r.nonTrovate.length > 0;

        let esito;
        if (r.problemi.length > 0) esito = "NON VALIDO";
        else if (incompleta) esito = "VERIFICA INCOMPLETA: nessun problema trovato, ma alcune righe non sono state controllate";
        else esito = "VALIDO";

        const righe = [`Esito per ${formato}: ${esito} (${r.totaleMazzo} carte nel mazzo).`];
        if (r.problemi.length) righe.push("", "Problemi:", ...r.problemi.map((p) => `- ${p}`));
        // Una carta non trovata resta "verifica incompleta", non "non valido":
        // non sappiamo se il nome è sbagliato o se la carta non è su Arena.
        if (r.nonTrovate.length) righe.push(
          "",
          "Carte non trovate tra quelle giocabili su Arena (nome non esatto, oppure carta non disponibile su Arena):",
          ...r.nonTrovate.map((n) => `- ${n}`),
        );
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
        "Cerca una carta di Magic: The Gathering giocabile su MTG Arena e restituisce costo in mana, " +
        "tipo, testo (faccia per faccia per le carte a più facce) e legalità nei formati di Arena. " +
        "Il nome deve essere esatto (maiuscole e minuscole non contano): il nome intero della carta " +
        "oppure il nome di una sua faccia, es. 'Lightning Bolt', 'Life // Death', 'Peter Parker'.",
      inputSchema: z.object({
        nome: z.string().min(1).describe("Nome esatto della carta in inglese, o di una sua faccia"),
      }),
    },
    async ({ nome }) => {
      try {
        const carte = await trovaCartePerNome(db, nome);

        if (carte.length === 0) {
          // "Non trovata" qui non vuol dire "non esiste": nel database ci sono
          // solo le carte legali in almeno un formato Arena, e il nome deve
          // essere esatto. Lo diciamo, invece di far credere a Claude che la
          // carta non esista.
          return {
            content: [{
              type: "text",
              text:
                `"${nome}" non trovata tra le carte giocabili su MTG Arena. ` +
                "Può darsi che il nome non sia esatto, che la carta non sia su Arena, " +
                "o che non sia legale in nessun formato di Arena.",
            }],
          };
        }

        const testo = carte.map((card) => descriviCarta(card, FORMATI_ARENA)).join("\n\n---\n\n");
        return { content: [{ type: "text", text: testo }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  return server;
}