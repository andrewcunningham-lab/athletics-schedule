/* Team attendance for coaches.
   - Each head coach keeps his own team's roster (rosters/{team}).
   - The AD uploads or pastes the day's absences (from TeacherEase). They're matched to rosters and saved per team in
     attDay/{team}: only that team's players, only "Absent" or "Partial day", never the reason or code. Absences that
     aren't on any roster are dropped, never saved. Each upload replaces the day before.
   - A coach sees only his own teams. The Firestore rules enforce that, not just this screen.
*/
(function(root){
"use strict";

// ---------- pure helpers (also used by tests) ----------
const clean=s=>String(s||"").toLowerCase().replace(/[‘’']/g,"").replace(/[^a-z\s,-]/g," ").replace(/\s+/g," ").trim();
// "Smith, John A" / "John Smith" -> {first:"john", last:"smith"}
function splitName(raw){
  const s=String(raw||"").trim(); if(!s)return null;
  if(s.includes(",")){ const [l,f]=s.split(",",2); const first=clean(f).split(/[\s-]/)[0]||""; return {first,last:clean(l).replace(/\s/g,"")}; }
  const p=clean(s).split(" ").filter(Boolean); if(p.length<2)return null;
  return {first:p[0],last:p.slice(1).join("")};
}
const keyOf=n=>n?n.first+"|"+n.last:"";
const PARTIAL=/half|partial|early|late|tardy|\bam\b|\bpm\b|left|arriv/i;
function parseCSVLine(line,sep){ const out=[]; let cur="",q=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(q){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; } else if(ch==='"')q=true; else if(ch===sep){ out.push(cur); cur=""; } else cur+=ch; } out.push(cur); return out.map(x=>x.trim()); }
// Reads a CSV export or a pasted list of today's absences. Returns [{first,last,grade,partial}] and never keeps the reason.
function parseAbsences(text){
  const lines=String(text||"").split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return [];
  const sep=lines[0].includes("\t")?"\t":(lines[0].split(",").length>2||/name|first|last|student/i.test(lines[0]))?",":null;
  if(!sep){ // pasted list, one student per line: "John Smith", "Smith, John", optionally followed by " - half day"
    return lines.map(l=>{ const m=l.split(/\s+[-–—|]\s+|\t/); const n=splitName(m[0]); return n?Object.assign(n,{grade:"",partial:PARTIAL.test(m.slice(1).join(" "))}):null; }).filter(Boolean);
  }
  const rows=lines.map(l=>parseCSVLine(l,sep));
  const h=rows[0].map(x=>x.toLowerCase().replace(/[^a-z]/g,""));
  const hasHead=h.some(x=>/name|first|last|student|grade|status|code|reason/.test(x));
  const idx=k=>h.findIndex(x=>k.test(x));
  const fi=hasHead?idx(/^first|firstname|fname/):-1, li=hasHead?idx(/^last|lastname|lname/):-1;
  const ni=hasHead?idx(/^(student|name|studentname|fullname)$/):(-1), gi=hasHead?idx(/^grade|^gr$|gradelevel/):-1;
  const si=hasHead?h.findIndex((x,i)=>i!==ni&&i!==fi&&i!==li&&i!==gi&&/status|code|type|attendance|reason|period|desc/.test(x)):-1;
  return rows.slice(hasHead?1:0).map(r=>{
    let n=null;
    if(fi>=0&&li>=0)n={first:clean(r[fi]).split(/[\s-]/)[0]||"",last:clean(r[li]).replace(/\s/g,"")};
    else n=splitName(r[ni>=0?ni:0]);
    if(!n||!n.first||!n.last)return null;
    const rest=si>=0?r[si]:r.filter((_,i)=>i!==ni&&i!==fi&&i!==li&&i!==gi).join(" ");
    return {first:n.first,last:n.last,grade:gi>=0?String(r[gi]).replace(/\D/g,""):"",partial:PARTIAL.test(rest||"")};
  }).filter(Boolean);
}
// Matches absences to every team's roster. Returns per-team results (only that team's players) plus what didn't match.
function matchAll(rosters,absences){
  const byKey=new Map(); absences.forEach(a=>{ const k=keyOf(a); const prev=byKey.get(k); if(!prev||(!a.partial&&prev.partial))byKey.set(k,a); });
  const used=new Set(), perTeam={}, close=[];
  rosters.forEach(r=>{
    perTeam[r.team]=[];
    (r.players||[]).forEach(p=>{
      const n={first:clean(p.first).split(/[\s-]/)[0],last:clean(p.last).replace(/\s/g,"")}; const a=byKey.get(keyOf(n));
      if(a&&(!a.grade||!p.grade||String(p.grade)===a.grade)){ used.add(keyOf(n)); perTeam[r.team].push({first:p.first,last:p.last,status:a.partial?"Partial day":"Absent"}); }
      else { const near=absences.find(x=>x.last===n.last&&x.first!==n.first&&(x.first[0]===n.first[0])); if(near)close.push({team:r.team,player:p.first+" "+p.last,absence:near.first+" "+near.last}); }
    });
  });
  const unmatched=absences.filter(a=>!used.has(keyOf(a))).length;
  return {perTeam,unmatched,close};
}
const teamId=t=>encodeURIComponent(t);

// ---------- screens ----------
let ctx=null, unsubs=[];
const $=id=>document.getElementById(id), esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const CSS=`
.attTeam{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px;background:var(--surface)}
.attTeam h4{margin:0 0 2px;font-size:16px}
.attRow{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:14.5px}
.attSt{font-weight:700;font-size:13px;border:1.5px solid currentColor;border-radius:5px;padding:1px 8px;white-space:nowrap}
.attSt.ab{color:var(--scarlet)} .attSt.pt{color:var(--tent)} .attSt.ok{color:var(--muted);font-weight:600;border-style:dashed}
.attRow button{border:0;background:var(--bg);border-radius:99px;padding:2px 9px;font-size:12px;cursor:pointer}
#attSheet textarea{width:100%;min-height:120px;font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}
`;
const todayIso=()=>{ const d=new Date(), p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); };
const fmtT=ms=>new Date(ms).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
const sortP=(a,b)=>String(a.last).localeCompare(String(b.last))||String(a.first).localeCompare(String(b.first));

async function getRoster(team){ try{ const s=await ctx.fdb.collection("rosters").doc(teamId(team)).get(); return s.exists?(s.data().players||[]):[]; }catch(_){ return []; } }
async function getDay(team){ try{ const s=await ctx.fdb.collection("attDay").doc(teamId(team)).get(); return s.exists?s.data():null; }catch(_){ return null; } }

function shell(title){
  $("attSheet").innerHTML=`<h3 id="attTitle">${esc(title)}</h3><div id="attBody"></div><div class="row" style="margin-top:12px"><button class="btn" id="att-close">Close</button></div>`;
  $("att-close").onclick=()=>ctx.closeSheet();
}

// Coach: his teams, today's status, and his roster.
async function openCoach(){
  shell("Attendance"); ctx.showSheet("attSheet");
  const teams=ctx.coachTeams().slice().sort(); const B=$("attBody");
  if(!teams.length){ B.innerHTML='<p class="small muted">You are not set up as a coach for any team.</p>'; return; }
  B.innerHTML='<p class="small muted">Loading…</p>';
  const today=todayIso(); let h=`<p class="small muted">Only you (and the ADs) can see your teams. Other coaches can't.</p>`;
  for(const t of teams){
    const [players,day]=await Promise.all([getRoster(t),getDay(t)]);
    const posted=day&&day.date===today; const st={};
    if(posted)(day.absent||[]).forEach(a=>st[(a.first+" "+a.last).toLowerCase()]=a.status);
    h+=`<div class="attTeam" data-team="${esc(t)}"><h4>${esc(t)}</h4>
      <div class="small muted">${posted?"Today's attendance posted "+fmtT(day.postedAt):"Today's attendance hasn't been posted yet."}</div>
      ${players.length?players.slice().sort(sortP).map(p=>{ const s=posted?st[(p.first+" "+p.last).toLowerCase()]:null;
        const lbl=!posted?"":s==="Absent"?'<span class="attSt ab">Absent</span>':s==="Partial day"?'<span class="attSt pt">Partial day</span>':'<span class="attSt ok">Not marked absent</span>';
        return `<div class="attRow"><span>${esc(p.first)} ${esc(p.last)}${p.grade?` <span class="small muted">· ${esc(p.grade)}th</span>`:""}</span><span style="display:flex;gap:6px;align-items:center">${lbl}<button data-rm="${esc(p.first+"|"+p.last+"|"+(p.grade||""))}" title="Remove from roster">Remove</button></span></div>`; }).join("")
        :'<p class="small muted" style="margin:6px 0">No players on this roster yet. Add them below.</p>'}
      <details style="margin-top:8px"><summary class="small">Add players</summary>
        <p class="small muted">One player per line: first name, last name, grade. For example: <b>John Smith 10</b></p>
        <textarea data-add></textarea><div class="row" style="margin-top:6px"><button class="btn primary" data-save>Add to roster</button></div></details></div>`;
  }
  h+=`<p class="small muted">"Not marked absent" means the player wasn't on today's absence list. Spell names the same way the school office does, or an absence won't match.</p>`;
  B.innerHTML=h;
  B.onclick=async e=>{
    const card=e.target.closest("[data-team]"); if(!card)return; const t=card.dataset.team;
    const rm=e.target.closest("[data-rm]"), sv=e.target.closest("[data-save]");
    if(rm){ const [f,l,g]=rm.dataset.rm.split("|"); if(!confirm("Remove "+f+" "+l+" from the "+t+" roster?"))return;
      const players=(await getRoster(t)).filter(p=>!(p.first===f&&p.last===l&&String(p.grade||"")===g));
      try{ await ctx.fdb.collection("rosters").doc(teamId(t)).set({team:t,players}); ctx.toast("Removed"); openCoach(); }catch(_){ ctx.toast("Couldn't save. Check your connection."); } }
    if(sv){ const lines=card.querySelector("[data-add]").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(!lines.length)return;
      const add=[], bad=[];
      lines.forEach(l=>{ const m=l.replace(/,/g," ").trim().match(/^(\S+)\s+(.+?)(?:\s+(\d{1,2})(?:th|st|nd|rd)?)?$/i); if(m)add.push({first:m[1],last:m[2].trim(),grade:m[3]||""}); else bad.push(l); });
      if(bad.length){ ctx.toast("Couldn't read: "+bad.join("; ")); return; }
      const cur=await getRoster(t); const have=new Set(cur.map(p=>(p.first+" "+p.last).toLowerCase()));
      const players=cur.concat(add.filter(p=>!have.has((p.first+" "+p.last).toLowerCase())));
      try{ await ctx.fdb.collection("rosters").doc(teamId(t)).set({team:t,players}); ctx.toast("Roster saved"); openCoach(); }catch(_){ ctx.toast("Couldn't save. Check your connection."); } }
  };
}

// AD: upload today's absences, preview the matches, then post.
async function openAD(){
  shell("Attendance upload"); ctx.showSheet("attSheet"); const B=$("attBody");
  B.innerHTML=`<div class="form">
    <p class="small muted">Upload TeacherEase's absence report (CSV) or paste today's absent students, one per line. Only students on a team roster are saved, and only as Absent or Partial day. Reasons and codes are never saved. Each upload replaces the day before.</p>
    <div class="row"><label class="btn" for="att-file">Choose CSV file</label><input type="file" id="att-file" accept=".csv,.txt,text/csv" hidden></div>
    <label><span class="lbl">Or paste here</span><textarea id="att-text" placeholder="Smith, John&#10;Jane Doe - half day"></textarea></label>
    <div class="row"><button class="btn" id="att-prev">Check matches</button></div>
    <div id="att-res"></div><p class="err" id="att-err"></p></div>`;
  $("att-file").onchange=async e=>{ const f=e.target.files[0]; e.target.value=""; if(f){ $("att-text").value=await f.text(); $("att-prev").click(); } };
  $("att-prev").onclick=async()=>{
    $("att-err").textContent=""; const abs=parseAbsences($("att-text").value);
    if(!abs.length){ $("att-err").textContent="Couldn't find any student names. Paste one per line, or use a CSV with a name column."; return; }
    let rosters=[]; try{ const s=await ctx.fdb.collection("rosters").get(); rosters=s.docs.map(d=>d.data()).filter(r=>r.team); }catch(_){ $("att-err").textContent="Couldn't load rosters. If this is new, paste the updated Firestore rules."; return; }
    if(!rosters.length){ $("att-err").textContent="No team has a roster yet. Coaches add their players under Attendance."; return; }
    const m=matchAll(rosters,abs);
    $("att-res").innerHTML=`<div class="cfs"><div class="h">${abs.length} absence${abs.length===1?"":"s"} read</div><ul>${Object.entries(m.perTeam).sort().map(([t,a])=>`<li>${esc(t)}: ${a.length?a.map(x=>esc(x.first+" "+x.last)+" ("+x.status.toLowerCase()+")").join(", "):"nobody absent"}</li>`).join("")}</ul>
      <p class="small muted">${m.unmatched} absence${m.unmatched===1?" isn't":"s aren't"} on any roster and won't be saved.</p></div>
      ${m.close.length?`<div class="cfs"><div class="h">Check these spellings</div><ul>${m.close.map(c=>`<li>${esc(c.player)} on the ${esc(c.team)} roster, but the absence list has ${esc(c.absence)}</li>`).join("")}</ul><p class="small muted">If they're the same student, have the coach fix the roster spelling, then check again.</p></div>`:""}
      <div class="row"><button class="btn primary" id="att-post">Post today's attendance</button></div>`;
    $("att-post").onclick=async()=>{
      const now=Date.now(), d=todayIso(), b=ctx.fdb.batch();
      Object.entries(m.perTeam).forEach(([t,a])=>b.set(ctx.fdb.collection("attDay").doc(teamId(t)),{team:t,date:d,postedAt:now,absent:a}));
      try{ await b.commit(); ctx.toast("Posted for "+Object.keys(m.perTeam).length+" teams"); $("att-text").value=""; $("att-res").innerHTML='<p class="small">Posted. Coaches can see their own teams now.</p>'; }
      catch(_){ $("att-err").textContent="Couldn't post. If this is new, paste the updated Firestore rules."; }
    };
  };
}

const api={parseAbsences,matchAll,splitName,teamId};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.Attendance=Object.assign(api,{
  init(c){ ctx=c; if(!document.getElementById("attCss")){ const st=document.createElement("style"); st.id="attCss"; st.textContent=CSS; document.head.appendChild(st); } },
  openCoach, openAD
});
})(typeof window!=="undefined"?window:globalThis);
