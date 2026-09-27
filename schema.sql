-- schema.sql
--
-- Tabella carte: una riga per ogni carta legale in almeno un formato Arena.
-- Chiave primaria: oracle_id, non id — è l'identificativo della carta,
-- stabile su tutte le stampe, a differenza di id che è della singola stampa.

CREATE TABLE carte (
  oracle_id TEXT PRIMARY KEY,

  name TEXT NOT NULL,          -- "Delver of Secrets // Insectile Aberration"
  layout TEXT NOT NULL,        -- "normal", "transform", "split", "reversible_card", ...
  card_faces TEXT,             -- JSON delle facce; NULL se la carta ha una faccia sola

  mana_cost TEXT,              -- "{2}{U}{U}"; NULL per le terre e per molte carte a più facce
  cmc REAL NOT NULL,           -- costo di mana convertito

  colors TEXT NOT NULL DEFAULT '',          -- es. "UR"; "" per le carte incolori
  color_identity TEXT NOT NULL DEFAULT '',  -- come sopra, usata in Brawl

  type_line TEXT NOT NULL,     -- "Creature — Human Wizard"
  oracle_text TEXT,            -- NULL per le carte a più facce (il testo sta in card_faces)

  legalities TEXT NOT NULL     -- blob JSON: {"standard":"legal","historic":"banned",...}
);

-- Tabella nomi: la versione SQL di indicizza() in validazione.js.
-- Una riga per ogni nome con cui una carta può comparire in una lista di
-- Arena: il nome intero ("life // death") e il nome di ogni faccia
-- ("life", "death", "peter parker"). Sempre in minuscolo.
-- Chiave primaria sulla coppia (nome, oracle_id); l'indice che SQLite crea
-- è ordinato prima per nome, ed è quello che rende veloce "WHERE nome IN (...)".
-- ON DELETE CASCADE: se una carta viene cancellata, i suoi nomi spariscono con lei.
CREATE TABLE nomi (
  nome TEXT NOT NULL,
  oracle_id TEXT NOT NULL REFERENCES carte(oracle_id) ON DELETE CASCADE,
  PRIMARY KEY (nome, oracle_id)
);
