// Stockage des avis, activités, événements et votes.
// Deux implémentations avec la même interface :
//   - SupabaseStore : votes partagés entre tous les visiteurs
//   - LocalStore    : votes conservés dans ce navigateur (mode démo)

const VOTER_KEY = "cdl.voterId";
const LOCAL_KEY = "cdl.entries";

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}

export function voterId() {
  let id = safeGet(VOTER_KEY);
  if (!id) {
    id = uuid();
    safeSet(VOTER_KEY, id);
  }
  return id;
}

export const newId = uuid;

class LocalStore {
  shared = false;

  #read() {
    try { return JSON.parse(safeGet(LOCAL_KEY)) || []; } catch { return []; }
  }

  async reviews() {
    return this.#read().filter((e) => e.kind === "review");
  }

  async forCentre(centreId) {
    return this.#read().filter((e) => e.centre_id === centreId);
  }

  async save(entry) {
    const all = this.#read();
    const i = all.findIndex((e) =>
      e.kind === entry.kind && e.centre_id === entry.centre_id &&
      e.voter_id === entry.voter_id && e.target === entry.target);
    const row = { ...entry, created_at: i >= 0 ? all[i].created_at : new Date().toISOString() };
    if (i >= 0) all[i] = row; else all.push(row);
    safeSet(LOCAL_KEY, JSON.stringify(all));
    return row;
  }
}

class SupabaseStore {
  shared = true;

  constructor(url, key) {
    this.base = url.replace(/\/$/, "") + "/rest/v1/entries";
    this.headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  async #get(query) {
    const res = await fetch(`${this.base}?${query}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Lecture impossible (${res.status})`);
    return res.json();
  }

  async reviews() {
    return this.#get("kind=eq.review&select=centre_id,payload&limit=100000");
  }

  async forCentre(centreId) {
    return this.#get(`centre_id=eq.${encodeURIComponent(centreId)}&select=*&order=created_at.desc&limit=2000`);
  }

  async save(entry) {
    const res = await fetch(`${this.base}?on_conflict=kind,centre_id,voter_id,target`, {
      method: "POST",
      headers: { ...this.headers, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`Enregistrement impossible (${res.status})`);
    return (await res.json())[0];
  }
}

export function createStore(config = {}) {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    return new SupabaseStore(config.supabaseUrl, config.supabaseAnonKey);
  }
  return new LocalStore();
}
