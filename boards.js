/* Boards: an AD-only, Trello-style section of the scheduler.
   Board -> ordered lists -> ordered cards. Cards have labels (always shown as text), custom fields shown on the card
   front, checklists (x/y badge), an optional due date, a description, and comments.
   Firestore: boards/{id} (lists, labels, fields) and boardCards/{id}. Both AD-only in the rules.
   Automation (Jarvis spec, mirrors the two Butler rules):
     1. Coaches board: adding MISSING HEAD COACH / MISSING ASSISTANT removes FULLY STAFFED and creates
        "{card} — Head Coach" / "{card} — Assistant Coach" in the Coach Hiring board's first list.
     2. A card's "Season Items" checklist reaching all done adds SEASON ITEMS DONE.
*/
(function(root){
"use strict";
const rid=()=>Math.random().toString(36).slice(2,10);
const byName=(arr,n)=>(arr||[]).find(x=>String(x.name).toLowerCase()===String(n).toLowerCase());

// ---------- automation (pure: returns what to change; the caller writes it) ----------
function automation(boards,board,before,after){
  const out={patch:{},create:[]};
  if(!board)return out;
  const added=(after.labels||[]).filter(l=>!(before.labels||[]).includes(l));
  const lab=n=>byName(board.labels,n);
  if(board.key==="coaches"&&added.length){
    const hiring=boards.find(b=>b.key==="hiring");
    const vac=[["MISSING HEAD COACH","Head Coach"],["MISSING ASSISTANT","Assistant Coach"]];
    for(const [trig,role] of vac){
      const t=lab(trig); if(!t||!added.includes(t.id))continue;
      const fs=lab("FULLY STAFFED"); const cur=out.patch.labels||after.labels||[];
      if(fs&&cur.includes(fs.id))out.patch.labels=cur.filter(x=>x!==fs.id);
      if(hiring&&hiring.lists&&hiring.lists[0]){ const hl=byName(hiring.labels,role);
        out.create.push({boardId:hiring.id,listId:hiring.lists[0].id,title:after.title+" — "+role,labels:hl?[hl.id]:[]}); }
    }
  }
  const si=(after.checklists||[]).find(c=>String(c.name).toLowerCase()==="season items");
  const sb=(before.checklists||[]).find(c=>String(c.name).toLowerCase()==="season items");
  const full=c=>!!(c&&c.items&&c.items.length&&c.items.every(i=>i.done));
  if(full(si)&&!full(sb)){ const d=lab("SEASON ITEMS DONE"); const cur=out.patch.labels||after.labels||[]; if(d&&!cur.includes(d.id))out.patch.labels=cur.concat([d.id]); }
  return out;
}

// ---------- seed: builds boards from a starter file the AD picks (kept off the public repo) ----------
function seedPlan(S){
  // S = {boards:[{key,name,lists:[..],labels:[[name,color]],fields:[[name,type]],cards:[{title,list,labels,fields,checklists:[[name,[items]]],due,desc,comments}]}]}
  const boards=[], cards=[];
  S.boards.forEach((b,bi)=>{
    const id="bd_"+b.key;
    const lists=b.lists.map(n=>({id:"l_"+rid(),name:n}));
    const labels=(b.labels||[]).map(l=>({id:"lb_"+rid(),name:l[0],color:({green:"blue",lime:"teal"})[l[1]]||l[1]}));
    const fields=(b.fields||[]).map(f=>({id:"f_"+rid(),name:f[0],type:f[1]}));
    boards.push({id,key:b.key,name:b.name,order:bi,lists,labels,fields});
    (b.cards||[]).forEach((c,ci)=>{
      const list=lists[c.list||0]; const fv={};
      Object.entries(c.fields||{}).forEach(([k,v])=>{ const f=byName(fields,k); if(f)fv[f.id]=v; });
      cards.push({id:"c_"+rid(),boardId:id,listId:list.id,pos:(ci+1)*1000,title:c.title,desc:c.desc||"",
        labels:(c.labels||[]).map(n=>{ const l=byName(labels,n); return l&&l.id; }).filter(Boolean),fields:fv,
        checklists:(c.checklists||[]).map(cl=>({id:"k_"+rid(),name:cl[0],items:cl[1].map(t=>({id:"i_"+rid(),text:t,done:false}))})),
        due:c.due||"",comments:(c.comments||[]).map(t=>({by:"From Trello",text:t,at:Date.parse("2026-11-24T12:00:00")}))});
    });
  });
  return {boards,cards};
}

// ---------- screens ----------
let ctx=null, boards=[], cards=[], cur=null, unsubB=null, unsubC=null, openCard=null, dragId=null;
const $=id=>document.getElementById(id), esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// No red-vs-green: Trello's green shows as blue and lime as teal. Every label also shows its name.
const COLORS={red:"#c8102e",orange:"#c2410c",yellow:"#a16207",teal:"#0f766e",blue:"#1d4ed8",purple:"#7e22ce",gray:"#57534e"};
const COLOR_OF={green:"blue",lime:"teal"};
const CSS=`
#bdSheet{max-width:none;width:100vw}
.bdTabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px}
.bdTabs button{white-space:nowrap}
.bdWrap{display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:12px;scroll-snap-type:x mandatory}
.bdList{flex:0 0 min(300px,82vw);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px;scroll-snap-align:start}
.bdList.over{outline:2px dashed var(--ink)}
.bdLH{display:flex;justify-content:space-between;align-items:center;gap:6px;font-weight:700;font-size:14px;margin:2px 2px 8px}
.bdLH button{border:0;background:none;cursor:pointer;font-size:16px;color:var(--muted)}
.bdCard{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer;font-size:14px}
.bdCard:hover{border-color:var(--ink)}
.bdCard .t{font-weight:600;margin:2px 0}
.bdLabs{display:flex;flex-wrap:wrap;gap:4px}
.bdLab{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:4px;padding:1px 6px;letter-spacing:.02em}
.bdF{font-size:12.5px;color:var(--muted)} .bdF b{color:var(--ink);font-weight:600}
.bdBadges{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--muted);margin-top:4px}
.bdBadges .done{font-weight:700;color:var(--ink)} .bdBadges .late{font-weight:700;color:var(--scarlet)}
.bdAdd{width:100%;border:1px dashed var(--line);background:none;border-radius:8px;padding:6px;cursor:pointer;color:var(--muted);font:inherit;font-size:13px}
.bdModal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:70;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto}
.bdBox{background:var(--surface);color:var(--ink);border-radius:12px;max-width:560px;width:100%;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.bdBox h5{margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.bdBox input[type=text],.bdBox input[type=number],.bdBox input[type=date],.bdBox textarea,.bdBox select{width:100%;font:inherit;font-size:15px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);box-sizing:border-box}
.bdBox textarea{min-height:70px}
.bdBox .ttl{font-size:18px;font-weight:700}
.bdLabT{border:2px solid transparent;opacity:.45;cursor:pointer}
.bdLabT[aria-pressed=true]{opacity:1;border-color:var(--ink)}
.bdItem{display:flex;gap:8px;align-items:center;padding:3px 0}
.bdItem input[type=checkbox]{width:18px;height:18px;flex:none}
.bdItem span{flex:1} .bdItem.done span{text-decoration:line-through;color:var(--muted)}
.bdItem button,.bdX{border:0;background:var(--bg);border-radius:99px;padding:2px 8px;font-size:12px;cursor:pointer}
.bdCm{border-top:1px solid var(--line);padding:6px 0;font-size:14px;white-space:pre-wrap} .bdCm small{display:block;color:var(--muted);font-size:12px}
.bdRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
`;
const C=n=>ctx.fdb.collection(n);
const curBoard=()=>boards.find(b=>b.id===cur)||boards[0];
const listCards=lid=>cards.filter(c=>c.listId===lid).sort((a,b)=>a.pos-b.pos);
const whoAmI=()=>{ try{ return localStorage.getItem("bdName")||""; }catch(_){ return ""; } };
const today=()=>{ const d=new Date(),p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
const fmtDue=s=>{ const [y,m,d]=s.split("-").map(Number); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]+" "+d+", "+y; };
const labChip=l=>`<span class="bdLab" style="background:${COLORS[l.color]||COLORS.gray}">${esc(l.name)}</span>`;

async function saveCard(id,patch){
  const before=cards.find(c=>c.id===id); if(!before)return;
  const after=Object.assign({},before,patch);
  const b=boards.find(x=>x.id===before.boardId);
  const auto=automation(boards,b,before,after);
  Object.assign(patch,auto.patch); Object.assign(after,auto.patch);
  try{
    await C("boardCards").doc(id).update(patch);
    for(const n of auto.create){ const there=(await C("boardCards").where("boardId","==",n.boardId).get()).docs.map(d=>d.data()).filter(x=>x.listId===n.listId);
      const pos=Math.max(0,...there.map(x=>x.pos||0))+1000;
      await C("boardCards").add({boardId:n.boardId,listId:n.listId,pos,title:n.title,desc:"",labels:n.labels,fields:{},checklists:[],due:"",comments:[]}); }
    const sid=board=>{ const l=byName(b.labels,"SEASON ITEMS DONE"); return l&&(auto.patch.labels||[]).includes(l.id)&&!(before.labels||[]).includes(l.id); };
    if(auto.create.length)ctx.toast("Added "+auto.create.map(x=>"“"+x.title+"”").join(" and ")+" to Coach Hiring");
    else if(sid())ctx.toast("Season items done — label added");
  }catch(e){ ctx.toast("Couldn't save. If this is new, the Firestore rules need publishing."); console.error(e); }
}
const saveBoard=(patch)=>C("boards").doc(curBoard().id).update(patch).catch(()=>ctx.toast("Couldn't save."));

function draw(){
  const S=$("bdSheet"); if(!S||S.hidden)return; const b=curBoard();
  if(!boards.length){
    $("bdBody").innerHTML=`<p class="small muted">No boards yet.</p><div class="row"><label class="btn primary" for="bd-seedfile">Load starter boards from a file</label><input type="file" id="bd-seedfile" accept=".json,application/json" hidden><button class="btn" id="bd-new">New board</button></div>
      <p class="small muted">The starter file stays on your device. It's never stored in the scheduler's code, which is public on GitHub.</p>`;
    $("bd-seedfile").onchange=async e=>{ const f=e.target.files[0]; e.target.value=""; if(!f)return; try{ seed(JSON.parse(await f.text())); }catch(_){ ctx.toast("That file isn't a boards starter file."); } };
    $("bd-new").onclick=newBoard; return;
  }
  cur=b.id;
  $("bdBody").innerHTML=`<div class="bdTabs" role="tablist">${boards.map(x=>`<button class="btn" role="tab" aria-pressed="${x.id===b.id}" data-bd="${esc(x.id)}">${esc(x.name)}</button>`).join("")}<button class="btn" id="bd-new">+ Board</button></div>
    <div class="bdWrap">${b.lists.map((l,li)=>`<div class="bdList" data-list="${esc(l.id)}"><div class="bdLH"><span>${esc(l.name)} <span class="small muted">${listCards(l.id).length}</span></span><button data-lmenu="${esc(l.id)}" aria-label="List options for ${esc(l.name)}">⋯</button></div>
      ${listCards(l.id).map(c=>cardFront(b,c)).join("")}
      <button class="bdAdd" data-addcard="${esc(l.id)}">+ Add a card</button></div>`).join("")}
      <div class="bdList" style="background:none;border-style:dashed"><button class="bdAdd" id="bd-addlist">+ Add a list</button></div></div>
    <div class="row"><button class="btn" id="bd-labels">Labels and fields</button><button class="btn" id="bd-rename">Rename board</button></div>`;
  bind();
}
function cardFront(b,c){
  const labs=(c.labels||[]).map(id=>b.labels.find(l=>l.id===id)).filter(Boolean);
  const fv=b.fields.filter(f=>c.fields&&c.fields[f.id]!==undefined&&c.fields[f.id]!=="").map(f=>`<div class="bdF">${esc(f.name)}: <b>${esc(f.type==="number"&&f.name.match(/cost/i)?"$"+Number(c.fields[f.id]).toLocaleString():c.fields[f.id])}</b></div>`).join("");
  const items=(c.checklists||[]).flatMap(k=>k.items); const dn=items.filter(i=>i.done).length;
  const late=c.due&&c.due<today();
  const badges=[items.length?`<span class="${dn===items.length?"done":""}">☑ ${dn}/${items.length}${dn===items.length?" done":""}</span>`:"",
    c.due?`<span class="${late?"late":""}">${late?"OVERDUE · ":"Due "}${esc(fmtDue(c.due))}</span>`:"",
    (c.comments||[]).length?`<span>${c.comments.length} comment${c.comments.length===1?"":"s"}</span>`:"",c.desc?"<span>≡ notes</span>":""].filter(Boolean).join("");
  return `<div class="bdCard" draggable="true" data-card="${esc(c.id)}">${labs.length?`<div class="bdLabs">${labs.map(labChip).join("")}</div>`:""}<div class="t">${esc(c.title)}</div>${fv}${badges?`<div class="bdBadges">${badges}</div>`:""}</div>`;
}
function bind(){
  const B=$("bdBody");
  B.onclick=async e=>{
    const t=e.target.closest("[data-bd]"); if(t){ cur=t.dataset.bd; watchCards(); return; }
    if(e.target.closest("#bd-new"))return newBoard();
    if(e.target.closest("#bd-addlist")){ const n=(prompt("Name of the new list?")||"").trim(); if(n)saveBoard({lists:curBoard().lists.concat([{id:"l_"+rid(),name:n}])}); return; }
    if(e.target.closest("#bd-rename")){ const n=(prompt("Board name:",curBoard().name)||"").trim(); if(n)saveBoard({name:n}); return; }
    if(e.target.closest("#bd-labels"))return labelsEditor();
    const lm=e.target.closest("[data-lmenu]"); if(lm)return listMenu(lm.dataset.lmenu);
    const ac=e.target.closest("[data-addcard]"); if(ac){ const n=(prompt("Card title?")||"").trim(); if(!n)return;
      const pos=Math.max(0,...listCards(ac.dataset.addcard).map(c=>c.pos))+1000;
      try{ await C("boardCards").add({boardId:curBoard().id,listId:ac.dataset.addcard,pos,title:n,desc:"",labels:[],fields:{},checklists:[],due:"",comments:[]}); }catch(_){ ctx.toast("Couldn't add. If this is new, the Firestore rules need publishing."); } return; }
    const cd=e.target.closest("[data-card]"); if(cd)return cardEditor(cd.dataset.card);
  };
  // desktop drag and drop (phones use Move in the card)
  B.ondragstart=e=>{ const c=e.target.closest("[data-card]"); if(c){ dragId=c.dataset.card; e.dataTransfer.effectAllowed="move"; } };
  B.ondragover=e=>{ const l=e.target.closest("[data-list]"); if(l&&dragId){ e.preventDefault(); B.querySelectorAll(".over").forEach(x=>x.classList.remove("over")); l.classList.add("over"); } };
  B.ondragleave=e=>{ const l=e.target.closest("[data-list]"); if(l&&!l.contains(e.relatedTarget))l.classList.remove("over"); };
  B.ondrop=e=>{ const l=e.target.closest("[data-list]"); if(!l||!dragId)return; e.preventDefault(); l.classList.remove("over");
    const before=e.target.closest("[data-card]"); moveCard(dragId,l.dataset.list,before&&before.dataset.card!==dragId?before.dataset.card:null); dragId=null; };
}
function moveCard(id,listId,beforeId){
  const others=listCards(listId).filter(c=>c.id!==id);
  let pos;
  if(beforeId){ const i=others.findIndex(c=>c.id===beforeId); const prev=others[i-1]; pos=prev?(prev.pos+others[i].pos)/2:others[i].pos-1000; }
  else pos=(others.length?others[others.length-1].pos:0)+1000;
  return saveCard(id,{listId,pos});
}
function listMenu(lid){
  const b=curBoard(); const i=b.lists.findIndex(l=>l.id===lid); const l=b.lists[i];
  const ch=prompt(`List "${l.name}". Type a choice:\n1 = rename\n2 = move left\n3 = move right\n4 = delete (only if empty)`,"");
  if(ch==="1"){ const n=(prompt("New name:",l.name)||"").trim(); if(n)saveBoard({lists:b.lists.map(x=>x.id===lid?Object.assign({},x,{name:n}):x)}); }
  else if(ch==="2"||ch==="3"){ const j=ch==="2"?i-1:i+1; if(j<0||j>=b.lists.length)return; const ls=b.lists.slice(); [ls[i],ls[j]]=[ls[j],ls[i]]; saveBoard({lists:ls}); }
  else if(ch==="4"){ if(listCards(lid).length){ ctx.toast("Move or delete its cards first."); return; } if(confirm("Delete the list "+l.name+"?"))saveBoard({lists:b.lists.filter(x=>x.id!==lid)}); }
}
async function newBoard(){
  const n=(prompt("Name of the new board?")||"").trim(); if(!n)return;
  try{ const r=await C("boards").add({name:n,key:"",order:boards.length,lists:[{id:"l_"+rid(),name:"To do"},{id:"l_"+rid(),name:"Doing"},{id:"l_"+rid(),name:"Done"}],labels:[],fields:[]}); cur=r.id; watchCards(); }catch(_){ ctx.toast("Couldn't create. If this is new, the Firestore rules need publishing."); }
}
function labelsEditor(){
  const b=curBoard(); const m=document.createElement("div"); m.className="bdModal";
  const paint=()=>{ const b=curBoard(); m.innerHTML=`<div class="bdBox"><div class="ttl">Labels and fields · ${esc(b.name)}</div>
    <h5>Labels</h5>${b.labels.map(l=>`<div class="bdRow">${labChip(l)}<button class="bdX" data-lren="${l.id}">Rename</button><select data-lcol="${l.id}" aria-label="Color for ${esc(l.name)}">${Object.keys(COLORS).map(k=>`<option${k===l.color?" selected":""}>${k}</option>`).join("")}</select><button class="bdX" data-ldel="${l.id}">Delete</button></div>`).join("")||'<p class="small muted">No labels.</p>'}
    <div class="bdRow"><button class="btn" data-ladd>+ Label</button></div>
    <p class="small muted">Labels always show their name, so color is never the only way to tell them apart.</p>
    <h5>Fields shown on card fronts</h5>${b.fields.map(f=>`<div class="bdRow"><span>${esc(f.name)} <span class="small muted">(${f.type})</span></span><button class="bdX" data-fdel="${f.id}">Delete</button></div>`).join("")||'<p class="small muted">No fields.</p>'}
    <div class="bdRow"><button class="btn" data-fadd="text">+ Text field</button><button class="btn" data-fadd="number">+ Number field</button></div>
    <div class="bdRow"><button class="btn primary" data-close>Done</button></div></div>`; };
  paint(); document.body.appendChild(m);
  m.onclick=async e=>{ const d=e.target.dataset; const b=curBoard();
    if(e.target===m||"close" in d){ m.remove(); return; }
    if("ladd" in d){ const n=(prompt("Label name?")||"").trim(); if(n){ await saveBoard({labels:b.labels.concat([{id:"lb_"+rid(),name:n,color:"gray"}])}); setTimeout(paint,150); } }
    if(d.lren){ const l=b.labels.find(x=>x.id===d.lren); const n=(prompt("Label name:",l.name)||"").trim(); if(n){ await saveBoard({labels:b.labels.map(x=>x.id===l.id?Object.assign({},x,{name:n}):x)}); setTimeout(paint,150); } }
    if(d.ldel){ if(!confirm("Delete this label? It comes off every card."))return; await saveBoard({labels:b.labels.filter(x=>x.id!==d.ldel)}); setTimeout(paint,150); }
    if(d.fadd){ const n=(prompt("Field name?")||"").trim(); if(n){ await saveBoard({fields:b.fields.concat([{id:"f_"+rid(),name:n,type:d.fadd}])}); setTimeout(paint,150); } }
    if(d.fdel){ if(!confirm("Delete this field from every card?"))return; await saveBoard({fields:b.fields.filter(x=>x.id!==d.fdel)}); setTimeout(paint,150); } };
  m.onchange=e=>{ const id=e.target.dataset.lcol; if(id){ const b=curBoard(); saveBoard({labels:b.labels.map(x=>x.id===id?Object.assign({},x,{color:e.target.value}):x)}); } };
}

function cardEditor(id){
  closeEditor(); openCard=id; const m=document.createElement("div"); m.className="bdModal"; m.id="bdEdit"; document.body.appendChild(m); paintEditor();
  m.addEventListener("click",e=>{ if(e.target===m)closeEditor(); });
}
function closeEditor(){ const m=$("bdEdit"); if(m)m.remove(); openCard=null; }
function paintEditor(){
  const m=$("bdEdit"); if(!m)return; const c=cards.find(x=>x.id===openCard); if(!c){ closeEditor(); return; }
  const b=boards.find(x=>x.id===c.boardId); if(!b)return;
  const focus=document.activeElement&&m.contains(document.activeElement)?document.activeElement.dataset.k:null;
  m.innerHTML=`<div class="bdBox" role="dialog" aria-label="Card">
    <input type="text" class="ttl" data-k="title" value="${esc(c.title)}" aria-label="Card title">
    <p class="small muted" style="margin:4px 0 0">In list: <b>${esc((b.lists.find(l=>l.id===c.listId)||{}).name||"")}</b></p>
    <h5>Labels</h5><div class="bdLabs">${b.labels.map(l=>`<button class="bdLab bdLabT" style="background:${COLORS[l.color]||COLORS.gray}" aria-pressed="${(c.labels||[]).includes(l.id)}" data-lab="${l.id}">${(c.labels||[]).includes(l.id)?"✓ ":""}${esc(l.name)}</button>`).join("")||'<span class="small muted">This board has no labels.</span>'}</div>
    ${b.fields.length?`<h5>Fields</h5>${b.fields.map(f=>`<label style="display:block;margin-bottom:6px"><span class="small">${esc(f.name)}</span><input type="${f.type==="number"?"number":"text"}" data-field="${f.id}" value="${esc((c.fields||{})[f.id]==null?"":(c.fields||{})[f.id])}"></label>`).join("")}`:""}
    <h5>Due date</h5><div class="bdRow"><input type="date" data-k="due" value="${esc(c.due||"")}" style="max-width:200px"><button class="bdX" data-nodue${c.due?"":" hidden"}>Clear</button></div>
    <h5>Description</h5><textarea data-k="desc" placeholder="Optional">${esc(c.desc||"")}</textarea>
    ${(c.checklists||[]).map(k=>{ const dn=k.items.filter(i=>i.done).length; return `<h5>${esc(k.name)} · ${dn}/${k.items.length}</h5>
      ${k.items.map(i=>`<div class="bdItem${i.done?" done":""}"><input type="checkbox" data-chk="${k.id}|${i.id}"${i.done?" checked":""} aria-label="${esc(i.text)}"><span>${esc(i.text)}</span><button data-idel="${k.id}|${i.id}" aria-label="Remove item">✕</button></div>`).join("")}
      <div class="bdRow"><button class="bdX" data-iadd="${k.id}">+ Item</button><button class="bdX" data-kdel="${k.id}">Delete checklist</button></div>`; }).join("")}
    <div class="bdRow"><button class="btn" data-kadd>+ Checklist</button></div>
    <h5>Comments</h5>${(c.comments||[]).slice().sort((a,b)=>b.at-a.at).map(x=>`<div class="bdCm">${esc(x.text)}<small>${esc(x.by||"")} · ${new Date(x.at).toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</small></div>`).join("")||'<p class="small muted">No comments.</p>'}
    <textarea data-cm placeholder="Write a comment"></textarea>
    <div class="bdRow"><input type="text" data-who value="${esc(whoAmI())}" placeholder="Your name (Andrew or Ryan)" style="max-width:200px" aria-label="Comment as"><button class="btn" data-post>Post comment</button></div>
    <h5>Move</h5><div class="bdRow"><select data-mvlist aria-label="Move to list">${b.lists.map(l=>`<option value="${l.id}"${l.id===c.listId?" selected":""}>${esc(l.name)}</option>`).join("")}</select>
      <select data-mvpos aria-label="Position"><option value="bottom">Bottom</option><option value="top">Top</option></select><button class="btn" data-mv>Move</button></div>
    <div class="bdRow" style="margin-top:14px"><button class="btn" data-copy>Copy card</button><button class="btn" data-del>Delete card</button><span class="spacer" style="flex:1"></span><button class="btn primary" data-close>Done</button></div></div>`;
  if(focus){ const el=m.querySelector(`[data-k="${focus}"]`); if(el)el.focus(); }
  const val=s=>m.querySelector(s);
  m.onchange=e=>{ const t=e.target, d=t.dataset;
    if(d.k==="title"){ const v=t.value.trim(); if(v)saveCard(c.id,{title:v}); }
    else if(d.k==="desc")saveCard(c.id,{desc:t.value});
    else if(d.k==="due")saveCard(c.id,{due:t.value||""});
    else if(d.field){ const f=b.fields.find(x=>x.id===d.field); const fields=Object.assign({},c.fields||{}); if(t.value==="")delete fields[f.id]; else fields[f.id]=f.type==="number"?Number(t.value):t.value; saveCard(c.id,{fields}); }
    else if(d.chk){ const [kid,iid]=d.chk.split("|"); saveCard(c.id,{checklists:c.checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.map(i=>i.id===iid?Object.assign({},i,{done:t.checked}):i)}))}); }
    else if("who" in d){ try{ localStorage.setItem("bdName",t.value.trim()); }catch(_){} } };
  m.onclick=e=>{ const t=e.target.closest("button"); if(!t)return; const d=t.dataset;
    if("close" in d)return closeEditor();
    if(d.lab){ const has=(c.labels||[]).includes(d.lab); saveCard(c.id,{labels:has?c.labels.filter(x=>x!==d.lab):(c.labels||[]).concat([d.lab])}); }
    if("nodue" in d)saveCard(c.id,{due:""});
    if(d.iadd){ const n=(prompt("Checklist item?")||"").trim(); if(n)saveCard(c.id,{checklists:c.checklists.map(k=>k.id!==d.iadd?k:Object.assign({},k,{items:k.items.concat([{id:"i_"+rid(),text:n,done:false}])}))}); }
    if(d.idel){ const [kid,iid]=d.idel.split("|"); saveCard(c.id,{checklists:c.checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.filter(i=>i.id!==iid)}))}); }
    if(d.kdel){ if(confirm("Delete this checklist?"))saveCard(c.id,{checklists:c.checklists.filter(k=>k.id!==d.kdel)}); }
    if("kadd" in d){ const n=(prompt("Checklist name?","Checklist")||"").trim(); if(n)saveCard(c.id,{checklists:(c.checklists||[]).concat([{id:"k_"+rid(),name:n,items:[]}])}); }
    if("post" in d){ const tx=val("[data-cm]").value.trim(); if(!tx)return; const by=val("[data-who]").value.trim()||"AD"; try{ localStorage.setItem("bdName",by); }catch(_){}
      saveCard(c.id,{comments:(c.comments||[]).concat([{by,text:tx,at:Date.now()}])}); }
    if("mv" in d){ const lid=val("[data-mvlist]").value, top=val("[data-mvpos]").value==="top"; const first=listCards(lid).filter(x=>x.id!==c.id)[0];
      moveCard(c.id,lid,top&&first?first.id:null); }
    if("copy" in d){ const n=(prompt("Title for the copy:",c.title)||"").trim(); if(!n)return;
      const copy={boardId:c.boardId,listId:c.listId,pos:c.pos+1,title:n,desc:c.desc||"",labels:(c.labels||[]).slice(),fields:Object.assign({},c.fields||{}),
        checklists:(c.checklists||[]).map(k=>({id:"k_"+rid(),name:k.name,items:k.items.map(i=>({id:"i_"+rid(),text:i.text,done:false}))})),due:c.due||"",comments:[]};
      C("boardCards").add(copy).then(()=>ctx.toast("Copied")).catch(()=>ctx.toast("Couldn't copy.")); }
    if("del" in d){ if(!confirm("Delete the card “"+c.title+"”? This can't be undone."))return; C("boardCards").doc(c.id).delete().then(closeEditor).catch(()=>ctx.toast("Couldn't delete.")); } };
}

async function seed(data){
  if(!data||!Array.isArray(data.boards)){ ctx.toast("That file isn't a boards starter file."); return; }
  if(!confirm("Load "+data.boards.length+" starter boards: "+data.boards.map(b=>b.name).join(", ")+"?"))return;
  const plan=seedPlan(data);
  try{ let b=ctx.fdb.batch(), n=0;
    for(const x of plan.boards){ const {id,...rest}=x; b.set(C("boards").doc(id),rest); n++; }
    for(const x of plan.cards){ const {id,...rest}=x; b.set(C("boardCards").doc(id),rest); if(++n>=400){ await b.commit(); b=ctx.fdb.batch(); n=0; } }
    await b.commit(); ctx.toast("Boards loaded"); }catch(e){ console.error(e); ctx.toast("Couldn't load. If this is new, the Firestore rules need publishing."); }
}

function watchCards(){
  if(unsubC)unsubC(); cards=[]; const b=curBoard(); if(!b){ draw(); return; }
  unsubC=C("boardCards").where("boardId","==",b.id).onSnapshot(s=>{ cards=s.docs.map(d=>Object.assign({id:d.id},d.data())); draw(); paintEditor(); },()=>{});
  draw();
}
// Cards from other boards are needed for automation positions only when creating hiring cards; positions there are
// computed from what's loaded, so a new hiring card may land in the middle until the list is opened. That's fine.

const api={automation,seedPlan};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.Boards=Object.assign(api,{
  init(c){ ctx=c; if(!document.getElementById("bdCss")){ const st=document.createElement("style"); st.id="bdCss"; st.textContent=CSS; document.head.appendChild(st); } },
  open(){
    $("bdSheet").innerHTML=`<h3 id="bdTitle">Boards</h3><div id="bdBody"><p class="small muted">Loading…</p></div><div class="row" style="margin-top:8px"><button class="btn" id="bd-close">Close</button></div>`;
    $("bd-close").onclick=()=>{ closeEditor(); ctx.closeSheet(); };
    ctx.showSheet("bdSheet");
    if(unsubB)unsubB();
    unsubB=C("boards").onSnapshot(s=>{ boards=s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(a.order||0)-(b.order||0)); if(!cur||!boards.find(b=>b.id===cur)){ cur=boards[0]&&boards[0].id; watchCards(); } else draw(); },
      ()=>{ $("bdBody").innerHTML='<p class="err">Couldn\'t load boards. The Firestore rules for boards need publishing first.</p>'; });
  }
});
})(typeof window!=="undefined"?window:globalThis);
