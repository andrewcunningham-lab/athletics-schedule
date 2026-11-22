/* Officials texting for the Sandoval scheduler.
   Phase 1: TEST MODE ONLY. Nothing is sent to a real phone; every "text" is written to the message log
   and shown on the Test phone tab, where you can answer as the official.

   How it works
   - Season list: one text lists a team's open home games as 1, 2, 3... Officials reply with the numbers they can work, or NO.
   - One game: a YES/NO text for a single game (used for drops).
   - Both go out in waves: regulars first, then everyone else, a few officials at a time (default 3) with a wait between waves (default 15 min).
     If everyone in a wave has answered, the next wave goes right away.
   - First come, first served. When a crew fills, the crew gets a confirmation and everyone still pending on that game gets the apology text.
   - Only clear answers are acted on. Anything else goes to the Inbox with the full text. CANCEL/STOP/etc. are carrier opt-out words and opt the number out.
*/
(function(root){
"use strict";

const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SDAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];

const DEFAULTS={
  adName:"Andrew Cunningham", school:"Sandoval", waveSize:3, waveMins:15, startHour:7, endHour:21, testMode:true,
  recHour:9, recDeadlineHrs:4, autoRefill:false, calUrl:"", timeChgMins:10,
  tpl:{
    season:"This is {ad}, AD at {school}. I am looking for officials for these {team} games at {school}:\n{list}\nReply with the numbers of the games you can work (for example: 1 3). Reply NO if you cannot work any of them. Thank you!",
    single:"This is {ad}, AD at {school}. I am looking for {count} official(s) for {team} on {date} at {time} at {school}. Please reply YES if you can work it or NO if you cannot. Thank you!",
    got:"Thank you! You are on for: {dates}. I will send a confirmation with your partners once each crew is full.{calendar}",
    update:"Update for {short} at {school}: {name} has confirmed. Crew so far: {crew}. Still looking for {left} more official(s). Thank you!{calendar}",
    calNote:"Here is your Sandoval calendar link: {link}\n\nClick on it and it will add your games into your iCal. It stays current on its own — games added will appear, and games you are removed from will come off. No app or login needed.",
    confirm:"Confirming {date} at {time} at {school} — {team}, full pay. Your partners: {partners}. Please reply if anything changes. Thank you!{calendar}",
    timechg:"Update for {short} at {school}: the {team} game {change}. Your partners are still {partners}. Please reply YES to confirm you can still work it. Thank you!",
    recon:"Confirming tomorrow, {date} at {time} at {school} — {team}. Your partners: {partners}. Please reply YES to confirm you are still good for tomorrow. Thank you!",
    sorry:"My apologies {name}, I just had someone grab the last spot on {dates}.",
    changed:"Update for {short} at {school}: the crew has changed. Your partners are now: {partners}. Same time, {time}, full pay. Thank you!"
  }
};
const TPL_LABELS={season:"Season list",single:"One game (YES/NO)",got:"Thank-you after picking games",update:"Crew update (one game, not full yet)",confirm:"Crew full confirmation",sorry:"Apology (spot taken)",changed:"Crew changed (after a drop is refilled)",calNote:"Calendar link paragraph (added once, at the end of his first text after taking a game)",recon:"Day-before check",timechg:"Game time or date changed"};

// ---------- pure helpers ----------
function normPhone(s){ let d=String(s||"").replace(/\D/g,""); if(d.length===11&&d[0]==="1")d=d.slice(1); return d.length===10?d:""; }
function showPhone(p){ const d=normPhone(p); return d?"("+d.slice(0,3)+") "+d.slice(3,6)+"-"+d.slice(6):String(p||""); }
function dt(s){ return new Date(s+"T12:00:00"); }
function longDate(s){ const d=dt(s); return DAYS[d.getDay()]+", "+MONTHS[d.getMonth()]+" "+d.getDate(); }
function shortMD(s){ const d=dt(s); return MONTHS[d.getMonth()]+" "+d.getDate(); }
function tinyDate(s){ const d=dt(s); return SDAYS[d.getDay()]+" "+(d.getMonth()+1)+"/"+d.getDate(); }
function andList(a){ a=a.filter(Boolean); return a.length<=1?(a[0]||""):a.length===2?a[0]+" and "+a[1]:a.slice(0,-1).join(", ")+", and "+a[a.length-1]; }
function fill(t,v){ return String(t||"").replace(/\{(\w+)\}/g,(m,k)=>v[k]!==undefined&&v[k]!==null?String(v[k]):m); }
const defaultSlotsFor=g=>/^HS\b.*basketball/i.test((g&&g.team)||"")?3:2;
const sameName=(a,b)=>String(a||"").trim().toLowerCase()===String(b||"").trim().toLowerCase();
const onSlot=(x,r)=>!!(x&&x.name&&((x.refId&&x.refId===r.id)||sameName(x.name,r.name)));

const STOP_WORDS=new Set(["stop","stopall","stop all","unsubscribe","cancel","end","quit"]);
const YES_WORDS=new Set(["yes","y","yep","yeah","yea","yes sir","yessir","yes i can","yes i can work it","i can","i can work it"]);
const NO_WORDS=new Set(["no","n","nope","no sir","cannot","can't","cant","i cannot","i can't","i cant","no i cannot","no i can't","no i cant","no i can not","none","no thank you","no thanks"]);
function clean(text){
  return String(text||"").toLowerCase().replace(/[‘’]/g,"'").replace(/[^\p{L}\p{N}' ,&#]/gu," ")
    .replace(/\s+/g," ").trim().replace(/[ ,]*(thank you|thanks|thx|ty)$/,"").replace(/[ ,]+$/,"").trim();
}
// -> {type:"stop"|"yes"|"no"|"nums"|"unclear", nums:[...]}
function parseReply(text){
  const c=clean(text);
  if(STOP_WORDS.has(c))return {type:"stop"};
  if(YES_WORDS.has(c))return {type:"yes"};
  if(NO_WORDS.has(c))return {type:"no"};
  // Dates and times ("12/3", "1-7", "6:00", "3.5") are never read as game numbers.
  if(/\d\s*[\/\-:.]\s*\d/.test(String(text||"")))return {type:"unclear"};
  if(/^#?\d{1,2}((\s*(,|&|\band\b)\s*|\s+)#?\d{1,2})*$/.test(c)){ const nums=[...new Set((c.match(/\d{1,2}/g)||[]).map(Number))]; return {type:"nums",nums}; }
  return {type:"unclear"};
}

// ---------- engine ----------
function createEngine(opt){
  const db=opt.db, now=opt.now||(()=>Date.now()), slotsFor=opt.slotsFor||defaultSlotsFor, calPage=opt.calPage||"";
  const C=n=>db.collection(n);
  const runs=()=>C("txRuns"), asks=()=>C("txAsks"), logC=()=>C("txLog"), inboxC=()=>C("txInbox"), refsC=()=>C("refs"), cfgDoc=()=>C("txcfg").doc("settings");
  let cfg=null;
  async function getCfg(force){ if(cfg&&!force)return cfg; const s=await cfgDoc().get(); const d=s.exists?s.data():{}; cfg=Object.assign({},DEFAULTS,d,{tpl:Object.assign({},DEFAULTS.tpl,d.tpl||{})}); cfg.testMode=true; return cfg; }
  async function saveCfg(c){ await cfgDoc().set(c); cfg=null; return getCfg(); }
  async function roster(){ const s=await refsC().get(); return s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>String(a.name).localeCompare(String(b.name))); }
  async function rosterMap(){ const m={}; (await roster()).forEach(r=>m[r.id]=r); return m; }
  function vars(c,extra){ return Object.assign({ad:c.adName,school:c.school},extra); }
  function newToken(){ const b=new Uint8Array(18); (globalThis.crypto||require("crypto").webcrypto).getRandomValues(b); return Array.from(b,x=>"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x%56]).join(""); }
  // " Your games calendar: <link>." the first time an official is confirmed, once the calendar feed is set up; "" otherwise.
  async function calendarLine(c,r){
    if(!c.calUrl||!calPage||!r||!r.id)return "";
    const s=await refsC().doc(r.id).get(); const d=s.exists?s.data():{}; if(d.calSent)return "";
    let t=d.calToken; if(!t){ t=newToken(); await refsC().doc(r.id).update({calToken:t}); }
    return "\n\n"+fill(c.tpl.calNote,vars(c,{link:calPage+"?t="+t}));
  }

  async function log(e){ const ref=logC().doc(); await ref.set(Object.assign({at:now(),fake:true,gameIds:[],runId:null,askId:null,refId:null,result:""},e)); return ref; }
  async function addInbox(e){ const ref=inboxC().doc(); await ref.set(Object.assign({at:now(),status:"open",resolution:""},e)); return ref; }

  // The one place a text leaves the app.
  async function send(r,body,meta){
    const c=await getCfg();
    const phone=normPhone(r&&r.phone);
    if(!phone)return false;
    const fresh=await refsC().doc(r.id).get();
    if(fresh.exists&&fresh.data().optedOut)return false;
    if(!c.testMode)throw new Error("Real texting isn't connected yet.");
    await log(Object.assign({dir:"out",phone,refId:r.id,name:r.name,body},meta||{}));
    return true;
  }

  async function loadState(ids){
    const games={}, slots={};
    await Promise.all([...new Set(ids)].map(async id=>{
      const [g,a]=await Promise.all([C("games").doc(id).get(),C("refAssign").doc(id).get()]);
      if(g.exists)games[id]=Object.assign({id},g.data());
      slots[id]=a.exists?(a.data().slots||[]):[];
    }));
    return {games,slots};
  }
  const filledCount=sl=>(sl||[]).filter(x=>x&&x.name).length;
  const isOpen=(st,id)=>{ const g=st.games[id]; return !!(g&&!g.cancelled&&filledCount(st.slots[id])<slotsFor(g)); };
  async function declinedFor(refId){ const s=await asks().where("refId","==",refId).get(); const d=new Set(); s.docs.forEach(x=>(x.data().declined||[]).forEach(g=>d.add(g))); return d; }
  function openItems(run,st,r,decl){ return run.gameIds.filter(id=>isOpen(st,id)&&!(st.slots[id]||[]).some(x=>onSlot(x,r))&&!decl.has(id)).sort((a,b)=>{ const ga=st.games[a],gb=st.games[b]; return ga.date<gb.date?-1:ga.date>gb.date?1:0; }); }

  function askText(c,run,items,st){
    if(run.kind==="season"){
      const list=items.map((id,i)=>{ const g=st.games[id]; return (i+1)+") "+tinyDate(g.date)+" at "+(g.time||"TBA"); }).join("\n");
      return fill(c.tpl.season,vars(c,{team:run.team,list}));
    }
    const g=st.games[items[0]], left=slotsFor(g)-filledCount(st.slots[items[0]]);
    return fill(c.tpl.single,vars(c,{team:g.team,count:left,date:longDate(g.date),short:shortMD(g.date),time:g.time||"TBA"}));
  }

  async function startRun(o){
    const c=await getCfg();
    if(!o.gameIds||!o.gameIds.length)throw new Error("Pick at least one game.");
    const st=await loadState(o.gameIds);
    const ids=o.gameIds.filter(id=>isOpen(st,id));
    if(!ids.length)throw new Error("Those games already have full crews.");
    const team=o.team||st.games[ids[0]].team, ex=o.excluded||[];
    const all=(await roster()).filter(r=>normPhone(r.phone)&&!r.optedOut&&!ex.includes(r.id)&&(!(r.sports&&r.sports.length)||r.sports.includes(team)));
    const queue=all.filter(r=>r.regular).concat(all.filter(r=>!r.regular)).map(r=>r.id);
    if(!queue.length)throw new Error("No officials with a phone number are set to work "+team+".");
    const ref=runs().doc();
    await ref.set({kind:o.kind==="season"?"season":"single",team,gameIds:ids,status:"running",queue,nextIdx:0,nextWaveAt:0,waves:0,
      waveSize:+c.waveSize||3,waveMins:+c.waveMins||15,createdAt:now(),excluded:ex,refill:o.refill||null,exhausted:false});
    await sendWave(ref.id,true);
    return ref.id;
  }

  async function sendWave(runId,force){
    const rs=await runs().doc(runId).get(); if(!rs.exists)return 0; const run=rs.data();
    if(run.status!=="running")return 0;
    if(!force&&now()<run.nextWaveAt)return 0;
    const st=await loadState(run.gameIds);
    if(!run.gameIds.some(id=>isOpen(st,id))){ await runs().doc(runId).update({status:"done",doneAt:now()}); return 0; }
    const rm=await rosterMap(); const picks=[]; let i=run.nextIdx;
    while(i<run.queue.length&&picks.length<run.waveSize){
      const r=rm[run.queue[i]]; i++;
      if(!r||r.optedOut||!normPhone(r.phone))continue;
      const items=openItems(run,st,r,await declinedFor(r.id));
      if(items.length)picks.push({r,items: run.kind==="season"?items:[items[0]]});
    }
    const claimed=await db.runTransaction(async t=>{ const s=await t.get(runs().doc(runId)); const d=s.data();
      if(!d||d.status!=="running"||d.nextIdx!==run.nextIdx)return false;
      t.update(runs().doc(runId),{nextIdx:i,nextWaveAt:now()+run.waveMins*60000,waves:(d.waves||0)+(picks.length?1:0),exhausted:i>=run.queue.length});
      return true; });
    if(!claimed)return 0;
    const c=await getCfg();
    for(const p of picks){
      const ar=asks().doc();
      await ar.set({runId,kind:run.kind,team:run.team,refId:p.r.id,name:p.r.name,phone:normPhone(p.r.phone),items:p.items,sentAt:now(),status:"pending",claimed:[],declined:[],apologized:[]});
      await send(p.r,askText(c,run,p.items,st),{runId,askId:ar.id,gameIds:p.items});
    }
    return picks.length;
  }

  // Called on a timer while the page is open (and right after replies).
  async function tick(){
    const c=await getCfg(); const h=new Date(now()).getHours(); const inHours=h>=+c.startHour&&h<+c.endHour;
    const s=await runs().where("status","==","running").get(); let sent=0;
    for(const d of s.docs){
      const run=d.data(); if(run.exhausted&&run.nextIdx>=run.queue.length){ const st=await loadState(run.gameIds); if(!run.gameIds.some(id=>isOpen(st,id)))await d.ref.update({status:"done",doneAt:now()}); continue; }
      if(!inHours)continue;
      let due=now()>=run.nextWaveAt;
      if(!due){ const a=await asks().where("runId","==",d.id).get(); due=!a.docs.some(x=>x.data().status==="pending"); }
      if(due)sent+=await sendWave(d.id,true);
    }
    if(inHours)sent+=await processTimeChanges(false);
    if(inHours&&h>=+c.recHour)sent+=await sendDayBefore(tomorrowIso());
    await checkSilent();
    return sent;
  }

  async function claim(game,r){
    const ref=C("refAssign").doc(game.id), n=slotsFor(game);
    return db.runTransaction(async t=>{
      const s=await t.get(ref); const d=s.exists?s.data():{};
      const slots=(d.slots||[]).map(x=>Object.assign({},x)); while(slots.length<n)slots.push({name:"",confirmed:false});
      if(slots.some(x=>onSlot(x,r)))return {res:"already",slots};
      const f=filledCount(slots); if(f>=n||game.cancelled)return {res:"full",slots};
      const i=slots.findIndex(x=>!x||!x.name); slots[i]={name:r.name,confirmed:false,refId:r.id,via:"text"};
      t.set(ref,{date:game.date,slots}); return {res:"got",slots,nowFull:f+1>=n};
    });
  }

  function crewPeople(slots,rm){ return (slots||[]).filter(x=>x&&x.name).map(x=>{ const r=(x.refId&&rm[x.refId])||Object.values(rm).find(y=>sameName(y.name,x.name)); return {name:x.name,r}; }); }

  // Fill {calendar} for this one official (his link the first time, blank after), send, and remember he has it.
  async function sendCal(c,r,tplKey,v,meta){
    const cal=await calendarLine(c,r);
    const body=fill(c.tpl[tplKey],Object.assign({},v,{calendar:cal})).replace(/ {2,}/g," ").trim();
    const ok=await send(r,body,meta); if(ok&&cal&&/\{calendar\}/.test(c.tpl[tplKey]))await refsC().doc(r.id).update({calSent:true}); return ok;
  }
  async function crewFull(game,newRefId,runDoc){
    const c=await getCfg(), rm=await rosterMap();
    const a=await C("refAssign").doc(game.id).get(); const slots=(a.exists&&a.data().slots)||[];
    const people=crewPeople(slots,rm); const texted=new Set();
    const refill=!!(runDoc&&runDoc.refill);
    for(const p of people){
      if(!p.r)continue;
      const partners=andList(people.filter(q=>q!==p).map(q=>q.name))||"none";
      const v=vars(c,{date:longDate(game.date),short:shortMD(game.date),time:game.time||"TBA",team:game.team,partners});
      const isConfirm=!(refill&&p.r.id!==newRefId); const meta={gameIds:[game.id],runId:runDoc?runDoc.id:null};
      const ok=isConfirm?await sendCal(c,p.r,"confirm",v,meta):await send(p.r,fill(c.tpl.changed,v),meta);
      if(ok)texted.add(p.name.toLowerCase());
    }
    if(texted.size)await db.runTransaction(async t=>{ const s=await t.get(C("refAssign").doc(game.id)); const d=s.data()||{}; const sl=(d.slots||[]).map(x=>x&&x.name&&texted.has(x.name.toLowerCase())?Object.assign({},x,{confirmed:true}):x); t.set(C("refAssign").doc(game.id),Object.assign({},d,{slots:sl})); });
  }

  async function crewUpdate(game,slots,newName,runId){
    const c=await getCfg(), rm=await rosterMap(); const people=crewPeople(slots,rm);
    const v=vars(c,{short:shortMD(game.date),name:newName,crew:andList(people.map(p=>p.name)),left:slotsFor(game)-people.length});
    for(const p of people)if(p.r)await sendCal(c,p.r,"update",v,{gameIds:[game.id],runId});
  }

  // Everyone still pending (no answer yet, or an unclear answer) on games that just filled.
  async function apologize(gameIds,exceptAskId){
    if(!gameIds.length)return;
    const c=await getCfg(), rm=await rosterMap();
    const s=await asks().where("items","array-contains-any",gameIds.slice(0,30)).get();
    for(const d of s.docs){
      const a=d.data(); if(d.id===exceptAskId||(a.kind!=="season"&&a.kind!=="single")||!["pending","ambiguous"].includes(a.status))continue;
      const hit=a.items.filter(id=>gameIds.includes(id)&&!(a.apologized||[]).includes(id)); if(!hit.length)continue;
      const st=await loadState(a.items); const r=rm[a.refId];
      if(r)await send(r,fill(c.tpl.sorry,vars(c,{name:a.name,dates:andList(hit.map(id=>tinyDate(st.games[id].date)))})),{runId:a.runId,askId:d.id,gameIds:hit});
      const apol=(a.apologized||[]).concat(hit);
      const stillOpen=a.items.some(id=>!apol.includes(id)&&isOpen(st,id));
      await d.ref.update({apologized:apol,status:stillOpen?a.status:"closed"});
    }
  }

  async function finishRuns(runIds){
    for(const id of new Set(runIds.filter(Boolean))){ const s=await runs().doc(id).get(); if(!s.exists)continue; const r=s.data(); if(r.status==="done")continue; const st=await loadState(r.gameIds); if(!r.gameIds.some(g=>isOpen(st,g)))await s.ref.update({status:"done",doneAt:now()}); }
  }

  // Put an official on the games he picked (or said yes to). Used for clear replies and for the AD's inbox taps.
  async function applyClaim(askId,gameIds){
    const ad=await asks().doc(askId).get(); const a=ad.data(); const rm=await rosterMap(); const r=rm[a.refId]||{id:a.refId,name:a.name,phone:a.phone};
    const c=await getCfg(); const st=await loadState(a.items);
    const rd=await runs().doc(a.runId).get(); const runDoc=rd.exists?Object.assign({id:rd.id},rd.data()):null;
    const got=[], full=[], filledNow=[];
    for(const id of gameIds){ const g=st.games[id]; if(!g){ full.push(id); continue; } const x=await claim(g,r);
      if(x.res==="got"){ got.push(id); if(x.nowFull)filledNow.push(id); else if(a.kind==="single")await crewUpdate(g,x.slots,r.name,a.runId); }
      else if(x.res==="already")got.push(id); else full.push(id); }
    const declined=a.items.filter(id=>!gameIds.includes(id));
    await ad.ref.update({status:"answered",answeredAt:now(),claimed:[...new Set((a.claimed||[]).concat(got))],declined:[...new Set((a.declined||[]).concat(declined))]});
    if(a.kind==="season"&&got.length)await sendCal(c,r,"got",vars(c,{dates:andList(got.map(id=>tinyDate(st.games[id].date)))}),{runId:a.runId,askId,gameIds:got});
    if(full.length)await send(r,fill(c.tpl.sorry,vars(c,{name:a.name,dates:andList(full.filter(id=>st.games[id]).map(id=>tinyDate(st.games[id].date)))})),{runId:a.runId,askId,gameIds:full});
    for(const id of filledNow)await crewFull(st.games[id],r.id,runDoc);
    await apologize(filledNow,askId);
    await finishRuns([a.runId].concat(await runsFor(filledNow)));
    const parts=[]; if(got.length)parts.push("On the crew for "+andList(got.map(id=>tinyDate(st.games[id].date)))); if(full.length)parts.push("already full: "+andList(full.filter(id=>st.games[id]).map(id=>tinyDate(st.games[id].date)))); if(declined.length&&a.kind==="season")parts.push("passed on "+declined.length);
    return {got,full,declined,summary:parts.join("; ")||"Answered"};
  }
  async function runsFor(gameIds){ if(!gameIds.length)return []; const s=await runs().where("gameIds","array-contains-any",gameIds.slice(0,30)).get(); return s.docs.map(d=>d.id); }

  async function applyNo(askId){ const ad=await asks().doc(askId).get(); const a=ad.data(); await ad.ref.update({status:"answered",answeredAt:now(),declined:[...new Set((a.declined||[]).concat(a.items.filter(id=>!(a.claimed||[]).includes(id))))]}); return {summary:"Said no"}; }

  // A text came in.
  async function inbound(phone,body){
    const p=normPhone(phone); const all=await roster(); const r=all.find(x=>normPhone(x.phone)===p);
    const lr=await log({dir:"in",phone:p||String(phone||""),refId:r?r.id:null,name:r?r.name:"Unknown number",body});
    const done=async(result,extra)=>{ await lr.update(Object.assign({result},extra||{})); return result; };
    if(!r){ await addInbox({type:"unknown",phone:p,name:"Unknown number",body,logId:lr.id}); return done("Not on the officials list. Sent to the inbox."); }
    const pr=parseReply(body);
    if(pr.type==="stop"){
      await refsC().doc(r.id).update({optedOut:true,optedOutAt:now()});
      const s=await asks().where("refId","==",r.id).get(); for(const d of s.docs)if(["pending","ambiguous"].includes(d.data().status))await d.ref.update({status:"closed"});
      await addInbox({type:"optout",refId:r.id,name:r.name,phone:p,body,logId:lr.id});
      return done("Opted out. No more texts will go to this number.");
    }
    const s=await asks().where("refId","==",r.id).get(); const week=7*864e5;
    const open=s.docs.map(d=>Object.assign({id:d.id},d.data())).filter(a=>["pending","ambiguous"].includes(a.status)||(isCheck(a)&&a.status==="silent")||(!isCheck(a)&&a.status==="closed"&&now()-a.sentAt<week)).sort((a,b)=>b.sentAt-a.sentAt);
    let target=null;
    // A live request wins over an old one he was already told was filled; an old one only counts if it's the only one (a late reply).
    const one=c=>{ const live=c.filter(a=>a.status!=="closed"); return live.length===1?live[0]:(!live.length&&c.length===1?c[0]:null); };
    // YES to several crew checks on the same game (a day-before check and a time-change text) answers all of them.
    const checks=open.filter(a=>isCheck(a)&&a.status!=="closed");
    if((pr.type==="yes"||pr.type==="no")&&checks.length>1&&open.filter(a=>a.status!=="closed").length===checks.length&&checks.every(a=>a.items[0]===checks[0].items[0])){
      let last; for(const a of checks)last=await applyCheck(a,pr.type==="yes",body);
      return done(last.summary,{askId:checks[0].id,gameIds:checks[0].items});
    }
    if(pr.type==="yes")target=one(open.filter(a=>a.kind==="single"||isCheck(a)));
    else if(pr.type==="nums"){ const t=one(open.filter(a=>a.kind==="season")); if(t&&pr.nums.every(n=>n>=1&&n<=t.items.length))target=t; }
    else if(pr.type==="no")target=one(open);
    if(!target){
      const why=!open.length?"No open request for this official.":pr.type==="unclear"?"Unclear reply.":open.length>1?"Has more than one open request.":"Reply doesn't match the request.";
      for(const a of open)if(a.status==="pending"||a.status==="silent")await asks().doc(a.id).update({status:"ambiguous"});
      await addInbox({type:open.length?"unclear":"reply",refId:r.id,name:r.name,phone:p,body,askIds:open.map(a=>a.id),note:why,logId:lr.id});
      const res=await done(why+" Sent to the inbox.",{askId:open.length===1?open[0].id:null,gameIds:open.length===1?open[0].items:[]});
      for(const a of open)await maybeNextWave(a.runId);
      return res;
    }
    let out;
    if(isCheck(target))out=await applyCheck(target,pr.type==="yes",body);
    else if(pr.type==="no")out=await applyNo(target.id);
    else out=await applyClaim(target.id,pr.type==="yes"?[target.items[0]]:pr.nums.map(n=>target.items[n-1]));
    await maybeNextWave(target.runId);
    return done(out.summary,{askId:target.id,runId:target.runId,gameIds:target.items});
  }
  async function maybeNextWave(runId){ if(!runId)return; const s=await runs().doc(runId).get(); if(!s.exists||s.data().status!=="running")return; const a=await asks().where("runId","==",runId).get(); if(!a.docs.some(x=>x.data().status==="pending")){ const c=await getCfg(); const h=new Date(now()).getHours(); if(h>=+c.startHour&&h<+c.endHour)await sendWave(runId,true); } }

  // AD removes someone from a crew (a drop). Reopens the spot and starts a one-game re-run on its own.
  async function dropFromCrew(gameId,slotName,note){
    const st=await loadState([gameId]); const g=st.games[gameId]; if(!g)throw new Error("Game not found.");
    let removed=null;
    await db.runTransaction(async t=>{ const ref=C("refAssign").doc(gameId); const s=await t.get(ref); const d=s.data()||{date:g.date,slots:[]};
      const sl=(d.slots||[]).map(x=>{ if(!removed&&x&&sameName(x.name,slotName)){ removed=x; return {name:"",confirmed:false}; } return x; });
      t.set(ref,Object.assign({},d,{slots:sl})); });
    if(!removed)throw new Error(slotName+" isn't on that crew.");
    const rm=await rosterMap(); const rr=(removed.refId&&rm[removed.refId])||Object.values(rm).find(y=>sameName(y.name,removed.name));
    const s=await asks().where("items","array-contains",gameId).get();
    for(const d of s.docs){ const a=d.data(); if(rr&&a.refId===rr.id)await d.ref.update(Object.assign({claimed:(a.claimed||[]).filter(x=>x!==gameId),declined:[...new Set((a.declined||[]).concat([gameId]))]},isCheck(a)&&a.status!=="answered"?{status:"closed"}:{})); }
    await log({dir:"note",phone:"",refId:rr?rr.id:null,name:removed.name,body:"Removed from the crew for "+tinyDate(g.date)+" "+g.team+(note?" ("+note+")":"")+". Re-running the list for the open spot.",gameIds:[gameId]});
    return startRun({kind:"single",gameIds:[gameId],excluded:rr?[rr.id]:[],refill:{gameId,removed:removed.name}});
  }

  function isCheck(a){ return a&&(a.kind==="recon"||a.kind==="timechg"); }
  async function applyCheck(a,yes,said){
    if(a.kind==="recon")return applyRecon(a.id,yes);
    const ref=asks().doc(a.id), gid=a.items[0];
    if(yes){
      await ref.update({status:"answered",answeredAt:now(),claimed:[gid]});
      await db.runTransaction(async t=>{ const r=C("refAssign").doc(gid); const s=await t.get(r); const d=s.data()||{}; const sl=(d.slots||[]).map(x=>x&&x.name&&((x.refId&&x.refId===a.refId)||sameName(x.name,a.name))?Object.assign({},x,{confirmed:true}):x); t.set(r,Object.assign({},d,{slots:sl})); });
      return {summary:"Confirmed the new time"};
    }
    await ref.update({status:"answered",answeredAt:now(),declined:[gid]});
    await addInbox({type:"timeno",refId:a.refId,name:a.name,phone:a.phone,body:said||"NO",askIds:[a.id],note:"Can't work the new time."});
    return {summary:"Said no to the new time. Sent to the inbox."};
  }

  // ----- time/date changes: queued, then sent after a wait so an accidental edit can be fixed first -----
  function changeText(o,g){
    const dChg=o.date!==g.date, tChg=(o.time||"")!==(g.time||"");
    if(dChg&&tChg)return "has moved from "+longDate(o.date)+" at "+(o.time||"TBA")+" to "+longDate(g.date)+" at "+(g.time||"TBA");
    if(dChg)return "has moved from "+longDate(o.date)+" to "+longDate(g.date);
    return "time has changed from "+(o.time||"TBA")+" to "+(g.time||"TBA");
  }
  async function crewToText(gameId){ const rm=await rosterMap(); const a=await C("refAssign").doc(gameId).get(); return crewPeople((a.exists&&a.data().slots)||[],rm); }
  async function timeChangePreview(gameId,old){
    const c=await getCfg(); const g=(await C("games").doc(gameId).get()).data(); const people=await crewToText(gameId);
    const p=people.find(x=>x.r&&normPhone(x.r.phone))||people[0];
    const body=p?fill(c.tpl.timechg,vars(c,{short:shortMD(old.date),team:g.team,change:changeText(old,g),partners:andList(people.filter(q=>q!==p).map(q=>q.name))||"none yet"})):"";
    return {body,textable:people.filter(x=>x.r&&normPhone(x.r.phone)&&!x.r.optedOut).map(x=>x.name),untextable:people.filter(x=>!(x.r&&normPhone(x.r.phone))||x.r.optedOut).map(x=>x.name)};
  }
  async function queueTimeChange(gameId,old){
    const c=await getCfg(); const id="tc_"+gameId; const ref=runs().doc(id); const ex=await ref.get();
    const keepOld=ex.exists&&ex.data().status==="queued"?ex.data().old:{date:old.date,time:old.time||""};
    await ref.set({kind:"timechange",gameId,old:keepOld,status:"queued",createdAt:now(),sendAt:now()+(+c.timeChgMins||10)*60000,gameIds:[],queue:[]});
    return now()+(+c.timeChgMins||10)*60000;
  }
  async function cancelTimeChange(gameId){ const ref=runs().doc("tc_"+gameId); const s=await ref.get(); if(s.exists&&s.data().status==="queued")await ref.update({status:"cancelled",cancelledAt:now()}); }
  async function processTimeChanges(force){
    const s=await runs().where("status","==","queued").get(); let n=0;
    for(const d of s.docs){ const q=d.data(); if(q.kind!=="timechange"||(!force&&now()<q.sendAt))continue;
      const gs=await C("games").doc(q.gameId).get(); const g=gs.exists?gs.data():null;
      if(!g||g.cancelled||(g.date===q.old.date&&(g.time||"")===(q.old.time||""))){ await d.ref.update({status:"cancelled",cancelledAt:now(),note:!g?"Game deleted":g.cancelled?"Game cancelled":"Changed back before it went out"}); continue; }
      const c=await getCfg(); const people=await crewToText(q.gameId);
      const prior=(await asks().where("items","array-contains",q.gameId).get()).docs; for(const x of prior){ const a=x.data(); if(a.kind==="timechg"&&["pending","ambiguous","silent"].includes(a.status))await x.ref.update({status:"closed"}); }
      for(const p of people){ if(!p.r)continue;
        const ar=asks().doc();
        await ar.set({runId:null,kind:"timechg",team:g.team,refId:p.r.id,name:p.r.name,phone:normPhone(p.r.phone),items:[q.gameId],sentAt:now(),status:"pending",claimed:[],declined:[],apologized:[]});
        const body=fill(c.tpl.timechg,vars(c,{short:shortMD(q.old.date),team:g.team,change:changeText(q.old,g),partners:andList(people.filter(x=>x!==p).map(x=>x.name))||"none yet",time:g.time||"TBA",date:longDate(g.date)}));
        if(await send(p.r,body,{askId:ar.id,gameIds:[q.gameId]}))n++; else await ar.delete(); }
      await d.ref.update({status:"sent",sentAt:now(),sentTo:n});
    }
    return n;
  }

  // ----- day-before checks -----
  async function sendDayBefore(dateIso){
    const c=await getCfg(), rm=await rosterMap();
    const gs=(await C("games").where("date","==",dateIso).get()).docs.map(d=>Object.assign({id:d.id},d.data())).filter(g=>g.ha==="H"&&!g.cancelled);
    let n=0;
    for(const g of gs){
      const a=await C("refAssign").doc(g.id).get(); const people=crewPeople((a.exists&&a.data().slots)||[],rm); if(!people.length)continue;
      const all=(await asks().where("items","array-contains",g.id).get()).docs.map(d=>d.data());
      const prior=all.filter(x=>x.kind==="recon");
      // someone who just took the spot in the last day (a late replacement) already got a confirmation; no need to check again
      const fresh=all.filter(x=>(x.kind==="season"||x.kind==="single")&&(x.claimed||[]).includes(g.id)&&now()-(x.answeredAt||0)<864e5).map(x=>x.refId);
      for(const p of people){
        if(!p.r||prior.some(x=>x.refId===p.r.id)||fresh.includes(p.r.id))continue;
        const partners=andList(people.filter(q=>q!==p).map(q=>q.name))||"none";
        const ar=asks().doc();
        await ar.set({runId:null,kind:"recon",team:g.team,refId:p.r.id,name:p.r.name,phone:normPhone(p.r.phone),items:[g.id],sentAt:now(),status:"pending",claimed:[],declined:[],apologized:[]});
        if(await send(p.r,fill(c.tpl.recon,vars(c,{date:longDate(g.date),short:shortMD(g.date),time:g.time||"TBA",team:g.team,partners})),{askId:ar.id,gameIds:[g.id]}))n++;
        else await ar.delete();
      }
    }
    return n;
  }
  async function applyRecon(askId,yes){
    const ad=await asks().doc(askId).get(); const a=ad.data(); const gid=a.items[0];
    if(yes){
      await ad.ref.update({status:"answered",answeredAt:now(),claimed:[gid]});
      await db.runTransaction(async t=>{ const ref=C("refAssign").doc(gid); const s=await t.get(ref); const d=s.data()||{}; const sl=(d.slots||[]).map(x=>x&&x.name&&((x.refId&&x.refId===a.refId)||sameName(x.name,a.name))?Object.assign({},x,{confirmed:true,reconfirmed:true}):x); t.set(ref,Object.assign({},d,{slots:sl})); });
      return {summary:"Re-confirmed for tomorrow"};
    }
    await ad.ref.update({status:"answered",answeredAt:now(),declined:[gid]});
    await dropFromCrew(gid,a.name,"said no to the day-before check");
    return {summary:"Said no to tomorrow. Removed from the crew; re-running the list"};
  }
  async function checkSilent(){
    const c=await getCfg(); const hrs=+c.recDeadlineHrs||4;
    const s=await asks().where("status","==","pending").get();
    for(const d of s.docs){ const a=d.data(); if(!isCheck(a)||now()<a.sentAt+hrs*3600e3)continue;
      await d.ref.update({status:"silent"});
      if(a.kind==="timechg"){ await addInbox({type:"silent",refId:a.refId,name:a.name,phone:a.phone,body:"(no reply)",askIds:[d.id],note:"No reply to the time-change text in "+hrs+" hours. At risk."}); continue; }
      if(c.autoRefill){ await dropFromCrew(a.items[0],a.name,"no reply to the day-before check");
        await addInbox({type:"silent",refId:a.refId,name:a.name,phone:a.phone,body:"(no reply)",askIds:[d.id],note:"No reply in "+hrs+" hours. Released automatically and re-running the list.",auto:true}); }
      else await addInbox({type:"silent",refId:a.refId,name:a.name,phone:a.phone,body:"(no reply)",askIds:[d.id],note:"No reply to the day-before check in "+hrs+" hours. At risk."});
    }
  }
  function tomorrowIso(){ const d=new Date(now()); d.setDate(d.getDate()+1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

  async function resolveInbox(id,resolution){ await inboxC().doc(id).update({status:"resolved",resolution,resolvedAt:now()}); }

  return {getCfg,saveCfg,startRun,sendWave,tick,inbound,applyClaim,applyNo,applyRecon,applyCheck,timeChangePreview,queueTimeChange,cancelTimeChange,processTimeChanges,sendDayBefore,checkSilent,tomorrowIso,newToken,dropFromCrew,resolveInbox,loadState,roster,
    setRun:(id,o)=>runs().doc(id).update(o), clearOptOut:refId=>refsC().doc(refId).update({optedOut:false}), optOut:refId=>refsC().doc(refId).update({optedOut:true,optedOutAt:now()}),
    markAskHandled:id=>asks().doc(id).update({status:"answered",answeredAt:now()})};
}

const api={DEFAULTS,TPL_LABELS,parseReply,normPhone,showPhone,longDate,shortMD,tinyDate,andList,fill,createEngine};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.TextingCore=api;
})(typeof window!=="undefined"?window:globalThis);
