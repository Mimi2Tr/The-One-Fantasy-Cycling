import { DEFAULT_TEAMS } from "./data.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseApp=initializeApp(firebaseConfig);
const db=getDatabase(firebaseApp);
const auth=getAuth(firebaseApp);

const START_BONUS={mimi:1,baz:2,leo:3,fefe:4,gael:5,clem:7,yo:10};

let teams=DEFAULT_TEAMS;
let currentUser=null;
let hideChosen=false;
let currentView="riders";
let rankingMode="general";

const $=id=>document.getElementById(id);
const app=$("app");

function isAdmin(){return currentUser?.uid===ADMIN_UID}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1900)}
function clean(value){return String(value??"").trim()}
function marked(value){return ["X","OUI","YES","1","TRUE","VRAI"].includes(clean(value).toUpperCase())}
function safeKey(text){return clean(text).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function profileClass(profile){return "profile-"+safeKey(profile)}
function numericPoints(value){
  if(value===""||value===null||value===undefined)return null;
  const number=Number(String(value).replace(",","."));
  return Number.isFinite(number)?number:null;
}
function numericStage(value){
  if(value===""||value===null||value===undefined)return null;
  const number=Number(String(value).replace(",","."));
  return Number.isFinite(number)?number:null;
}
function riderName(rider){return `${clean(rider.nom)} ${clean(rider.prenom)}`.trim()}
function allRiders(){return teams.flatMap(team=>team.riders||[])}
function playerDisplayName(playerKey){
  const found=allRiders().find(rider=>safeKey(rider.par)===playerKey&&clean(rider.par));
  return found?clean(found.par):playerKey.charAt(0).toUpperCase()+playerKey.slice(1);
}
function getStages(){
  return [...new Set(allRiders()
    .filter(rider=>rider.choisi&&clean(rider.par)&&numericStage(rider.etape)!==null)
    .map(rider=>numericStage(rider.etape)))]
    .sort((a,b)=>a-b);
}
function getChoicesForPlayer(playerKey){
  return allRiders()
    .filter(rider=>rider.choisi&&safeKey(rider.par)===playerKey)
    .map(rider=>({
      rider:riderName(rider),
      stage:numericStage(rider.etape),
      points:numericPoints(rider.points)
    }))
    .sort((a,b)=>(a.stage??999)-(b.stage??999)||a.rider.localeCompare(b.rider,"fr"));
}
function getStageWinCounts(){
  const wins=new Map(Object.keys(START_BONUS).map(key=>[key,0]));
  getStages().forEach(stage=>{
    const entries=allRiders()
      .filter(rider=>rider.choisi&&clean(rider.par)&&numericStage(rider.etape)===stage&&numericPoints(rider.points)!==null)
      .map(rider=>({playerKey:safeKey(rider.par),points:numericPoints(rider.points)}));
    if(!entries.length)return;
    const best=Math.min(...entries.map(entry=>entry.points));
    entries.filter(entry=>entry.points===best).forEach(entry=>{
      wins.set(entry.playerKey,(wins.get(entry.playerKey)||0)+1);
    });
  });
  return wins;
}
function getRanking(){
  const stageWins=getStageWinCounts();
  const players=new Map();

  Object.entries(START_BONUS).forEach(([playerKey,bonus])=>{
    players.set(playerKey,{
      playerKey,
      player:playerDisplayName(playerKey),
      total:bonus,
      choices:[],
      best:null,
      worst:null,
      stageWins:stageWins.get(playerKey)||0
    });
  });

  allRiders().forEach(rider=>{
    const player=clean(rider.par);
    const playerKey=safeKey(player);
    const points=numericPoints(rider.points);
    if(!rider.choisi||!player||points===null)return;

    if(!players.has(playerKey)){
      players.set(playerKey,{
        playerKey,
        player,
        total:0,
        choices:[],
        best:null,
        worst:null,
        stageWins:stageWins.get(playerKey)||0
      });
    }

    const entry=players.get(playerKey);
    const choice={points,rider:riderName(rider),stage:numericStage(rider.etape)};
    entry.total+=points;
    entry.choices.push(choice);
    if(entry.best===null||points<entry.best.points)entry.best=choice;
    if(entry.worst===null||points>entry.worst.points)entry.worst=choice;
  });

  return [...players.values()].sort((a,b)=>
    a.total-b.total||
    (a.best?.points??Infinity)-(b.best?.points??Infinity)||
    b.stageWins-a.stageWins||
    a.player.localeCompare(b.player,"fr")
  );
}
function getStageRanking(stage){
  const players=new Map();

  Object.keys(START_BONUS).forEach(playerKey=>{
    players.set(playerKey,{
      playerKey,
      player:playerDisplayName(playerKey),
      rider:"—",
      points:null
    });
  });

  allRiders().forEach(rider=>{
    const player=clean(rider.par);
    if(!rider.choisi||!player||numericStage(rider.etape)!==stage)return;
    const playerKey=safeKey(player);
    players.set(playerKey,{
      playerKey,
      player,
      rider:riderName(rider),
      points:numericPoints(rider.points)
    });
  });

  return [...players.values()].sort((a,b)=>{
    if(a.points===null&&b.points!==null)return 1;
    if(a.points!==null&&b.points===null)return -1;
    if(a.points!==null&&b.points!==null&&a.points!==b.points)return a.points-b.points;
    return a.player.localeCompare(b.player,"fr");
  });
}
function formatChoice(choice){
  if(!choice)return "—";
  const stage=choice.stage!==null?` ; étape ${choice.stage}`:"";
  return `${choice.points} pt${choice.points>1?"s":""} (${choice.rider}${stage})`;
}
function medal(rank,total){
  if(rank===1)return "🥇";
  if(rank===2)return "🥈";
  if(rank===3)return "🥉";
  if(rank===total)return "💩";
  return rank;
}
function populateRankingModes(){
  const select=$("rankingMode");
  const previous=rankingMode;
  select.innerHTML='<option value="general">Classement général</option>'+
    getStages().map(stage=>`<option value="stage-${stage}">Étape ${stage}</option>`).join("");
  const valid=[...select.options].some(option=>option.value===previous);
  rankingMode=valid?previous:"general";
  select.value=rankingMode;
}
function renderGeneralRanking(){
  const ranking=getRanking();
  const stages=getStages();
  const latest=stages.length?Math.max(...stages):null;

  $("rankingTitle").textContent=latest!==null?`Classement général – après l'étape ${latest}`:"Classement général";
  $("rankingSubtitle").textContent="Le plus petit total de points est en tête.";
  $("rankingMeta").textContent=`${ranking.length} joueurs · ${stages.length} étape${stages.length>1?"s":""} comptabilisée${stages.length>1?"s":""}`;

  $("rankingTable").innerHTML=`
    <table class="ranking-table general-table">
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
        ${ranking.map((entry,index)=>`
          <tr class="${index===0?"leader-row ":""}clickable-player" data-player="${entry.playerKey}" tabindex="0">
            <td class="rank"><span class="medal">${medal(index+1,ranking.length)}</span></td>
            <td class="player">${entry.player}</td>
            <td class="number"><strong>${entry.total}</strong></td>
            <td>${formatChoice(entry.best)}</td>
            <td>${formatChoice(entry.worst)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  bindPlayerRows();
}
function renderStageRanking(stage){
  const ranking=getStageRanking(stage);
  const completed=ranking.filter(entry=>entry.points!==null).length;

  $("rankingTitle").textContent=`Classement de l'étape ${stage}`;
  $("rankingSubtitle").textContent="Le coureur ayant marqué le moins de points remporte l'étape.";
  $("rankingMeta").textContent=`${completed}/${ranking.length} résultat${completed>1?"s":""} renseigné${completed>1?"s":""}`;

  $("rankingTable").innerHTML=`
    <table class="ranking-table stage-table">
      <thead>
        <tr>
          <th>Rang</th>
          <th>Joueur</th>
          <th>Coureur choisi</th>
          <th class="number">Points</th>
        </tr>
      </thead>
      <tbody>
        ${ranking.map((entry,index)=>{
          const rankedBefore=ranking.slice(0,index).filter(item=>item.points!==null).length;
          const rank=entry.points===null?"—":rankedBefore+1;
          return `
          <tr class="${rank===1?"leader-row ":""}clickable-player ${entry.points===null?"pending":""}" data-player="${entry.playerKey}" tabindex="0">
            <td class="rank"><span class="medal">${entry.points===null?"—":medal(rank,completed)}</span></td>
            <td class="player">${entry.player}</td>
            <td>${entry.rider}</td>
            <td class="number"><strong>${entry.points===null?"—":entry.points}</strong></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  bindPlayerRows();
}
function renderRanking(){
  populateRankingModes();
  if(rankingMode==="general"){
    renderGeneralRanking();
    return;
  }
  const stage=Number(rankingMode.replace("stage-",""));
  renderStageRanking(stage);
}
function bindPlayerRows(){
  document.querySelectorAll("[data-player]").forEach(row=>{
    const open=()=>openPlayerDetails(row.dataset.player);
    row.addEventListener("click",open);
    row.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();open()}
    });
  });
}
function openPlayerDetails(playerKey){
  const choices=getChoicesForPlayer(playerKey);
  const rankingEntry=getRanking().find(entry=>entry.playerKey===playerKey);
  const player=rankingEntry?.player||playerDisplayName(playerKey);
  const numericChoices=choices.filter(choice=>choice.points!==null);
  const best=numericChoices.length?Math.min(...numericChoices.map(choice=>choice.points)):null;
  const worst=numericChoices.length?Math.max(...numericChoices.map(choice=>choice.points)):null;
  let cumulative=0;

  $("playerDialogTitle").textContent=player;
  $("playerDialogSummary").textContent=`${choices.length} choix enregistré${choices.length>1?"s":""}`;

  if(!choices.length){
    $("playerDialogContent").innerHTML='<div class="empty-ranking">Aucun choix enregistré pour ce joueur.</div>';
  }else{
    $("playerDialogContent").innerHTML=`
      <table class="player-table">
        <thead>
          <tr>
            <th>Étape</th>
            <th>Coureur</th>
            <th class="number">Points</th>
            <th class="number">Cumul des choix</th>
          </tr>
        </thead>
        <tbody>
          ${choices.map(choice=>{
            if(choice.points!==null)cumulative+=choice.points;
            const bestClass=choice.points!==null&&choice.points===best?"choice-best":"";
            const worstClass=choice.points!==null&&choice.points===worst&&worst!==best?"choice-worst":"";
            return `<tr class="${bestClass} ${worstClass}">
              <td>${choice.stage??"—"}</td>
              <td>${choice.rider}</td>
              <td class="number">${choice.points??"—"}</td>
              <td class="number">${choice.points===null?"—":cumulative}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <div class="player-total">
        <span>Total au classement</span>
        <span>${rankingEntry?.total??cumulative} pts</span>
      </div>
      <div class="player-legend">Vert : meilleur choix · Rouge : pire choix. Les bonus de départ restent intégrés au classement sans être détaillés.</div>`;
  }

  $("playerDialog").showModal();
}
function setView(view){
  currentView=view;
  const riders=view==="riders";
  $("app").classList.toggle("hidden",!riders);
  $("rankingView").classList.toggle("hidden",riders);
  $("ridersTab").classList.toggle("active",riders);
  $("rankingTab").classList.toggle("active",!riders);
  document.querySelector(".controls").classList.toggle("hidden",!riders);
  if(!riders)renderRanking();
}
function render(){
  const query=$("search").value.trim().toLowerCase();
  const filter=$("profileFilter").value;
  app.innerHTML="";
  let availableTotal=0,chosenTotal=0,abandonTotal=0;

  teams.forEach(team=>{
    const visible=team.riders.filter(rider=>{
      const text=`${team.team} ${rider.nom} ${rider.prenom}`.toLowerCase();
      return text.includes(query)&&(!filter||rider.profil===filter)&&!(hideChosen&&rider.choisi);
    });
    if(!visible.length)return;

    const available=team.riders.filter(rider=>!rider.choisi&&!rider.abandon).length;
    availableTotal+=available;
    chosenTotal+=team.riders.filter(rider=>rider.choisi).length;
    abandonTotal+=team.riders.filter(rider=>rider.abandon).length;

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
  if(currentView==="ranking")renderRanking();
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
  event.preventDefault();
  $("loginError").textContent="";
  try{
    const credential=await signInWithEmailAndPassword(auth,$("email").value,$("password").value);
    if(credential.user.uid!==ADMIN_UID){await signOut(auth);throw new Error("Compte non autorisé")}
    $("loginDialog").close();
    toast("Mode administrateur activé");
  }catch(error){
    $("loginError").textContent="Connexion impossible.";
    console.error(error);
  }
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

    const grouped=[],map=new Map();
    rows.forEach(row=>{
      const teamName=clean(row["Équipe"]||row["Equipe"]);
      const nom=clean(row["Nom"]);
      const prenom=clean(row["Prénom"]||row["Prenom"]);
      const profil=clean(row["Profil"])||"Autre";
      if(!teamName||!nom)return;

      if(!map.has(teamName)){
        const team={team:teamName,color:DEFAULT_TEAMS[map.size]?.color||"#777777",riders:[]};
        map.set(teamName,team);
        grouped.push(team);
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
    toast(`${grouped.reduce((number,team)=>number+team.riders.length,0)} coureurs importés`);
    event.target.value="";
  }catch(error){
    toast("Import impossible : vérifie les colonnes");
    console.error(error);
  }
});

$("ridersTab").addEventListener("click",()=>setView("riders"));
$("rankingTab").addEventListener("click",()=>setView("ranking"));
$("rankingMode").addEventListener("change",event=>{
  rankingMode=event.target.value;
  renderRanking();
});
$("closePlayerDialog").addEventListener("click",()=>$("playerDialog").close());
$("playerDialog").addEventListener("click",event=>{
  if(event.target===$("playerDialog"))$("playerDialog").close();
});

setView("riders");
render();
