// modules/carte-db.js
//
// L'unico punto del progetto che sa come sono salvate le carte in D1.
// Ogni funzione riceve il database come primo parametro (db) invece di
// importarlo: è chi chiama a decidere quale database usare (quello locale
// di wrangler dev, quello vero su Cloudflare, o uno finto in un test).

// Trasforma una riga di D1 in un oggetto con la stessa forma di una carta
// di Scryfall. In D1 alcuni campi sono salvati come testo (JSON, oppure la
// stringa dei colori "UR"): qui tornano oggetti e array, così il resto del
// codice (validazione.js compreso) non deve sapere come li abbiamo salvati.
function daRiga(riga) {
    return {
      ...riga,
      card_faces: riga.card_faces ? JSON.parse(riga.card_faces) : null,
      colors: riga.colors.split(''),                 // "UR" -> ["U", "R"]; "" -> []
      color_identity: riga.color_identity.split(''),
      legalities: JSON.parse(riga.legalities),
    };
  }
  
  // Stessa normalizzazione usata in caricaCarte.js quando abbiamo riempito
  // la tabella nomi: se le due non coincidessero, nessuna ricerca troverebbe niente.
  export function normalizzaNome(nome) {
    return nome.trim().toLowerCase();
  }
  
  // Tutte le carte che hanno questo nome, intero o di una faccia.
  // Di solito è una sola; possono essere di più se due carte diverse hanno
  // una faccia con lo stesso nome. Array vuoto se non ce n'è nessuna.
  export async function trovaCartePerNome(db, nome) {
    // Il "?" è un parametro legato: il valore passato a bind() viaggia
    // separato dal testo SQL, e il database non lo interpreta mai come SQL.
    // Qui è obbligatorio, perché il nome arriva da fuori (da Claude).
    const { results } = await db
      .prepare('SELECT c.* FROM nomi n JOIN carte c ON c.oracle_id = n.oracle_id WHERE n.nome = ?')
      .bind(normalizzaNome(nome))
      .all();
  
    return results.map(daRiga);
  }
  
  // Quanti nomi mettere in una sola query IN (...). Ogni nome è un parametro
  // legato, e D1 ha un limite di parametri per query (dovrebbe essere 100,
  // non l'ho verificato): 50 lascia margine. È lo stesso ragionamento dei
  // blocchi da 75 di recuperaCarte su /cards/collection.
  const NOMI_PER_QUERY = 50;
  
  // La versione D1 di recuperaCarte: stessa forma del risultato,
  // { trovate, nonTrovate }, così validazione.js cambia il meno possibile.
  // - trovate: le carte trovate, ognuna una volta sola (anche se nel mazzo
  //   compare sia come "Life" sia come "Life // Death").
  // - nonTrovate: i nomi senza corrispondenza, scritti come nel mazzo.
  export async function trovaCartePerNomi(db, nomi) {
    // Un nome per ogni forma normalizzata, conservando come era scritto.
    const originali = new Map();
    for (const nome of nomi) {
      const normalizzato = normalizzaNome(nome);
      if (!originali.has(normalizzato)) originali.set(normalizzato, nome);
    }
    const daCercare = [...originali.keys()];
  
    const cartePerId = new Map();   // oracle_id -> carta, per non avere doppioni
    const nomiTrovati = new Set();  // nomi normalizzati che hanno trovato qualcosa
  
    for (let i = 0; i < daCercare.length; i += NOMI_PER_QUERY) {
      const blocco = daCercare.slice(i, i + NOMI_PER_QUERY);
  
      // Un "?" per ogni nome del blocco: "?, ?, ?". Solo i segnaposto sono
      // costruiti a mano; i valori passano comunque da bind().
      const segnaposto = blocco.map(() => '?').join(', ');
      const { results } = await db
        .prepare(
          `SELECT n.nome AS nome_cercato, c.* FROM nomi n JOIN carte c ON c.oracle_id = n.oracle_id WHERE n.nome IN (${segnaposto})`
        )
        .bind(...blocco)
        .all();
  
      for (const { nome_cercato, ...riga } of results) {
        nomiTrovati.add(nome_cercato);
        cartePerId.set(riga.oracle_id, daRiga(riga));
      }
    }
  
    const nonTrovate = daCercare
      .filter((normalizzato) => !nomiTrovati.has(normalizzato))
      .map((normalizzato) => originali.get(normalizzato));
  
    return { trovate: [...cartePerId.values()], nonTrovate };
  }
  
  const COLORI = ['W', 'U', 'B', 'R', 'G'];
  
  // Pezzo di SQL che dice a LIKE quale carattere usare come "escape":
  // un \ davanti a % o _ li fa trattare come caratteri normali, non come jolly.
  // (In JavaScript '\\' è un solo carattere \.)
  const ESCAPE = "ESCAPE '\\'";
  
  // Trasforma un testo cercato in un pattern per LIKE: "contiene questo testo".
  // % e _ sono jolly in LIKE (% = qualsiasi sequenza, _ = un carattere);
  // se compaiono nel testo cercato li precediamo con \, e lo stesso per \.
  // Esempio: "100%" diventa "%100\%%".
  function contiene(testo) {
    return `%${testo.replace(/[\\%_]/g, (carattere) => '\\' + carattere)}%`;
  }
  
  // Ricerca con filtri strutturati. Tutti i filtri sono facoltativi e si
  // combinano con AND. Restituisce { totale, carte }: totale è il numero di
  // carte che soddisfano i filtri, carte ne contiene al massimo maxRisultati.
  //
  // La regola di sicurezza di questa funzione: il testo SQL si compone solo
  // con pezzi scritti qui dentro; ogni valore che arriva da fuori finisce
  // in "valori" e passa da bind(). Condizioni e valori crescono insieme:
  // ogni "?" aggiunto a condizioni ha il suo valore aggiunto a valori.
  export async function cercaCarte(db, filtri) {
    const condizioni = [];
    const valori = [];
  
    if (filtri.nome) {
      condizioni.push(`c.name LIKE ? ${ESCAPE}`);
      valori.push(contiene(filtri.nome));
    }
  
    if (filtri.tipo) {
      condizioni.push(`c.type_line LIKE ? ${ESCAPE}`);
      valori.push(contiene(filtri.tipo));
    }
  
    if (filtri.testo) {
      // Il testo sta in oracle_text per le carte a una faccia, e dentro
      // card_faces per quelle a più facce. json_each() trasforma l'array
      // JSON delle facce in righe, una per faccia; json_extract() prende il
      // testo di ogni faccia. Così cerchiamo solo nel testo delle regole, non
      // nei nomi o nei tipi che stanno anche loro dentro card_faces.
      condizioni.push(
        `(c.oracle_text LIKE ? ${ESCAPE} OR EXISTS (` +
          `SELECT 1 FROM json_each(c.card_faces) AS faccia ` +
          `WHERE json_extract(faccia.value, '$.oracle_text') LIKE ? ${ESCAPE}))`
      );
      valori.push(contiene(filtri.testo), contiene(filtri.testo));
    }
  
    // "Ha almeno questi colori": per ogni colore richiesto, la stringa dei
    // colori (es. "UR") deve contenere quella lettera.
    for (const colore of filtri.colori ?? []) {
      condizioni.push('c.colors LIKE ?');
      valori.push(`%${colore}%`);
    }
  
    // "Identità contenuta in questi colori": vuol dire che l'identità non
    // deve contenere NESSUNO dei colori esclusi. Con ["G","U","W"] escludiamo
    // B e R; con [] escludiamo tutti e cinque, e restano solo le incolori.
    if (filtri.identitaEntro) {
      for (const colore of COLORI.filter((c) => !filtri.identitaEntro.includes(c))) {
        condizioni.push('c.color_identity NOT LIKE ?');
        valori.push(`%${colore}%`);
      }
    }
  
    if (filtri.cmcMin !== undefined) {
      condizioni.push('c.cmc >= ?');
      valori.push(filtri.cmcMin);
    }
    if (filtri.cmcMax !== undefined) {
      condizioni.push('c.cmc <= ?');
      valori.push(filtri.cmcMax);
    }
  
    if (filtri.formato) {
      // json_extract legge un campo dal blob JSON delle legalità.
      // Anche il percorso ("$.historic") passa da bind.
      condizioni.push("json_extract(c.legalities, ?) = 'legal'");
      valori.push(`$.${filtri.formato}`);
    }
  
    const where = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';
  
    // COUNT(*) OVER () è una "window function": conta tutte le righe che
    // soddisfano il WHERE e scrive quel numero su ognuna, PRIMA che LIMIT
    // ne tenga solo le prime. Così otteniamo il totale nella stessa query,
    // senza leggere la tabella una seconda volta.
    const { results } = await db
      .prepare(`SELECT c.*, COUNT(*) OVER () AS totale FROM carte c ${where} ORDER BY c.name LIMIT ?`)
      .bind(...valori, filtri.maxRisultati)
      .all();
  
    const totale = results.length > 0 ? results[0].totale : 0;
    const carte = results.map(({ totale, ...riga }) => daRiga(riga));
    return { totale, carte };
  }