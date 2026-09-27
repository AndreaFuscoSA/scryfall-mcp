// scaricaBulk.js
//
// Script "usa e getta" per la tappa B1: non fa parte del server MCP,
// serve solo per esplorare il file bulk-data di Scryfall in locale.
//
// Cosa fa:
// 1. Chiede a Scryfall l'elenco dei file bulk-data disponibili.
// 2. Trova la voce "oracle_cards" (una riga per carta, non per stampa).
// 3. Scarica quel file, lo decomprime al volo (è gzip) e lo salva su disco
//    già leggibile come testo.
//
// Uso: node scaricaBulk.js

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

// .jsonl perché il file, una volta decompresso, non è un array JSON:
// è una riga di testo per carta, ogni riga un oggetto JSON a sé stante.
const PERCORSO_FILE = './oracle-cards.jsonl';

// Stessi header che usiamo già in scryfall.js: Scryfall blocca le richieste
// senza uno User-Agent descrittivo.
const HEADER = {
  'User-Agent': 'AndreaScryfallMcp/0.1',
  Accept: 'application/json',
};

async function trovaVoceBulk(tipo) {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADER });
  if (!res.ok) {
    throw new Error(`/bulk-data ha risposto ${res.status}`);
  }

  const corpo = await res.json();
  const voce = corpo.data.find((v) => v.type === tipo);
  if (!voce) {
    throw new Error(`Nessuna voce di tipo "${tipo}" nell'elenco`);
  }
  return voce;
}

async function scaricaFile(url, percorsoDestinazione) {
  const res = await fetch(url, { headers: HEADER });
  if (!res.ok || !res.body) {
    throw new Error(`Download fallito: ${res.status}`);
  }

  // Tre tappe invece di due:
  // 1. streamWeb: i byte compressi che arrivano dalla rete, un pezzo alla volta.
  // 2. decompressore: li decomprime al volo (gzip -> testo), sempre a pezzi.
  // 3. streamFile: scrive su disco quello che esce dal decompressore.
  // In nessun punto teniamo l'intero file (compresso o no) tutto in RAM.
  const streamWeb = Readable.fromWeb(res.body);
  const decompressore = createGunzip();
  const streamFile = createWriteStream(percorsoDestinazione);

  await pipeline(streamWeb, decompressore, streamFile);
}

async function main() {
  console.log('Cerco la voce "oracle_cards" in /bulk-data...');
  const voce = await trovaVoceBulk('oracle_cards');

  console.log(`Nome: ${voce.name}`);
  console.log(`Descrizione: ${voce.description}`);
  console.log(`Dimensione compressa dichiarata: ${(voce.compressed_size / 1_000_000).toFixed(1)} MB`);
  console.log(`Ultimo aggiornamento: ${voce.updated_at}`);
  console.log(`URL di download: ${voce.jsonl_download_uri}`);

  console.log('\nScarico e decomprimo il file...');
  const inizio = Date.now();
  await scaricaFile(voce.jsonl_download_uri, PERCORSO_FILE);
  const secondi = ((Date.now() - inizio) / 1000).toFixed(1);

  console.log(`\nFatto in ${secondi}s. File salvato in ${PERCORSO_FILE}`);
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exit(1);
});