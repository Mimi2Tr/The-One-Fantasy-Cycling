
import { DEFAULT_TEAMS } from "./data.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseApp=initializeApp(firebaseConfig);
const db=getDatabase(firebaseApp);
const auth=getAuth(firebaseApp);

let teams=DEFAULT_TEAMS, currentUser=null, hideChosen=false, currentView="riders";
const $=id=>document.getElementById(id), app=$("app");

function isAdmin(){return currentUser?.uid===ADMIN_UID}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1900)}
function clean(value){return String(value??"").trim()}
function marked(value){return ["X","OUI","YES","1","TRUE","VRAI"].includes(clean(value).toUpperCase())}
function safeKey(text){return text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function profileClass(profile){return "profile-"+safeKey(profile)}


function numericPoints(value){
  if(value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function numericStage(value){
  if(value === "" || value === null || value === undefined) return null;
  const stage = Number(String(value).replace(",", "."));
  return Number.isFinite(stage) ? stage : null;
}

function riderInitials(firstName){
  const initials = clean(firstName)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase())
    .join(".");
  return initials ? `${initials}.` : "";
}

function compareRankingEntries(a,b){
  return a.total - b.total ||
    a.bestStageScore - b.bestStageScore ||
    b.stageWins - a.stageWins ||
    a.player.localeCompare(b.player, "fr", {sensitivity:"base"});
}

function sameRankingCriteria(a,b){
  return a.total === b.total &&
    a.bestStageScore === b.bestStageScore &&
    a.stageWins === b.stageWins;
}

function getRanking(){
  const startBonus = {
    "mimi": 1,
    "baz": 2,
    "leo": 3,
    "fefe": 4,
    "gael": 5,
    "clem": 7,
    "yo": 10
  };

  const players = new Map();
  const stageScores = new Map();

  Object.entries(startBonus).forEach(([playerKey, bonus]) => {
    players.set(playerKey, {
      player: playerKey.charAt(0).toUpperCase()+playerKey.slice(1),
      total: bonus,
      best:null,
      worst:null,
      stageWins:0,
      bestStageScore:Number.POSITIVE_INFINITY
    });
  });

  teams.flatMap(team => team.riders).forEach(rider => {
    const player = clean(rider.par);
    const points = numericPoints(rider.points);
    const stage = numericStage(rider.etape);

    if(!rider.choisi || !player || points === null) return;

    const playerKey = safeKey(player);
    if(!players.has(playerKey)){
      players.set(playerKey, {
        player,
        total: startBonus[playerKey] || 0,
        best:null,
        worst:null,
        stageWins:0,
        bestStageScore:Number.POSITIVE_INFINITY
      });
    }

    const entry = players.get(playerKey);
    entry.player = player;
    entry.total += points;

    const choice = {
      points,
      nom:clean(rider.nom).toUpperCase(),
      prenom:clean(rider.prenom),
      stage
    };

    if(entry.best === null || points < entry.best.points){
      entry.best = choice;
    }

    if(entry.worst === null || points > entry.worst.points){
      entry.worst = choice;
    }

    if(stage !== null){
      if(!stageScores.has(stage)) stageScores.set(stage,new Map());
      const scores = stageScores.get(stage);
      scores.set(playerKey,(scores.get(playerKey) || 0) + points);
    }
  });

  stageScores.forEach(scores => {
    const values = [...scores.values()];
    if(!values.length) return;
    const stageBest = Math.min(...values);

    scores.forEach((score,playerKey) => {
      const entry = players.get(playerKey);
      if(!entry) return;
      entry.bestStageScore = Math.min(entry.bestStageScore,score);
      if(score === stageBest) entry.stageWins += 1;
    });
  });

  const ranking = [...players.values()]
    .map(entry => ({
      ...entry,
      bestStageScore:Number.isFinite(entry.bestStageScore)
        ? entry.bestStageScore
        : Number.POSITIVE_INFINITY
    }))
    .sort(compareRankingEntries);

  let previous = null;
  ranking.forEach((entry,index) => {
    entry.rank = previous && sameRankingCriteria(entry,previous)
      ? previous.rank
      : index + 1;
    previous = entry;
  });

  return ranking;
}

function formatChoice(choice){
  if(!choice) return "—";
  const stage = choice.stage !== null ? ` ; étape ${choice.stage}` : "";
  const identity = `${choice.nom} ${riderInitials(choice.prenom)}`.trim();
  return `${choice.points} pts (${identity}${stage})`;
}

function getLatestStage(){
  const stages = teams
    .flatMap(team => team.riders)
    .map(rider => numericStage(rider.etape))
    .filter(stage => stage !== null);
  return stages.length ? Math.max(...stages) : null;
}

function renderRanking(){
  const ranking = getRanking();
  const container = $("rankingTable");
  const latestStage = getLatestStage();

  $("rankingTitle").textContent = latestStage === null
    ? "Classement général"
    : `Classement général – après l’étape ${latestStage}`;
  $("rankingMeta").textContent =
    `${ranking.length} joueur${ranking.length>1?"s":""}`;

  if(!ranking.length){
    container.innerHTML = `
      <div class="empty-ranking">
        Le classement apparaîtra dès que les colonnes
        <strong>Choisi</strong>, <strong>Par</strong> et <strong>Points</strong>
        seront renseignées dans l’Excel.
      </div>`;
    return;
  }

  const medal = rank => rank===1 ? "🥇" : rank===2 ? "🥈" : rank===3 ? "🥉" : rank;

  container.innerHTML = `
    <div class="ranking-scroll">
      <table class="ranking-table">
        <thead>
          <tr>
            <th>Rang</th>
            <th>Joueur</th>
            <th class="number">Points</th>
            <th>Meilleur</th>
            <th>Pire</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map(entry => `
            <tr class="${entry.rank===1?"leader-row":""}">
              <td class="rank"><span class="medal">${medal(entry.rank)}</span></td>
              <td class="player">${entry.player}</td>
              <td class="number"><strong>${entry.total}</strong></td>
              <td class="choice-cell">${formatChoice(entry.best)}</td>
              <td class="choice-cell">${formatChoice(entry.worst)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function setView(view){
  currentView=view;
  const riders=view==="riders";
  $("app").classList.toggle("hidden",!riders);
  $("rankingView").classList.toggle("hidden",riders);
  $("ridersTab").classList.toggle("active",riders);
  $("rankingTab").classList.toggle("active",!riders);
  document.querySelector(".controls").classList.toggle("hidden",!riders);
  if(!riders) renderRanking();
}

function render(){
  const query=$("search").value.trim().toLowerCase();
  const filter=$("profileFilter").value;
  app.innerHTML="";
  let availableTotal=0, chosenTotal=0, abandonTotal=0;

  teams.forEach(team=>{
    const visible=team.riders.filter(r=>{
      const text=`${team.team} ${r.nom} ${r.prenom}`.toLowerCase();
      return text.includes(query)&&(!filter||r.profil===filter)&&!(hideChosen&&r.choisi);
    });
    if(!visible.length)return;

    const available=team.riders.filter(r=>!r.choisi&&!r.abandon).length;
    availableTotal+=available;
    chosenTotal+=team.riders.filter(r=>r.choisi).length;
    abandonTotal+=team.riders.filter(r=>r.abandon).length;

    const section=document.createElement("section");
    section.className="team";
    section.style.setProperty("--team",team.color);
    section.innerHTML=`<div class="band"></div><div class="team-head"><div class="jersey"></div><div class="team-name">${team.team}</div><div class="count">${available} disponibles</div></div><div class="riders"></div>`;
    const list=section.querySelector(".riders");

    visible.forEach(rider=>{
      const row=document.createElement("div");
      row.className="rider"+(rider.choisi?" chosen":"")+(isAdmin()?" admin-click":"");
      const details=[
        rider.par?`Choisi par ${rider.par}`:"",
        rider.etape!==""?`Étape ${rider.etape}`:"",
        rider.points!==""?`${rider.points} point(s)`:""
      ].filter(Boolean).join(" · ");
      row.title=details;

      row.innerHTML=`
        <span class="rider-name"><strong>${rider.nom}</strong> ${rider.prenom}</span>
        ${rider.abandon?'<span class="abandon">ABANDON</span>':""}
        <span class="profile ${profileClass(rider.profil)}">${rider.profil}</span>`;

      if(isAdmin()){
        row.addEventListener("click",async()=>{
          rider.choisi=!rider.choisi;
          try{
            await set(ref(db,"tour2026/roster"),teams);
            toast(rider.choisi?"Coureur barré":"Coureur réactivé");
          }catch(error){
            rider.choisi=!rider.choisi;
            toast("Modification refusée");
            console.error(error);
          }
        });
      }
      list.appendChild(row);
    });

    app.appendChild(section);
  });

  $("summary").textContent=`${availableTotal} disponibles · ${chosenTotal} choisis · ${abandonTotal} abandons`;
  $("adminState").textContent=isAdmin()?"Mode administrateur":"Consultation";
  $("adminBtn").textContent=isAdmin()?"Se déconnecter":"Administration";
  if(currentView==="ranking") renderRanking();
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin()));
}

onValue(ref(db,"tour2026/roster"),snapshot=>{
  teams=snapshot.exists()?snapshot.val():DEFAULT_TEAMS;
  render();
});

onAuthStateChanged(auth,user=>{currentUser=user;render()});
$("search").addEventListener("input",render);
$("profileFilter").addEventListener("change",render);
$("toggleChosen").addEventListener("click",event=>{
  hideChosen=!hideChosen;
  event.currentTarget.textContent=hideChosen?"Afficher les choisis":"Masquer les choisis";
  render();
});
$("adminBtn").addEventListener("click",async()=>{
  if(isAdmin()){await signOut(auth);toast("Déconnecté")}
  else $("loginDialog").showModal();
});
$("cancelLogin").addEventListener("click",()=>$("loginDialog").close());
$("loginForm").addEventListener("submit",async event=>{
  event.preventDefault();$("loginError").textContent="";
  try{
    const credential=await signInWithEmailAndPassword(auth,$("email").value,$("password").value);
    if(credential.user.uid!==ADMIN_UID){await signOut(auth);throw new Error("Compte non autorisé")}
    $("loginDialog").close();toast("Mode administrateur activé");
  }catch(error){$("loginError").textContent="Connexion impossible.";console.error(error)}
});

$("importBtn").addEventListener("click",()=>$("excelInput").click());

$("excelInput").addEventListener("change",async event=>{
  const file=event.target.files[0];
  if(!file||!isAdmin())return;
  try{
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:"array"});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:""});

    const grouped=[], map=new Map();
    rows.forEach(row=>{
      const teamName=clean(row["Équipe"]||row["Equipe"]);
      const nom=clean(row["Nom"]), prenom=clean(row["Prénom"]||row["Prenom"]);
      const profil=clean(row["Profil"])||"Autre";
      if(!teamName||!nom)return;

      if(!map.has(teamName)){
        const team={team:teamName,color:DEFAULT_TEAMS[map.size]?.color||"#777777",riders:[]};
        map.set(teamName,team);grouped.push(team);
      }

      map.get(teamName).riders.push({
        id:safeKey(`${teamName}-${nom}-${prenom}`),
        nom,prenom,profil,
        choisi:marked(row["Choisi"]),
        abandon:marked(row["Abandon"]),
        par:clean(row["Par"]),
        etape:row["Etape"]??row["Étape"]??"",
        points:row["Points"]??row["Point"]??""
      });
    });

    if(!grouped.length)throw new Error("Aucune ligne reconnue");
    await set(ref(db,"tour2026/roster"),grouped);
    toast(`${grouped.reduce((n,t)=>n+t.riders.length,0)} coureurs importés`);
    event.target.value="";
  }catch(error){
    toast("Import impossible : vérifie les colonnes");
    console.error(error);
  }
});

$("ridersTab").addEventListener("click",()=>setView("riders"));
$("rankingTab").addEventListener("click",()=>setView("ranking"));

setView("riders");
render();
