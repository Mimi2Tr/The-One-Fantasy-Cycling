
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

function getRanking(){
  const players = new Map();

  teams.flatMap(team => team.riders).forEach(rider => {
    const player = clean(rider.par);
    const points = numericPoints(rider.points);

    if(!rider.choisi || !player || points === null) return;

    if(!players.has(player)){
      players.set(player, {
        player,
        total:0,
        choices:0,
        stages:new Set(),
        best:null,
        worst:null
      });
    }

    const entry = players.get(player);
    entry.total += points;
    entry.choices += 1;
    if(rider.etape !== "" && rider.etape !== null && rider.etape !== undefined){
      entry.stages.add(String(rider.etape));
    }
    entry.best = entry.best === null ? points : Math.min(entry.best, points);
    entry.worst = entry.worst === null ? points : Math.max(entry.worst, points);
  });

  return [...players.values()]
    .map(entry => ({
      ...entry,
      average: entry.choices ? entry.total / entry.choices : 0,
      stageCount: entry.stages.size
    }))
    .sort((a,b) =>
      a.total - b.total ||
      a.average - b.average ||
      a.player.localeCompare(b.player, "fr")
    );
}

function renderRanking(){
  const ranking = getRanking();
  const container = $("rankingTable");
  const stages = new Set();

  teams.flatMap(team => team.riders).forEach(rider => {
    if(rider.choisi && clean(rider.par) && rider.etape !== "" && rider.etape !== null){
      stages.add(String(rider.etape));
    }
  });

  $("rankingMeta").textContent =
    `${ranking.length} joueur${ranking.length>1?"s":""} · ${stages.size} étape${stages.size>1?"s":""} comptabilisée${stages.size>1?"s":""}`;

  if(!ranking.length){
    container.innerHTML = `
      <div class="empty-ranking">
        Le classement apparaîtra dès que les colonnes
        <strong>Choisi</strong>, <strong>Par</strong> et <strong>Points</strong>
        seront renseignées dans l’Excel.
      </div>`;
    return;
  }

  const medal = rank => rank===1 ? "1" : rank===2 ? "2" : rank===3 ? "3" : rank;

  container.innerHTML = `
    <table class="ranking-table">
      <thead>
        <tr>
          <th>Rang</th>
          <th>Joueur</th>
          <th class="number">Points</th>
          <th class="number">Choix</th>
          <th class="number">Moyenne</th>
          <th class="number">Meilleur</th>
        </tr>
      </thead>
      <tbody>
        ${ranking.map((entry,index) => `
          <tr class="${index===0?"leader-row":""}">
            <td class="rank"><span class="medal">${medal(index+1)}</span></td>
            <td class="player">${entry.player}</td>
            <td class="number"><strong>${entry.total}</strong></td>
            <td class="number">${entry.choices}</td>
            <td class="number">${entry.average.toFixed(1).replace(".",",")}</td>
            <td class="number">${entry.best}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
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
