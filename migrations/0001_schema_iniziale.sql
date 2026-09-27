-- Migration 0001: schema iniziale.
-- Da qui in poi lo schema cambia solo con nuove migration (0002, 0003...),
-- mai modificando questo file dopo che è stato applicato al database remoto.

-- WITHOUT ROWID: tabella ordinata direttamente per oracle_id, senza il numero
-- interno di SQLite. Tabella e chiave primaria sono la stessa struttura,
-- quindi ogni riga costa una scrittura invece di due.
CREATE TABLE carte (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  card_faces TEXT,             -- JSON delle facce, solo name/mana_cost/type_line/oracle_text/colors
  mana_cost TEXT,
  cmc REAL NOT NULL,
  colors TEXT NOT NULL DEFAULT '',
  color_identity TEXT NOT NULL DEFAULT '',
  type_line TEXT NOT NULL,
  oracle_text TEXT,
  legalities TEXT NOT NULL,
  hash TEXT NOT NULL           -- impronta dei campi qui sopra, per capire ogni notte se la carta è cambiata
) WITHOUT ROWID;

CREATE TABLE nomi (
  nome TEXT NOT NULL,
  oracle_id TEXT NOT NULL REFERENCES carte(oracle_id) ON DELETE CASCADE,
  PRIMARY KEY (nome, oracle_id)
) WITHOUT ROWID;

-- La chiave primaria di nomi è ordinata per nome: serve alle ricerche, non a
-- trovare i nomi di una carta. Senza questo indice ogni cancellazione di una
-- carta leggerebbe tutta la tabella nomi.
CREATE INDEX idx_nomi_oracle_id ON nomi(oracle_id);
