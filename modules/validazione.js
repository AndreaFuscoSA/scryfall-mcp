import { parseMazzo } from "./mazzo.js";
import { recuperaCarte } from "./scryfall.js";

export const REGOLE = {
  standard: { maxCopie: 4, minCarte: 60 },
  alchemy: { maxCopie: 4, minCarte: 60 },
  historic: { maxCopie: 4, minCarte: 60 },
  timeless: { maxCopie: 4, minCarte: 60 },
  brawl: { maxCopie: 1, carteEsatte: 100, richiedeComandante: true },
  competitivebrawl: { maxCopie: 1, carteEsatte: 100, richiedeComandante: true },
};

function indicizza(carte) {
  const indice = new Map();
  for (const card of carte) {
    indice.set(card.name.toLowerCase(), card);
    for (const faccia of card.card_faces ?? []) {
      indice.set(faccia.name.toLowerCase(), card);
    }
  }
  return indice;
}

function copieIllimitate(card) {
  return card.type_line.startsWith("Basic") ||
    /any number of cards named/i.test(card.oracle_text ?? "");
}

export async function validaMazzo(testo, formato) {
  const regole = REGOLE[formato];
  const { carte, nonRiconosciute } = parseMazzo(testo);
  const { trovate, nonTrovate } = await recuperaCarte(carte.map((c) => c.nome));
  const indice = indicizza(trovate);

  const copiePerCarta = new Map();
  let totaleMazzo = 0;
  let comandante = null;

  for (const voce of carte) {
    if (voce.sezione === "mazzo" || voce.sezione === "comandante") {
      totaleMazzo += voce.quantita;
    }

    const card = indice.get(voce.nome.toLowerCase());
    if (!card) continue;

    if (voce.sezione === "comandante") comandante = card;
    copiePerCarta.set(card.name, (copiePerCarta.get(card.name) ?? 0) + voce.quantita);
  }

  const problemi = [];

  for (const [nome, copie] of copiePerCarta) {
    const card = indice.get(nome.toLowerCase());
    const stato = card.legalities[formato];

    if (stato === "banned") {
      problemi.push(`${nome}: bannata in ${formato}`);
    } else if (stato !== "legal") {
      problemi.push(`${nome}: non legale in ${formato} (stato: ${stato})`);
    }

    if (copie > regole.maxCopie && !copieIllimitate(card)) {
      problemi.push(`${nome}: ${copie} copie, massimo ${regole.maxCopie}`);
    }

    if (comandante && !card.color_identity.every((c) => comandante.color_identity.includes(c))) {
      problemi.push(`${nome}: fuori dall'identità di colore del comandante`);
    }
  }

  if (regole.minCarte && totaleMazzo < regole.minCarte) {
    problemi.push(`Il mazzo ha ${totaleMazzo} carte, ne servono almeno ${regole.minCarte}`);
  }
  if (regole.carteEsatte && totaleMazzo !== regole.carteEsatte) {
    problemi.push(`Il mazzo ha ${totaleMazzo} carte, ne servono esattamente ${regole.carteEsatte}`);
  }
  if (regole.richiedeComandante && !comandante) {
    problemi.push("Nessun comandante indicato (manca la sezione Commander)");
  }

  return { problemi, nonRiconosciute, nonTrovate, totaleMazzo };
}