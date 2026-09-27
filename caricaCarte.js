// caricaCarte.js
//
// Legge oracle-cards.jsonl, tiene solo le carte legali in almeno un
// formato Arena e scrive un file .sql con gli INSERT per le tabelle
// carte e nomi, pronto per:
//   npx wrangler d1 execute scryfall-cards --local --file=carica-carte.sql
//
// Uso: node caricaCarte.js

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';

const PERCORSO_INGRESSO = './oracle-cards.jsonl';
const PERCORSO_USCITA = './carica-carte.sql';

// Non conosciamo il limite esatto di lunghezza che D1 impone su una singola
// istruzione SQL (200 righe per blocco lo hanno superato: SQLITE_TOOBIG).
// Mettiamo un tetto ai caratteri accumulati invece che al numero di righe.
const LIMITE_BLOCCO_CARATTERI = 50_000;

const FORMATI_ARENA = ['standard', 'alchemy', 'historic', 'timeless', 'brawl', 'competitivebrawl'];

const COLONNE_CARTE = [
  'oracle_id', 'name', 'layout', 'card_faces', 'mana_cost', 'cmc',
  'colors', 'color_identity', 'type_line', 'oracle_text', 'legalities',
];
const COLONNE_NOMI = ['nome', 'oracle_id'];

// Trasforma un valore JS in un literal SQL sicuro: stringhe tra apici,
// con ogni apice interno raddoppiato ("Urza's Tower" -> 'Urza''s Tower').
function sqlString(valore) {
  if (valore === null || valore === undefined) return 'NULL';
  return `'${String(valore).replace(/'/g, "''")}'`;
}

function tuplaCarta(carta) {
  const valori = [
    sqlString(carta.oracle_id),
    sqlString(carta.name),
    sqlString(carta.layout),
    sqlString(carta.card_faces ? JSON.stringify(carta.card_faces) : null),
    sqlString(carta.mana_cost ?? null),
    carta.cmc, // numero: nessun apice
    sqlString((carta.colors ?? []).join('')),
    sqlString((carta.color_identity ?? []).join('')),
    sqlString(carta.type_line),
    sqlString(carta.oracle_text ?? null),
    sqlString(JSON.stringify(carta.legalities)),
  ];
  return `(${valori.join(', ')})`;
}

// Tutti i nomi con cui una carta può comparire in una lista di Arena:
// il nome intero e il nome di ogni faccia, in minuscolo.
// Il Set elimina i doppioni, e qui non è solo pulizia: le reversible_card
// (es. Brightglass Gearhulk) hanno lo stesso nome su entrambe le facce.
// Senza Set inseriremmo due righe identiche, la chiave primaria le
// rifiuterebbe e l'intero blocco di INSERT fallirebbe.
function nomiCercabili(carta) {
  const nomi = new Set([carta.name.toLowerCase()]);
  for (const faccia of carta.card_faces ?? []) {
    nomi.add(faccia.name.toLowerCase());
  }
  return [...nomi];
}

function istruzioneInsert(tabella, colonne, tuple) {
  return `INSERT INTO ${tabella} (${colonne.join(', ')}) VALUES\n${tuple.join(',\n')};\n\n`;
}

async function main() {
  const flusso = createReadStream(PERCORSO_INGRESSO, { encoding: 'utf8' });
  const righe = createInterface({ input: flusso, crlfDelay: Infinity });
  const uscita = createWriteStream(PERCORSO_USCITA);

  let bloccoCarte = [];
  let bloccoNomi = [];
  let caratteriBlocco = 0;
  let totaleCarte = 0;
  let totaleNomi = 0;

  // Scrive sempre prima le carte e subito dopo i loro nomi: ogni riga di
  // nomi punta a una carta (chiave esterna), quindi quella carta deve già
  // esistere nel momento in cui il nome viene inserito.
  // Il blocco dei nomi non ha un suo limite di caratteri: segue quello
  // delle carte, ed è molto più piccolo (circa 60 caratteri per nome
  // contro circa 800 per carta), quindi resta ben sotto la soglia.
  function scriviBlocchi() {
    if (bloccoCarte.length === 0) return;
    uscita.write(istruzioneInsert('carte', COLONNE_CARTE, bloccoCarte));
    uscita.write(istruzioneInsert('nomi', COLONNE_NOMI, bloccoNomi));
    totaleCarte += bloccoCarte.length;
    totaleNomi += bloccoNomi.length;
    bloccoCarte = [];
    bloccoNomi = [];
    caratteriBlocco = 0;
  }

  for await (const riga of righe) {
    if (riga.trim() === '') continue;

    const carta = JSON.parse(riga);

    const legaleInArena = FORMATI_ARENA.some((formato) => carta.legalities?.[formato] === 'legal');
    if (!legaleInArena) continue;

    const tupla = tuplaCarta(carta);
    bloccoCarte.push(tupla);
    caratteriBlocco += tupla.length;

    for (const nome of nomiCercabili(carta)) {
      bloccoNomi.push(`(${sqlString(nome)}, ${sqlString(carta.oracle_id)})`);
    }

    if (caratteriBlocco >= LIMITE_BLOCCO_CARATTERI) {
      scriviBlocchi();
    }
  }
  scriviBlocchi(); // l'ultimo blocco, qualunque sia la sua dimensione

  uscita.end();
  await finished(uscita);

  console.log(`Scritte ${totaleCarte} carte e ${totaleNomi} nomi in ${PERCORSO_USCITA}`);
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exit(1);
});