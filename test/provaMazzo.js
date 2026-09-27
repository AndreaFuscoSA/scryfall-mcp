import { parseMazzo } from "../mazzo.js";

const lista = `Deck
4 Lightning Bolt (STA) 42
4 Jeskai Ascendancy (KTK) 180
2 Fire // Ice (XXX) 1
20 Island

Sideboard
2 Negate (M20) 69
riga strana`;

const risultato = parseMazzo(lista);
console.log(risultato.carte);
console.log("Non riconosciute:", risultato.nonRiconosciute);