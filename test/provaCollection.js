import { parseMazzo } from "../mazzo.js";
import { recuperaCarte } from "../scryfall.js";

const lista = `Deck
4 Lightning Bolt (STA) 42
4 Jeskai Ascendancy (KTK) 180
4 A-Vivi Ornitier
1 Black Lotus
20 Island

Sideboard
2 Negate (M20) 69
1 Carta Inventata`;

const { carte } = parseMazzo(lista);
const nomi = carte.map((c) => c.nome);

const { trovate, nonTrovate } = await recuperaCarte(nomi);

for (const card of trovate) {
  console.log(card.name, "| historic:", card.legalities.historic, "| games:", card.games);
}
console.log("\nNon trovate:", nonTrovate);