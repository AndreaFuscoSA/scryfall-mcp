import { scryfallGet } from "../scryfall.js";


// 1. Una carta per nome esatto
const card = await scryfallGet("/cards/named", { exact: "Jeskai Ascendancy" });
console.log(card.name, "- set:", card.set);
console.log("Giochi:", card.games);
console.log("Legalità:", {
  historic: card.legalities.historic,
  brawl: card.legalities.brawl,
  standard: card.legalities.standard,
});

// 2. Una ricerca con la sintassi di Scryfall
const risultati = await scryfallGet("/cards/search", {
  q: "game:arena legal:historic t:dragon c<=R",
});
console.log(`\nTrovate ${risultati.total_cards} carte. Le prime 5:`);
console.log(risultati.data.slice(0, 5).map((c) => c.name));