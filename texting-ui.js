/* Officials texting screens. Loaded by index.html; started by Texting.init(ctx) when the AD account signs in. */
(function(){
"use strict";
const K=window.TextingCore;
let ctx=null, E=null, $=id=>document.getElementById(id), esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let tab="send", sendKind="season", runsL=[], asksL=[], inboxL=[], logL=[], rosterL=[], unsubs=[], timer=null, gamesCache={}, upcoming=[], testRef="";

const CSS=`
#txSheet .seg{flex-wrap:wrap}
.txcard{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--surface)}
.txcard h4{margin:0 0 4px;font-size:15px}
.txst{display:inline-block;font-size:12px;font-weight:700;border:1.5px solid currentColor;border-radius:4px;padding:0 6px;margin-left:6px;vertical-align:1px}
.txst.run{color:var(--gym)} .txst.pause{color:var(--tent)} .txst.done{color:var(--muted)}
.txgame{padding:6px 0;border-top:1px solid var(--line);font-size:13.5px}
.txgame .crew{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.txchip{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:99px;padding:2px 4px 2px 10px;font-size:13px}
.txchip.open{border-style:dashed;color:var(--muted);padding-right:10px}
.txchip button{border:0;background:var(--bg);border-radius:99px;padding:2px 8px;font-size:12px;cursor:pointer}
.txasks{font-size:13px;color:var(--muted);margin-top:6px}
.txasks b{color:var(--ink);font-weight:600}
.txq{white-space:pre-wrap;border-left:3px solid var(--line);padding:4px 10px;margin:6px 0;font-size:14px}
.txrow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.txlog{font-size:13px;border-bottom:1px solid var(--line);padding:6px 2px}
.txlog .h{color:var(--muted);font-size:12px}
.txlog .b{white-space:pre-wrap}
.txlog .r{font-size:12px;font-weight:600;margin-top:2px}
.txthread{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:10px;padding:10px;max-height:46vh;overflow-y:auto;background:var(--bg);margin:8px 0}
.txb{max-width:85%;padding:7px 10px;border-radius:12px;white-space:pre-wrap;font-size:14px;line-height:1.35}
.txb.out{align-self:flex-start;background:var(--surface);border:1px solid var(--line)}
.txb.in{align-self:flex-end;background:var(--gym);color:#fff}
.txb small{display:block;font-size:11px;opacity:.75;margin-top:2px}
.txtest{font-size:12.5px;font-weight:700;border:1.5px dashed var(--tent);color:var(--tent);border-radius:6px;padding:4px 8px;margin-bottom:10px}
#txSheet label.txpick,.txpick{display:flex;flex-direction:row;gap:8px;align-items:center;text-align:left;padding:6px 2px;border-bottom:1px solid var(--line);font-size:14px}
.txpick input{flex:none}
#txSheet textarea{width:100%;min-height:84px;font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}
.txbadge{display:inline-block;min-width:18px;padding:0 5px;border-radius:99px;background:var(--scarlet);color:#fff;font-size:11px;font-weight:700;margin-left:4px;text-align:center}
.txmodal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px}
.txmodal .box{background:var(--surface);color:var(--ink);border-radius:12px;max-width:460px;width:100%;padding:16px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.txmodal h4{margin:0 0 8px;font-size:17px}
.txmodal .btn{width:100%;margin-top:8px;padding:10px}
.rrow2{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px;color:var(--muted);align-items:center}
.rrow2 label{display:inline-flex;gap:4px;align-items:center;cursor:pointer}
.rrow2 .oo{font-weight:700;color:var(--scarlet)}
`;

const fmtT=ms=>{ const d=new Date(ms); let h=d.getHours(), ap=h>=12?"PM":"AM"; h=h%12||12; return h+":"+String(d.getMinutes()).padStart(2,"0")+" "+ap; };
const fmtWhen=ms=>{ const d=new Date(ms); return (d.getMonth()+1)+"/"+d.getDate()+" "+fmtT(ms); };
const gLabel=id=>{ const g=gamesCache[id]; return g?K.tinyDate(g.date)+" "+(g.time||"TBA"):"(game removed)"; };

function shell(){
  $("txSheet").innerHTML=`<h3 id="txTitle">Officials texting</h3>
  <div class="txtest">TEST MODE — nothing is sent to real phones. Use the Test phone tab to answer as an official.</div>
  <div class="seg" role="group" aria-label="Texting view" style="align-self:flex-start;margin-bottom:12px">
    ${[["send","Send"],["runs","Running"],["inbox","Inbox"],["log","Log"],["test","Test phone"],["set","Settings"]].map(([k,l])=>`<button data-tab="${k}" aria-pressed="${tab===k}">${l}${k==="inbox"?'<span class="txbadge" id="txInboxN" hidden></span>':""}</button>`).join("")}
  </div>
  <div id="txBody"></div>
  <div class="row" style="margin-top:12px"><button class="btn" id="tx-close">Close</button></div>`;
  $("txSheet").querySelector(".seg").onclick=e=>{ const b=e.target.closest("[data-tab]"); if(b){ tab=b.dataset.tab; draw(); } };
  $("tx-close").onclick=()=>ctx.closeSheet();
}
function draw(){
  if(!$("txBody"))return;
  $("txSheet").querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tab===tab));
  badge();
  ({send:drawSend,runs:drawRuns,inbox:drawInbox,log:drawLog,test:drawTest,set:drawSet})[tab]();
}
function badge(){ const n=inboxL.length; ["txInboxN","txMenuN"].forEach(id=>{ const el=$(id); if(el){ el.hidden=!n; el.textContent=n; } }); }
const isOpenSheet=()=>$("txSheet")&&!$("txSheet").hidden;
const redraw=()=>{ if(isOpenSheet()&&tab!=="send"&&tab!=="set"&&!(document.activeElement&&/TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)&&$("txBody").contains(document.activeElement)))draw(); else badge(); };

async function act(btn,fn,okMsg){ if(btn)btn.disabled=true; try{ const r=await fn(); if(okMsg)ctx.toast(typeof okMsg==="function"?okMsg(r):okMsg); }catch(e){ ctx.toast(e&&e.message&&!/permission/i.test(e.code||"")?e.message:"That didn't work. If this is new, paste the updated Firestore rules."); console.error(e); } if(btn)btn.disabled=false; }

// ---------- Send ----------
async function loadUpcoming(){
  const end=new Date(); end.setMonth(end.getMonth()+6); const p=n=>String(n).padStart(2,"0"); const to=end.getFullYear()+"-"+p(end.getMonth()+1)+"-"+p(end.getDate());
  const [gs,as]=await Promise.all([ctx.fdb.collection("games").where("date",">=",ctx.todayIso).where("date","<=",to).get(), ctx.fdb.collection("refAssign").where("date",">=",ctx.todayIso).where("date","<=",to).get()]);
  const A={}; as.docs.forEach(d=>A[d.id]=d.data().slots||[]);
  upcoming=gs.docs.map(d=>Object.assign({id:d.id},d.data())).filter(ctx.needsRefs).sort(ctx.sortGames).map(g=>Object.assign(g,{_slots:A[g.id]||[],_filled:(A[g.id]||[]).filter(x=>x&&x.name).length,_n:ctx.slotsFor(g)}));
  upcoming.forEach(g=>gamesCache[g.id]=g);
}
async function drawSend(){
  const B=$("txBody"); B.innerHTML='<p class="small muted">Loading games…</p>';
  try{ await loadUpcoming(); rosterL=await E.roster(); }catch(e){ B.innerHTML='<p class="err">Couldn\'t load games. Check your connection.</p>'; return; }
  const open=upcoming.filter(g=>g._filled<g._n); const teams=[...new Set(open.map(g=>g.team))].sort();
  if(!teams.length){ B.innerHTML='<p class="small muted">Every home game in the next 6 months has a full crew.</p>'; return; }
  const keep=B.dataset.team&&teams.includes(B.dataset.team)?B.dataset.team:teams[0];
  B.innerHTML=`<div class="form">
    <div class="seg" role="group" aria-label="What to send" style="align-self:flex-start"><button data-k="season" aria-pressed="${sendKind==="season"}">Season list</button><button data-k="single" aria-pressed="${sendKind==="single"}">One game</button></div>
    <p class="small muted">${sendKind==="season"?"One text lists every game you check, numbered. Officials reply with the numbers they can work.":"A YES/NO text for one game — for when someone drops."}</p>
    <label><span class="lbl">Team</span><select id="tx-team">${teams.map(t=>`<option${t===keep?" selected":""}>${esc(t)}</option>`).join("")}</select></label>
    <div id="tx-games"></div>
    <p class="small muted" id="tx-who"></p>
    <details><summary class="small">Preview the text</summary><div class="txq" id="tx-prev"></div></details>
    <div class="row"><button class="btn primary" id="tx-start">Start texting</button></div>
    <p class="err" id="tx-err"></p></div>`;
  B.querySelector(".seg").onclick=e=>{ const b=e.target.closest("[data-k]"); if(b){ sendKind=b.dataset.k; drawSend(); } };
  const paint=async()=>{ const team=$("tx-team").value; B.dataset.team=team; const gs=open.filter(g=>g.team===team);
    $("tx-games").innerHTML=gs.map((g,i)=>`<label class="txpick"><input type="${sendKind==="season"?"checkbox":"radio"}" name="txg" value="${esc(g.id)}"${sendKind==="season"||i===0?" checked":""}> <span><b>${esc(ctx.fmtDate(g.date))}</b> · ${esc(g.time||"TBA")} vs. ${esc(g.opp)} <span class="small muted">· ${g._filled} of ${g._n} officials</span></span></label>`).join("");
    const el=rosterL.filter(r=>K.normPhone(r.phone)&&!r.optedOut&&(!(r.sports&&r.sports.length)||r.sports.includes(team)));
    const c=await E.getCfg(); const reg=el.filter(r=>r.regular).length;
    $("tx-who").textContent=el.length?`${el.length} officials can get this (${reg} regular${reg===1?"":"s"} first), ${c.waveSize} at a time, ${c.waveMins} minutes apart. Officials without a phone number, opted out, or not set to work ${team} are skipped.`:`No officials with a phone number are set to work ${team}. Add phone numbers on the Officials list.`;
    prev(); };
  const prev=async()=>{ const c=await E.getCfg(); const ids=[...$("tx-games").querySelectorAll("input:checked")].map(x=>x.value); const gs=ids.map(id=>gamesCache[id]).sort(ctx.sortGames);
    if(!gs.length){ $("tx-prev").textContent="Pick a game."; return; }
    $("tx-prev").textContent=sendKind==="season"?K.fill(c.tpl.season,{ad:c.adName,school:c.school,team:gs[0].team,list:gs.map((g,i)=>(i+1)+") "+K.tinyDate(g.date)+" at "+(g.time||"TBA")).join("\n")}):K.fill(c.tpl.single,{ad:c.adName,school:c.school,team:gs[0].team,count:gs[0]._n-gs[0]._filled,date:K.longDate(gs[0].date),time:gs[0].time||"TBA"}); };
  $("tx-team").onchange=paint; $("tx-games").onchange=prev; await paint();
  $("tx-start").onclick=async()=>{ const ids=[...$("tx-games").querySelectorAll("input:checked")].map(x=>x.value); $("tx-err").textContent=""; if(!ids.length){ $("tx-err").textContent="Pick at least one game."; return; }
    await act($("tx-start"),()=>E.startRun({kind:sendKind,gameIds:ids,team:$("tx-team").value}),"Texting started"); tab="runs"; draw(); };
}

// ---------- Running ----------
function askStatus(a){
  if(a.kind==="timechg")return a.status==="pending"?"waiting for YES to the new time":a.status==="silent"?"NO REPLY to the new time — at risk":a.status==="ambiguous"?"unclear reply (in inbox)":a.status==="closed"?"replaced by a newer change":(a.claimed||[]).length?"confirmed the new time":"said no to the new time (in inbox)";
  if(a.kind==="recon")return a.status==="pending"?"waiting for YES":a.status==="silent"?"NO REPLY — at risk":a.status==="ambiguous"?"unclear reply (in inbox)":a.status==="closed"?"removed from crew":(a.claimed||[]).length?"confirmed for tomorrow":"said no — replacement started";
  if(a.status==="pending")return "no reply yet";
  if(a.status==="ambiguous")return "unclear reply (in inbox)";
  if(a.status==="closed")return (a.apologized&&a.apologized.length?"told spot was taken":"closed");
  if(a.claimed&&a.claimed.length)return a.kind==="season"?"took "+a.claimed.map(gLabel).join(", "):"said yes";
  return "said no";
}
async function drawRuns(){
  const B=$("txBody"); const list=runsL.filter(r=>r.kind!=="timechange").sort((a,b)=>(a.status==="done")-(b.status==="done")||b.createdAt-a.createdAt);
  const tcs=runsL.filter(r=>r.kind==="timechange"&&(r.status==="queued"||Date.now()-r.createdAt<864e5)).sort((a,b)=>b.createdAt-a.createdAt);
  const tcIds=tcs.map(r=>r.gameId).filter(id=>!gamesCache[id]); if(tcIds.length){ try{ Object.assign(gamesCache,(await E.loadState(tcIds)).games); }catch(_){} }
  const tcHtml=tcs.length?`<div class="txcard"><h4>Time-change texts</h4>${tcs.map(r=>{ const g=gamesCache[r.gameId]||{};
    const what=esc((g.team||"")+" · was "+K.tinyDate(r.old.date)+" "+(r.old.time||"TBA")+", now "+(g.date?K.tinyDate(g.date):"")+" "+(g.time||"TBA"));
    return `<div class="txasks" style="margin-top:4px"><b>${what}</b><br>${r.status==="queued"?`Going out about ${fmtT(r.sendAt)}. <button class="btn" style="padding:2px 8px;font-size:12px" data-tccancel="${esc(r.gameId)}">Cancel</button> <button class="btn" style="padding:2px 8px;font-size:12px" data-tcnow="1">Send now</button>`:r.status==="sent"?"Sent "+fmtT(r.sentAt)+" to "+r.sentTo+" official"+(r.sentTo===1?"":"s"):"Cancelled"+(r.note?" — "+esc(r.note.toLowerCase()):"")}</div>`; }).join("")}</div>`:"";
  const rec=asksL.filter(a=>(a.kind==="recon"||a.kind==="timechg")&&Date.now()-a.sentAt<3*864e5).sort((a,b)=>b.sentAt-a.sentAt);
  const recIds=[...new Set(rec.flatMap(a=>a.items))].filter(id=>!gamesCache[id]); if(recIds.length){ try{ Object.assign(gamesCache,(await E.loadState(recIds)).games); }catch(_){} }
  const recHtml=rec.length?`<div class="txcard"><h4>Crew checks</h4>${rec.map(a=>`<div class="txasks" style="margin-top:3px"><b>${esc(a.name)}</b> · ${a.kind==="recon"?"day-before":"new time"} · ${esc(gLabel(a.items[0]))} ${esc((gamesCache[a.items[0]]||{}).team||"")} — ${esc(askStatus(a))}</div>`).join("")}</div>`:"";
  if(!list.length){ B.innerHTML=tcHtml+recHtml+'<p class="small muted">Nothing running. Start one on the Send tab.</p>'; bindRuns(B); return; }
  const need=[...new Set(list.flatMap(r=>r.gameIds))].filter(id=>!gamesCache[id]||!gamesCache[id]._slots);
  if(need.length){ try{ const st=await E.loadState(need); need.forEach(id=>{ if(st.games[id])gamesCache[id]=Object.assign(gamesCache[id]||{},st.games[id],{_slots:st.slots[id]}); }); }catch(_){} }
  B.innerHTML=tcHtml+recHtml+`<p class="small muted">Waves go out only while this page is open somewhere (on your phone or computer) during texting hours. Tap “Send next wave now” to skip the wait.</p>`+list.map(r=>{
    const lbl=r.status==="running"?'<span class="txst run">Running</span>':r.status==="paused"?'<span class="txst pause">Paused</span>':r.status==="stopped"?'<span class="txst done">Stopped</span>':'<span class="txst done">Done — crews full</span>';
    const texted=new Set(asksL.filter(a=>a.runId===r.id).map(a=>a.refId)).size;
    const wave=r.status==="running"?(r.nextIdx>=r.queue.length?"Everyone on the list has been texted.":"Next wave about "+fmtT(r.nextWaveAt)+"."):"";
    const games=r.gameIds.map(id=>{ const g=gamesCache[id]||{}; const sl=(g._slots||[]); const n=g.team?ctx.slotsFor(g):sl.length; const chips=[];
      for(let i=0;i<n;i++){ const x=sl[i]; chips.push(x&&x.name?`<span class="txchip">${esc(x.name)}${x.confirmed?" ✓":""}<button data-drop="${esc(id)}" data-name="${esc(x.name)}" title="Remove from crew and find a replacement">Drop</button></span>`:'<span class="txchip open">Open</span>'); }
      return `<div class="txgame"><b>${esc(g.date?ctx.fmtDate(g.date):"")}</b> ${esc(g.time||"")} vs. ${esc(g.opp||"")}<div class="crew">${chips.join("")}</div></div>`; }).join("");
    const as=asksL.filter(a=>a.runId===r.id).sort((a,b)=>a.sentAt-b.sentAt);
    const btns=r.status==="running"?`<button class="btn" data-wave="${r.id}">Send next wave now</button><button class="btn" data-set="${r.id}" data-v="paused">Pause</button><button class="btn" data-set="${r.id}" data-v="stopped">Stop</button>`:r.status==="paused"?`<button class="btn" data-set="${r.id}" data-v="running">Resume</button><button class="btn" data-set="${r.id}" data-v="stopped">Stop</button>`:"";
    return `<div class="txcard"><h4>${r.kind==="season"?"Season list":"One game"}${r.refill?" (replacing "+esc(r.refill.removed)+")":""} · ${esc(r.team)} ${lbl}</h4>
      <div class="small muted">Started ${fmtWhen(r.createdAt)} · texted ${texted} of ${r.queue.length} officials. ${wave}</div>
      ${games}
      ${as.length?`<div class="txasks">${as.map(a=>`<div><b>${esc(a.name)}</b> — ${esc(askStatus(a))}</div>`).join("")}</div>`:""}
      ${btns?`<div class="txrow">${btns}</div>`:""}</div>`; }).join("");
  bindRuns(B);
}
function bindRuns(B){
  B.onclick=async e=>{ const w=e.target.closest("[data-wave]"), s=e.target.closest("[data-set]"), d=e.target.closest("[data-drop]"), tc=e.target.closest("[data-tccancel]"), tn=e.target.closest("[data-tcnow]");
    if(tc){ if(!confirm("Cancel this time-change text? The crew won't be told."))return; return act(tc,()=>E.cancelTimeChange(tc.dataset.tccancel),"Cancelled"); }
    if(tn)return act(tn,()=>E.processTimeChanges(true),n=>n?"Sent to "+n+" official"+(n===1?"":"s"):"Nothing sent (the game may have been changed back)");
    if(w)await act(w,()=>E.sendWave(w.dataset.wave,true),n=>n?"Texted "+n+" more":"Nobody left to text, or every crew is full");
    if(s){ if(s.dataset.v==="stopped"&&!confirm("Stop this? No more waves will go out. Replies that come in are still handled."))return; await act(s,()=>E.setRun(s.dataset.set,{status:s.dataset.v}),s.dataset.v==="paused"?"Paused":s.dataset.v==="running"?"Resumed":"Stopped"); }
    if(d){ const g=gamesCache[d.dataset.drop]; if(!confirm("Remove "+d.dataset.name+" from the crew for "+(g?ctx.fmtDate(g.date):"this game")+"? The app will start texting the list for a replacement."))return;
      await act(d,()=>E.dropFromCrew(d.dataset.drop,d.dataset.name,"removed by AD"),"Removed. Looking for a replacement."); if(gamesCache[d.dataset.drop])gamesCache[d.dataset.drop]._slots=null; drawRuns(); } };
}

// ---------- Inbox ----------
const TYPE={timeno:"Can't work the new time",unclear:"Unclear reply",reply:"Reply with no open request",optout:"Opted out",unknown:"Unknown number",silent:"No reply to day-before check"};
async function drawInbox(){
  const B=$("txBody");
  if(!inboxL.length){ B.innerHTML='<p class="small muted">Nothing needs you right now.</p>'; return; }
  const askIds=[...new Set(inboxL.flatMap(i=>i.askIds||[]))]; const askMap={};
  await Promise.all(askIds.map(async id=>{ const s=await ctx.fdb.collection("txAsks").doc(id).get(); if(s.exists)askMap[id]=Object.assign({id},s.data()); }));
  const ids=[...new Set(Object.values(askMap).flatMap(a=>a.items))].filter(id=>!gamesCache[id]); if(ids.length){ const st=await E.loadState(ids); Object.assign(gamesCache,st.games); }
  try{ await loadUpcoming(); }catch(_){}
  B.innerHTML=inboxL.slice().sort((a,b)=>b.at-a.at).map(it=>{
    let acts="";
    if(it.type==="unclear"){
      acts=(it.askIds||[]).map(aid=>{ const a=askMap[aid]; if(!a)return ""; const head=`<div class="small" style="margin-top:6px"><b>${a.kind==="season"?"Season list":"One game"} · ${esc(a.team)}</b> (sent ${fmtWhen(a.sentAt)})</div>`;
        if(a.kind==="recon"||a.kind==="timechg")return `<div class="small" style="margin-top:6px"><b>${a.kind==="recon"?"Day-before check":"New time"} · ${esc(gLabel(a.items[0]))} ${esc(a.team)}</b></div><div class="txrow"><button class="btn" data-ryes="${aid}" data-i="${it.id}">Count as yes</button><button class="btn" data-rno="${aid}" data-i="${it.id}">Count as no (drop and refill)</button></div>`;
        if(a.kind==="single")return head+`<div class="txrow"><button class="btn" data-yes="${aid}" data-i="${it.id}">Count as yes</button><button class="btn" data-no="${aid}" data-i="${it.id}">Count as no</button></div>`;
        return head+a.items.map((g,n)=>`<label class="txpick"><input type="checkbox" data-pick="${aid}" value="${esc(g)}"> ${n+1}) ${esc(gLabel(g))}</label>`).join("")+`<div class="txrow"><button class="btn" data-save="${aid}" data-i="${it.id}">Put him on the checked games</button><button class="btn" data-no="${aid}" data-i="${it.id}">Count as no</button></div>`; }).join("")
        +`<div class="txrow"><button class="btn" data-manual="${it.id}">I'll reply myself</button><button class="btn" data-oo="${it.refId}" data-i="${it.id}">Mark opted out</button></div>`;
    } else if(it.type==="reply"){
      const crews=upcoming.filter(g=>(g._slots||[]).some(x=>x&&x.name&&String(x.name).toLowerCase()===String(it.name).toLowerCase()));
      acts=`<div class="txrow">${crews.map(g=>`<button class="btn" data-drop="${esc(g.id)}" data-name="${esc(it.name)}" data-i="${it.id}">Drop from ${esc(K.tinyDate(g.date))} crew</button>`).join("")}<button class="btn" data-ok="${it.id}">Done</button><button class="btn" data-oo="${it.refId}" data-i="${it.id}">Mark opted out</button></div>`;
    } else if(it.type==="timeno"){
      const aid=(it.askIds||[])[0], a=askMap[aid];
      acts=a?`<div class="small" style="margin-top:6px"><b>${esc(gLabel(a.items[0]))} ${esc(a.team)}</b> (new time)</div><div class="txrow"><button class="btn" data-rno="${aid}" data-i="${it.id}">Drop and find a replacement</button><button class="btn" data-ok="${it.id}">Leave him on</button></div>`:`<div class="txrow"><button class="btn" data-ok="${it.id}">Done</button></div>`;
    } else if(it.type==="silent"){
      const aid=(it.askIds||[])[0], a=askMap[aid];
      acts=a?`<div class="small" style="margin-top:6px"><b>${esc(gLabel(a.items[0]))} ${esc(a.team)}</b></div>`+(it.auto?`<div class="txrow"><button class="btn" data-ok="${it.id}">OK</button></div>`:`<div class="txrow"><button class="btn" data-ryes="${aid}" data-i="${it.id}">He's good (count as yes)</button><button class="btn" data-rno="${aid}" data-i="${it.id}">Drop and find a replacement</button><button class="btn" data-ok="${it.id}">Leave him on</button></div>`):`<div class="txrow"><button class="btn" data-ok="${it.id}">Done</button></div>`;
    } else if(it.type==="optout"){
      acts=`<p class="small muted">No more texts will go to this number from the app until you clear it. Only clear it if they told you they want texts again.</p><div class="txrow"><button class="btn" data-ok="${it.id}">OK</button><button class="btn" data-clear="${it.refId}" data-i="${it.id}">Clear opt-out</button></div>`;
    } else acts=`<div class="txrow"><button class="btn" data-ok="${it.id}">Done</button></div>`;
    return `<div class="txcard"><h4>${esc(TYPE[it.type]||it.type)} · ${esc(it.name||"")}</h4><div class="small muted">${esc(K.showPhone(it.phone))} · ${fmtWhen(it.at)}${it.note?" · "+esc(it.note):""}</div><div class="txq">${esc(it.body)}</div>${acts}</div>`; }).join("");
  B.onclick=async e=>{ const t=e.target.closest("button"); if(!t)return; const d=t.dataset; const res=r=>E.resolveInbox(d.i,r);
    if(d.yes)return act(t,async()=>{ const r=await E.applyClaim(d.yes,[ (await ctx.fdb.collection("txAsks").doc(d.yes).get()).data().items[0] ]); await res(r.full.length?"Counted as yes, but the crew was already full (apology sent)":"Counted as yes"); return r; },r=>r.full.length?"Crew was already full — he got the apology text":"He's on the crew");
    if(d.no)return act(t,async()=>{ await E.applyNo(d.no); await res("Counted as no"); },"Counted as no");
    if(d.ryes)return act(t,async()=>{ await E.applyCheck(askMap[d.ryes],true); await res("Counted as yes"); },"Confirmed");
    if(d.rno){ const a=askMap[d.rno]; if(!confirm("Remove "+a.name+" from this crew and start texting for a replacement?"))return;
      return act(t,async()=>{ if(a.kind==="recon")await E.applyRecon(a.id,false); else { await E.markAskHandled(a.id); await E.dropFromCrew(a.items[0],a.name,"can't work the new time"); } await res("Dropped; re-running the list"); },"Removed. Looking for a replacement."); }
    if(d.save){ const ids=[...B.querySelectorAll(`input[data-pick="${d.save}"]:checked`)].map(x=>x.value); if(!ids.length){ ctx.toast("Check at least one game, or tap Count as no."); return; }
      return act(t,async()=>{ const r=await E.applyClaim(d.save,ids); await res(r.summary); return r; },r=>r.summary); }
    if(d.manual)return act(t,async()=>{ const it=inboxL.find(x=>x.id===d.manual); for(const a of (it.askIds||[]))await E.markAskHandled(a); await res("AD replied himself"); },"Marked handled");
    if(d.oo){ if(!confirm("Stop all texts to this official?"))return; return act(t,async()=>{ await E.optOut(d.oo); await res("Marked opted out"); },"Opted out"); }
    if(d.clear){ if(!confirm("Clear the opt-out? Only do this if they asked to get texts again."))return; return act(t,async()=>{ await E.clearOptOut(d.clear); await res("Opt-out cleared"); },"Opt-out cleared"); }
    if(d.drop){ if(!confirm("Remove "+d.name+" from this crew? The app will text the list for a replacement."))return; return act(t,async()=>{ await E.dropFromCrew(d.drop,d.name,"official asked out"); await res("Dropped from crew; re-running the list"); },"Removed. Looking for a replacement."); }
    if(d.ok)return act(t,()=>E.resolveInbox(d.ok,"Done"),"Done");
  };
}

// ---------- Log ----------
function drawLog(){
  const B=$("txBody");
  B.innerHTML=`<p class="small muted">Every text sent and received, newest first (last 200). Each game's texts also show on its edit form.</p>`+(logL.length?logL.map(m=>`<div class="txlog"><div class="h">${fmtWhen(m.at)} · ${m.dir==="out"?"Sent to":m.dir==="in"?"From":"Note"} <b>${esc(m.name||"")}</b>${m.phone?" "+esc(K.showPhone(m.phone)):""}${(m.gameIds||[]).length?" · "+esc(m.gameIds.map(gLabel).join(", ")):""}</div><div class="b">${esc(m.body)}</div>${m.result?`<div class="r">→ ${esc(m.result)}</div>`:""}</div>`).join(""):'<p class="small muted">No texts yet.</p>');
}

// ---------- Test phone ----------
async function drawTest(){
  const B=$("txBody"); if(!rosterL.length)try{ rosterL=await E.roster(); }catch(_){}
  const people=rosterL.filter(r=>K.normPhone(r.phone)); if(!testRef&&people[0])testRef=people[0].id;
  const r=people.find(x=>x.id===testRef); const ph=r?K.normPhone(r.phone):"";
  const thread=logL.filter(m=>m.phone===ph&&m.dir!=="note").slice().reverse();
  B.innerHTML=`<p class="small muted">Pretend to be an official. Pick one, read what the app sent him, and type his reply.</p>
    <label class="lbl" for="tx-tref">Official</label> <select id="tx-tref">${people.map(x=>`<option value="${esc(x.id)}"${x.id===testRef?" selected":""}>${esc(x.name)}${x.optedOut?" (opted out)":""}</option>`).join("")}<option value="__unknown"${testRef==="__unknown"?" selected":""}>A number not on the list</option></select>
    <div class="txthread" id="tx-thread">${thread.length?thread.map(m=>`<div class="txb ${m.dir}">${esc(m.body)}<small>${fmtT(m.at)}${m.result?" · "+esc(m.result):""}</small></div>`).join(""):'<span class="small muted">No texts with this number yet.</span>'}</div>
    <textarea id="tx-reply" placeholder="Type his reply, like YES, NO, 1 3, or anything else" style="min-height:56px"></textarea>
    <div class="row" style="margin-top:6px"><button class="btn primary" id="tx-send">Send reply</button></div>
    <div class="txcard" style="margin-top:16px"><h4>Day-before check</h4><p class="small muted">These go out on their own the day before each game at the time set in Settings. To test, send them now for any game date.</p>
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><input type="date" id="tx-rdate" value="${esc(E.tomorrowIso())}"><button class="btn" id="tx-rsend">Send day-before checks now</button></div></div>`;
  const th=$("tx-thread"); th.scrollTop=th.scrollHeight;
  $("tx-tref").onchange=e=>{ testRef=e.target.value; drawTest(); };
  $("tx-rsend").onclick=()=>{ const d=$("tx-rdate").value; if(!d)return; act($("tx-rsend"),()=>E.sendDayBefore(d),n=>n?"Sent "+n+" day-before check"+(n===1?"":"s"):"Nobody to check for that date (no crew, no phone numbers, or already sent)"); };
  $("tx-send").onclick=async()=>{ const body=$("tx-reply").value.trim(); if(!body)return; const phone=testRef==="__unknown"?"6185550199":ph;
    await act($("tx-send"),()=>E.inbound(phone,body),r=>String(r||"Received")); };
}

// ---------- Settings ----------
async function drawSet(){
  const B=$("txBody"); const c=await E.getCfg(true);
  const hrs=Array.from({length:24},(_,h)=>h);
  const hl=h=>(h%12||12)+":00 "+(h<12?"AM":"PM");
  B.innerHTML=`<div class="form">
    <div class="two"><label><span class="lbl">AD name in texts</span><input type="text" id="ts-ad" value="${esc(c.adName)}"></label><label><span class="lbl">School name in texts</span><input type="text" id="ts-sch" value="${esc(c.school)}"></label></div>
    <div class="two"><label><span class="lbl">Officials per wave</span><input type="number" min="1" max="20" id="ts-wave" value="${esc(c.waveSize)}"></label><label><span class="lbl">Minutes between waves</span><input type="number" min="1" max="1440" id="ts-mins" value="${esc(c.waveMins)}"></label></div>
    <div class="two"><label><span class="lbl">Texting starts</span><select id="ts-sh">${hrs.map(h=>`<option value="${h}"${h===+c.startHour?" selected":""}>${hl(h)}</option>`).join("")}</select></label><label><span class="lbl">Texting stops</span><select id="ts-eh">${hrs.map(h=>`<option value="${h}"${h===+c.endHour?" selected":""}>${hl(h)}</option>`).join("")}</select></label></div>
    <p class="small muted">Waves wait until texting hours. “Send next wave now” and “Start texting” go out right away.</p>
    <div class="lbl">Day-before check</div>
    <div class="two"><label><span class="lbl">Send at</span><select id="ts-rh">${hrs.map(h=>`<option value="${h}"${h===+c.recHour?" selected":""}>${hl(h)}</option>`).join("")}</select></label><label><span class="lbl">Hours to reply</span><input type="number" min="1" max="24" id="ts-rd" value="${esc(c.recDeadlineHrs)}"></label></div>
    <label class="chk"><input type="checkbox" id="ts-ar"${c.autoRefill?" checked":""}> If an official doesn't reply in time, drop him and find a replacement automatically</label>
    <p class="small muted">Off: a silent official is flagged in the Inbox as at risk, and you decide. On: he's released and the list is re-run on its own.</p>
    <label><span class="lbl">Wait before texting a game time change (minutes)</span><input type="number" min="1" max="120" id="ts-tcm" value="${esc(c.timeChgMins)}"></label>
    <p class="small muted">Gives you time to fix an accidental change. If the game goes back to its old time in that window, nothing is sent.</p>
    <div class="lbl">Officials' calendar</div>
    <label><span class="lbl">Calendar feed link (Google Apps Script web app URL)</span><input type="text" id="ts-cal" value="${esc(c.calUrl||"")}" placeholder="https://script.google.com/macros/s/.../exec"></label>
    <p class="small muted">Once this is filled in, the first text an official gets after taking a game includes his personal calendar link (only once). Leave it blank until the calendar script is set up.</p>
    <div class="lbl">Text wording</div>
    <p class="small muted">Words in {braces} are filled in for you: {ad}, {school}, {team}, {date} (Tuesday, December 8), {short} (December 8), {time}, {list}, {count}, {dates}, {name}, {crew}, {left}, {partners}, {change} (what changed, e.g. "time has changed from 6:00 PM to 6:30 PM"), {calendar} (adds the calendar link paragraph the first time only), {link} (the link itself, in that paragraph).</p>
    ${Object.keys(K.DEFAULTS.tpl).map(k=>`<label><span class="lbl">${esc(K.TPL_LABELS[k])}</span><textarea id="ts-t-${k}">${esc(c.tpl[k])}</textarea></label>`).join("")}
    <div class="row"><button class="btn primary" id="ts-save">Save</button><button class="btn" id="ts-reset">Put back the original wording</button></div><p class="err" id="ts-err"></p></div>`;
  const read=()=>{ const tpl={}; Object.keys(K.DEFAULTS.tpl).forEach(k=>tpl[k]=$("ts-t-"+k).value); return {adName:$("ts-ad").value.trim(),school:$("ts-sch").value.trim()||"Sandoval",waveSize:Math.max(1,+$("ts-wave").value||3),waveMins:Math.max(1,+$("ts-mins").value||15),startHour:+$("ts-sh").value,endHour:+$("ts-eh").value,recHour:+$("ts-rh").value,recDeadlineHrs:Math.max(1,+$("ts-rd").value||4),autoRefill:$("ts-ar").checked,timeChgMins:Math.max(1,+$("ts-tcm").value||10),calUrl:$("ts-cal").value.trim(),tpl}; };
  $("ts-save").onclick=()=>{ const v=read(); $("ts-err").textContent=""; if(v.endHour<=v.startHour){ $("ts-err").textContent="Texting has to stop after it starts."; return; }
    if(v.calUrl&&!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v.calUrl)){ $("ts-err").textContent="The calendar link should start with https://script.google.com/ and end with /exec."; return; }
    if(v.calUrl&&!(v.tpl.got.includes("{calendar}")&&v.tpl.update.includes("{calendar}"))){ $("ts-err").textContent="Add {calendar} to the thank-you after picking games and to the crew update, so officials get their calendar link as soon as they take a game."; return; }
    if(v.calUrl&&!v.tpl.calNote.includes("{link}")){ $("ts-err").textContent="The calendar link paragraph needs {link} where the link goes."; return; }
    act($("ts-save"),async()=>{ await E.saveCfg(v); await ctx.fdb.collection("meta").doc("calFeed").set({url:v.calUrl}); },"Saved"); };
  $("ts-reset").onclick=()=>{ if(!confirm("Put every text back to the original wording?"))return; Object.keys(K.DEFAULTS.tpl).forEach(k=>$("ts-t-"+k).value=K.DEFAULTS.tpl[k]); ctx.toast("Click Save to keep it"); };
}

// ---------- game form: texts for this game ----------
async function gameLog(g,el){
  if(!el)return; el.innerHTML=""; if(!g||!E)return;
  try{ const s=await ctx.fdb.collection("txLog").where("gameIds","array-contains",g.id).get(); const m=s.docs.map(d=>d.data()).sort((a,b)=>a.at-b.at); if(!m.length)return;
    el.innerHTML=`<details class="offs" style="padding:8px 10px"><summary class="lbl" style="cursor:pointer">Texts for this game (${m.length})</summary>${m.map(x=>`<div class="txlog"><div class="h">${fmtWhen(x.at)} · ${x.dir==="out"?"Sent to":x.dir==="in"?"From":"Note"} <b>${esc(x.name||"")}</b></div><div class="b">${esc(x.body)}</div>${x.result?`<div class="r">→ ${esc(x.result)}</div>`:""}</div>`).join("")}</details>`;
  }catch(_){}
}

// ---------- start / stop ----------
function watch(){
  stop(); const db=ctx.fdb; const since=Date.now()-30*864e5;
  unsubs.push(db.collection("txRuns").where("createdAt",">=",since).onSnapshot(s=>{ runsL=s.docs.map(d=>Object.assign({id:d.id},d.data())); runsL.forEach(r=>r.gameIds.forEach(id=>{ if(gamesCache[id])gamesCache[id]._slots=null; })); redraw(); },()=>{}));
  unsubs.push(db.collection("txAsks").where("sentAt",">=",since).onSnapshot(s=>{ asksL=s.docs.map(d=>Object.assign({id:d.id},d.data())); redraw(); },()=>{}));
  unsubs.push(db.collection("txInbox").where("status","==","open").onSnapshot(s=>{ inboxL=s.docs.map(d=>Object.assign({id:d.id},d.data())); redraw(); },()=>{}));
  unsubs.push(db.collection("txLog").orderBy("at","desc").limit(200).onSnapshot(s=>{ logL=s.docs.map(d=>d.data()); redraw(); },()=>{}));
  const t=()=>E.tick().catch(()=>{}); setTimeout(t,4000); timer=setInterval(t,30000);
}
function stop(){ unsubs.forEach(u=>{ try{u();}catch(_){} }); unsubs=[]; if(timer)clearInterval(timer); timer=null; runsL=[];asksL=[];inboxL=[];logL=[]; badge(); }

window.Texting={
  init(c){ ctx=c; if(!document.getElementById("txCss")){ const st=document.createElement("style"); st.id="txCss"; st.textContent=CSS; document.head.appendChild(st); }
    E=K.createEngine({db:c.fdb,slotsFor:c.slotsFor,calPage:new URL("cal.html",location.href.split("?")[0].split("#")[0]).href}); watch(); },
  stop(){ stop(); E=null; },
  open(){ if(!E)return; shell(); ctx.showSheet("txSheet"); draw(); },
  // After a saved game's date or time changed: ask whether to text the crew. Nothing is texted unless the AD taps "Text the crew".
  async onGameTimeChange(gameId,old){
    if(!E)return;
    try{
      const q=await ctx.fdb.collection("txRuns").doc("tc_"+gameId).get(); const queued=q.exists&&q.data().status==="queued"?q.data():null;
      const g=(await ctx.fdb.collection("games").doc(gameId).get()).data();
      if(queued&&queued.old.date===g.date&&(queued.old.time||"")===(g.time||"")){ await E.cancelTimeChange(gameId); ctx.toast("Back to the original time, so the waiting time-change text was cancelled."); return; }
      const from=queued?queued.old:old; const pv=await E.timeChangePreview(gameId,from);
      if(!pv.textable.length)return;
      const c=await E.getCfg(); const m=document.createElement("div"); m.className="txmodal";
      m.innerHTML=`<div class="box" role="dialog" aria-label="Text the crew"><h4>Text the crew about the change?</h4>
        <p class="small muted" style="margin:0 0 6px">Goes to ${esc(K.andList(pv.textable))}${pv.untextable.length?". Can't text "+esc(K.andList(pv.untextable))+" (no phone number or opted out), so tell them yourself":""}. Each one has to reply YES.</p>
        <div class="txq">${esc(pv.body)}</div>
        ${queued?'<p class="small muted">A time-change text for this game is already waiting. Texting updates it to the newest time; not texting cancels it.</p>':""}
        <button class="btn primary" data-m="send">Text the crew (goes out in ${esc(c.timeChgMins)} minutes)</button>
        <button class="btn" data-m="skip">Save without texting</button>
        <p class="small muted" style="margin-top:8px">If this was a mistake, change it back within ${esc(c.timeChgMins)} minutes and nothing is sent. You can also cancel it on the Officials texting → Running tab.</p></div>`;
      document.body.appendChild(m); m.querySelector("[data-m=send]").focus();
      m.onclick=async e=>{ const b=e.target.closest("[data-m]"); if(!b)return; m.remove();
        if(b.dataset.m==="send"){ const at=await E.queueTimeChange(gameId,from); ctx.toast("Crew will be texted about "+fmtT(at)+" unless it's changed back"); }
        else if(queued){ await E.cancelTimeChange(gameId); ctx.toast("Saved. The waiting time-change text was cancelled."); } };
    }catch(e){ console.error(e); }
  },
  gameLog
};
})();
