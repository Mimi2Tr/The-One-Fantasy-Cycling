import { DEFAULT_TEAMS } from "./data.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, runTransaction } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseApp=initializeApp(firebaseConfig);
const db=getDatabase(firebaseApp);
const auth=getAuth(firebaseApp);

const START_BONUS={mimi:1,baz:2,leo:3,fefe:4,gael:5,clem:7,yo:10};
const PLAYER_KEYS=Object.keys(START_BONUS);

let teams=DEFAULT_TEAMS;
let game=null;
let currentUser=null;
let hideUnavailable=false;
let currentView="riders";
let rankingMode="general";
let choiceMode=false;
let selectedRider=null;
let adminRider=null;

const $=id=>document.getElementById(id);
const app=$("app");

function isAdmin(){return currentUser?.uid===ADMIN_UID}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
function clean(value){return String(value??"").trim()}
function marked(value){return ["X","OUI","YES","1","TRUE","VRAI"].includes(clean(value).toUpperCase())}
function safeKey(text){return clean(text).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function profileClass(profile){return "profile-"+safeKey(profile)}
function numericPoints(value){if(value===""||value===null||value===undefined)return null;const n=Number(String(value).replace(",","."));return Number.isFinite(n)?n:null}
function numericStage(value){if(value===""||value===null||value===undefined)return null;const n=Number(String(value).replace(",","."));return Number.isFinite(n)?n:null}
function riderName(rider){return `${clean(rider.nom)} ${clean(rider.prenom)}`.trim()}
function allRiders(){return teams.flatMap(team=>(team.riders||[]).map(rider=>({...rider,team:team.team})))}
function playerDisplayName(playerKey){const found=allRiders().find(r=>safeKey(r.par)===playerKey&&clean(r.par));return found?clean(found.par):playerKey.charAt(0).toUpperCase()+playerKey.slice(1)}
function currentPlayerKey(){return game?.phase==="selection"&&Array.isArray(game.order)?game.order[game.turnIndex||0]||null:null}
function currentPlayerName(){const key=currentPlayerKey();return key?playerDisplayName(key):""}
function gamePicks(){return game?.picks||{}}
function pickedRiderIds(){return new Set(Object.values(gamePicks()).map(p=>p?.riderId).filter(Boolean))}
function isUnavailable(rider){return !!rider.choisi||!!rider.abandon||pickedRiderIds().has(rider.id)}
function getStages(){
  return [...new Set(allRiders().filter(r=>r.choisi&&clean(r.par)&&numericStage(r.etape)!==null).map(r=>numericStage(r.etape)))].sort((a,b)=>a-b);
}
function getChoicesForPlayer(playerKey){
  return allRiders().filter(r=>r.choisi&&safeKey(r.par)===playerKey).map(r=>({rider:riderName(r),stage:numericStage(r.etape),points:numericPoints(r.points)})).sort((a,b)=>(a.stage??999)-(b.stage??999)||a.rider.localeCompare(b.rider,"fr"));
}
function getStageWinCounts(){
  const wins=new Map(PLAYER_KEYS.map(k=>[k,0]));
  getStages().forEach(stage=>{
    const entries=allRiders().filter(r=>r.choisi&&clean(r.par)&&numericStage(r.etape)===stage&&numericPoints(r.points)!==null).map(r=>({playerKey:safeKey(r.par),points:numericPoints(r.points)}));
    if(!entries.length)return;
    const best=Math.min(...entries.map(e=>e.points));
    entries.filter(e=>e.points===best).forEach(e=>wins.set(e.playerKey,(wins.get(e.playerKey)||0)+1));
  });
  return wins;
}
function getRanking(){
  const stageWins=getStageWinCounts(),players=new Map();
  Object.entries(START_BONUS).forEach(([playerKey,bonus])=>players.set(playerKey,{playerKey,player:playerDisplayName(playerKey),total:bonus,choices:[],best:null,worst:null,stageWins:stageWins.get(playerKey)||0}));
  allRiders().forEach(r=>{
    const player=clean(r.par),key=safeKey(player),points=numericPoints(r.points);
    if(!r.choisi||!player||points===null)return;
    if(!players.has(key))players.set(key,{playerKey:key,player,total:0,choices:[],best:null,worst:null,stageWins:stageWins.get(key)||0});
    const e=players.get(key),choice={points,rider:riderName(r),stage:numericStage(r.etape)};
    e.total+=points;e.choices.push(choice);
    if(e.best===null||points<e.best.points)e.best=choice;
    if(e.worst===null||points>e.worst.points)e.worst=choice;
  });
  return [...players.values()].sort((a,b)=>a.total-b.total||(a.best?.points??Infinity)-(b.best?.points??Infinity)||b.stageWins-a.stageWins||a.player.localeCompare(b.player,"fr"));
}
function inverseOrder(){return getRanking().slice().reverse().map(e=>e.playerKey)}
function getStageRanking(stage){
  const players=new Map();
  PLAYER_KEYS.forEach(k=>players.set(k,{playerKey:k,player:playerDisplayName(k),rider:"—",points:null}));
  allRiders().forEach(r=>{
    const player=clean(r.par);if(!r.choisi||!player||numericStage(r.etape)!==stage)return;
    players.set(safeKey(player),{playerKey:safeKey(player),player,rider:riderName(r),points:numericPoints(r.points)});
  });
  return [...players.values()].sort((a,b)=>a.points===null&&b.points!==null?1:a.points!==null&&b.points===null?-1:a.points!==null&&b.points!==null&&a.points!==b.points?a.points-b.points:a.player.localeCompare(b.player,"fr"));
}
function formatChoice(c){if(!c)return"—";return`${c.points} pt${c.points>1?"s":""} (${c.rider}${c.stage!==null?` ; étape ${c.stage}`:""})`}
function medal(rank,total){if(rank===1)return"🥇";if(rank===2)return"🥈";if(rank===3)return"🥉";if(rank===total)return"💩";return rank}

function renderGameBanner(){
  const banner=$("gameBanner"),button=$("playerChoiceBtn");
  if(!game){banner.classList.add("hidden");button.classList.add("hidden");return}
  banner.classList.remove("hidden");
  if(game.phase==="selection"){
    const done=Object.keys(gamePicks()).length;
    banner.innerHTML=`<strong>Étape ${game.currentStage} — C’est au tour de ${currentPlayerName()}</strong><span>${done}/7 choix enregistrés.</span>`;
    button.classList.remove("hidden");
    button.textContent=`Choix de ${currentPlayerName()}`;
  }else if(game.phase==="results"){
    banner.innerHTML=`<strong>Étape ${game.currentStage} — Tous les choix sont enregistrés</strong><span>En attente de la saisie des résultats par l’administrateur.</span>`;
    button.classList.add("hidden");
  }else{
    banner.innerHTML=`<strong>Tour terminé</strong><span>Le classement général est définitif après l’étape 21.</span>`;
    button.classList.add("hidden");
  }
}

function populateRankingModes(){
  const select=$("rankingMode"),previous=rankingMode;
  select.innerHTML='<option value="general">Classement général</option>'+getStages().map(s=>`<option value="stage-${s}">Étape ${s}</option>`).join("");
  rankingMode=[...select.options].some(o=>o.value===previous)?previous:"general";select.value=rankingMode;
}
function renderGeneralRanking(){
  const ranking=getRanking(),stages=getStages(),latest=stages.length?Math.max(...stages):null;
  $("rankingTitle").textContent=latest!==null?`Classement général – après l'étape ${latest}`:"Classement général";
  $("rankingSubtitle").textContent="Le plus petit total de points est en tête.";
  $("rankingMeta").textContent=`${ranking.length} joueurs · ${stages.length} étape${stages.length>1?"s":""} comptabilisée${stages.length>1?"s":""}`;
  $("rankingTable").innerHTML=`<table class="ranking-table general-table"><thead><tr><th>Rang</th><th>Joueur</th><th class="number">Points</th><th>Meilleur</th><th>Pire</th></tr></thead><tbody>${ranking.map((e,i)=>`<tr class="${i===0?"leader-row ":""}clickable-player" data-player="${e.playerKey}" tabindex="0"><td class="rank"><span class="medal">${medal(i+1,ranking.length)}</span></td><td class="player">${e.player}</td><td class="number"><strong>${e.total}</strong></td><td>${formatChoice(e.best)}</td><td>${formatChoice(e.worst)}</td></tr>`).join("")}</tbody></table>`;
  bindPlayerRows();
}
function renderStageRanking(stage){
  const ranking=getStageRanking(stage),completed=ranking.filter(e=>e.points!==null).length;
  $("rankingTitle").textContent=`Classement de l'étape ${stage}`;$("rankingSubtitle").textContent="Le coureur ayant marqué le moins de points remporte l’étape.";$("rankingMeta").textContent=`${completed}/${ranking.length} résultats renseignés`;
  $("rankingTable").innerHTML=`<table class="ranking-table"><thead><tr><th>Rang</th><th>Joueur</th><th>Coureur choisi</th><th class="number">Points</th></tr></thead><tbody>${ranking.map((e,i)=>{const r=e.points===null?"—":ranking.slice(0,i).filter(x=>x.points!==null).length+1;return`<tr class="${r===1?"leader-row ":""}clickable-player ${e.points===null?"pending":""}" data-player="${e.playerKey}" tabindex="0"><td class="rank"><span class="medal">${e.points===null?"—":medal(r,completed)}</span></td><td class="player">${e.player}</td><td>${e.rider}</td><td class="number"><strong>${e.points??"—"}</strong></td></tr>`}).join("")}</tbody></table>`;bindPlayerRows();
}
function renderRanking(){populateRankingModes();rankingMode==="general"?renderGeneralRanking():renderStageRanking(Number(rankingMode.replace("stage-","")))}

function bindPlayerRows(){document.querySelectorAll("[data-player]").forEach(row=>{const open=()=>openPlayerDetails(row.dataset.player);row.onclick=open;row.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}}})}
function openPlayerDetails(key){
  const choices=getChoicesForPlayer(key),entry=getRanking().find(e=>e.playerKey===key),numeric=choices.filter(c=>c.points!==null),best=numeric.length?Math.min(...numeric.map(c=>c.points)):null,worst=numeric.length?Math.max(...numeric.map(c=>c.points)):null;let cumulative=0;
  $("playerDialogTitle").textContent=entry?.player||playerDisplayName(key);$("playerDialogSummary").textContent=`${choices.length} choix enregistré${choices.length>1?"s":""}`;
  $("playerDialogContent").innerHTML=!choices.length?'<div class="empty-ranking">Aucun choix enregistré.</div>':`<table class="player-table"><thead><tr><th>Étape</th><th>Coureur</th><th class="number">Points</th><th class="number">Cumul</th></tr></thead><tbody>${choices.map(c=>{if(c.points!==null)cumulative+=c.points;return`<tr class="${c.points===best?"choice-best":""} ${c.points===worst&&worst!==best?"choice-worst":""}"><td>${c.stage??"—"}</td><td>${c.rider}</td><td class="number">${c.points??"—"}</td><td class="number">${c.points===null?"—":cumulative}</td></tr>`}).join("")}</tbody></table><div class="player-total"><span>Total au classement</span><span>${entry?.total??cumulative} pts</span></div><div class="player-legend">Vert : meilleur choix · Rouge : pire choix. Les bonus restent cachés.</div>`;
  $("playerDialog").showModal();
}

function render(){
  renderGameBanner();
  const query=$("search").value.trim().toLowerCase(),filter=$("profileFilter").value;
  app.innerHTML="";let availableTotal=0,chosenTotal=0,abandonTotal=0;
  teams.forEach(team=>{
    const visible=team.riders.filter(r=>{const text=`${team.team} ${r.nom} ${r.prenom}`.toLowerCase();return text.includes(query)&&(!filter||r.profil===filter)&&!(hideUnavailable&&isUnavailable(r))});
    if(!visible.length)return;
    const available=team.riders.filter(r=>!isUnavailable(r)).length;
    availableTotal+=available;chosenTotal+=team.riders.filter(r=>r.choisi||pickedRiderIds().has(r.id)).length;abandonTotal+=team.riders.filter(r=>r.abandon).length;
    const section=document.createElement("section");section.className="team";section.style.setProperty("--team",team.color);
    section.innerHTML=`<div class="band"></div><div class="team-head"><div class="jersey"></div><div class="team-name">${team.team}</div><div class="count">${available} disponibles</div></div><div class="riders"></div>`;
    const list=section.querySelector(".riders");
    visible.forEach(r=>{
      const unavailable=isUnavailable(r),row=document.createElement("div");
      row.className=`rider${unavailable?" chosen":""}${isAdmin()?" admin-click":""}${choiceMode&&!unavailable?" selectable":""}`;
      row.innerHTML=`<span class="rider-name"><strong>${r.nom}</strong> ${r.prenom}</span>${r.abandon?'<span class="abandon">ABANDON</span>':""}<span class="profile ${profileClass(r.profil)}">${r.profil}</span>`;
      if(choiceMode&&!unavailable)row.onclick=()=>preparePick(r,team.team);
      else if(isAdmin())row.onclick=()=>openAdminRider(r,team.team);
      list.appendChild(row);
    });app.appendChild(section);
  });
  $("summary").textContent=`${availableTotal} disponibles · ${chosenTotal} choisis · ${abandonTotal} abandons`;
  $("adminState").textContent=isAdmin()?"Mode administrateur":"Consultation";$("adminBtn").textContent=isAdmin()?"Se déconnecter":"Administration";
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin()));
  if(currentView==="ranking")renderRanking();
}

function startChoiceFlow(){
  if(game?.phase!=="selection")return;
  $("identityTitle").textContent=`Es-tu bien ${currentPlayerName()} ?`;
  $("identityDialog").showModal();
}
function enterChoiceMode(){
  choiceMode=true;$("identityDialog").close();setView("riders");toast(`Choisis le coureur de ${currentPlayerName()}`);
  window.scrollTo({top:0,behavior:"smooth"});render();
}
function preparePick(rider,teamName){
  selectedRider={...rider,teamName};
  $("confirmPickText").innerHTML=`<strong>${currentPlayerName()}</strong>, confirmes-tu définitivement le choix de <strong>${riderName(rider)}</strong> (${teamName}) pour l’étape ${game.currentStage} ?`;
  $("confirmPickDialog").showModal();
}
async function confirmPick(){
  if(!selectedRider||game?.phase!=="selection")return;
  const expectedPlayer=currentPlayerKey(),rider=selectedRider;
  $("confirmPick").disabled=true;
  try{
    const result=await runTransaction(ref(db,"tour2026/game"),current=>{
      if(!current||current.phase!=="selection")return;
      const order=Array.isArray(current.order)?current.order:Object.values(current.order||{});
      const turn=current.turnIndex||0;
      if(order[turn]!==expectedPlayer)return;
      const picks=current.picks||{};
      if(picks[expectedPlayer])return;
      if(Object.values(picks).some(p=>p?.riderId===rider.id))return;
      picks[expectedPlayer]={playerKey:expectedPlayer,player:playerDisplayName(expectedPlayer),riderId:rider.id,rider:riderName(rider),team:rider.teamName,stage:current.currentStage,createdAt:Date.now()};
      current.picks=picks;
      const nextTurn=turn+1;
      if(nextTurn>=order.length){current.phase="results";current.turnIndex=order.length}
      else current.turnIndex=nextTurn;
      return current;
    });
    if(!result.committed)throw new Error("Choix déjà pris ou tour modifié");
    choiceMode=false;selectedRider=null;$("confirmPickDialog").close();
    toast(game?.phase==="results"?"Tous les choix sont enregistrés":"Choix enregistré");
  }catch(e){toast("Choix impossible : actualise la page");console.error(e)}
  finally{$("confirmPick").disabled=false}
}

function openAdminRider(rider,teamName){
  adminRider={rider,teamName};$("riderAdminTitle").textContent=riderName(rider);
  const inCurrent=Object.entries(gamePicks()).find(([,p])=>p?.riderId===rider.id);
  $("riderAdminStatus").textContent=rider.abandon?"Ce coureur est marqué abandon.":rider.choisi?"Ce coureur a déjà été utilisé.":inCurrent?`Choisi par ${playerDisplayName(inCurrent[0])} pour l’étape ${game.currentStage}.`:"Coureur disponible.";
  $("toggleAbandonBtn").textContent=rider.abandon?"Retirer le statut abandon":"Marquer comme abandon";
  $("toggleAbandonBtn").classList.toggle("hidden",rider.choisi||!!inCurrent);
  $("cancelLastPickBtn").classList.toggle("hidden",!inCurrent||game?.phase!=="selection");
  $("riderAdminDialog").showModal();
}
async function toggleAbandon(){
  if(!adminRider||!isAdmin())return;
  const target=!adminRider.rider.abandon,updated=teams.map(t=>({...t,riders:t.riders.map(r=>r.id===adminRider.rider.id?{...r,abandon:target}:r)}));
  try{await set(ref(db,"tour2026/roster"),updated);$("riderAdminDialog").close();toast(target?"Coureur marqué abandon":"Abandon retiré")}catch(e){toast("Modification impossible");console.error(e)}
}
async function cancelCurrentPick(){
  if(!adminRider||!isAdmin()||game?.phase!=="selection")return;
  const hit=Object.entries(gamePicks()).find(([,p])=>p?.riderId===adminRider.rider.id);if(!hit)return;
  const [playerKey]=hit;
  try{
    await runTransaction(ref(db,"tour2026/game"),current=>{
      if(!current||current.phase!=="selection")return;
      const order=Array.isArray(current.order)?current.order:Object.values(current.order||{});
      const index=order.indexOf(playerKey);if(index<0)return;
      const picks={...(current.picks||{})};delete picks[playerKey];current.picks=picks;current.turnIndex=index;return current;
    });
    $("riderAdminDialog").close();toast("Choix annulé");
  }catch(e){toast("Annulation impossible")}
}

function renderAdminGame(){
  if(!isAdmin())return;
  const content=$("adminGameContent");
  if(!game){
    const next=Math.min(21,(getStages().length?Math.max(...getStages())+1:1));
    $("adminGameSummary").textContent="La gestion automatique n’est pas encore initialisée.";
    content.innerHTML=`<div class="game-admin-card"><h3>Démarrer la V2.0</h3><p>L’ordre initial sera l’inverse du classement actuel. Étape proposée : ${next}.</p><label>Première étape gérée <input id="initialStage" type="number" min="1" max="21" value="${next}"></label><div class="result-actions"><button id="initializeGame" class="primary">Démarrer les sélections</button></div></div>`;
    $("initializeGame").onclick=initializeGame;
  }else if(game.phase==="selection"){
    $("adminGameSummary").textContent=`Étape ${game.currentStage} · sélections en cours`;
    const order=Array.isArray(game.order)?game.order:Object.values(game.order||{});
    content.innerHTML=`<div class="game-admin-card"><h3>Ordre des choix</h3><p>Le dernier du classement choisit en premier.</p><div class="order-list">${order.map((k,i)=>{const pick=gamePicks()[k];return`<div class="order-item ${i===(game.turnIndex||0)?"active":""}"><span class="order-index">${i+1}</span><span class="order-player">${playerDisplayName(k)}</span><span class="order-status">${pick?pick.rider:i===(game.turnIndex||0)?"À son tour":"En attente"}</span></div>`}).join("")}</div><div class="result-actions"><button id="resetStage">Réinitialiser cette sélection</button></div></div>`;
    $("resetStage").onclick=resetCurrentStage;
  }else if(game.phase==="results"){
    $("adminGameSummary").textContent=`Étape ${game.currentStage} · saisie des résultats`;
    const order=Array.isArray(game.order)?game.order:Object.values(game.order||{});
    content.innerHTML=`<div class="game-admin-card"><h3>Points de l’étape</h3><p>Saisis la place obtenue par chaque coureur, puis valide l’étape.</p><table class="result-table"><thead><tr><th>Joueur</th><th>Coureur</th><th class="number">Points</th></tr></thead><tbody>${order.map(k=>{const p=gamePicks()[k];return`<tr><td class="player">${playerDisplayName(k)}</td><td>${p?.rider||"—"}</td><td class="number"><input class="score-input" data-player="${k}" type="number" min="1" step="1" value="${game.scores?.[k]??""}" required></td></tr>`}).join("")}</tbody></table><div class="result-actions"><button id="saveScores">Enregistrer sans valider</button><button id="validateStage" class="primary">Valider définitivement l’étape</button></div></div>`;
    $("saveScores").onclick=()=>saveScores(false);$("validateStage").onclick=()=>saveScores(true);
  }else{
    $("adminGameSummary").textContent="Tour terminé";
    content.innerHTML='<div class="game-admin-card"><h3>Classement final</h3><p>L’étape 21 a été validée. Aucune nouvelle sélection ne sera ouverte.</p></div>';
  }
}
async function initializeGame(){
  const stage=Number($("initialStage").value);if(!Number.isInteger(stage)||stage<1||stage>21)return toast("Numéro d’étape invalide");
  await set(ref(db,"tour2026/game"),{currentStage:stage,phase:"selection",order:inverseOrder(),turnIndex:0,picks:{},createdAt:Date.now()});
  $("adminGameDialog").close();toast(`Sélection de l’étape ${stage} ouverte`);
}
async function resetCurrentStage(){
  if(!confirm("Effacer tous les choix de cette étape et recommencer ?"))return;
  await update(ref(db,"tour2026/game"),{phase:"selection",turnIndex:0,picks:null,scores:null});
  $("adminGameDialog").close();toast("Sélection réinitialisée");
}
function readScores(){
  const scores={};let valid=true;
  document.querySelectorAll(".score-input").forEach(input=>{const value=Number(input.value);if(!Number.isInteger(value)||value<1)valid=false;else scores[input.dataset.player]=value});
  return valid?scores:null;
}
async function saveScores(validate){
  const scores=readScores();if(!scores)return toast("Renseigne un nombre entier positif pour chaque joueur");
  if(!validate){await update(ref(db,"tour2026/game"),{scores});toast("Scores enregistrés");return}
  if(!confirm(`Valider définitivement les résultats de l’étape ${game.currentStage} ?`))return;
  const updatedTeams=structuredClone(teams);
  Object.entries(gamePicks()).forEach(([playerKey,pick])=>{
    for(const team of updatedTeams){
      const rider=team.riders.find(r=>r.id===pick.riderId);
      if(rider){rider.choisi=true;rider.par=playerDisplayName(playerKey);rider.etape=game.currentStage;rider.points=scores[playerKey];break}
    }
  });
  try{
    await set(ref(db,"tour2026/roster"),updatedTeams);
    // Le classement local sera recalculé à partir des données validées.
    teams=updatedTeams;
    if(game.currentStage>=21){
      await set(ref(db,"tour2026/game"),{...game,scores,phase:"finished",validatedAt:Date.now()});
      toast("Étape 21 validée : classement final");
    }else{
      const nextStage=game.currentStage+1;
      await set(ref(db,"tour2026/game"),{currentStage:nextStage,phase:"selection",order:inverseOrder(),turnIndex:0,picks:{},createdAt:Date.now()});
      toast(`Étape validée : sélection de l’étape ${nextStage} ouverte`);
    }
    $("adminGameDialog").close();
  }catch(e){toast("Validation impossible");console.error(e)}
}

function setView(view){currentView=view;const riders=view==="riders";$("app").classList.toggle("hidden",!riders);$("rankingView").classList.toggle("hidden",riders);$("ridersTab").classList.toggle("active",riders);$("rankingTab").classList.toggle("active",!riders);document.querySelector(".controls").classList.toggle("hidden",!riders);if(!riders)renderRanking()}

onValue(ref(db,"tour2026/roster"),snapshot=>{teams=snapshot.exists()?snapshot.val():DEFAULT_TEAMS;render()});
onValue(ref(db,"tour2026/game"),snapshot=>{game=snapshot.exists()?snapshot.val():null;if(game?.order&&!Array.isArray(game.order))game.order=Object.values(game.order);render();if($("adminGameDialog").open)renderAdminGame()});

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){try{await signInAnonymously(auth)}catch(e){console.error("Active l’authentification anonyme dans Firebase",e)}}
  render();
});

$("search").oninput=render;$("profileFilter").onchange=render;
$("toggleChosen").onclick=e=>{hideUnavailable=!hideUnavailable;e.currentTarget.textContent=hideUnavailable?"Afficher les indisponibles":"Masquer les indisponibles";render()};
$("playerChoiceBtn").onclick=startChoiceFlow;
$("identityYes").onclick=enterChoiceMode;
$("identityNo").onclick=()=>{$("identityDialog").close();$("notPlayerMessage").textContent=`Il faut relancer ${currentPlayerName()} pour qu’il choisisse.`;$("notPlayerDialog").showModal()};
$("cancelPick").onclick=()=>{$("confirmPickDialog").close();selectedRider=null};
$("confirmPick").onclick=confirmPick;
$("toggleAbandonBtn").onclick=toggleAbandon;
$("cancelLastPickBtn").onclick=cancelCurrentPick;
$("adminGameBtn").onclick=()=>{renderAdminGame();$("adminGameDialog").showModal()};
document.querySelectorAll("[data-close]").forEach(btn=>btn.onclick=()=>$(btn.dataset.close).close());

$("adminBtn").onclick=async()=>{
  if(isAdmin()){await signOut(auth);await signInAnonymously(auth);toast("Déconnecté")}
  else $("loginDialog").showModal();
};
$("cancelLogin").onclick=()=>$("loginDialog").close();
$("loginForm").onsubmit=async e=>{
  e.preventDefault();$("loginError").textContent="";
  try{const c=await signInWithEmailAndPassword(auth,$("email").value,$("password").value);if(c.user.uid!==ADMIN_UID){await signOut(auth);await signInAnonymously(auth);throw new Error("Compte non autorisé")}$("loginDialog").close();toast("Mode administrateur activé")}
  catch(error){$("loginError").textContent="Connexion impossible.";console.error(error)}
};

$("importBtn").onclick=()=>$("excelInput").click();
$("excelInput").onchange=async e=>{
  const file=e.target.files[0];if(!file||!isAdmin())return;
  try{
    const buffer=await file.arrayBuffer(),workbook=XLSX.read(buffer,{type:"array"}),sheet=workbook.Sheets[workbook.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{defval:""});
    const grouped=[],map=new Map();
    rows.forEach(row=>{
      const teamName=clean(row["Équipe"]||row["Equipe"]),nom=clean(row["Nom"]),prenom=clean(row["Prénom"]||row["Prenom"]),profil=clean(row["Profil"])||"Autre";if(!teamName||!nom)return;
      if(!map.has(teamName)){const team={team:teamName,color:DEFAULT_TEAMS[map.size]?.color||"#777777",riders:[]};map.set(teamName,team);grouped.push(team)}
      map.get(teamName).riders.push({id:safeKey(`${teamName}-${nom}-${prenom}`),nom,prenom,profil,choisi:marked(row["Choisi"]),abandon:marked(row["Abandon"]),par:clean(row["Par"]),etape:row["Etape"]??row["Étape"]??"",points:row["Points"]??row["Point"]??""});
    });
    if(!grouped.length)throw new Error("Aucune ligne reconnue");await set(ref(db,"tour2026/roster"),grouped);toast(`${grouped.reduce((n,t)=>n+t.riders.length,0)} coureurs importés`);e.target.value="";
  }catch(error){toast("Import impossible : vérifie les colonnes");console.error(error)}
};

$("ridersTab").onclick=()=>setView("riders");$("rankingTab").onclick=()=>setView("ranking");
$("rankingMode").onchange=e=>{rankingMode=e.target.value;renderRanking()};
setView("riders");render();
