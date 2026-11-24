/* Boards: an AD-only, Trello-style section of the scheduler.
   Board -> ordered lists -> ordered cards. Firestore: boards/{id}, boardCards/{id} (both AD-only in the rules).
   Trello features: drag cards and lists (mouse, and long-press on phones), inline add/rename, card covers, labels
   (always shown with their names), members, start/due dates with "complete", description, custom fields, link
   attachments, checklists with progress, comments + activity, move/copy across boards, card templates, archive and
   restore, board filters, a due-dates view, board backgrounds.
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
  const out={patch:{},create:[],log:[]};
  if(!board)return out;
  const lab=n=>byName(board.labels,n);
  // 0. Coaches board: when a Head Coach or Assistant Coach name changes, the staffing labels follow it.
  if(board.key==="coaches"){
    const fH=byName(board.fields,"Head Coach"), fA=byName(board.fields,"Assistant Coach");
    const val=(c,f)=>f?String((c.fields||{})[f.id]||"").trim():"";
    if(fH&&fA&&(val(before,fH)!==val(after,fH)||val(before,fA)!==val(after,fA))){
      const h=!!val(after,fH), a=!!val(after,fA), mh=lab("MISSING HEAD COACH"), ma=lab("MISSING ASSISTANT"), fs=lab("FULLY STAFFED");
      let ls=(after.labels||[]).slice();
      const set=(l,on)=>{ if(!l)return; const has=ls.includes(l.id); if(on&&!has){ ls.push(l.id); out.log.push("Automation added "+l.name); } if(!on&&has){ ls=ls.filter(x=>x!==l.id); out.log.push("Automation removed "+l.name); } };
      set(mh,!h); set(ma,!a); set(fs,h&&a);
      if(ls.join()!==(after.labels||[]).join()){ out.patch.labels=ls; after=Object.assign({},after,{labels:ls}); }
    }
  }
  const added=(after.labels||[]).filter(l=>!(before.labels||[]).includes(l));
  if(board.key==="coaches"&&added.length){
    const hiring=boards.find(b=>b.key==="hiring");
    // VACANT: the whole staff is open → one hiring card for both spots
    const v=lab("VACANT");
    if(v&&added.includes(v.id)&&hiring&&hiring.lists&&hiring.lists[0]){
      out.create.push({boardId:hiring.id,listId:hiring.lists[0].id,title:after.title+" — Head & Assistant",labels:[]});
      out.log.push("Automation added “"+after.title+" — Head & Assistant” to "+hiring.name); }
    for(const [trig,role] of [["MISSING HEAD COACH","Head Coach"],["MISSING ASSISTANT","Assistant Coach"]]){
      const t=lab(trig); if(!t||!added.includes(t.id))continue;
      const fs=lab("FULLY STAFFED"); const cur=out.patch.labels||after.labels||[];
      if(fs&&cur.includes(fs.id)){ out.patch.labels=cur.filter(x=>x!==fs.id); out.log.push("Automation removed FULLY STAFFED"); }
      if(hiring&&hiring.lists&&hiring.lists[0]){ const hl=byName(hiring.labels,role);
        out.create.push({boardId:hiring.id,listId:hiring.lists[0].id,title:after.title+" — "+role,labels:hl?[hl.id]:[]});
        out.log.push("Automation added “"+after.title+" — "+role+"” to "+hiring.name); }
    }
  }
  const si=(after.checklists||[]).find(c=>String(c.name).toLowerCase()==="season items");
  const sb=(before.checklists||[]).find(c=>String(c.name).toLowerCase()==="season items");
  const full=c=>!!(c&&c.items&&c.items.length&&c.items.every(i=>i.done));
  if(full(si)&&!full(sb)){ const d=lab("SEASON ITEMS DONE"); const cur=out.patch.labels||after.labels||[];
    if(d&&!cur.includes(d.id)){ out.patch.labels=cur.concat([d.id]); out.log.push("Automation added SEASON ITEMS DONE"); } }
  return out;
}

// ---------- seed: builds boards from a starter file the AD picks (kept off the public repo) ----------
const COLOR_OF={green:"blue",lime:"teal"};
function seedPlan(S){
  const boards=[], cards=[];
  S.boards.forEach((b,bi)=>{
    const id="bd_"+(b.key||rid());
    const lists=b.lists.map(n=>({id:"l_"+rid(),name:n}));
    const labels=(b.labels||[]).map(l=>({id:"lb_"+rid(),name:l[0],color:COLOR_OF[l[1]]||l[1]}));
    const fields=(b.fields||[]).map(f=>({id:"f_"+rid(),name:f[0],type:f[1]}));
    boards.push({id,key:b.key||"",name:b.name,order:bi,bg:b.bg||"",lists,labels,fields,members:S.members||["Andrew","Ryan"]});
    (b.cards||[]).forEach((c,ci)=>{
      const list=lists[c.list||0]; const fv={};
      Object.entries(c.fields||{}).forEach(([k,v])=>{ const f=byName(fields,k); if(f)fv[f.id]=v; });
      cards.push({id:"c_"+rid(),boardId:id,listId:list.id,pos:(ci+1)*1000,title:c.title,desc:c.desc||"",
        labels:(c.labels||[]).map(n=>{ const l=byName(labels,n); return l&&l.id; }).filter(Boolean),fields:fv,
        checklists:(c.checklists||[]).map(cl=>({id:"k_"+rid(),name:cl[0],items:cl[1].map(t=>({id:"i_"+rid(),text:t,done:false}))})),
        due:c.due||"",start:"",dueDone:false,members:[],cover:"",attachments:[],template:!!c.template,archived:false,
        comments:(c.comments||[]).map(t=>({id:"m_"+rid(),by:"From Trello",text:t,at:Date.now()})),activity:[]});
    });
  });
  return {boards,cards};
}

// ---------- filters (pure) ----------
function addDays(iso,n){ const d=new Date(iso+"T12:00:00"); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
function matches(c,f,today){
  if(!f)return true;
  if(f.text){ const q=f.text.toLowerCase(); if(!(c.title||"").toLowerCase().includes(q)&&!(c.desc||"").toLowerCase().includes(q))return false; }
  if(f.labels&&f.labels.length&&!f.labels.some(l=>(c.labels||[]).includes(l)))return false;
  if(f.members&&f.members.length&&!f.members.some(m=>(c.members||[]).includes(m)))return false;
  if(f.due){ const d=c.due||""; const wk=addDays(today,7);
    if(f.due==="none"&&d)return false;
    if(f.due==="overdue"&&!(d&&d<today&&!c.dueDone))return false;
    if(f.due==="week"&&!(d&&d>=today&&d<=wk&&!c.dueDone))return false;
    if(f.due==="done"&&!c.dueDone)return false; }
  return true;
}
// position for a card dropped before `beforeId` (or at the end) among `others` (sorted, without the moving card)
function posFor(others,beforeId){
  if(!beforeId)return (others.length?others[others.length-1].pos:0)+1000;
  const i=others.findIndex(x=>x.id===beforeId);
  if(i<0)return (others.length?others[others.length-1].pos:0)+1000;
  return i===0?others[0].pos-1000:(others[i-1].pos+others[i].pos)/2;
}

// ---------- screens ----------
let ro=false, ctx=null, boards=[], cards=[], cur=null, unsubB=null, unsubC=null, openCard=null, filter=null;
const $=id=>document.getElementById(id), esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// No red-vs-green: Trello's green shows as blue and lime as teal. Every label also shows its name.
const COLORS={red:"#c8102e",orange:"#c2410c",yellow:"#a16207",teal:"#0f766e",blue:"#1d4ed8",sky:"#0369a1",purple:"#7e22ce",pink:"#be185d",black:"#1c1917",gray:"#57534e"};
const BGS={scarlet:"#7f1d1d",black:"#1c1917",blue:"#1e3a8a",teal:"#134e4a",purple:"#4c1d95",gray:"#44403c"};
const CSS=`
#bdSheet{max-width:none;width:100vw;padding:0!important;display:flex;flex-direction:column}
#bdSheet[hidden]{display:none}
.bdTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;color:#fff}
.bdTop .bdName{font-size:18px;font-weight:800;background:transparent;border:0;color:#fff;padding:4px 6px;border-radius:6px;cursor:pointer;font-family:inherit}
.bdTop .bdName:hover{background:rgba(255,255,255,.18)}
.bdTop button.bt,.bdTop select{background:rgba(255,255,255,.2);color:#fff;border:0;border-radius:6px;padding:6px 10px;font:inherit;font-size:14px;cursor:pointer}
.bdTop select option{color:#000}
.bdTop .sp{flex:1}
.bdCanvas{flex:1;display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding:4px 12px 16px;min-height:60vh}
.bdList{flex:0 0 272px;max-width:85vw;background:#f1f2f4;color:#172b4d;border-radius:12px;padding:6px 6px 8px;display:flex;flex-direction:column;max-height:calc(100vh - 150px)}
.bdLH{display:flex;align-items:center;gap:4px;padding:4px 4px 6px;cursor:grab}
.bdLH input{flex:1;min-width:0;font-weight:700;font-size:14px;border:2px solid transparent;background:transparent;border-radius:6px;padding:4px 6px;color:inherit;font-family:inherit}
.bdLH input:focus{border-color:#388bff;background:#fff;outline:0}
.bdLH .cnt{font-size:12px;color:#626f86}
.bdIcon{border:0;background:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:15px;color:#44546f}
.bdIcon:hover{background:rgba(9,30,66,.14)}
.bdCards{overflow-y:auto;min-height:6px;padding:0 2px}
.bdCard{background:#fff;border-radius:8px;box-shadow:0 1px 1px rgba(9,30,66,.25);margin-bottom:8px;cursor:pointer;overflow:hidden;font-size:14px;position:relative;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.bdCard:hover{box-shadow:0 0 0 2px #388bff}
.bdCard .cv{height:28px}
.bdCard .in{padding:7px 10px 6px}
.bdCard .t{margin:3px 0 4px;line-height:1.3;word-wrap:break-word}
.bdCard.tpl .t::before{content:"TEMPLATE · ";font-size:11px;font-weight:700;color:#44546f}
.bdLabs{display:flex;flex-wrap:wrap;gap:4px}
.bdLab{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:4px;padding:1px 7px;letter-spacing:.02em;line-height:16px}
.bdF{font-size:12.5px;color:#44546f} .bdF b{color:#172b4d;font-weight:600}
.bdBadges{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px;color:#44546f;margin-top:4px}
.bdB{display:inline-flex;align-items:center;gap:3px;border-radius:4px;padding:1px 4px}
.bdB.late{background:#c8102e;color:#fff;font-weight:700}.bdB.soon{background:#a16207;color:#fff;font-weight:700}.bdB.ok{background:#1d4ed8;color:#fff;font-weight:700}
.bdAv{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#44546f;color:#fff;font-size:11px;font-weight:700}
.bdAvs{display:flex;gap:2px;margin-left:auto}
.bdPh{background:rgba(9,30,66,.12);border-radius:8px;margin-bottom:8px}
.bdComp textarea{width:100%;box-sizing:border-box;border:0;border-radius:8px;box-shadow:0 1px 1px rgba(9,30,66,.25);padding:8px 10px;font:inherit;font-size:14px;resize:none;min-height:56px}
.bdComp .r{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.bdAddBtn{width:100%;text-align:left;border:0;background:none;border-radius:8px;padding:8px 10px;cursor:pointer;color:#44546f;font:inherit;font-size:14px}
.bdAddBtn:hover{background:rgba(9,30,66,.1);color:#172b4d}
.bdAddList{flex:0 0 272px;background:rgba(255,255,255,.24);border-radius:12px;padding:6px}
.bdAddList>.bdAddBtn{color:#fff}.bdAddList>.bdAddBtn:hover{background:rgba(255,255,255,.18);color:#fff}
.bdBlue{background:#0c66e4;color:#fff;border:0;border-radius:6px;padding:6px 12px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;display:inline-block}
.bdGrayB{background:rgba(9,30,66,.06);color:#172b4d;border:0;border-radius:6px;padding:6px 12px;font:inherit;font-size:14px;cursor:pointer;text-align:left}
.bdGrayB:hover{background:rgba(9,30,66,.14)}
.bdGrayB:disabled{opacity:.45;cursor:default}
.bdDragGhost{position:fixed;z-index:200;pointer-events:none;transform:rotate(3deg);box-shadow:0 8px 24px rgba(0,0,0,.35)!important;opacity:.95;margin:0!important}
.bdPop{position:fixed;z-index:120;background:#fff;color:#172b4d;border-radius:8px;box-shadow:0 8px 24px rgba(9,30,66,.3);width:304px;max-width:92vw;max-height:80vh;overflow:auto;padding:12px;box-sizing:border-box}
.bdPop h6{margin:0 0 10px;text-align:center;font-size:14px;color:#44546f;font-weight:600}
.bdPop .x{position:absolute;right:6px;top:6px}
.bdPop label{display:block;font-size:12px;font-weight:700;color:#44546f;margin:8px 0 4px}
.bdPop input[type=text],.bdPop input[type=url],.bdPop input[type=date],.bdPop select,.bdPop textarea{width:100%;box-sizing:border-box;border:1px solid #8590a2;border-radius:4px;padding:6px 8px;font:inherit;font-size:14px}
.bdPop .opt{display:block;width:100%;margin-bottom:4px}
.bdModal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;overflow-y:auto;padding:40px 12px}
.bdBox{background:#f1f2f4;color:#172b4d;border-radius:12px;max-width:768px;margin:0 auto;position:relative;overflow:hidden}
.bdBox .cvr{height:96px}
.bdBox .hd{display:flex;gap:10px;padding:16px 48px 4px 16px}
.bdBox .hd textarea{flex:1;font-size:20px;font-weight:700;border:2px solid transparent;background:transparent;resize:none;border-radius:6px;padding:4px 6px;font-family:inherit;color:inherit;overflow:hidden}
.bdBox .hd textarea:focus{background:#fff;border-color:#388bff;outline:0}
.bdBox .close{position:absolute;right:10px;top:10px;z-index:2;background:rgba(9,30,66,.1)}
.bdBox .sub{padding:0 16px 8px 22px;font-size:14px;color:#44546f}
.bdCols{display:flex;gap:16px;padding:0 16px 16px;flex-wrap:wrap}
.bdMain{flex:1 1 440px;min-width:0}
.bdSide{flex:0 0 168px;display:flex;flex-direction:column;gap:6px}
.bdSide .h{font-size:12px;font-weight:700;color:#44546f;margin:6px 0 2px}
@media (max-width:640px){.bdSide{flex:1 1 100%;flex-direction:row;flex-wrap:wrap;order:-1}.bdSide .h{flex:1 1 100%}.bdSide .bdGrayB{flex:1 1 40%}.bdModal{padding:0}.bdBox{border-radius:0;min-height:100%}}
.bdSec{margin:14px 0}
.bdSec h4{font-size:15px;margin:0 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bdSec h4 .sp{flex:1}
.bdChips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.bdChipBtn{border:0;border-radius:4px;background:rgba(9,30,66,.06);padding:6px 10px;cursor:pointer;font:inherit;font-size:14px}
.bdDesc{background:rgba(9,30,66,.06);border-radius:8px;padding:8px 12px;min-height:40px;white-space:pre-wrap;cursor:pointer;font-size:14px}
.bdBox textarea.ed,.bdBox input.ed{width:100%;box-sizing:border-box;border:1px solid #8590a2;border-radius:6px;padding:8px;font:inherit;font-size:14px;background:#fff}
.bdProg{display:flex;align-items:center;gap:8px;font-size:12px;color:#44546f;margin-bottom:6px}
.bdProg .bdBar{flex:1;height:8px;background:rgba(9,30,66,.1);border-radius:4px;overflow:hidden;border:0;margin:0;padding:0;display:block}.bdProg .bdFill{display:block;height:100%;background:#1d4ed8;border:0;margin:0}
.bdProg.full .bdFill{background:#0f766e}
.bdItem{display:flex;gap:10px;align-items:flex-start;padding:4px;border-radius:6px}
.bdItem:hover{background:rgba(9,30,66,.06)}
.bdItem input[type=checkbox]{width:18px;height:18px;margin-top:1px;flex:none}
.bdItem span{flex:1;font-size:14px;cursor:text}.bdItem.done span{text-decoration:line-through;color:#626f86}
.bdItem button{visibility:hidden}.bdItem:hover button{visibility:visible}
@media (hover:none){.bdItem button{visibility:visible}}
.bdAct{display:flex;gap:10px;margin:10px 0}
.bdAct .bdAv{flex:none;width:32px;height:32px;font-size:12px}
.bdAct .bd{flex:1;font-size:14px;min-width:0}
.bdAct .bd .m{font-size:12px;color:#626f86}
.bdAct .cm{background:#fff;border-radius:8px;padding:8px 12px;box-shadow:0 1px 1px rgba(9,30,66,.25);margin-top:4px;white-space:pre-wrap;word-wrap:break-word}
.bdAct .lnk{font-size:12px;color:#44546f;text-decoration:underline;cursor:pointer;margin-right:8px;border:0;background:none;padding:0}
.bdFilterOn{background:#fff!important;color:#172b4d!important;font-weight:700}
.bdPanel{position:fixed;right:0;top:0;bottom:0;width:340px;max-width:100vw;box-sizing:border-box;background:#fff;color:#172b4d;z-index:110;box-shadow:-4px 0 24px rgba(0,0,0,.25);overflow-y:auto;padding:14px}
.bdPanel h5{margin:0 0 12px;font-size:16px;text-align:center}
.bdPanel .row2{display:flex;gap:6px;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #dcdfe4;font-size:14px}
.bdPanel .opt{display:block;width:100%;margin-bottom:4px}
.bdPanel .hh{font-weight:700;font-size:13px;color:#44546f;margin:14px 0 6px}
`;
const C=n=>ctx.fdb.collection(n);
const openBoards=()=>boards.filter(x=>!x.closed);
const curBoard=()=>boards.find(b=>b.id===cur)||openBoards()[0]||boards[0];
const liveCards=()=>cards.filter(c=>!c.archived);
const listCards=lid=>liveCards().filter(c=>c.listId===lid).sort((a,b)=>a.pos-b.pos);
const me=()=>{ try{ return localStorage.getItem("bdName")||""; }catch(_){ return ""; } };
const setMe=n=>{ try{ localStorage.setItem("bdName",n); }catch(_){} };
const todayIso=()=>{ const d=new Date(),p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtD=s=>{ if(!s)return ""; const [y,m,d]=s.split("-").map(Number); return MON[m-1]+" "+d+(y!==new Date().getFullYear()?", "+y:""); };
const fmtWhen=ms=>new Date(ms).toLocaleString([],{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
const ini=n=>String(n||"?").split(/\s+/).filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase();
const labChip=l=>`<span class="bdLab" style="background:${COLORS[l.color]||COLORS.gray}">${esc(l.name)}</span>`;
const dueState=c=>{ if(!c.due)return ""; if(c.dueDone)return "ok"; const t=todayIso(); if(c.due<t)return "late"; if(c.due<=addDays(t,1))return "soon"; return ""; };
const dueText=c=>(c.dueDone?"Done · ":dueState(c)==="late"?"Overdue · ":dueState(c)==="soon"?"Due soon · ":"")+(c.start?fmtD(c.start)+" – ":"")+fmtD(c.due);
const RULES_MSG="Couldn't save. If Boards is new, the Firestore rules for boards need publishing first.";

// ---------- writes ----------
function blankCard(boardId,listId,pos,title,extra){
  return Object.assign({boardId,listId,pos,title,desc:"",labels:[],fields:{},checklists:[],due:"",start:"",dueDone:false,members:[],cover:"",attachments:[],template:false,archived:false,comments:[],activity:[{by:me()||"AD",text:"added this card",at:Date.now()}]},extra||{});
}
async function saveCard(id,patch,logText){
  if(ro)return;
  const before=cards.find(c=>c.id===id); if(!before)return;
  const after=Object.assign({},before,patch);
  const b=boards.find(x=>x.id===after.boardId);
  const auto=automation(boards,b,before,after);
  Object.assign(patch,auto.patch);
  const logs=[].concat(logText?[{by:me()||"AD",text:logText}]:[],auto.log.map(t=>({by:"Automation",text:t.replace(/^Automation /,"")})));
  if(logs.length)patch.activity=(before.activity||[]).concat(logs.map(x=>Object.assign(x,{at:Date.now()}))).slice(-80);
  try{
    await C("boardCards").doc(id).update(patch);
    for(const n of auto.create){
      const there=(await C("boardCards").where("boardId","==",n.boardId).get()).docs.map(d=>d.data()).filter(x=>x.listId===n.listId&&!x.archived);
      await C("boardCards").add(blankCard(n.boardId,n.listId,Math.max(0,...there.map(x=>x.pos||0))+1000,n.title,{labels:n.labels,activity:[{by:"Automation",text:"created this card from "+(b?b.name:"")+": "+before.title,at:Date.now()}]}));
    }
    if(auto.create.length)ctx.toast("Added "+auto.create.map(x=>"“"+x.title+"”").join(" and ")+" to Coach Hiring");
    else if(auto.log.some(t=>/SEASON ITEMS DONE/.test(t)))ctx.toast("Season items done — label added");
  }catch(e){ console.error(e); ctx.toast(RULES_MSG); }
}
const saveBoard=(patch,id)=>ro?Promise.resolve():C("boards").doc(id||curBoard().id).update(patch).catch(e=>{ console.error(e); ctx.toast(RULES_MSG); });
const copyChecklists=ks=>(ks||[]).map(k=>({id:"k_"+rid(),name:k.name,items:k.items.map(i=>({id:"i_"+rid(),text:i.text,done:false}))}));
async function addCard(listId,title,tpl){
  const pos=posFor(listCards(listId),null);
  const extra=tpl?{desc:tpl.desc||"",labels:(tpl.labels||[]).slice(),fields:Object.assign({},tpl.fields||{}),checklists:copyChecklists(tpl.checklists),cover:tpl.cover||"",attachments:(tpl.attachments||[]).slice(),members:(tpl.members||[]).slice()}:{};
  try{ await C("boardCards").add(blankCard(curBoard().id,listId,pos,title,extra)); }catch(e){ console.error(e); ctx.toast(RULES_MSG); }
}

// ---------- board view ----------
function draw(){
  const S=$("bdSheet"), body=$("bdBody"); if(!S||S.hidden||!body)return;
  if(!openBoards().length&&ro){ S.style.background=BGS.gray; body.innerHTML=`<div style="padding:20px;color:#fff"><h3 style="margin:0 0 8px">Boards (view only)</h3><p>No boards yet.</p><button class="bdGrayB" style="background:#fff" id="bd-x">Close</button></div>`; $("bd-x").onclick=close; return; }
  if(!openBoards().length){
    S.style.background=BGS.gray;
    body.innerHTML=`<div style="padding:20px;color:#fff"><h3 style="margin:0 0 8px">Boards</h3><p>No boards yet.</p>
      <div class="bdChips"><label class="bdBlue" for="bd-seedfile">Load starter boards from a file</label><input type="file" id="bd-seedfile" accept=".json,application/json" hidden><button class="bdGrayB" style="background:#fff" id="bd-new">Create a board</button>${boards.length?`<button class="bdGrayB" style="background:#fff" id="bd-reopen">Reopen a closed board</button>`:""}<button class="bdGrayB" style="background:#fff" id="bd-x">Close</button></div>
      <p style="opacity:.85;font-size:13px">The starter file stays on your device. It's never put in the scheduler's code, which is public on GitHub.</p></div>`;
    $("bd-seedfile").onchange=async e=>{ const f=e.target.files[0]; e.target.value=""; if(!f)return; try{ seed(JSON.parse(await f.text())); }catch(_){ ctx.toast("That file isn't a boards starter file."); } };
    $("bd-new").onclick=newBoard; $("bd-x").onclick=close; if($("bd-reopen"))$("bd-reopen").onclick=archivePanel; return;
  }
  const b=curBoard(); cur=b.id;
  S.style.background=BGS[b.bg]||BGS.scarlet;
  const old=$("bdCanvas"), scroll=old?old.scrollLeft:0;
  const listScroll={}; if(old)old.querySelectorAll("[data-cards]").forEach(n=>listScroll[n.dataset.cards]=n.scrollTop);
  const fOn=!!(filter&&(filter.text||(filter.labels||[]).length||(filter.members||[]).length||filter.due));
  const shown=liveCards().filter(c=>matches(c,filter,todayIso())).length;
  body.innerHTML=`<div class="bdTop">
      <select id="bd-switch" aria-label="Switch board">${openBoards().map(x=>`<option value="${esc(x.id)}"${x.id===b.id?" selected":""}>${esc(x.name)}</option>`).join("")}${ro?"":'<option value="__new">+ Create a board…</option>'}</select>
      ${ro?`<span class="bdName" style="cursor:default">${esc(b.name)}</span><span style="font-size:13px;background:rgba(255,255,255,.2);border-radius:6px;padding:3px 8px">View only</span>`:`<button class="bdName" id="bd-rename" title="Rename board">${esc(b.name)}</button>`}
      <span class="sp"></span>
      ${fOn?`<span style="font-size:13px">${shown} card${shown===1?"":"s"} match</span>`:""}
      <button class="bt${fOn?" bdFilterOn":""}" id="bd-filter">Filter${fOn?" (on)":""}</button>
      <button class="bt" id="bd-due">Due dates</button>
      ${ro?"":'<button class="bt" id="bd-menu">⋯ Menu</button>'}
      <button class="bt" id="bd-close" aria-label="Close boards">✕ Close</button></div>
    <div class="bdCanvas" id="bdCanvas">${(b.lists||[]).filter(l=>!l.archived).map(l=>listHtml(b,l)).join("")}
      ${ro?"":'<div class="bdAddList" id="bd-addlist"><button class="bdAddBtn">+ Add another list</button></div>'}</div>`;
  $("bdCanvas").scrollLeft=scroll;
  $("bdCanvas").querySelectorAll("[data-cards]").forEach(n=>{ if(listScroll[n.dataset.cards])n.scrollTop=listScroll[n.dataset.cards]; });
  bind();
}
function listHtml(b,l){
  const cs=listCards(l.id), vis=cs.filter(c=>matches(c,filter,todayIso()));
  return `<div class="bdList" data-list="${esc(l.id)}"><div class="bdLH" data-lhandle="${esc(l.id)}"><input value="${esc(l.name)}" data-lname="${esc(l.id)}" aria-label="List name"${ro?" readonly":""}><span class="cnt">${cs.length}</span>${ro?"":`<button class="bdIcon" data-lmenu="${esc(l.id)}" aria-label="List actions for ${esc(l.name)}">⋯</button>`}</div>
    <div class="bdCards" data-cards="${esc(l.id)}">${vis.map(c=>cardFront(b,c)).join("")}</div>
    ${ro?"":`<div data-comp="${esc(l.id)}"><button class="bdAddBtn" data-addcard="${esc(l.id)}">+ Add a card</button></div>`}</div>`;
}
function fieldVal(f,v){ return f.type==="number"&&/cost|price|\$/i.test(f.name)?"$"+Number(v).toLocaleString():f.type==="date"?fmtD(v):v; }
function cardFront(b,c){
  const labs=(c.labels||[]).map(id=>b.labels.find(l=>l.id===id)).filter(Boolean);
  const fv=(b.fields||[]).filter(f=>c.fields&&c.fields[f.id]!==undefined&&c.fields[f.id]!=="").map(f=>`<div class="bdF">${esc(f.name)}: <b>${esc(fieldVal(f,c.fields[f.id]))}</b></div>`).join("");
  const items=(c.checklists||[]).flatMap(k=>k.items); const dn=items.filter(i=>i.done).length;
  const badges=[c.due?`<span class="bdB ${dueState(c)}" title="Due date">◷ ${esc(dueText(c))}</span>`:"",
    c.desc?`<span class="bdB" title="This card has a description">≡</span>`:"",
    (c.comments||[]).length?`<span class="bdB" title="Comments">💬 ${c.comments.length}</span>`:"",
    (c.attachments||[]).length?`<span class="bdB" title="Attachments">📎 ${c.attachments.length}</span>`:"",
    items.length?`<span class="bdB ${dn===items.length?"ok":""}" title="Checklist items">☑ ${dn}/${items.length}</span>`:""].filter(Boolean).join("");
  const avs=(c.members||[]).length?`<span class="bdAvs">${c.members.map(m=>`<span class="bdAv" title="${esc(m)}">${esc(ini(m))}</span>`).join("")}</span>`:"";
  return `<div class="bdCard${c.template?" tpl":""}" data-card="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.title)}">${c.cover?`<div class="cv" style="background:${COLORS[c.cover]||COLORS.gray}"></div>`:""}<div class="in">
    ${labs.length?`<div class="bdLabs">${labs.map(labChip).join("")}</div>`:""}<div class="t">${esc(c.title)}</div>${fv}
    ${badges||avs?`<div class="bdBadges">${badges}${avs}</div>`:""}</div></div>`;
}
function bind(){
  const B=$("bdBody");
  $("bd-switch").onchange=e=>{ if(e.target.value==="__new"){ e.target.value=cur; newBoard(); return; } cur=e.target.value; filter=null; watchCards(); };
  if($("bd-rename"))$("bd-rename").onclick=e=>pop(e.currentTarget,"Rename board",`<input type="text" id="p-name" value="${esc(curBoard().name)}"><div style="margin-top:8px"><button class="bdBlue" id="p-ok">Save</button></div>`,p=>{
    const go=()=>{ const n=p.querySelector("#p-name").value.trim(); if(n){ saveBoard({name:n}); closePop(); } };
    p.querySelector("#p-ok").onclick=go; p.querySelector("#p-name").onkeydown=e=>{ if(e.key==="Enter")go(); }; p.querySelector("#p-name").select(); });
  $("bd-close").onclick=close;
  $("bd-filter").onclick=e=>filterPop(e.currentTarget);
  $("bd-due").onclick=duePanel;
  if($("bd-menu"))$("bd-menu").onclick=menuPanel;
  if($("bd-addlist"))$("bd-addlist").onclick=e=>{ const w=$("bd-addlist"); if(w.querySelector("input"))return;
    w.innerHTML=`<div style="background:#f1f2f4;border-radius:12px;padding:6px"><input type="text" placeholder="Enter list name…" aria-label="New list name" style="width:100%;box-sizing:border-box;border:2px solid #388bff;border-radius:6px;padding:6px 8px;font:inherit;font-size:14px"><div style="display:flex;gap:6px;margin-top:6px"><button class="bdBlue">Add list</button><button class="bdIcon" aria-label="Cancel">✕</button></div></div>`;
    const inp=w.querySelector("input"); inp.focus();
    const add=()=>{ const n=inp.value.trim(); if(!n)return; inp.value=""; saveBoard({lists:(curBoard().lists||[]).concat([{id:"l_"+rid(),name:n}])}); };
    w.querySelector(".bdBlue").onclick=ev=>{ ev.stopPropagation(); add(); };
    inp.onkeydown=ev=>{ if(ev.key==="Enter")add(); if(ev.key==="Escape")draw(); };
    w.querySelector(".bdIcon").onclick=ev=>{ ev.stopPropagation(); draw(); }; };
  if(!ro)B.querySelectorAll("[data-lname]").forEach(inp=>{
    inp.onchange=()=>{ const n=inp.value.trim(), b=curBoard(); if(n)saveBoard({lists:b.lists.map(x=>x.id===inp.dataset.lname?Object.assign({},x,{name:n}):x)}); else inp.value=(b.lists.find(x=>x.id===inp.dataset.lname)||{}).name||""; };
    inp.onkeydown=e=>{ if(e.key==="Enter"||e.key==="Escape")inp.blur(); }; });
  B.querySelectorAll("[data-lmenu]").forEach(btn=>btn.onclick=e=>{ e.stopPropagation(); listMenu(btn,btn.dataset.lmenu); });
  B.querySelectorAll("[data-addcard]").forEach(btn=>btn.onclick=()=>composer(btn.dataset.addcard));
  B.querySelectorAll("[data-card]").forEach(n=>n.onkeydown=e=>{ if(e.key==="Enter")cardEditor(n.dataset.card); });
  dragSetup($("bdCanvas"));
}
let composing=null;
function composer(lid){
  composing=lid;
  const w=document.querySelector(`[data-comp="${lid}"]`); if(!w)return;
  const tpls=liveCards().filter(c=>c.template);
  w.innerHTML=`<div class="bdComp"><textarea placeholder="Enter a title for this card…" aria-label="New card title"></textarea><div class="r"><button class="bdBlue">Add card</button><button class="bdIcon" aria-label="Cancel">✕</button>${tpls.length?`<select aria-label="Start from a template" style="margin-left:auto;max-width:140px;font:inherit;font-size:13px"><option value="">From template…</option>${tpls.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("")}</select>`:""}</div></div>`;
  const ta=w.querySelector("textarea"); ta.focus();
  const box=document.querySelector(`[data-cards="${lid}"]`); if(box)box.scrollTop=box.scrollHeight;
  const add=async()=>{ const n=ta.value.trim(); if(!n)return; const sel=w.querySelector("select"); const t=sel&&sel.value?cards.find(c=>c.id===sel.value):null; ta.value=""; if(sel)sel.value=""; await addCard(lid,n,t); };
  w.querySelector(".bdBlue").onclick=add;
  ta.onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); add(); }  };
  w.querySelector(".bdIcon").onclick=()=>{ composing=null; draw(); };
  const s=w.querySelector("select"); if(s)s.onchange=()=>{ const t=cards.find(c=>c.id===s.value); if(t&&!ta.value.trim())ta.value=t.title; ta.focus(); };
}

// ---------- drag and drop: mouse drags right away; touch needs a long-press so scrolling still works ----------
let drag=null, justDragged=false;
function dragSetup(canvas){
  if(!canvas)return;
  canvas.onmousedown=e=>{ if(e.button!==0)return; start(e,e.clientX,e.clientY,false); };
  canvas.addEventListener("touchstart",e=>{ if(e.touches.length!==1)return; const t=e.touches[0]; start(e,t.clientX,t.clientY,true); },{passive:true});
  canvas.addEventListener("contextmenu",e=>{ if(e.target.closest("[data-card],[data-lhandle]")&&drag)e.preventDefault(); });
  canvas.onclick=e=>{ if(justDragged)return; const c=e.target.closest("[data-card]"); if(c)cardEditor(c.dataset.card); };
  function start(e,x,y,touch){
    if(ro)return;
    if(e.target.closest("input,textarea,button,select,.bdComp"))return;
    const card=e.target.closest("[data-card]"), lh=e.target.closest("[data-lhandle]");
    if(!card&&!lh)return;
    drag={kind:card?"card":"list",el:card||lh.closest("[data-list]"),id:card?card.dataset.card:lh.dataset.lhandle,x0:x,y0:y,active:false,touch};
    if(touch)drag.timer=setTimeout(()=>{ if(drag&&!drag.active){ begin(drag.x0,drag.y0); try{ navigator.vibrate&&navigator.vibrate(15); }catch(_){} } },380);
  }
}
function begin(x,y){
  const r=drag.el.getBoundingClientRect(); drag.active=true; drag.dx=x-r.left; drag.dy=y-r.top;
  const g=drag.el.cloneNode(true); g.classList.add("bdDragGhost"); g.style.width=r.width+"px"; g.style.height=r.height+"px"; g.style.left=r.left+"px"; g.style.top=r.top+"px"; document.body.appendChild(g); drag.ghost=g;
  const ph=document.createElement("div");
  if(drag.kind==="card"){ ph.className="bdPh"; ph.style.height=r.height+"px"; }
  else { ph.style.cssText="flex:0 0 "+r.width+"px;height:"+r.height+"px;background:rgba(0,0,0,.22);border-radius:12px"; ph.dataset.ph="1"; }
  drag.ph=ph; drag.el.parentNode.insertBefore(ph,drag.el); drag.el.style.display="none";
}
function moveTo(x,y){
  if(!drag)return;
  if(!drag.active){
    if(Math.abs(x-drag.x0)+Math.abs(y-drag.y0)<=6)return;
    if(drag.touch){ clearTimeout(drag.timer); drag=null; return; } // finger moved before the long-press: it's a scroll
    begin(drag.x0,drag.y0);
  }
  drag.ghost.style.left=(x-drag.dx)+"px"; drag.ghost.style.top=(y-drag.dy)+"px";
  const cv=$("bdCanvas"); if(cv){ const r=cv.getBoundingClientRect(); if(x>r.right-40)cv.scrollLeft+=14; if(x<r.left+40)cv.scrollLeft-=14; }
  const under=document.elementFromPoint(x,y); if(!under)return;
  if(drag.kind==="card"){
    const list=under.closest("[data-list]"); if(!list)return; const box=list.querySelector("[data-cards]");
    const sib=[...box.querySelectorAll("[data-card]")].filter(c=>c!==drag.el);
    const before=sib.find(c=>{ const r=c.getBoundingClientRect(); return y<r.top+r.height/2; });
    if(before){ if(drag.ph.nextSibling!==before)box.insertBefore(drag.ph,before); } else if(box.lastElementChild!==drag.ph)box.appendChild(drag.ph);
    const br=box.getBoundingClientRect(); if(y>br.bottom-30)box.scrollTop+=10; if(y<br.top+30)box.scrollTop-=10;
  } else {
    const lists=[...cv.querySelectorAll("[data-list]")].filter(l=>l!==drag.el);
    const before=lists.find(l=>{ const r=l.getBoundingClientRect(); return x<r.left+r.width/2; })||$("bd-addlist");
    if(drag.ph.nextSibling!==before)cv.insertBefore(drag.ph,before);
  }
}
function end(){
  if(!drag)return; clearTimeout(drag.timer); const d=drag; drag=null;
  if(!d.active)return;
  justDragged=true; setTimeout(()=>{ justDragged=false; },50);
  d.ghost.remove(); d.el.style.display="";
  if(d.kind==="card"){
    const box=d.ph.parentNode, lid=box&&box.dataset.cards;
    let next=d.ph.nextElementSibling; while(next&&!next.dataset.card)next=next.nextElementSibling;
    d.ph.remove(); if(lid)moveCard(d.id,lid,next?next.dataset.card:null); else draw();
  } else {
    const order=[...$("bdCanvas").children].map(n=>n===d.el?null:n===d.ph?d.id:n.dataset.list).filter(Boolean);
    d.ph.remove(); const b=curBoard();
    const lists=order.map(id=>b.lists.find(l=>l.id===id)).filter(Boolean).concat(b.lists.filter(l=>!order.includes(l.id)));
    if(lists.map(l=>l.id).join()!==b.lists.map(l=>l.id).join())saveBoard({lists}); else draw();
  }
}
if(typeof document!=="undefined"){
  document.addEventListener("mousemove",e=>{ if(drag)moveTo(e.clientX,e.clientY); });
  document.addEventListener("mouseup",end);
  document.addEventListener("touchmove",e=>{ if(!drag)return; if(drag.active)e.preventDefault(); const t=e.touches[0]; moveTo(t.clientX,t.clientY); },{passive:false});
  document.addEventListener("touchend",end);
  document.addEventListener("touchcancel",end);
  // Escape closes the innermost Boards thing (popup, panel, card, composer, a field being edited) — not the whole Boards screen
  document.addEventListener("keydown",e=>{ if(e.key!=="Escape"||!$("bdSheet")||$("bdSheet").hidden)return;
    const ae=document.activeElement, inSheet=ae&&$("bdSheet").contains(ae)&&/INPUT|TEXTAREA|SELECT/.test(ae.tagName);
    if(document.querySelector(".bdPop"))closePop();
    else if($("bdEdit")){ if(ae&&$("bdEdit").contains(ae)&&/INPUT|TEXTAREA/.test(ae.tagName)&&ae.closest("[data-iaddw]"))paintEditor(true); else closeEditor(); }
    else if($("bdPanelEl"))closePanel();
    else if(composing||inSheet){ composing=null; if(ae)ae.blur(); draw(); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation(); },true);
}
function moveCard(id,listId,beforeId){
  const c=cards.find(x=>x.id===id); if(!c)return;
  const pos=posFor(listCards(listId).filter(x=>x.id!==id),beforeId);
  // optimistic so the card doesn't jump back while saving
  const b=curBoard(), fromN=(b.lists.find(l=>l.id===c.listId)||{}).name, toN=(b.lists.find(l=>l.id===listId)||{}).name, moved=c.listId!==listId;
  const patch={listId,pos}; if(moved)patch.activity=(c.activity||[]).concat([{by:me()||"AD",text:"moved this card from "+fromN+" to "+toN,at:Date.now()}]).slice(-80);
  Object.assign(c,patch); draw(); // optimistic, so the card doesn't jump back while saving
  return C("boardCards").doc(id).update(patch).catch(e=>{ console.error(e); ctx.toast(RULES_MSG); });
}

// ---------- popovers and side panels ----------
function pop(anchor,title,html,after){
  closePop(); const p=document.createElement("div"); p.className="bdPop"; p.setAttribute("role","dialog"); p.setAttribute("aria-label",title);
  p.innerHTML=`<h6>${esc(title)}</h6><button class="bdIcon x" aria-label="Close">✕</button>${html}`;
  document.body.appendChild(p);
  const r=anchor.getBoundingClientRect(), w=p.offsetWidth;
  p.style.left=Math.max(8,Math.min(r.left,window.innerWidth-w-8))+"px";
  const top=r.bottom+6; p.style.top=(top+p.offsetHeight>window.innerHeight?Math.max(8,window.innerHeight-p.offsetHeight-8):top)+"px";
  p.querySelector(".x").onclick=closePop;
  setTimeout(()=>document.addEventListener("mousedown",outside,true),0);
  if(after)after(p); return p;
}
function outside(e){ const p=document.querySelector(".bdPop"); if(p&&!p.contains(e.target))closePop(); }
function closePop(){ const p=document.querySelector(".bdPop"); if(p)p.remove(); document.removeEventListener("mousedown",outside,true); }
let panelFn=null;
function openPanel(title,html,after,fn){ closePanel(); panelFn=fn||null; const p=document.createElement("div"); p.className="bdPanel"; p.id="bdPanelEl"; p.setAttribute("role","dialog"); p.setAttribute("aria-label",title);
  p.innerHTML=`<button class="bdIcon" style="float:right" data-pclose aria-label="Close">✕</button><h5>${esc(title)}</h5>${html}`; document.body.appendChild(p);
  p.querySelector("[data-pclose]").onclick=closePanel; if(after)after(p); return p; }
function closePanel(){ const p=$("bdPanelEl"); if(p)p.remove(); panelFn=null; }
const refreshPanel=()=>{ if(panelFn&&$("bdPanelEl")){ const st=$("bdPanelEl").scrollTop; panelFn(); if($("bdPanelEl"))$("bdPanelEl").scrollTop=st; } };

function listMenu(anchor,lid){
  const b=curBoard(); const live=b.lists.filter(x=>!x.archived); const l=b.lists.find(x=>x.id===lid); const i=live.indexOf(l);
  pop(anchor,"List actions",`
    <button class="bdGrayB opt" data-a="add">Add card</button>
    <button class="bdGrayB opt" data-a="copy">Copy list</button>
    <button class="bdGrayB opt" data-a="left"${i<=0?" disabled":""}>Move list left</button>
    <button class="bdGrayB opt" data-a="right"${i>=live.length-1?" disabled":""}>Move list right</button>
    <label>Move list to another board</label><select data-mvb><option value="">Pick a board…</option>${openBoards().filter(x=>x.id!==b.id).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select>
    <label>Sort cards by</label><button class="bdGrayB opt" data-a="sdue">Due date (soonest first)</button><button class="bdGrayB opt" data-a="sname">Card name (A–Z)</button><button class="bdGrayB opt" data-a="snew">Newest first</button>
    <label>Move all cards in this list to</label><select data-mvall><option value="">Pick a list…</option>${live.filter(x=>x.id!==lid).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select>
    <hr style="border:0;border-top:1px solid #dcdfe4;margin:10px 0">
    <button class="bdGrayB opt" data-a="arch">Archive all cards in this list</button>
    <button class="bdGrayB opt" data-a="archl">Archive this list</button>`,p=>{
    p.onclick=async e=>{ const a=e.target.dataset.a; if(!a||e.target.disabled)return; const cs=listCards(lid); closePop();
      try{
      if(a==="add")composer(lid);
      if(a==="left"||a==="right"){ const other=live[a==="left"?i-1:i+1]; const ls=b.lists.slice(); const x=ls.indexOf(l), y=ls.indexOf(other); [ls[x],ls[y]]=[ls[y],ls[x]]; await saveBoard({lists:ls}); }
      if(a==="copy"){ const nid="l_"+rid(); const ls=b.lists.slice(); ls.splice(b.lists.indexOf(l)+1,0,{id:nid,name:l.name+" (copy)"}); await saveBoard({lists:ls});
        for(const c of cs){ const {id,...rest}=c; await C("boardCards").add(Object.assign({},rest,{listId:nid,checklists:copyChecklists(c.checklists),comments:[],activity:[{by:me()||"AD",text:"copied this card from "+l.name,at:Date.now()}]})); } }
      if(a==="sdue"||a==="sname"||a==="snew"){ const s=cs.slice().sort(a==="sdue"?((x,y)=>(x.due||"9999").localeCompare(y.due||"9999")):a==="sname"?((x,y)=>x.title.localeCompare(y.title)):((x,y)=>((y.activity||[])[0]||{at:0}).at-((x.activity||[])[0]||{at:0}).at));
        const bt=ctx.fdb.batch(); s.forEach((c,k)=>bt.update(C("boardCards").doc(c.id),{pos:(k+1)*1000})); await bt.commit(); }
      if(a==="arch"){ if(!cs.length||!confirm("Archive all "+cs.length+" cards in "+l.name+"? You can restore them from Menu → Archived items."))return; const bt=ctx.fdb.batch(); cs.forEach(c=>bt.update(C("boardCards").doc(c.id),{archived:true})); await bt.commit(); ctx.toast("Archived "+cs.length+" card"+(cs.length===1?"":"s")); }
      if(a==="archl"){ if(!confirm("Archive the list "+l.name+"? You can restore it from Menu → Archived items."))return; await saveBoard({lists:b.lists.map(x=>x.id===lid?Object.assign({},x,{archived:true}):x)}); }
      }catch(err){ console.error(err); ctx.toast(RULES_MSG); } };
    p.querySelector("[data-mvall]").onchange=async e=>{ const to=e.target.value; if(!to)return; const cs=listCards(lid); closePop(); let base=posFor(listCards(to),null)-1000;
      const bt=ctx.fdb.batch(); cs.forEach(c=>{ base+=1000; bt.update(C("boardCards").doc(c.id),{listId:to,pos:base}); }); await bt.commit(); ctx.toast("Moved "+cs.length+" card"+(cs.length===1?"":"s")); };
    p.querySelector("[data-mvb]").onchange=async e=>{ const to=boards.find(x=>x.id===e.target.value); if(!to)return; const cs=listCards(lid); closePop();
      if(!confirm("Move the list "+l.name+" and its "+cs.length+" card"+(cs.length===1?"":"s")+" to "+to.name+"? Labels carry over where "+to.name+" has a label with the same name."))return;
      await saveBoard({lists:(to.lists||[]).concat([{id:l.id,name:l.name}])},to.id);
      const bt=ctx.fdb.batch(); cs.forEach(c=>bt.update(C("boardCards").doc(c.id),{boardId:to.id,labels:mapLabels(c.labels,b,to),fields:mapFields(c.fields,b,to)})); await bt.commit();
      await saveBoard({lists:b.lists.filter(x=>x.id!==lid)}); ctx.toast("Moved to "+to.name); };
  });
}
const mapLabels=(ids,from,to)=>(ids||[]).map(id=>(from.labels.find(l=>l.id===id)||{}).name).map(n=>byName(to.labels,n)).filter(Boolean).map(l=>l.id);
const mapFields=(fv,from,to)=>{ const o={}; Object.entries(fv||{}).forEach(([k,v])=>{ const f=(from.fields||[]).find(x=>x.id===k); const t=f&&byName(to.fields,f.name); if(t)o[t.id]=v; }); return o; };
function filterPop(anchor){
  const b=curBoard(); const f=filter||{text:"",labels:[],members:[],due:""};
  pop(anchor,"Filter cards",`<label>Keyword</label><input type="text" id="f-t" value="${esc(f.text||"")}" placeholder="Search titles and descriptions">
    <label>Labels</label>${b.labels.map(l=>`<label style="display:flex;gap:6px;align-items:center;font-weight:400;margin:4px 0"><input type="checkbox" data-fl="${l.id}"${(f.labels||[]).includes(l.id)?" checked":""}> ${labChip(l)}</label>`).join("")||'<p style="font-size:13px;color:#626f86">No labels on this board.</p>'}
    <label>Members</label>${(b.members||["Andrew","Ryan"]).map(m=>`<label style="display:flex;gap:6px;align-items:center;font-weight:400;margin:4px 0"><input type="checkbox" data-fm="${esc(m)}"${(f.members||[]).includes(m)?" checked":""}> ${esc(m)}</label>`).join("")}
    <label>Due date</label><select id="f-d"><option value="">Any</option><option value="overdue"${f.due==="overdue"?" selected":""}>Overdue</option><option value="week"${f.due==="week"?" selected":""}>Due in the next week</option><option value="none"${f.due==="none"?" selected":""}>No due date</option><option value="done"${f.due==="done"?" selected":""}>Marked complete</option></select>
    <div style="display:flex;gap:6px;margin-top:10px"><button class="bdBlue" id="f-ok">Apply</button><button class="bdGrayB" id="f-clr">Clear filter</button></div>`,p=>{
    const apply=()=>{ filter={text:p.querySelector("#f-t").value.trim(),labels:[...p.querySelectorAll("[data-fl]:checked")].map(x=>x.dataset.fl),members:[...p.querySelectorAll("[data-fm]:checked")].map(x=>x.dataset.fm),due:p.querySelector("#f-d").value}; closePop(); draw(); };
    p.querySelector("#f-ok").onclick=apply; p.querySelector("#f-t").onkeydown=e=>{ if(e.key==="Enter")apply(); }; p.querySelector("#f-t").focus();
    p.querySelector("#f-clr").onclick=()=>{ filter=null; closePop(); draw(); }; });
}
function duePanel(){
  const b=curBoard(); const t=todayIso(), wk=addDays(t,7);
  const cs=liveCards().filter(c=>c.due).sort((x,y)=>x.due.localeCompare(y.due));
  const grp=[["Overdue",cs.filter(c=>!c.dueDone&&c.due<t)],["Due in the next week",cs.filter(c=>!c.dueDone&&c.due>=t&&c.due<=wk)],["Later",cs.filter(c=>!c.dueDone&&c.due>wk)],["Complete",cs.filter(c=>c.dueDone)]];
  openPanel("Due dates · "+b.name,grp.map(([h,a])=>a.length?`<div class="hh">${h} (${a.length})</div>${a.map(c=>`<div class="row2" data-open="${esc(c.id)}" style="cursor:pointer"><span>${esc(c.title)}<br><span style="font-size:12px;color:#626f86">${esc((b.lists.find(l=>l.id===c.listId)||{}).name||"")}</span></span><span class="bdB ${dueState(c)}">${esc(fmtD(c.due))}</span></div>`).join("")}`:"").join("")||'<p style="font-size:14px;color:#626f86">No cards on this board have due dates.</p>',
    p=>p.onclick=e=>{ const r=e.target.closest("[data-open]"); if(r)cardEditor(r.dataset.open); },duePanel);
}
function menuPanel(){
  const b=curBoard();
  openPanel("Menu",`
    <div class="hh" style="margin-top:4px">Background</div>
    <div class="bdChips">${Object.entries(BGS).map(([k,v])=>`<button data-bg="${k}" aria-label="${k} background${(b.bg||"scarlet")===k?" (current)":""}" title="${k}" style="width:48px;height:32px;border-radius:6px;border:${(b.bg||"scarlet")===k?"3px solid #0c66e4":"1px solid #ccc"};background:${v};cursor:pointer"></button>`).join("")}</div>
    <div class="hh">Board</div>
    <button class="bdGrayB opt" data-m="labels">Labels</button>
    <button class="bdGrayB opt" data-m="fields">Custom fields</button>
    <button class="bdGrayB opt" data-m="members">Members</button>
    <button class="bdGrayB opt" data-m="arch">Archived items</button>
    <button class="bdGrayB opt" data-m="auto">Automation</button>
    <button class="bdGrayB opt" data-m="copy">Copy board</button>
    <button class="bdGrayB opt" data-m="closeb">Close board</button>
    <div class="hh">Your name on comments</div>
    <input type="text" id="m-me" value="${esc(me())}" placeholder="Andrew or Ryan" aria-label="Your name" style="width:100%;box-sizing:border-box;border:1px solid #8590a2;border-radius:6px;padding:6px 8px;font:inherit">
    <p style="font-size:12px;color:#626f86">You and Ryan share one login, so this tells your comments and activity apart. It's remembered on this device.</p>`,p=>{
    p.querySelector("#m-me").onchange=e=>{ setMe(e.target.value.trim()); ctx.toast("Saved"); };
    p.onclick=async e=>{ const t=e.target.closest("[data-bg],[data-m]"); if(!t)return; const bg=t.dataset.bg; if(bg){ await saveBoard({bg}); return; } const m=t.dataset.m;
      if(m==="labels")labelsPanel(); if(m==="fields")fieldsPanel(); if(m==="members")membersPanel(); if(m==="arch")archivePanel(); if(m==="auto")autoPanel();
      if(m==="copy"){ const n=(prompt("Name for the copy:",b.name+" (copy)")||"").trim(); if(!n)return;
        try{ const {id,key,...rest}=b; const ref=await C("boards").add(Object.assign({},rest,{name:n,key:"",order:boards.length,closed:false}));
          for(const c of liveCards()){ const {id:cid,...cr}=c; await C("boardCards").add(Object.assign({},cr,{boardId:ref.id,checklists:copyChecklists(c.checklists),comments:[],activity:[{by:me()||"AD",text:"copied from "+b.name,at:Date.now()}]})); }
          closePanel(); cur=ref.id; watchCards(); ctx.toast("Board copied"); }catch(err){ console.error(err); ctx.toast(RULES_MSG); } }
      if(m==="closeb"){ if(!confirm("Close the board "+b.name+"? It's hidden from the board list. You can reopen it from Menu → Archived items on any board."))return; await saveBoard({closed:true}); closePanel(); cur=(openBoards().find(x=>x.id!==b.id)||{}).id; watchCards(); } };
  },menuPanel);
}
function labelsPanel(){
  const b=curBoard();
  openPanel("Labels",`${b.labels.map(l=>`<div class="row2"><input type="text" data-ln="${l.id}" value="${esc(l.name)}" aria-label="Label name" style="flex:1;min-width:0;border:1px solid #8590a2;border-radius:4px;padding:4px 6px;font:inherit;font-size:13px"><select data-lc="${l.id}" aria-label="Label color">${Object.keys(COLORS).map(k=>`<option${k===l.color?" selected":""}>${k}</option>`).join("")}</select>${labChip(l)}<button class="bdIcon" data-ld="${l.id}" aria-label="Delete label ${esc(l.name)}">🗑</button></div>`).join("")}
    <div style="margin-top:10px"><button class="bdBlue" data-la>Create a new label</button></div><p style="font-size:12px;color:#626f86">Labels always show their name on cards, so color is never the only way to tell them apart. Renaming a label the automation uses (VACANT, MISSING HEAD COACH, MISSING ASSISTANT, FULLY STAFFED, SEASON ITEMS DONE, Head Coach, Assistant Coach) turns that rule off.</p>`,p=>{
    p.onchange=e=>{ const d=e.target.dataset; const b=curBoard(); if(d.ln)saveBoard({labels:b.labels.map(x=>x.id===d.ln?Object.assign({},x,{name:e.target.value.trim()||x.name}):x)}); if(d.lc)saveBoard({labels:b.labels.map(x=>x.id===d.lc?Object.assign({},x,{color:e.target.value}):x)}); };
    p.onclick=async e=>{ const t=e.target.closest("[data-la],[data-ld]"); if(!t)return; const d=t.dataset; const b=curBoard();
      if("la" in d)await saveBoard({labels:b.labels.concat([{id:"lb_"+rid(),name:"New label",color:"gray"}])});
      if(d.ld){ if(!confirm("Delete this label? It comes off every card on this board."))return; await saveBoard({labels:b.labels.filter(x=>x.id!==d.ld)}); } }; },labelsPanel);
}
function fieldsPanel(){
  const b=curBoard();
  openPanel("Custom fields",`<p style="font-size:13px;color:#626f86">Shown on the front of every card that has a value.</p>${(b.fields||[]).map(f=>`<div class="row2"><span>${esc(f.name)} <span style="color:#626f86;font-size:12px">(${f.type})</span></span><button class="bdIcon" data-fd="${f.id}" aria-label="Delete field ${esc(f.name)}">🗑</button></div>`).join("")||"<p>No custom fields.</p>"}
    <div class="hh">New field</div><input type="text" id="nf" placeholder="Field name" aria-label="New field name" style="width:100%;box-sizing:border-box;border:1px solid #8590a2;border-radius:4px;padding:6px;font:inherit"><div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="bdBlue" data-fa="text">Add text field</button><button class="bdGrayB" data-fa="number">Add number field</button><button class="bdGrayB" data-fa="date">Add date field</button></div>`,p=>{
    p.onclick=async e=>{ const t=e.target.closest("[data-fa],[data-fd]"); if(!t)return; const d=t.dataset; const b=curBoard();
      if(d.fa){ const n=p.querySelector("#nf").value.trim(); if(!n)return; await saveBoard({fields:(b.fields||[]).concat([{id:"f_"+rid(),name:n,type:d.fa}])}); }
      if(d.fd){ if(!confirm("Delete this field from every card?"))return; await saveBoard({fields:b.fields.filter(x=>x.id!==d.fd)}); } }; },fieldsPanel);
}
function membersPanel(){
  const b=curBoard(); const ms=b.members||["Andrew","Ryan"];
  openPanel("Members",`<p style="font-size:13px;color:#626f86">Names you can put on cards. They aren't logins.</p>${ms.map(m=>`<div class="row2"><span><span class="bdAv" style="margin-right:6px">${esc(ini(m))}</span>${esc(m)}</span><button class="bdIcon" data-md="${esc(m)}" aria-label="Remove ${esc(m)}">🗑</button></div>`).join("")}
    <div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="nm" placeholder="Name" aria-label="New member name" style="flex:1;border:1px solid #8590a2;border-radius:4px;padding:6px;font:inherit"><button class="bdBlue" data-ma>Add</button></div>`,p=>{
    p.onclick=async e=>{ const t=e.target.closest("[data-ma],[data-md]"); if(!t)return; const d=t.dataset; const ms=curBoard().members||["Andrew","Ryan"];
      if("ma" in d){ const n=p.querySelector("#nm").value.trim(); if(!n||ms.includes(n))return; await saveBoard({members:ms.concat([n])}); }
      if(d.md)await saveBoard({members:ms.filter(x=>x!==d.md)}); }; },membersPanel);
}
function archivePanel(){
  const b=curBoard(); const ac=cards.filter(c=>c.archived), al=b?(b.lists||[]).filter(l=>l.archived):[], cb=boards.filter(x=>x.closed);
  openPanel("Archived items",`${b&&!b.closed?`<div class="hh" style="margin-top:4px">Cards on ${esc(b.name)}</div>${ac.map(c=>`<div class="row2"><span style="cursor:pointer" data-open="${esc(c.id)}">${esc(c.title)}</span><span style="white-space:nowrap"><button class="bdGrayB" data-rc="${esc(c.id)}">Restore</button> <button class="bdGrayB" data-dc="${esc(c.id)}">Delete</button></span></div>`).join("")||'<p style="font-size:13px;color:#626f86">No archived cards.</p>'}
    <div class="hh">Lists</div>${al.map(l=>`<div class="row2"><span>${esc(l.name)}</span><button class="bdGrayB" data-rl="${esc(l.id)}">Restore</button></div>`).join("")||'<p style="font-size:13px;color:#626f86">No archived lists.</p>'}`:""}
    <div class="hh">Closed boards</div>${cb.map(x=>`<div class="row2"><span>${esc(x.name)}</span><button class="bdGrayB" data-rb="${esc(x.id)}">Reopen</button></div>`).join("")||'<p style="font-size:13px;color:#626f86">No closed boards.</p>'}`,p=>{
    p.onclick=async e=>{ const t=e.target.closest("[data-rc],[data-dc],[data-rl],[data-rb],[data-open]"); if(!t)return; const d=t.dataset;
      if(d.open)return cardEditor(d.open);
      if(d.rc)await saveCard(d.rc,{archived:false},"restored this card");
      if(d.dc){ const c=cards.find(x=>x.id===d.dc); if(!confirm("Permanently delete “"+c.title+"”? This can't be undone."))return; await C("boardCards").doc(d.dc).delete().catch(()=>ctx.toast(RULES_MSG)); }
      if(d.rl){ const b=curBoard(); await saveBoard({lists:b.lists.map(x=>x.id===d.rl?Object.assign({},x,{archived:false}):x)}); }
      if(d.rb){ await saveBoard({closed:false},d.rb); cur=d.rb; closePanel(); watchCards(); } }; },archivePanel);
}
function autoPanel(){
  openPanel("Automation",`<p style="font-size:14px">These run on their own, like the Butler rules did in Trello:</p>
    <div class="row2" style="display:block"><b>Coach names → staffing labels</b><br><span style="font-size:13px">On the coaches board, when you type or clear a Head Coach or Assistant Coach name, the labels update: a blank head adds <b>MISSING HEAD COACH</b>, a blank assistant adds <b>MISSING ASSISTANT</b>, and both filled in sets <b>FULLY STAFFED</b>. Other labels, like COMPLIANCE FLAG, are left alone.</span></div>
    <div class="row2" style="display:block"><b>Coach vacancy → hiring card</b><br><span style="font-size:13px">On the coaches board, adding <b>MISSING HEAD COACH</b> removes FULLY STAFFED and adds “{card} — Head Coach” to the first list of Coach Hiring. <b>MISSING ASSISTANT</b> does the same with “{card} — Assistant Coach.”</span></div>
    <div class="row2" style="display:block"><b>Vacant → hiring card</b><br><span style="font-size:13px">On the coaches board, adding <b>VACANT</b> adds “{card} — Head & Assistant” to the first list of Coach Hiring.</span></div>
    <div class="row2" style="display:block"><b>Season items done → label</b><br><span style="font-size:13px">When a card's Season Items checklist is all checked, <b>SEASON ITEMS DONE</b> is added.</span></div>
    <p style="font-size:12px;color:#626f86">Each run shows in the card's activity as “Automation.”</p>`);
}
async function newBoard(){
  const n=(prompt("Name of the new board?")||"").trim(); if(!n)return;
  try{ const r=await C("boards").add({name:n,key:"",order:boards.length,bg:"blue",lists:[{id:"l_"+rid(),name:"To do"},{id:"l_"+rid(),name:"Doing"},{id:"l_"+rid(),name:"Done"}],labels:[],fields:[],members:["Andrew","Ryan"]}); cur=r.id; watchCards(); }
  catch(e){ console.error(e); ctx.toast(RULES_MSG); }
}

// ---------- card detail ----------
let showDetails=false, editingDesc=false;
function cardEditor(id){ closeEditor(); closePop(); openCard=id; editingDesc=false; const m=document.createElement("div"); m.className="bdModal"; m.id="bdEdit"; document.body.appendChild(m); paintEditor(true); m.addEventListener("mousedown",e=>{ if(e.target===m)closeEditor(); }); }
function closeEditor(){ closePop(); const m=$("bdEdit"); if(m)m.remove(); openCard=null; }
function paintEditor(force){
  const m=$("bdEdit"); if(!m)return; const c=cards.find(x=>x.id===openCard); if(!c){ closeEditor(); return; }
  const b=boards.find(x=>x.id===c.boardId); if(!b)return;
  // don't repaint under someone typing something not yet saved
  const ae=document.activeElement;
  if(!force&&ae&&m.contains(ae)&&/TEXTAREA|INPUT/.test(ae.tagName)&&ae.type!=="checkbox"&&ae.value&&ae.value!==ae.defaultValue)return;
  const st=m.scrollTop;
  const labs=(c.labels||[]).map(id=>b.labels.find(l=>l.id===id)).filter(Boolean);
  const list=b.lists.find(l=>l.id===c.listId)||{};
  const feed=[].concat((c.comments||[]).map(x=>Object.assign({kind:"c"},x)),showDetails?(c.activity||[]).map(x=>Object.assign({kind:"a"},x)):[]).sort((x,y)=>y.at-x.at);
  const ds=dueState(c);
  m.innerHTML=`<div class="bdBox" role="dialog" aria-label="Card: ${esc(c.title)}">
    <button class="bdIcon close" data-x aria-label="Close card">✕</button>
    ${c.cover?`<div class="cvr" style="background:${COLORS[c.cover]||COLORS.gray}"></div>`:""}
    ${c.archived?`<div style="background:#a16207;color:#fff;padding:8px 16px;font-weight:600">This card is archived. <button class="bdGrayB" style="background:#fff;margin-left:8px" data-unarch>Send to board</button> <button class="bdGrayB" style="background:#fff" data-delete>Delete permanently</button></div>`:""}
    <div class="hd"><span style="font-size:20px;margin-top:6px" aria-hidden="true">▭</span><textarea rows="1" data-title aria-label="Card title">${esc(c.title)}</textarea></div>
    <div class="sub">in list <button class="bdChipBtn" style="padding:2px 6px;text-decoration:underline" data-a="move">${esc(list.name||"")}</button> on ${esc(b.name)}${c.template?` · <b>Template card</b>`:""}</div>
    <div class="bdCols"><div class="bdMain">
      ${(c.members||[]).length||labs.length||c.due?`<div class="bdChips" style="gap:16px;align-items:flex-start">
        ${(c.members||[]).length?`<div><div style="font-size:12px;font-weight:700;color:#44546f;margin-bottom:4px">Members</div><div class="bdChips">${c.members.map(n=>`<span class="bdAv" style="width:32px;height:32px" title="${esc(n)}">${esc(ini(n))}</span>`).join("")}<button class="bdChipBtn" data-a="members" aria-label="Edit members">+</button></div></div>`:""}
        ${labs.length?`<div><div style="font-size:12px;font-weight:700;color:#44546f;margin-bottom:4px">Labels</div><div class="bdChips">${labs.map(labChip).join("")}<button class="bdChipBtn" data-a="labels" aria-label="Edit labels">+</button></div></div>`:""}
        ${c.due?`<div><div style="font-size:12px;font-weight:700;color:#44546f;margin-bottom:4px">${c.start?"Dates":"Due date"}</div><div class="bdChips"><input type="checkbox" data-duedone${c.dueDone?" checked":""} aria-label="Mark due date complete" style="width:18px;height:18px"><button class="bdChipBtn" data-a="dates">${esc((c.start?fmtD(c.start)+" – ":"")+fmtD(c.due))}</button>${ds?`<span class="bdB ${ds}">${ds==="ok"?"Complete":ds==="late"?"Overdue":"Due soon"}</span>`:""}</div></div>`:""}
      </div>`:""}
      ${(b.fields||[]).length?`<div class="bdSec"><h4>▦ Custom fields</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${b.fields.map(f=>`<label style="font-size:12px;font-weight:700;color:#44546f">${esc(f.name)}<input class="ed" data-field="${f.id}" type="${f.type==="number"?"number":f.type==="date"?"date":"text"}" value="${esc((c.fields||{})[f.id]==null?"":(c.fields||{})[f.id])}" style="margin-top:4px"></label>`).join("")}</div></div>`:""}
      <div class="bdSec"><h4>≡ Description<span class="sp"></span>${c.desc&&!editingDesc?`<button class="bdGrayB" data-editdesc>Edit</button>`:""}</h4>
        ${editingDesc||!c.desc?`<textarea class="ed" data-desc placeholder="Add a more detailed description…" aria-label="Description" style="min-height:${editingDesc?140:60}px">${esc(c.desc||"")}</textarea><div style="margin-top:6px"><button class="bdBlue" data-savedesc>Save</button>${editingDesc?` <button class="bdGrayB" data-canceldesc>Cancel</button>`:""}</div>`:`<div class="bdDesc" data-editdesc>${linkify(c.desc)}</div>`}</div>
      ${(c.attachments||[]).length?`<div class="bdSec"><h4>📎 Attachments<span class="sp"></span><button class="bdGrayB" data-a="attach">Add</button></h4>${c.attachments.map(a=>`<div class="bdItem"><span><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name||a.url)}</a><br><span style="font-size:12px;color:#626f86">Added ${esc(fmtWhen(a.at))}</span></span><button class="bdIcon" data-adel="${esc(a.id)}" aria-label="Remove attachment">✕</button></div>`).join("")}</div>`:""}
      ${(c.checklists||[]).map(k=>{ const dn=k.items.filter(i=>i.done).length, pct=k.items.length?Math.round(dn*100/k.items.length):0; return `<div class="bdSec"><h4>☑ <span data-kname="${k.id}" style="cursor:text" title="Rename">${esc(k.name)}</span><span class="sp"></span>${dn?`<button class="bdGrayB" data-khide="${k.id}">${k.hide?"Show checked items ("+dn+")":"Hide checked items"}</button>`:""}<button class="bdGrayB" data-kdel="${k.id}">Delete</button></h4>
        <div class="bdProg${pct===100?" full":""}"><span>${pct}%</span><span class="bdBar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(k.name)} progress"><span class="bdFill" style="width:${pct}%"></span></span></div>
        ${k.items.filter(i=>!(k.hide&&i.done)).map(i=>`<div class="bdItem${i.done?" done":""}"><input type="checkbox" data-chk="${k.id}|${i.id}"${i.done?" checked":""} aria-label="${esc(i.text)}"><span data-iedit="${k.id}|${i.id}">${esc(i.text)}</span><button class="bdIcon" data-idel="${k.id}|${i.id}" aria-label="Delete item">✕</button></div>`).join("")}
        <div data-iaddw="${k.id}"><button class="bdGrayB" data-iadd="${k.id}">Add an item</button></div></div>`; }).join("")}
      <div class="bdSec"><h4>☰ Activity<span class="sp"></span><button class="bdGrayB" data-details>${showDetails?"Hide details":"Show details"}</button></h4>
        <div class="bdAct"><span class="bdAv">${esc(ini(me()||"AD"))}</span><div class="bd"><textarea class="ed" data-cm placeholder="Write a comment…" aria-label="Write a comment" style="min-height:44px"></textarea>
          <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="bdBlue" data-post>Save</button>${me()?`<span style="font-size:12px;color:#626f86">as ${esc(me())}</span>`:`<input type="text" data-who placeholder="Your name (Andrew or Ryan)" aria-label="Your name" style="border:1px solid #8590a2;border-radius:4px;padding:4px 6px;font:inherit;font-size:13px">`}</div></div></div>
        ${feed.map(x=>x.kind==="c"?`<div class="bdAct"><span class="bdAv">${esc(ini(x.by))}</span><div class="bd"><b>${esc(x.by)}</b> <span class="m">${esc(fmtWhen(x.at))}${x.edited?" (edited)":""}</span><div class="cm">${linkify(x.text)}</div>${x.id?`<button class="lnk" data-cedit="${esc(x.id)}">Edit</button><button class="lnk" data-cdel="${esc(x.id)}">Delete</button>`:""}</div></div>`
          :`<div class="bdAct"><span class="bdAv" style="background:#8590a2">${esc(ini(x.by))}</span><div class="bd"><b>${esc(x.by)}</b> ${esc(x.text)}<div class="m">${esc(fmtWhen(x.at))}</div></div></div>`).join("")}
      </div></div>
      <div class="bdSide"><div class="h">Add to card</div>
        <button class="bdGrayB" data-a="members">👤 Members</button><button class="bdGrayB" data-a="labels">🏷 Labels</button><button class="bdGrayB" data-a="checklist">☑ Checklist</button>
        <button class="bdGrayB" data-a="dates">◷ Dates</button><button class="bdGrayB" data-a="attach">📎 Attachment</button><button class="bdGrayB" data-a="cover">▬ Cover</button>
        <div class="h">Actions</div>
        <button class="bdGrayB" data-a="move">→ Move</button><button class="bdGrayB" data-a="copy">⧉ Copy</button>
        <button class="bdGrayB" data-a="tpl">${c.template?"★ Stop being a template":"☆ Make template"}</button>
        ${c.archived?"":`<button class="bdGrayB" data-a="archive">🗄 Archive</button>`}
      </div></div></div>`;
  if(ro){
    m.querySelectorAll(".bdSide,[data-iaddw],[data-idel],[data-kdel],[data-khide],[data-cedit],[data-cdel],[data-adel],[data-unarch],[data-delete],[data-savedesc],[data-canceldesc],.bdChips [data-a],h4 [data-a],h4 [data-editdesc]").forEach(n=>n.remove());
    const cm=m.querySelector("[data-cm]"); if(cm)cm.closest(".bdAct").remove();
    const dsc=m.querySelector("[data-desc]"); if(dsc)dsc.closest(".bdSec").remove();
    const dd=m.querySelector(".bdDesc"); if(dd){ dd.removeAttribute("data-editdesc"); dd.style.cursor="default"; }
    m.querySelectorAll("input,textarea").forEach(n=>{ n.disabled=true; });
    const sub=m.querySelector(".sub [data-a]"); if(sub){ const sp=document.createElement("b"); sp.textContent=sub.textContent; sub.replaceWith(sp); }
    m.querySelectorAll("[data-iedit],[data-kname]").forEach(n=>{ n.removeAttribute("data-iedit"); n.removeAttribute("data-kname"); n.style.cursor="default"; });
  }
  m.scrollTop=st;
  const ta=m.querySelector("[data-title]"); const fit=()=>{ ta.style.height="auto"; ta.style.height=ta.scrollHeight+"px"; }; fit(); ta.oninput=fit;
  ta.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); ta.blur(); } };
  ta.onblur=()=>{ if(ro)return; const v=ta.value.trim(); if(v&&v!==c.title)saveCard(c.id,{title:v},"renamed this card to “"+v+"”"); else ta.value=c.title; };
  const fresh=()=>cards.find(x=>x.id===c.id)||c;
  m.onchange=e=>{ if(ro)return; const t=e.target, d=t.dataset, cc=fresh();
    if(d.field){ const f=b.fields.find(x=>x.id===d.field); const fields=Object.assign({},cc.fields||{}); if(t.value==="")delete fields[f.id]; else fields[f.id]=f.type==="number"?Number(t.value):t.value; t.defaultValue=t.value; saveCard(c.id,{fields},"set "+f.name+(t.value?" to "+t.value:" to blank")); }
    if(d.chk){ const [kid,iid]=d.chk.split("|"); const k=cc.checklists.find(x=>x.id===kid), it=k.items.find(x=>x.id===iid);
      saveCard(c.id,{checklists:cc.checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.map(i=>i.id===iid?Object.assign({},i,{done:t.checked}):i)}))},(t.checked?"completed ":"marked incomplete ")+"“"+it.text+"” on "+k.name); }
    if("duedone" in d)saveCard(c.id,{dueDone:t.checked},t.checked?"marked the due date complete":"marked the due date incomplete");
    if("who" in d)setMe(t.value.trim()); };
  m.onclick=e=>{ const t=e.target.closest("button,[data-editdesc],[data-iedit],[data-kname]"); if(!t)return; const d=t.dataset, cc=fresh();
    if("x" in d)return closeEditor();
    if(ro&&!("details" in d))return;
    if("editdesc" in d){ editingDesc=true; paintEditor(true); const x=m.querySelector("[data-desc]"); if(x){ x.focus(); x.setSelectionRange(x.value.length,x.value.length); } return; }
    if("savedesc" in d){ const x=m.querySelector("[data-desc]"); const v=x.value; x.defaultValue=v; editingDesc=false; if(v!==(cc.desc||""))saveCard(c.id,{desc:v},"updated the description"); else paintEditor(true); return; }
    if("canceldesc" in d){ editingDesc=false; paintEditor(true); return; }
    if("details" in d){ showDetails=!showDetails; paintEditor(true); return; }
    if("post" in d){ const x=m.querySelector("[data-cm]"); const tx=x.value.trim(); if(!tx)return; const w=m.querySelector("[data-who]"); if(w&&w.value.trim())setMe(w.value.trim());
      x.value=""; saveCard(c.id,{comments:(cc.comments||[]).concat([{id:"m_"+rid(),by:me()||"AD",text:tx,at:Date.now()}])}); return; }
    if(d.cedit){ const x=cc.comments.find(y=>y.id===d.cedit); const v=prompt("Edit comment:",x.text); if(v==null||!v.trim())return; saveCard(c.id,{comments:cc.comments.map(y=>y.id===x.id?Object.assign({},y,{text:v.trim(),edited:true}):y)}); return; }
    if(d.cdel){ if(!confirm("Delete this comment?"))return; saveCard(c.id,{comments:cc.comments.filter(y=>y.id!==d.cdel)}); return; }
    if(d.kdel){ if(confirm("Delete this checklist?"))saveCard(c.id,{checklists:cc.checklists.filter(k=>k.id!==d.kdel)},"removed a checklist"); return; }
    if(d.khide){ saveCard(c.id,{checklists:cc.checklists.map(k=>k.id!==d.khide?k:Object.assign({},k,{hide:!k.hide}))}); return; }
    if(d.kname){ const k=cc.checklists.find(x=>x.id===d.kname); const v=(prompt("Checklist name:",k.name)||"").trim(); if(v&&v!==k.name)saveCard(c.id,{checklists:cc.checklists.map(x=>x.id===k.id?Object.assign({},x,{name:v}):x)}); return; }
    if(d.idel){ const [kid,iid]=d.idel.split("|"); saveCard(c.id,{checklists:cc.checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.filter(i=>i.id!==iid)}))}); return; }
    if(d.iedit){ const [kid,iid]=d.iedit.split("|"); const it=cc.checklists.find(k=>k.id===kid).items.find(i=>i.id===iid); const v=(prompt("Edit item:",it.text)||"").trim(); if(v&&v!==it.text)saveCard(c.id,{checklists:cc.checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.map(i=>i.id===iid?Object.assign({},i,{text:v}):i)}))}); return; }
    if(d.iadd)return itemComposer(m,d.iadd);
    if(d.iaddok){ const kid=d.iaddok; const x=m.querySelector(`[data-iaddw="${kid}"] textarea`); const lines=x.value.split("\n").map(s=>s.trim()).filter(Boolean); if(!lines.length)return; x.value=""; x.focus();
      saveCard(c.id,{checklists:fresh().checklists.map(k=>k.id!==kid?k:Object.assign({},k,{items:k.items.concat(lines.map(v=>({id:"i_"+rid(),text:v,done:false})))}))}).then(()=>setTimeout(()=>{ if($("bdEdit")&&!m.querySelector(`[data-iaddw="${kid}"] textarea`))itemComposer(m,kid); },60)); return; }
    if("iaddx" in d){ paintEditor(true); return; }
    if(d.adel){ saveCard(c.id,{attachments:cc.attachments.filter(a=>a.id!==d.adel)},"removed an attachment"); return; }
    if("unarch" in d){ saveCard(c.id,{archived:false},"sent this card back to the board"); return; }
    if("delete" in d){ if(!confirm("Permanently delete “"+c.title+"”? This can't be undone."))return; C("boardCards").doc(c.id).delete().then(closeEditor).catch(()=>ctx.toast(RULES_MSG)); return; }
    if(d.a)cardAction(t,cc,b,d.a);
  };
}
function itemComposer(m,kid){
  const w=m.querySelector(`[data-iaddw="${kid}"]`); if(!w)return;
  w.innerHTML=`<textarea class="ed" placeholder="Add an item (paste several lines to add several)" aria-label="New checklist item" style="min-height:40px"></textarea><div style="margin-top:6px"><button class="bdBlue" data-iaddok="${kid}">Add</button> <button class="bdGrayB" data-iaddx>Cancel</button></div>`;
  const x=w.querySelector("textarea"); x.focus();
  x.onkeydown=ev=>{ if(ev.key==="Enter"&&!ev.shiftKey){ ev.preventDefault(); w.querySelector("[data-iaddok]").click(); } };
}
function linkify(s){ return esc(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function cardAction(anchor,c,b,a){
  const fresh=()=>cards.find(x=>x.id===c.id)||c;
  if(a==="labels")return pop(anchor,"Labels",`${b.labels.map(l=>`<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0"><input type="checkbox" data-pl="${l.id}"${(c.labels||[]).includes(l.id)?" checked":""} style="width:18px;height:18px"> <span class="bdLab" style="background:${COLORS[l.color]||COLORS.gray};flex:1;padding:6px 10px;font-size:13px">${esc(l.name)}</span></label>`).join("")||"<p>No labels yet.</p>"}<button class="bdGrayB opt" data-plm style="margin-top:8px">Edit labels</button>`,p=>{
    p.onchange=e=>{ const id=e.target.dataset.pl; if(!id)return; const fc=fresh(); const l=b.labels.find(x=>x.id===id); const has=(fc.labels||[]).includes(id);
      saveCard(c.id,{labels:has?fc.labels.filter(x=>x!==id):(fc.labels||[]).concat([id])},(has?"removed the label ":"added the label ")+l.name); };
    p.querySelector("[data-plm]").onclick=()=>{ closePop(); closeEditor(); labelsPanel(); }; });
  if(a==="members"){ const ms=b.members||["Andrew","Ryan"]; return pop(anchor,"Members",ms.map(n=>`<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0"><input type="checkbox" data-pm="${esc(n)}"${(c.members||[]).includes(n)?" checked":""} style="width:18px;height:18px"><span class="bdAv">${esc(ini(n))}</span>${esc(n)}</label>`).join(""),p=>{
    p.onchange=e=>{ const n=e.target.dataset.pm; const fc=fresh(); const has=(fc.members||[]).includes(n); saveCard(c.id,{members:has?fc.members.filter(x=>x!==n):(fc.members||[]).concat([n])},(has?"removed "+n+" from":"added "+n+" to")+" this card"); }; }); }
  if(a==="checklist"){ const srcs=cards.filter(x=>(x.checklists||[]).length).flatMap(x=>x.checklists.map(k=>({v:x.id+"|"+k.id,t:x.title+" — "+k.name})));
    return pop(anchor,"Add checklist",`<label>Title</label><input type="text" id="p-k" value="Checklist">${srcs.length?`<label>Copy items from…</label><select id="p-kc"><option value="">(none)</option>${srcs.map(s=>`<option value="${esc(s.v)}">${esc(s.t)}</option>`).join("")}</select>`:""}<div style="margin-top:10px"><button class="bdBlue" id="p-ok">Add</button></div>`,p=>{
    p.querySelector("#p-k").select(); const go=()=>{ const n=p.querySelector("#p-k").value.trim()||"Checklist"; const s=p.querySelector("#p-kc"); let items=[];
      if(s&&s.value){ const [cid,kid]=s.value.split("|"); items=copyChecklists([cards.find(x=>x.id===cid).checklists.find(x=>x.id===kid)])[0].items; }
      const kid="k_"+rid(); saveCard(c.id,{checklists:(fresh().checklists||[]).concat([{id:kid,name:n,items}])},"added the checklist "+n).then(()=>setTimeout(()=>{ const m=$("bdEdit"); if(m&&!items.length)itemComposer(m,kid); },60)); closePop(); };
    p.querySelector("#p-ok").onclick=go; p.querySelector("#p-k").onkeydown=e=>{ if(e.key==="Enter")go(); }; }); }
  if(a==="dates")return pop(anchor,"Dates",`<label>Start date (optional)</label><input type="date" id="p-s" value="${esc(c.start||"")}"><label>Due date</label><input type="date" id="p-d" value="${esc(c.due||"")}"><div style="display:flex;gap:6px;margin-top:10px"><button class="bdBlue" id="p-ok">Save</button><button class="bdGrayB" id="p-rm">Remove</button></div>`,p=>{
    p.querySelector("#p-ok").onclick=()=>{ const s=p.querySelector("#p-s").value, d=p.querySelector("#p-d").value; if(s&&!d){ ctx.toast("Add a due date too."); return; } if(s&&d&&s>d){ ctx.toast("Start has to be on or before the due date."); return; }
      saveCard(c.id,{start:s,due:d,dueDone:d?!!c.dueDone:false},d?"set this card to be due "+fmtD(d):"removed the due date"); closePop(); };
    p.querySelector("#p-rm").onclick=()=>{ saveCard(c.id,{start:"",due:"",dueDone:false},"removed the dates"); closePop(); }; });
  if(a==="attach")return pop(anchor,"Attach a link",`<label>Link</label><input type="url" id="p-u" placeholder="Paste a link (Google Drive, a form, a website…)"><label>Display text (optional)</label><input type="text" id="p-n"><div style="margin-top:10px"><button class="bdBlue" id="p-ok">Attach</button></div><p style="font-size:12px;color:#626f86">For a file, put it in Google Drive and attach its link.</p>`,p=>{
    p.querySelector("#p-u").focus(); p.querySelector("#p-ok").onclick=()=>{ let u=p.querySelector("#p-u").value.trim(); if(!u)return; if(!/^https?:\/\//i.test(u))u="https://"+u;
      saveCard(c.id,{attachments:(fresh().attachments||[]).concat([{id:"a_"+rid(),url:u,name:p.querySelector("#p-n").value.trim(),at:Date.now()}])},"attached "+(p.querySelector("#p-n").value.trim()||u)); closePop(); }; });
  if(a==="cover")return pop(anchor,"Cover",`<div class="bdChips">${Object.entries(COLORS).map(([k,v])=>`<button data-cv="${k}" aria-label="${k} cover" title="${k}" style="width:52px;height:32px;border-radius:4px;border:${c.cover===k?"3px solid #0c66e4":"0"};background:${v};cursor:pointer"></button>`).join("")}</div><button class="bdGrayB opt" data-cv="" style="margin-top:8px">Remove cover</button>`,p=>{
    p.onclick=e=>{ const t=e.target.closest("[data-cv]"); if(!t)return; saveCard(c.id,{cover:t.dataset.cv}); closePop(); }; });
  if(a==="move"||a==="copy"){
    return pop(anchor,a==="move"?"Move card":"Copy card",`${a==="copy"?`<label>Title</label><textarea id="p-t" rows="2">${esc(c.title)}</textarea><label style="display:flex;gap:6px;font-weight:400"><input type="checkbox" id="p-kk" checked> Keep checklists</label><label style="display:flex;gap:6px;font-weight:400"><input type="checkbox" id="p-kl" checked> Keep labels</label><label style="display:flex;gap:6px;font-weight:400"><input type="checkbox" id="p-km" checked> Keep members</label>`:""}
      <label>Board</label><select id="p-b">${openBoards().map(x=>`<option value="${esc(x.id)}"${x.id===c.boardId?" selected":""}>${esc(x.name)}</option>`).join("")}</select>
      <label>List</label><select id="p-l"></select><label>Position</label><select id="p-p"><option value="bottom">Bottom</option><option value="top">Top</option></select>
      <div style="margin-top:10px"><button class="bdBlue" id="p-ok">${a==="move"?"Move":"Create card"}</button></div>`,p=>{
      const fillL=()=>{ const bb=boards.find(x=>x.id===p.querySelector("#p-b").value); p.querySelector("#p-l").innerHTML=(bb.lists||[]).filter(l=>!l.archived).map(l=>`<option value="${esc(l.id)}"${l.id===c.listId?" selected":""}>${esc(l.name)}${l.id===c.listId?" (current)":""}</option>`).join(""); };
      fillL(); p.querySelector("#p-b").onchange=fillL;
      p.querySelector("#p-ok").onclick=async()=>{ const bid=p.querySelector("#p-b").value, lid=p.querySelector("#p-l").value, top=p.querySelector("#p-p").value==="top"; if(!lid)return; const bb=boards.find(x=>x.id===bid);
        const ttl=a==="copy"?(p.querySelector("#p-t").value.trim()||c.title):"", keepK=a==="copy"&&p.querySelector("#p-kk").checked, keepL=a==="copy"&&p.querySelector("#p-kl").checked, keepM=a==="copy"&&p.querySelector("#p-km").checked;
        closePop();
        const sameBoard=bid===c.boardId;
        const there=sameBoard?listCards(lid).filter(x=>x.id!==c.id):(await C("boardCards").where("boardId","==",bid).get()).docs.map(d=>Object.assign({id:d.id},d.data())).filter(x=>x.listId===lid&&!x.archived).sort((x,y)=>x.pos-y.pos);
        const pos=top?(there.length?there[0].pos-1000:1000):posFor(there,null);
        try{
          if(a==="move"){
            if(sameBoard){ await moveCard(c.id,lid,top&&there[0]?there[0].id:null); }
            else { await saveCard(c.id,{boardId:bid,listId:lid,pos,labels:mapLabels(c.labels,b,bb),fields:mapFields(c.fields,b,bb)},"moved this card from "+b.name+" to "+bb.name); closeEditor(); ctx.toast("Moved to "+bb.name); }
          } else {
            await C("boardCards").add(blankCard(bid,lid,pos,ttl,{desc:c.desc||"",labels:keepL?(sameBoard?(c.labels||[]).slice():mapLabels(c.labels,b,bb)):[],fields:sameBoard?Object.assign({},c.fields||{}):mapFields(c.fields,b,bb),cover:c.cover||"",
              checklists:keepK?copyChecklists(c.checklists):[],members:keepM?(c.members||[]).slice():[],attachments:(c.attachments||[]).slice(),due:c.due||"",start:c.start||""}));
            ctx.toast("Card copied"+(sameBoard?"":" to "+bb.name));
          }
        }catch(err){ console.error(err); ctx.toast(RULES_MSG); } }; }); }
  if(a==="tpl")return saveCard(c.id,{template:!c.template},c.template?"stopped this card being a template":"made this card a template");
  if(a==="archive"){ saveCard(c.id,{archived:true},"archived this card"); closeEditor(); ctx.toast("Archived. Restore it from Menu → Archived items."); return; }
}

// ---------- seed + watchers ----------
async function seed(data){
  if(!data||!Array.isArray(data.boards)){ ctx.toast("That file isn't a boards starter file."); return; }
  if(!confirm("Load "+data.boards.length+" starter boards: "+data.boards.map(b=>b.name).join(", ")+"?"))return;
  const plan=seedPlan(data);
  try{ let bt=ctx.fdb.batch(), n=0;
    for(const x of plan.boards){ const {id,...rest}=x; bt.set(C("boards").doc(id),rest); n++; }
    for(const x of plan.cards){ const {id,...rest}=x; bt.set(C("boardCards").doc(id),rest); if(++n>=400){ await bt.commit(); bt=ctx.fdb.batch(); n=0; } }
    await bt.commit(); ctx.toast("Boards loaded"); }catch(e){ console.error(e); ctx.toast(RULES_MSG); }
}
function watchCards(){
  if(unsubC)unsubC(); cards=[]; composing=null; const b=curBoard(); if(!b||b.closed){ draw(); return; }
  cur=b.id;
  unsubC=C("boardCards").where("boardId","==",b.id).onSnapshot(s=>{ cards=s.docs.map(d=>Object.assign({id:d.id},d.data()));
    if(!(drag&&drag.active)){ const keep=composing; draw(); if(keep&&document.querySelector(`[data-comp="${keep}"]`))composer(keep); }
    paintEditor(); refreshPanel(); },e=>{ console.error(e); });
  draw();
}
function close(){ closeEditor(); closePanel(); closePop(); if(unsubC){ unsubC(); unsubC=null; } if(unsubB){ unsubB(); unsubB=null; } ctx.closeSheet(); }

const api={automation,seedPlan,matches,posFor};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.Boards=Object.assign(api,{
  init(c){ ctx=c; ro=!!c.readOnly; if(!document.getElementById("bdCss")){ const st=document.createElement("style"); st.id="bdCss"; st.textContent=CSS; document.head.appendChild(st); } },
  open(){
    $("bdSheet").innerHTML=`<span id="bdTitle" style="position:absolute;left:-9999px">Boards</span><div id="bdBody" style="display:flex;flex-direction:column;min-height:100%"><p style="color:#fff;padding:16px">Loading…</p></div>`;
    ctx.showSheet("bdSheet");
    if(unsubB)unsubB();
    unsubB=C("boards").onSnapshot(s=>{ boards=s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(a.order||0)-(b.order||0));
      const cb=boards.find(b=>b.key==="coaches"); if(!ro&&cb&&!byName(cb.labels,"VACANT"))C("boards").doc(cb.id).update({labels:(cb.labels||[]).concat([{id:"lb_"+rid(),name:"VACANT",color:"black"}])}).catch(()=>{});
      const ob=openBoards(); if(!cur||!ob.find(b=>b.id===cur)){ cur=ob[0]&&ob[0].id; watchCards(); } else if(!(drag&&drag.active)){ const keep=composing; draw(); if(keep&&document.querySelector(`[data-comp="${keep}"]`))composer(keep); }
      refreshPanel(); paintEditor(); },
      e=>{ console.error(e); $("bdBody").innerHTML='<p style="color:#fff;padding:16px">Couldn\'t load boards. The Firestore rules for boards need publishing first.</p>'; });
  }
});
})(typeof window!=="undefined"?window:globalThis);
