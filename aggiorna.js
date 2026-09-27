// aggiorna.js
//
// Aggiornamento incrementale del database: confronta il file di Scryfall con
// quello che c'è già in D1 e scrive in delta.sql solo le differenze.
// Sostituisce caricaCarte.js: il primo caricamento è solo un confronto con
// un database vuoto, in cui tutte le carte risultano nuove.
//
// Uso: node aggiorna.js [file.jsonl]
//   Legge:  oracle-cards.jsonl (o il file indicato), prodotto da scaricaBulk.js
//           hash-attuali.json, prodotto da:
//             npx wrangler d1 execute scryfall-cards --local --json \
//               --command="SELECT oracle_id, hash FROM carte" > hash-attuali.json
//           (con --remote al posto di --local per il database vero)
//   Scrive: delta.sql, solo se ci sono differenze e il freno non è scattato.
//   Esce con codice 1 se il freno di sicurezza scatta.

import { createReadStream, createWriteStream, readFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';

// Fonte unica di verità: i formati vengono da REGOLE, come nel server.
// Quando alchemy verrà tolto da REGOLE (febbraio 2027), anche l'aggiornamento
// notturno smetterà di considerarlo, senza toccare questo file.
import { REGOLE } from './modules/validazione.js';
import { normalizzaNome } from './modules/carte-db.js';

const FORMATI_ARENA = Object.keys(REGOLE);

const PERCORSO_CARTE = process.argv[2] ?? './oracle-cards.jsonl';
const PERCORSO_HASH = './hash-attuali.json';
const PERCORSO_DELTA = './delta.sql';

const LIMITE_BLOCCO_CARATTERI = 50_000; // vedi SQLITE_TOOBIG in B2

// Freno di sicurezza: se una di queste condizioni è vera, non si scrive niente.
const QUOTA_MINIMA_CARTE = 0.9;     // il file nuovo deve avere almeno il 90% delle carte del database
const MASSIMO_CANCELLAZIONI = 500;  // più di così, in una notte, è sospetto
const MASSIMO_SCRITTURE = 90_000;   // il limite giornaliero di D1 è 100.000: teniamo margine

const COLONNE = [
  'oracle_id', 'name', 'layout', 'card_faces', 'mana_cost', 'cmc',
  'colors', 'color_identity', 'type_line', 'oracle_text', 'legalities', 'hash',
];

function sqlString(valore) {
  if (valore === null || valore === undefined) return 'NULL';
  return `'${String(valore).replace(/'/g, "''")}'`;
}

// Per ogni faccia teniamo solo i campi della CARTA. Scryfall ci mette anche
// artist, illustration_id, image_uris: sono della stampa, e cambiano ogni
// volta che Scryfall sceglie una stampa di riferimento diversa. Se li
// tenessimo, cambierebbe l'hash e riscriveremmo carte che non sono cambiate.
function facceUtili(carta) {
  if (!carta.card_faces) return null;
  return carta.card_faces.map((f) => ({
    name: f.name,
    mana_cost: f.mana_cost ?? null,
    type_line: f.type_line ?? null,
    oracle_text: f.oracle_text ?? null,
    colors: f.colors ?? null,
  }));
}

// Solo i formati di Arena, in ordine fisso. Due motivi:
// - un ban in un formato cartaceo (es. Pauper) non ci interessa, e senza
//   questo filtro cambierebbe l'hash di quella carta;
// - se un giorno Scryfall mandasse le stesse legalità in un ordine diverso,
//   il testo JSON sarebbe diverso e l'hash cambierebbe senza motivo.
function legalitaArena(carta) {
  return Object.fromEntries(FORMATI_ARENA.map((f) => [f, carta.legalities?.[f] ?? 'not_legal']));
}

// I valori della riga, nell'ordine di COLONNE (hash escluso, lo aggiungiamo dopo).
function valoriCarta(carta) {
  const facce = facceUtili(carta);
  return [
    carta.oracle_id,
    carta.name,
    carta.layout,
    facce ? JSON.stringify(facce) : null,
    carta.mana_cost ?? null,
    carta.cmc,
    (carta.colors ?? []).join(''),
    (carta.color_identity ?? []).join(''),
    carta.type_line,
    carta.oracle_text ?? null,
    JSON.stringify(legalitaArena(carta)),
  ];
}

// L'impronta della carta: SHA-256 dei valori, tenendo i primi 16 caratteri
// esadecimali (64 bit). Se cambia anche una lettera di un valore, cambia
// l'impronta. Con 16.000 carte, due contenuti diversi con la stessa
// impronta sono un'eventualità trascurabile.
function impronta(valori) {
  return createHash('sha256').update(JSON.stringify(valori)).digest('hex').slice(0, 16);
}

function nomiCercabili(carta) {
  const nomi = new Set([normalizzaNome(carta.name)]);
  for (const faccia of carta.card_faces ?? []) nomi.add(normalizzaNome(faccia.name));
  return [...nomi];
}

function tupla(valori) {
  return `(${valori.map((v) => (typeof v === 'number' ? v : sqlString(v))).join(', ')})`;
}

// Legge l'output di wrangler --json: [{ results: [{ oracle_id, hash }, ...], success, meta }].
// Se la forma non è quella attesa ci fermiamo: meglio nessun aggiornamento
// che un confronto con un "database vuoto" immaginario, che direbbe di
// reinserire tutto.
function leggiHashAttuali() {
  const dati = JSON.parse(readFileSync(PERCORSO_HASH, 'utf8'));
  if (!Array.isArray(dati) || !Array.isArray(dati[0]?.results)) {
    throw new Error(`${PERCORSO_HASH} non ha la forma attesa [{ results: [...] }]`);
  }
  return new Map(dati[0].results.map((r) => [r.oracle_id, r.hash]));
}

async function main() {
  // Un delta.sql rimasto da un giro precedente non deve mai essere applicato
  // per sbaglio: lo cancelliamo subito, e lo riscriviamo solo se serve.
  rmSync(PERCORSO_DELTA, { force: true });

  const attuali = leggiHashAttuali();

  const daScrivere = []; // carte nuove o cambiate: { valori, nomi }
  let nuove = 0;
  let cambiate = 0;
  const viste = new Set();

  const righe = createInterface({ input: createReadStream(PERCORSO_CARTE, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const riga of righe) {
    if (riga.trim() === '') continue;
    const carta = JSON.parse(riga);
    if (!FORMATI_ARENA.some((f) => carta.legalities?.[f] === 'legal')) continue;

    viste.add(carta.oracle_id);
    const valori = valoriCarta(carta);
    const hash = impronta(valori);

    if (!attuali.has(carta.oracle_id)) nuove++;
    else if (attuali.get(carta.oracle_id) !== hash) cambiate++;
    else continue; // identica: niente da fare

    daScrivere.push({ valori: [...valori, hash], nomi: nomiCercabili(carta) });
  }

  // Le carte che sono nel database ma non più nel file (per esempio non più
  // legali in nessun formato Arena).
  const rimosse = [...attuali.keys()].filter((id) => !viste.has(id));

  // Stima delle scritture, approssimativa: ogni riga di carte vale 1
  // (WITHOUT ROWID), ogni riga di nomi vale 2 (tabella + indice su oracle_id).
  // Per una carta cambiata cancelliamo e reinseriamo i nomi: 2 + 2 per nome.
  // Per una carta rimossa ipotizziamo poco più di un nome in media.
  const nomiScritti = daScrivere.reduce((somma, c) => somma + c.nomi.length, 0);
  const stimaScritture = daScrivere.length + nomiScritti * 2 + cambiate * 2 + Math.ceil(rimosse.length * 3.2);

  console.log(`Carte nel file (legali su Arena): ${viste.size}`);
  console.log(`Carte nel database: ${attuali.size}`);
  console.log(`Nuove: ${nuove}, cambiate: ${cambiate}, rimosse: ${rimosse.length}`);
  console.log(`Scritture stimate: ${stimaScritture}`);

  const problemi = [];
  if (viste.size < attuali.size * QUOTA_MINIMA_CARTE) {
    problemi.push(`il file ha ${viste.size} carte, meno del ${QUOTA_MINIMA_CARTE * 100}% delle ${attuali.size} nel database`);
  }
  if (rimosse.length > MASSIMO_CANCELLAZIONI) {
    problemi.push(`${rimosse.length} carte da cancellare, più del massimo di ${MASSIMO_CANCELLAZIONI}`);
  }
  if (stimaScritture > MASSIMO_SCRITTURE) {
    problemi.push(`circa ${stimaScritture} scritture, più del massimo di ${MASSIMO_SCRITTURE}`);
  }
  if (problemi.length > 0) {
    console.error('\nFRENO DI SICUREZZA: nessun aggiornamento scritto.');
    for (const p of problemi) console.error(`- ${p}`);
    process.exitCode = 1;
    return;
  }

  if (daScrivere.length === 0 && rimosse.length === 0) {
    console.log('\nNessuna differenza: delta.sql non creato.');
    return;
  }

  const uscita = createWriteStream(PERCORSO_DELTA);

  // Carte nuove e cambiate, a blocchi. Per ogni blocco, in quest'ordine:
  // 1. cancello i nomi attuali di quelle carte (per le nuove non ce ne sono:
  //    costa solo una ricerca nell'indice);
  // 2. inserisco o aggiorno le carte (upsert);
  // 3. inserisco i nomi, che ora puntano a carte esistenti (chiave esterna).
  //
  // Upsert = "INSERT ... ON CONFLICT(oracle_id) DO UPDATE": se la carta non
  // c'è la inserisce, se c'è ne aggiorna le colonne sul posto. NON uso
  // "INSERT OR REPLACE": REPLACE cancella la riga vecchia e ne inserisce una
  // nuova, cioè più scritture, e una cancellazione è proprio ciò che fa
  // scattare le azioni della chiave esterna (qui ON DELETE CASCADE sui nomi).
  const aggiornamenti = COLONNE.filter((c) => c !== 'oracle_id').map((c) => `${c} = excluded.${c}`).join(', ');

  let blocco = [];
  let caratteri = 0;
  function scriviBlocco() {
    if (blocco.length === 0) return;
    const ids = blocco.map((c) => sqlString(c.valori[0])).join(', ');
    const nomi = blocco.flatMap((c) => c.nomi.map((n) => `(${sqlString(n)}, ${sqlString(c.valori[0])})`));
    uscita.write(`DELETE FROM nomi WHERE oracle_id IN (${ids});\n`);
    uscita.write(
      `INSERT INTO carte (${COLONNE.join(', ')}) VALUES\n${blocco.map((c) => tupla(c.valori)).join(',\n')}\n` +
      `ON CONFLICT(oracle_id) DO UPDATE SET ${aggiornamenti};\n`
    );
    uscita.write(`INSERT INTO nomi (nome, oracle_id) VALUES\n${nomi.join(',\n')};\n\n`);
    blocco = [];
    caratteri = 0;
  }
  for (const carta of daScrivere) {
    blocco.push(carta);
    caratteri += tupla(carta.valori).length;
    if (caratteri >= LIMITE_BLOCCO_CARATTERI) scriviBlocco();
  }
  scriviBlocco();

  // Carte rimosse: i loro nomi spariscono con ON DELETE CASCADE, e grazie
  // all'indice su nomi.oracle_id la cascata non legge tutta la tabella.
  for (let i = 0; i < rimosse.length; i += 500) {
    const ids = rimosse.slice(i, i + 500).map(sqlString).join(', ');
    uscita.write(`DELETE FROM carte WHERE oracle_id IN (${ids});\n`);
  }

  uscita.end();
  await finished(uscita);
  console.log(`\nDifferenze scritte in ${PERCORSO_DELTA}`);
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exitCode = 1;
});