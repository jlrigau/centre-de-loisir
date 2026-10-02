// Construit data/centres.json à partir de l'open data de la Ville de Paris.
// À Paris, les centres de loisirs (accueils de loisirs du mercredi et des vacances)
// sont installés dans les écoles maternelles et élémentaires publiques.
// Source : https://opendata.paris.fr/explore/dataset/lieux-municipaux/
import { writeFile } from "node:fs/promises";

const API = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/lieux-municipaux/exports/json";
const CATEGORIES = { "Ecoles maternelles": "maternelle", "Ecoles élémentaires": "elementaire" };

const where = Object.keys(CATEGORIES).map((c) => `categorie="${c}"`).join(" OR ");
const res = await fetch(`${API}?where=${encodeURIComponent(where)}`);
if (!res.ok) throw new Error(`Open data Paris : HTTP ${res.status}`);
const rows = await res.json();

const centres = rows
  .filter((r) => r.latitude && r.longitude)
  .map((r) => {
    const cp = r.address_postcode || "";
    const arr = /^750(\d\d)$/.test(cp) ? Number(cp.slice(3)) : null;
    return {
      id: String(r.id),
      nom: r.name.replace(/^Ecole/, "École"),
      type: CATEGORIES[r.categorie],
      adresse: r.address_street,
      cp,
      arr,
      tel: r.phone || null,
      lat: Number(r.latitude.toFixed(6)),
      lon: Number(r.longitude.toFixed(6)),
      url: r.url,
      photo: r.photo_url || null,
    };
  })
  .sort((a, b) => (a.arr ?? 99) - (b.arr ?? 99) || a.nom.localeCompare(b.nom, "fr"));

const out = {
  source: "Ville de Paris — jeu de données « lieux-municipaux » (Licence ODbL)",
  sourceUrl: "https://opendata.paris.fr/explore/dataset/lieux-municipaux/",
  generatedAt: new Date().toISOString().slice(0, 10),
  count: centres.length,
  centres,
};
await writeFile(new URL("../data/centres.json", import.meta.url), JSON.stringify(out));
console.log(`${centres.length} centres écrits dans data/centres.json`);
