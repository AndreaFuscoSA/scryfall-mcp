const RIGA_CARTA = /^(\d+)x?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)\s+(\S+))?$/;

const SEZIONI = {
  deck: "mazzo",
  sideboard: "sideboard",
  commander: "comandante",
  companion: "compagno",
};

export function parseMazzo(testo) {
  const carte = [];
  const nonRiconosciute = [];
  let sezione = "mazzo";

  for (const rigaGrezza of testo.split("\n")) {
    const riga = rigaGrezza.trim();
    if (riga === "") continue;

    const nuovaSezione = SEZIONI[riga.toLowerCase()];
    if (nuovaSezione) {
      sezione = nuovaSezione;
      continue;
    }

    const match = riga.match(RIGA_CARTA);
    if (!match) {
      nonRiconosciute.push(riga);
      continue;
    }

    const [, quantita, nome, set, numero] = match;
    carte.push({
      quantita: Number(quantita),
      nome,
      set: set ?? null,
      numero: numero ?? null,
      sezione,
    });
  }

  return { carte, nonRiconosciute };
}