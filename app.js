import { DEFAULT_TEAMS } from "./data.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getDatabase, ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

let teams = DEFAULT_TEAMS;
let selected = {};
let currentUser = null;
let hideExcluded = false;

const $ = id => document.getElementById(id);
const app = $("app");

function isAdmin() {
  return currentUser?.uid === ADMIN_UID;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function safeKey(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function profileClass(profile) {
  return "profile-" + safeKey(profile);
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("profileFilter").value;
  app.innerHTML = "";

  let totalAvailable = 0;
  let totalUsed = 0;

  teams.forEach(team => {
    const visible = team.riders.filter(rider => {
      const matchesText = `${team.team} ${rider.nom} ${rider.prenom}`.toLowerCase().includes(query);
      const matchesProfile = !filter || rider.profil === filter;
      const matchesExcluded = !(hideExcluded && rider.excluded);
      return matchesText && matchesProfile && matchesExcluded;
    });

    if (!visible.length) return;

    const available = team.riders.filter(r => !r.excluded && !selected[r.id]).length;
    totalAvailable += available;
    totalUsed += team.riders.filter(r => selected[r.id]).length;

    const section = document.createElement("section");
    section.className = "team";
    section.style.setProperty("--team", team.color);
    section.innerHTML = `
      <div class="band"></div>
      <div class="team-head">
        <div class="jersey"></div>
        <div class="team-name">${team.team}</div>
        <div class="count">${available} disponibles</div>
      </div>
      <div class="riders"></div>`;

    const list = section.querySelector(".riders");

    visible.forEach(rider => {
      const used = Boolean(selected[rider.id]);
      const crossed = rider.excluded || used;
      const row = document.createElement("div");
      row.className = "rider" + (crossed ? " crossed" : "") + (isAdmin() && !rider.excluded ? " admin-click" : "");

      row.innerHTML = `
        <span class="hospital">${rider.hospital ? "+" : ""}</span>
        <span class="rider-name"><strong>${rider.nom}</strong> ${rider.prenom}</span>
        <span class="profile ${profileClass(rider.profil)}">${rider.profil}</span>`;

      if (isAdmin() && !rider.excluded) {
        row.addEventListener("click", async () => {
          try {
            const target = ref(db, "tour2026/selected/" + rider.id);
            used ? await remove(target) : await set(target, true);
          } catch (error) {
            toast("Modification refusée");
            console.error(error);
          }
        });
      }
      list.appendChild(row);
    });

    section.appendChild(list);
    app.appendChild(section);
  });

  $("summary").textContent =
    `${totalAvailable} coureurs disponibles · ${totalUsed} utilisés pendant le jeu`;

  $("adminState").textContent = isAdmin() ? "Mode administrateur" : "Consultation";
  $("adminBtn").textContent = isAdmin() ? "Se déconnecter" : "Administration";
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
}

onValue(ref(db, "tour2026/selected"), snapshot => {
  selected = snapshot.val() || {};
  render();
});

onValue(ref(db, "tour2026/roster"), snapshot => {
  teams = snapshot.exists() ? snapshot.val() : DEFAULT_TEAMS;
  render();
});

onAuthStateChanged(auth, user => {
  currentUser = user;
  render();
});

$("search").addEventListener("input", render);
$("profileFilter").addEventListener("change", render);

$("toggleExcluded").addEventListener("click", event => {
  hideExcluded = !hideExcluded;
  event.currentTarget.textContent = hideExcluded ? "Afficher les retirés" : "Masquer les retirés";
  render();
});

$("adminBtn").addEventListener("click", async () => {
  if (isAdmin()) {
    await signOut(auth);
    toast("Déconnecté");
  } else {
    $("loginDialog").showModal();
  }
});

$("cancelLogin").addEventListener("click", () => $("loginDialog").close());

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";
  try {
    const credential = await signInWithEmailAndPassword(auth, $("email").value, $("password").value);
    if (credential.user.uid !== ADMIN_UID) {
      await signOut(auth);
      throw new Error("Compte non autorisé");
    }
    $("loginDialog").close();
    toast("Mode administrateur activé");
  } catch (error) {
    $("loginError").textContent = "Connexion impossible.";
    console.error(error);
  }
});

$("importBtn").addEventListener("click", () => $("excelInput").click());

$("excelInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file || !isAdmin()) return;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const grouped = [];
    const map = new Map();

    rows.forEach(row => {
      const teamName = String(row["Équipe"] || row["Equipe"] || "").trim();
      const nom = String(row["Nom"] || "").trim();
      const prenom = String(row["Prénom"] || row["Prenom"] || "").trim();
      const profil = String(row["Profil"] || "Autre").trim();
      if (!teamName || !nom) return;

      if (!map.has(teamName)) {
        const team = {
          team: teamName,
          color: DEFAULT_TEAMS[map.size]?.color || "#777777",
          riders: []
        };
        map.set(teamName, team);
        grouped.push(team);
      }

      const oldRider = DEFAULT_TEAMS.flatMap(t => t.riders)
        .find(r => r.nom === nom && r.prenom === prenom);

      map.get(teamName).riders.push({
        id: safeKey(`${teamName}-${nom}-${prenom}`),
        nom, prenom, profil,
        excluded: oldRider?.excluded || false,
        hospital: oldRider?.hospital || false
      });
    });

    if (!grouped.length) throw new Error("Aucune donnée reconnue");
    await set(ref(db, "tour2026/roster"), grouped);
    toast("Liste Excel importée");
    event.target.value = "";
  } catch (error) {
    toast("Import impossible");
    console.error(error);
  }
});

render();
