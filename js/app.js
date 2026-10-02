import { createStore, voterId, newId } from "./store.js";

const CRITERES = [
  ["encadrement", "Encadrement & animateurs"],
  ["activites", "Activités proposées"],
  ["locaux", "Locaux & sécurité"],
  ["communication", "Communication avec les parents"],
];
const PERIODES = { "": "Non précisé", mercredi: "Mercredis", vacances: "Vacances scolaires", les2: "Mercredis et vacances" };
const EVENT_KINDS = {
  bravo: { icon: "👏", label: "Super moment" },
  info: { icon: "ℹ️", label: "Info utile" },
  probleme: { icon: "⚠️", label: "Problème" },
};

const store = createStore(window.CDL_CONFIG);
const me = voterId();
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  centres: [],
  byId: new Map(),
  stats: new Map(), // centre_id -> { n, avg }
  markers: new Map(),
  position: null,
  current: null,
  entries: [],
  tab: "avis",
};

// ---------- utilitaires ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function arrLabel(n) { return n === 1 ? "1er" : `${n}e`; }
function typeLabel(t) { return t === "maternelle" ? "Maternelle" : "Élémentaire"; }
function stars(value, max = 5) {
  const full = Math.round(value);
  return `<span class="stars" aria-label="${value.toFixed(1)} sur ${max}">${"★".repeat(full)}<span class="off">${"★".repeat(max - full)}</span></span>`;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function today() { return new Date().toISOString().slice(0, 10); }
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}
function distance(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function color(stat) {
  if (!stat) return "#9aa3ad";
  if (stat.avg >= 4) return "#1f9d55";
  if (stat.avg >= 3) return "#e3a008";
  return "#d64545";
}

// ---------- chargement ----------
async function init() {
  if (!store.shared) {
    const b = $("#mode-banner");
    b.innerHTML = "Mode démo : vos votes sont enregistrés dans ce navigateur uniquement. " +
      "<a href=\"https://github.com/jlrigau/centre-de-loisir#activer-les-votes-partagés\" target=\"_blank\" rel=\"noopener\">Activer les votes partagés</a>";
    b.hidden = false;
  }

  const data = await fetch("data/centres.json").then((r) => r.json());
  state.centres = data.centres;
  state.centres.forEach((c) => state.byId.set(c.id, c));
  $("#about-count").textContent = data.count;

  const arrs = [...new Set(state.centres.map((c) => c.arr).filter(Boolean))].sort((a, b) => a - b);
  $("#arr").insertAdjacentHTML("beforeend", arrs.map((a) => `<option value="${a}">Paris ${arrLabel(a)}</option>`).join(""));

  initMap();
  await refreshStats();
  bindUi();
  route();
  try {
    if (!localStorage.getItem("cdl.seenAbout")) {
      $("#about").showModal();
      localStorage.setItem("cdl.seenAbout", "1");
    }
  } catch { /* ignore */ }
}

async function refreshStats() {
  try {
    const reviews = await store.reviews();
    const acc = new Map();
    for (const r of reviews) {
      const note = Number(r.payload?.note);
      if (!note) continue;
      const s = acc.get(r.centre_id) || { n: 0, sum: 0 };
      s.n++; s.sum += note;
      acc.set(r.centre_id, s);
    }
    state.stats = new Map([...acc].map(([id, s]) => [id, { n: s.n, avg: s.sum / s.n }]));
  } catch (e) {
    toast("Impossible de charger les notes : " + e.message);
  }
  renderList();
  paintMarkers();
}

// ---------- carte ----------
let map;
function initMap() {
  if (!window.L) {
    $("#map").innerHTML = `<p class="empty">Carte indisponible.</p>`;
    return;
  }
  map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([48.8589, 2.3469], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Données : Ville de Paris',
  }).addTo(map);
  for (const c of state.centres) {
    const m = L.circleMarker([c.lat, c.lon], { radius: 6, weight: 1.5, color: "#fff", fillOpacity: 0.9 })
      .addTo(map)
      .bindTooltip(c.nom)
      .on("click", () => openCentre(c.id));
    state.markers.set(c.id, m);
  }
}
function paintMarkers() {
  const visible = new Set(filtered().map((c) => c.id));
  for (const [id, m] of state.markers) {
    const show = visible.has(id);
    m.setStyle({ fillColor: color(state.stats.get(id)), fillOpacity: show ? 0.9 : 0, opacity: show ? 1 : 0 });
    m.options.interactive = show;
  }
}

// ---------- liste ----------
function filtered() {
  const q = $("#search").value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const arr = $("#arr").value, type = $("#type").value;
  return state.centres.filter((c) => {
    if (arr && String(c.arr) !== arr) return false;
    if (type && c.type !== type) return false;
    if (q) {
      const hay = `${c.nom} ${c.adresse} ${c.cp}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

function sorted(list) {
  const sort = $("#sort").value;
  const st = (c) => state.stats.get(c.id);
  if (sort === "best") return [...list].sort((a, b) => (st(b)?.avg ?? 0) - (st(a)?.avg ?? 0) || (st(b)?.n ?? 0) - (st(a)?.n ?? 0));
  if (sort === "most") return [...list].sort((a, b) => (st(b)?.n ?? 0) - (st(a)?.n ?? 0));
  if (sort === "near" && state.position) return [...list].sort((a, b) => distance(state.position, a) - distance(state.position, b));
  return list;
}

const PAGE = 80;
let shown = PAGE;
function renderList() {
  const list = sorted(filtered());
  $("#count").textContent = `${list.length} centre${list.length > 1 ? "s" : ""}`;
  const html = list.slice(0, shown).map((c) => {
    const s = state.stats.get(c.id);
    const note = s ? `${stars(s.avg)} <span class="small">${s.avg.toFixed(1)} · ${s.n} avis</span>` : `<span class="small muted">Pas encore d'avis</span>`;
    const dist = state.position && $("#sort").value === "near" ? ` · ${distance(state.position, c).toFixed(1)} km` : "";
    return `<li><button type="button" class="item" data-id="${c.id}">
      <span class="dot" style="background:${color(s)}"></span>
      <span class="item-body">
        <span class="item-title">${esc(c.nom)}</span>
        <span class="small muted">${typeLabel(c.type)} · ${esc(c.adresse)} · Paris ${arrLabel(c.arr)}${dist}</span>
        <span>${note}</span>
      </span></button></li>`;
  }).join("");
  const more = list.length > shown ? `<li><button type="button" class="ghost more" id="more">Afficher plus (${list.length - shown} restants)</button></li>` : "";
  $("#list").innerHTML = html + more || `<li class="empty">Aucun centre ne correspond.</li>`;
}

// ---------- fiche centre ----------
function route() {
  const m = location.hash.match(/^#\/centre\/(\w+)(?:\/(\w+))?/);
  if (m && state.byId.has(m[1])) {
    if (m[2]) state.tab = m[2];
    showCentre(m[1]);
  } else {
    closeDetail(false);
  }
}
function openCentre(id, tab) {
  state.tab = tab || state.tab || "avis";
  location.hash = `#/centre/${id}/${state.tab}`;
}
function closeDetail(updateHash = true) {
  $("#detail").hidden = true;
  document.body.classList.remove("detail-open");
  state.current = null;
  if (updateHash && location.hash) history.pushState("", "", location.pathname + location.search);
}

async function showCentre(id) {
  const c = state.byId.get(id);
  const changed = state.current?.id !== id;
  state.current = c;
  document.body.classList.add("detail-open");
  $("#detail").hidden = false;
  if (changed) {
    state.entries = [];
    renderDetail(true);
    map?.setView([c.lat, c.lon], Math.max(map.getZoom(), 15), { animate: true });
    try {
      state.entries = await store.forCentre(id);
    } catch (e) {
      toast(e.message);
    }
  }
  renderDetail(false);
}

function myEntry(kind, target = "") {
  return state.entries.find((e) => e.kind === kind && e.voter_id === me && e.target === target);
}

function renderDetail(loading) {
  const c = state.current;
  const s = state.stats.get(c.id);
  const tabs = [["avis", "⭐ Avis"], ["activites", "🎨 Activités"], ["evenements", "📣 Événements"]];
  $("#detail").innerHTML = `
    <div class="detail-head">
      <button type="button" class="ghost back" id="close">← Retour</button>
      ${c.photo ? `<img class="photo" src="${esc(c.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <h2>${esc(c.nom)}</h2>
      <p class="muted">${typeLabel(c.type)} · ${esc(c.adresse)}, ${esc(c.cp)} Paris</p>
      <p class="score">${s ? `${stars(s.avg)} <strong>${s.avg.toFixed(1)}</strong>/5 · ${s.n} avis` : "Pas encore d'avis — soyez le premier !"}</p>
      <p class="links">
        ${c.tel ? `<a href="tel:${esc(c.tel.replace(/\s/g, ""))}">📞 ${esc(c.tel)}</a>` : ""}
        <a href="${esc(c.url)}" target="_blank" rel="noopener">Fiche paris.fr ↗</a>
      </p>
    </div>
    <nav class="tabs" role="tablist">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" class="tab ${state.tab === k ? "active" : ""}" data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`).join("")}
    </nav>
    <div class="tab-body">${loading ? `<p class="muted">Chargement…</p>` : renderTab()}</div>`;
}

function renderTab() {
  if (state.tab === "activites") return renderActivities();
  if (state.tab === "evenements") return renderEvents();
  return renderReviews();
}

function starInput(name, value, required) {
  return `<span class="star-input" role="radiogroup">
    ${[5, 4, 3, 2, 1].map((n) => `<label title="${n} étoile${n > 1 ? "s" : ""}"><input type="radio" name="${name}" value="${n}" ${Number(value) === n ? "checked" : ""} ${required ? "required" : ""}><span>★</span></label>`).join("")}
  </span>`;
}

function renderReviews() {
  const reviews = state.entries.filter((e) => e.kind === "review" && e.payload?.note);
  const mine = myEntry("review");
  const p = mine?.payload || {};
  const avgCrit = CRITERES.map(([k, l]) => {
    const vals = reviews.map((r) => Number(r.payload[k])).filter(Boolean);
    if (!vals.length) return "";
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return `<div class="crit"><span>${l}</span><span class="bar"><span style="width:${avg / 5 * 100}%"></span></span><span class="small">${avg.toFixed(1)}</span></div>`;
  }).join("");

  return `
    ${avgCrit ? `<div class="card"><h3>Note par critère</h3>${avgCrit}</div>` : ""}
    <form class="card form" id="review-form">
      <h3>${mine ? "Modifier mon avis" : "Donner mon avis"}</h3>
      <div class="field"><span>Note globale *</span>${starInput("note", p.note, true)}</div>
      <details ${CRITERES.some(([k]) => p[k]) ? "open" : ""}><summary>Noter par critère (facultatif)</summary>
        ${CRITERES.map(([k, l]) => `<div class="field"><span>${l}</span>${starInput(k, p[k], false)}</div>`).join("")}
      </details>
      <label class="field"><span>Fréquentation</span>
        <select name="periode">${Object.entries(PERIODES).map(([k, l]) => `<option value="${k}" ${p.periode === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field col"><span>Commentaire</span>
        <textarea name="commentaire" maxlength="600" rows="3" placeholder="Ce qui vous plaît, ce qui pourrait être amélioré…">${esc(p.commentaire)}</textarea>
      </label>
      <button class="primary" type="submit">${mine ? "Mettre à jour" : "Publier mon avis"}</button>
    </form>
    <h3 class="section">${reviews.length} avis</h3>
    ${reviews.length ? reviews.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => `
      <article class="card review">
        <div>${stars(Number(r.payload.note))} <span class="small muted">${fmtDate(r.created_at)}${r.payload.periode ? " · " + PERIODES[r.payload.periode] : ""}${r.voter_id === me ? " · <strong>mon avis</strong>" : ""}</span></div>
        ${r.payload.commentaire ? `<p>${esc(r.payload.commentaire)}</p>` : ""}
      </article>`).join("") : `<p class="muted">Aucun avis pour l'instant.</p>`}`;
}

function voteCount(target) {
  const votes = state.entries.filter((e) => e.kind === "vote" && e.target === target);
  return {
    up: votes.filter((v) => v.payload.value === 1).length,
    down: votes.filter((v) => v.payload.value === -1).length,
    mine: votes.find((v) => v.voter_id === me)?.payload.value || 0,
  };
}

function renderActivities() {
  const acts = state.entries.filter((e) => e.kind === "activity")
    .map((a) => ({ ...a, v: voteCount(a.target) }))
    .sort((a, b) => (b.v.up - b.v.down) - (a.v.up - a.v.down) || b.created_at.localeCompare(a.created_at));
  return `
    <p class="muted">Proposez une activité vécue au centre ou que vous aimeriez voir, et votez pour celles des autres.</p>
    ${acts.length ? acts.map((a) => `
      <article class="card act">
        <div class="act-body">
          <strong>${esc(a.payload.titre)}</strong>
          ${a.payload.date ? `<span class="small muted"> · ${fmtDate(a.payload.date)}</span>` : ""}
          ${a.payload.description ? `<p>${esc(a.payload.description)}</p>` : ""}
        </div>
        <div class="votes">
          <button type="button" class="vote ${a.v.mine === 1 ? "on" : ""}" data-vote="1" data-target="${esc(a.target)}" aria-label="J'aime">👍 ${a.v.up}</button>
          <button type="button" class="vote ${a.v.mine === -1 ? "on" : ""}" data-vote="-1" data-target="${esc(a.target)}" aria-label="Je n'aime pas">👎 ${a.v.down}</button>
        </div>
      </article>`).join("") : `<p class="muted">Aucune activité proposée pour l'instant.</p>`}
    <form class="card form" id="activity-form">
      <h3>Proposer une activité</h3>
      <label class="field col"><span>Activité *</span><input name="titre" required maxlength="80" placeholder="Ex. : Sortie au Jardin des Plantes"></label>
      <label class="field col"><span>Date (si déjà faite)</span><input type="date" name="date" max="${today()}"></label>
      <label class="field col"><span>Détails</span><textarea name="description" maxlength="400" rows="2"></textarea></label>
      <button class="primary" type="submit">Proposer</button>
    </form>`;
}

function renderEvents() {
  const evs = state.entries.filter((e) => e.kind === "event")
    .sort((a, b) => (b.payload.date || "").localeCompare(a.payload.date || "") || b.created_at.localeCompare(a.created_at));
  return `
    <p class="muted">Il s'est passé quelque chose ? Partagez-le avec les autres parents.</p>
    <form class="card form" id="event-form">
      <h3>Signaler un événement</h3>
      <div class="kinds">${Object.entries(EVENT_KINDS).map(([k, v], i) => `<label class="chip"><input type="radio" name="type" value="${k}" ${i === 0 ? "checked" : ""}><span>${v.icon} ${v.label}</span></label>`).join("")}</div>
      <label class="field col"><span>Date</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
      <label class="field col"><span>Que s'est-il passé ? *</span><textarea name="texte" required maxlength="500" rows="3" placeholder="Ex. : Spectacle de fin de session génial !"></textarea></label>
      <button class="primary" type="submit">Publier</button>
    </form>
    ${evs.length ? evs.map((e) => {
      const k = EVENT_KINDS[e.payload.type] || EVENT_KINDS.info;
      const v = voteCount(e.target);
      return `<article class="card event ev-${esc(e.payload.type)}">
        <div><span class="badge">${k.icon} ${k.label}</span> <span class="small muted">${fmtDate(e.payload.date)}</span></div>
        <p>${esc(e.payload.texte)}</p>
        <button type="button" class="vote ${v.mine === 1 ? "on" : ""}" data-vote="1" data-target="${esc(e.target)}">🙋 Moi aussi · ${v.up}</button>
      </article>`;
    }).join("") : `<p class="muted">Aucun événement signalé.</p>`}`;
}

async function save(kind, payload, target = "") {
  const entry = { centre_id: state.current.id, kind, voter_id: me, target, payload };
  const row = await store.save(entry);
  state.entries = state.entries.filter((e) => !(e.kind === kind && e.voter_id === me && e.target === target));
  state.entries.push(row || { ...entry, created_at: new Date().toISOString() });
}

// ---------- interactions ----------
function bindUi() {
  ["search", "arr", "type"].forEach((id) => $("#" + id).addEventListener("input", () => { shown = PAGE; renderList(); paintMarkers(); }));
  $("#sort").addEventListener("change", (e) => {
    if (e.target.value === "near" && !state.position) {
      if (!navigator.geolocation) return toast("Géolocalisation indisponible");
      navigator.geolocation.getCurrentPosition(
        (p) => {
          state.position = { lat: p.coords.latitude, lon: p.coords.longitude };
          map?.setView([state.position.lat, state.position.lon], 15);
          renderList();
        },
        () => { toast("Position refusée"); e.target.value = "arr"; renderList(); },
      );
    }
    shown = PAGE;
    renderList();
  });
  $("#list").addEventListener("click", (e) => {
    if (e.target.closest("#more")) { shown += PAGE; renderList(); return; }
    const item = e.target.closest(".item");
    if (item) openCentre(item.dataset.id);
  });
  $("#about-btn").addEventListener("click", () => $("#about").showModal());
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.current && !$("#about").open) closeDetail(); });

  const detail = $("#detail");
  detail.addEventListener("click", async (e) => {
    if (e.target.closest("#close")) return closeDetail();
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; history.replaceState("", "", `#/centre/${state.current.id}/${state.tab}`); return renderDetail(false); }
    const vote = e.target.closest("[data-vote]");
    if (vote) {
      const value = Number(vote.dataset.vote);
      const current = voteCount(vote.dataset.target).mine;
      vote.disabled = true;
      try {
        await save("vote", { value: current === value ? 0 : value }, vote.dataset.target);
        renderDetail(false);
      } catch (err) { toast(err.message); vote.disabled = false; }
    }
  });

  detail.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = Object.fromEntries(new FormData(form));
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (form.id === "review-form") {
        const payload = { note: Number(f.note), periode: f.periode, commentaire: f.commentaire.trim() };
        CRITERES.forEach(([k]) => { if (f[k]) payload[k] = Number(f[k]); });
        await save("review", payload);
        await refreshStats();
        toast("Merci pour votre avis !");
      } else if (form.id === "activity-form") {
        await save("activity", { titre: f.titre.trim(), date: f.date || null, description: f.description.trim() }, newId());
        toast("Activité proposée !");
      } else if (form.id === "event-form") {
        await save("event", { type: f.type, date: f.date, texte: f.texte.trim() }, newId());
        toast("Événement publié !");
      }
      renderDetail(false);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}

init().catch((e) => {
  console.error(e);
  $("#list").innerHTML = `<li class="empty">Erreur de chargement : ${esc(e.message)}</li>`;
});
