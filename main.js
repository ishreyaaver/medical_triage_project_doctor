import "./styles.css";
import { supabase, supabaseConfig } from "./supabaseClient.js";
(()=>{
"use strict";
/* =====================================================================
   Helpers
   ===================================================================== */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ic=(n,c="")=>`<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const initials=n=>String(n||"?").replace(/^Dr\.?\s*/i,"").split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
const MIN=60000, now=()=>Date.now();
const fmtT=d=>new Date(d).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"});
const fmtD=d=>new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
const fmtDT=d=>`${fmtD(d)}, ${fmtT(d)}`;
const sameDay=(a,b)=>new Date(a).toDateString()===new Date(b).toDateString();
const ago=d=>{const m=Math.round((now()-new Date(d))/MIN);if(m<1)return"Just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" hr ago";return Math.round(h/24)+" d ago"};
const uid=()=>"id-"+Math.random().toString(36).slice(2,10);
const TRIAGE={critical:{l:"Critical",r:0},high:{l:"High priority",r:1},moderate:{l:"Moderate",r:2},low:{l:"Routine",r:3}};
const trR=t=>TRIAGE[t]?.r??9;
const triBadge=t=>TRIAGE[t]?`<span class="badge t-${t}">${TRIAGE[t].l}</span>`:"";
const triTxt=t=>TRIAGE[t]?`<span class="badge s-neutral">Triage: ${TRIAGE[t].l}</span>`:`<span class="muted">–</span>`;
/* Doctor-assigned priority. Separate from the stored clinical triage value. */
const PRI={low:{l:"Low",r:2},normal:{l:"Normal",r:1},high:{l:"High",r:0}};
const priOf=pid=>S.priorities[pid]?.category||null;
const priR=pid=>PRI[priOf(pid)]?.r??3;
const priBadge=c=>PRI[c]?`<span class="badge p-${c}">${PRI[c].l} priority</span>`:`<span class="badge s-neutral">Priority not set</span>`;
const ageGender=p=>[p?.age!=null&&p.age!==""?p.age+" yrs":"",p?.gender||""].filter(Boolean).join(" · ");
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const HOURS=[8,9,10,11,12,13,14,15,16,17,18,19];
const hLabel=h=>`${((h+11)%12)+1} ${h<12?"AM":"PM"}`;

/* =====================================================================
   State + data layer (Supabase only; no sample data)
   ===================================================================== */
const CFG=supabaseConfig;
const S={mode:"none",connected:false,loadError:"",notDoctor:false,sessionEmail:"",notConfigured:false,configIssue:"",priorities:{},priorityReady:false,summaries:{},sb:null,noSession:false,route:"dashboard",collapsed:false,drawer:false,
  triage:"all",apptTab:"today",repState:"pending",recSel:null,recQuery:"",histQuery:"",consult:null,
  settings:{ai:true,sound:false,digest:true,compact:false,motion:true},
  stream:null,mic:true,cam:true,dirtyAvail:false};
try{Object.assign(S.settings,JSON.parse(localStorage.getItem("dj-settings")||"{}"))}catch(e){}

async function init(){
  S.collapsed=innerWidth<1180&&innerWidth>900;
  applySettings();
  if(CFG.configured){
    S.sb=supabase;
    S.mode="live";
    await bootLive();
    S.sb.auth.onAuthStateChange(ev=>{if(ev==="SIGNED_OUT")setTimeout(toSignedOut,0)});
  }else{
    Object.assign(S,emptyData());
    S.mode="none";S.notConfigured=true;
    S.configIssue=CFG.issue;
  }
  shell();route();
}
function emptyData(){return{doctor:{full_name:"Doctor",specialty:"",accepting_patients:true},patients:[],appointments:[],reports:[],history:[],notifications:[],schedule:{},week:[0,0,0,0,0,0,0],priorities:{}}}

/* Load everything for the signed-in doctor. "connected" is only true after a real load succeeded. */
async function bootLive(){
  S.noSession=false;S.loadError="";S.notDoctor=false;S.connected=false;
  try{
    const ok=await loadLive();
    if(ok)S.connected=true;
    else{S.noSession=true;Object.assign(S,emptyData())}
  }catch(e){
    console.error(e);
    S.loadError=e.message||String(e);
    Object.assign(S,emptyData());
    toast("Could not load data from Supabase: "+S.loadError,"err");
  }
}
/* Drop everything held in memory (including patient data) when the session ends. */
function toSignedOut(){
  S.connected=false;S.notDoctor=false;S.loadError="";S.summaries={};S.consult=null;S.recSel=null;
  Object.assign(S,emptyData());S.noSession=true;
  clearInterval(timer);stopStream();$("#layer").innerHTML="";
  shell();route();
}
async function loadLive(){
  const sb=S.sb;
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return false;
  const id=session.user.id;S.sessionEmail=session.user.email||"";
  const q=(t,sel="*")=>sb.from(t).select(sel);
  const [d,a,r,c,n,av,p]=await Promise.all([
    q("doctors").eq("id",id).maybeSingle(),
    q("appointments","*, patient:patients(*)").eq("doctor_id",id).order("scheduled_at"),
    q("ai_reports","*, patient:patients(*)").eq("doctor_id",id).order("created_at",{ascending:false}),
    q("consultations","*, patient:patients(*)").eq("doctor_id",id).order("completed_at",{ascending:false}).limit(200),
    q("notifications").eq("doctor_id",id).order("created_at",{ascending:false}).limit(100),
    q("doctor_availability").eq("doctor_id",id).maybeSingle(),
    q("patients").limit(500)
  ]);
  if(d.error)throw d.error;
  if(!d.data){S.notDoctor=true;return false}
  for(const x of [d,a,r,c,n,av,p]) if(x.error) throw x.error;
  S.doctor=d.data;
  S.doctor.id=id;
  S.appointments=a.data||[];S.reports=r.data||[];S.history=c.data||[];S.notifications=n.data||[];
  S.schedule=av.data?.schedule||{};S.patients=p.data||[];
  const pr=await sb.from("patient_priorities").select("*, updater:doctors!updated_by(full_name)").eq("doctor_id",id);
  S.priorityReady=!pr.error;S.priorities={};
  if(!pr.error)(pr.data||[]).forEach(r=>S.priorities[r.patient_id]=r);
  S.week=weekCounts();
  return true;
}
function weekCounts(){
  const out=[];for(let i=6;i>=0;i--){const d=new Date(now()-i*864e5);out.push(S.history.filter(h=>sameDay(h.completed_at,d)).length)}return out;
}
/* Persist a write. Returns false (and tells the doctor) if nothing could be saved. */
async function persist(fn){
  if(!S.connected){toast("Supabase is not connected, so changes cannot be saved.","err");return false}
  try{const r=await fn(S.sb);if(r.error)throw r.error;
    if(Array.isArray(r.data)&&!r.data.length)throw new Error("No rows were changed. You may not have permission for this action.");
    return true}
  catch(e){toast("Could not save: "+e.message,"err");return false}
}

/* =====================================================================
   Derived data
   ===================================================================== */
const today=()=>S.appointments.filter(a=>sameDay(a.scheduled_at,now())&&a.status!=="cancelled");
const waiting=()=>S.appointments.filter(a=>a.status==="waiting").sort((a,b)=>(priR(a.patient_id)-priR(b.patient_id))||(new Date(a.checked_in_at||a.scheduled_at)-new Date(b.checked_in_at||b.scheduled_at)));
const pendingReports=()=>S.reports.filter(r=>r.status==="pending");
const unread=()=>S.notifications.filter(n=>!n.read).length;
const waitMin=a=>a.checked_in_at?Math.max(0,Math.round((now()-new Date(a.checked_in_at))/MIN)):0;
const apptById=id=>S.appointments.find(a=>a.id===id);
const patById=id=>S.patients.find(p=>p.id===id)||S.appointments.find(a=>a.patient_id===id)?.patient;
function allPatients(){
  const m=new Map();S.patients.forEach(p=>m.set(p.id,p));S.appointments.forEach(a=>a.patient&&m.set(a.patient.id,a.patient));
  return[...m.values()].sort((a,b)=>a.full_name.localeCompare(b.full_name));
}

/* =====================================================================
   Shell
   ===================================================================== */
const NAV=[
 ["dashboard","Dashboard","dashboard"],["queue","Patient Queue","queue"],["appointments","Appointments","calendar"],
 ["reports","AI Medical Reports","ai"],["records","Patient Records","folder"],["video","Video Consultations","video"],
 ["availability","Doctor Availability","clock"],["history","Consultation History","history"],
 ["notifications","Notifications","bell"],["profile","Doctor Profile","user"],["settings","Settings","settings"]
];
function shell(){
  const d=S.doctor;
  $("#top").innerHTML=`
    <button class="icon-btn only-mobile" data-a="drawer" aria-label="Open navigation">${ic("menu")}</button>
    <div class="brand"><span class="logo">${ic("pulse")}</span><div><b>Digi Janseva</b><small>Doctor Portal</small></div></div>
    <label class="search"><span class="sr">Search patients</span>${ic("search","sm")}<input id="gsearch" type="search" placeholder="Search patients, press Enter" autocomplete="off"></label>
    <span class="spacer"></span>
    <span class="pill hide-sm" title="AI patient-record summaries">${ic("ai","sm")} AI summaries ${S.settings.ai?"on":"off"}</span>
    <button class="pill" id="accpill" data-a="accept" aria-pressed="${!!d.accepting_patients}" title="Toggle whether patients can book you" style="cursor:pointer" ${S.connected?"":"disabled"}>
      <span class="dot ${d.accepting_patients?"on":""}"></span><span>${d.accepting_patients?"Accepting patients":"Not accepting"}</span></button>
    <button class="icon-btn" data-go="notifications" aria-label="Notifications, ${unread()} unread">${ic("bell")}${unread()?`<span class="badge-count">${unread()}</span>`:""}</button>
    <button class="me" data-go="profile" aria-label="Open doctor profile"><span class="avatar">${esc(initials(d.full_name))}</span><span class="n">${esc(d.full_name)}</span></button>`;
  renderSide();
  $("#gsearch").addEventListener("keydown",e=>{if(e.key==="Enter"){S.recQuery=e.target.value;S.recSel=null;go("records")}});
}
function renderSide(){
  const counts={queue:waiting().length,reports:pendingReports().length,notifications:unread()};
  $("#side").innerHTML=`<nav class="nav" aria-label="Main">${NAV.map(([id,l,i])=>`
    <button class="nav-item ${S.route===id?"active":""}" data-go="${id}" title="${l}" ${S.route===id?'aria-current="page"':""}>
      ${ic(i)}<span class="lbl">${l}</span>${counts[id]?`<span class="cnt">${counts[id]}</span>`:""}</button>`).join("")}</nav>
    <div class="side-foot"><button class="nav-item only-desktop" data-a="collapse" aria-label="${S.collapsed?"Expand":"Collapse"} sidebar" title="${S.collapsed?"Expand":"Collapse"} sidebar">${ic("collapse")}<span class="lbl">Collapse sidebar</span></button></div>`;
  $("#shell").classList.toggle("collapsed",S.collapsed);
  const c=$("#side .side-foot .ic");if(c)c.style.transform=S.collapsed?"rotate(180deg)":"";
}

/* =====================================================================
   Router
   ===================================================================== */
const VIEWS={};
function go(r){location.hash="#/"+r}
function route(){
  const r=(location.hash.replace(/^#\//,"")||"dashboard");
  S.route=VIEWS[r]?r:"dashboard";
  $("#shell").classList.remove("drawer-open");
  renderSide();
  $("#view").innerHTML=viewHtml();
  const after=showing()?AFTER[S.route]:null;if(after)after();
  const t=NAV.find(n=>n[0]===S.route)[1];document.title=`${t} · Digi Janseva Doctor Portal`;
  scrollTo({top:0});$("#view").focus({preventScroll:true});
}
addEventListener("hashchange",route);
function rerender(){const y=scrollY;shell();$("#view").innerHTML=viewHtml();if(showing())AFTER[S.route]?.();scrollTo({top:y})}
const showing=()=>!S.noSession&&!S.notConfigured&&!S.loadError;
const viewHtml=()=>S.noSession?noSession():S.loadError?loadFailed():S.notConfigured?notConfigured():VIEWS[S.route]();
function notConfigured(){return`<div class="card notice"><div class="empty">${ic("alert")}<b>Backend not configured</b><p>${esc(S.configIssue)} Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env.local</code> file and restart the dev server to load patient data. Nothing is shown until the portal is connected to your database.</p></div></div>`}
function noSession(){
  if(S.notDoctor)return`<div class="card notice"><div class="empty">${ic("user")}<b>This account is not a doctor account</b>
  <p>You are signed in as ${esc(S.sessionEmail)}, but no doctor profile exists for this account, so no patient data is shown.</p><p style="margin-top:12px"><button class="btn" data-a="signout">Sign out</button></p></div></div>`;
  return`<div class="card notice"><div class="empty">${ic("user")}<b>Sign in required</b>
  <p>Sign in with your doctor account to see your queue and records.</p></div>
  <form id="loginform" class="form" style="grid-template-columns:1fr;text-align:left;margin-top:4px">
   <label>Email<input class="field" type="email" name="email" autocomplete="username" required></label>
   <label>Password<input class="field" type="password" name="password" autocomplete="current-password" required></label>
   <div id="loginerr" role="alert" style="color:var(--crit);font-size:.88rem"></div>
   <button class="btn primary" type="submit">Sign in</button></form></div>`}
function loadFailed(){return`<div class="card notice"><div class="empty">${ic("alert")}<b>Could not load your data</b><p>${esc(S.loadError)}</p><p style="margin-top:12px"><button class="btn" data-a="retry">Try again</button></p></div></div>`}

/* =====================================================================
   Shared fragments
   ===================================================================== */
function head(title,sub,actions=""){return`<div class="page-head"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div>${actions?`<div class="actions">${actions}</div>`:""}</div>`}
function empty(i,t,s){return`<div class="empty">${ic(i)}<b>${t}</b><p>${s}</p></div>`}
function who(p,sub){return`<div class="who"><span class="avatar md alt">${esc(initials(p.full_name))}</span><div><b>${esc(p.full_name)}</b><small>${esc(sub??ageGender(p))}</small></div></div>`}

/* ---------- charts ---------- */
function barChart(vals){
  const W=440,H=190,pad=26,max=Math.max(...vals,1)*1.15,bw=34,gap=(W-pad*2-bw*7)/6;
  const labels=vals.map((_,i)=>new Date(now()-(6-i)*864e5).toLocaleDateString("en-IN",{weekday:"short"}));
  return`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consultations over the last 7 days: ${vals.join(", ")}">
  <defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38BDF8"/><stop offset="1" stop-color="#3B82F6"/></linearGradient></defs>
  ${[0,.5,1].map(f=>`<line x1="${pad}" x2="${W-pad}" y1="${H-28-(H-60)*f}" y2="${H-28-(H-60)*f}" stroke="#1A2943"/>`).join("")}
  ${vals.map((v,i)=>{const h=(H-60)*v/max,x=pad+i*(bw+gap),y=H-28-h,last=i===6;
    return`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h,2)}" rx="6" fill="${last?"url(#bg1)":"#3B82F6"}" opacity="${last?1:.42}"/>
    <text x="${x+bw/2}" y="${y-6}" text-anchor="middle" style="fill:${last?"#EAF2FF":"#94A3B8"};font-weight:${last?700:500}">${v}</text>
    <text x="${x+bw/2}" y="${H-10}" text-anchor="middle">${labels[i]}</text>`}).join("")}</svg>`;
}
function donut(){
  const t=today();
  if(!t.length)return empty("calendar","No appointments scheduled","Today's cases will be grouped by your priority categories.");
  const cols={high:"#F87171",normal:"#94A3B8",low:"#3B82F6",unset:"#334A74"},names={high:"High",normal:"Normal",low:"Low",unset:"Not set"};
  const cnt=["high","normal","low","unset"].map(k=>[k,t.filter(a=>(priOf(a.patient_id)||"unset")===k).length]),tot=t.length,R=52,C=2*Math.PI*R;let off=0;
  const segs=cnt.map(([k,n])=>{const len=C*n/tot,s=`<circle r="${R}" cx="70" cy="70" fill="none" stroke="${cols[k]}" stroke-width="16" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;off+=len;return n?s:""}).join("");
  return`<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
  <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Today's cases by priority"><circle r="${R}" cx="70" cy="70" fill="none" stroke="#0D1626" stroke-width="16"/>${segs}
   <text x="70" y="68" text-anchor="middle" style="fill:#EAF2FF;font-family:Sora;font-size:24px;font-weight:600">${t.length}</text><text x="70" y="86" text-anchor="middle" style="fill:#94A3B8;font-size:11px">cases today</text></svg>
  <div class="legend" style="flex:1;min-width:140px">${cnt.map(([k,n])=>`<div><i style="background:${cols[k]}"></i>${names[k]}<b>${n}</b></div>`).join("")}</div></div>`;
}

/* =====================================================================
   VIEWS
   ===================================================================== */
VIEWS.dashboard=()=>{
  const t=today(),w=waiting(),done=t.filter(a=>a.status==="completed").length;
  const next=w[0]||t.filter(a=>a.status==="scheduled").sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0];
  const hr=new Date().getHours(),g=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  const avgWait=w.length?Math.round(w.reduce((s,a)=>s+waitMin(a),0)/w.length):0;
  const hero=next?`<section class="card hero" aria-label="Up next">
    <div><p class="muted" style="margin-bottom:10px">${next.status==="waiting"?"Next in your queue":"Next scheduled"}</p>
      <div class="who">${`<span class="avatar lg">${esc(initials(next.patient.full_name))}</span>`}<div><h2 style="font-size:1.3rem">${esc(next.patient.full_name)}</h2><p class="muted">${esc(ageGender(next.patient))}${ageGender(next.patient)?" · ":""}${esc(next.reason)}</p></div></div>
      <div class="meta">${priBadge(priOf(next.patient_id))}<span class="badge s-neutral">${next.mode==="video"?"Video":"In person"}</span>${next.status==="waiting"?`<span class="badge s-neutral">Waiting ${waitMin(next)} min</span>`:`<span class="badge s-neutral">${fmtT(next.scheduled_at)}</span>`}</div>
      </div>
    <div style="display:flex;flex-direction:column;gap:10px"><button class="btn primary" data-a="start" data-id="${next.id}">Start consultation</button><button class="btn" data-a="case" data-pid="${next.patient_id}">View patient record</button></div>
  </section>`:`<section class="card hero">${empty("check","Your queue is clear","No patients are waiting. New check-ins will appear here.")}</section>`;
  const items=[...t].sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  let nowDone=false,tl="";
  items.forEach(a=>{
    if(!nowDone&&new Date(a.scheduled_at)>now()){tl+=`<div class="tl-now" aria-label="Current time"><span>${fmtT(now())}</span><i></i></div>`;nowDone=true}
    const cls=a.status==="completed"?"done":a.status==="waiting"?"wait":"";
    tl+=`<div class="tl-item ${cls}"><span class="tl-time num">${fmtT(a.scheduled_at)}</span><span class="tl-dot"><i></i></span>
      <div><div class="tl-title">${esc(a.patient.full_name)}</div><div class="tl-sub">${esc(a.reason)}</div></div>
      <div>${a.status==="completed"?`<span class="badge s-approved">Done</span>`:a.status==="waiting"?`<span class="badge s-pending">Waiting</span>`:priBadge(priOf(a.patient_id))}</div></div>`;
  });
  if(!nowDone&&items.length)tl+=`<div class="tl-now"><span>${fmtT(now())}</span><i></i></div>`;
  const alerts=pendingReports().sort((a,b)=>trR(a.severity)-trR(b.severity)).slice(0,3);
  return`${head(`${g}, ${esc(String(S.doctor.full_name||"Doctor").replace(/^Dr\.?\s*/i,"Dr. "))}`,new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})+` · ${w.length} waiting, ${t.filter(a=>a.status==="scheduled").length} still to come`)}
  ${hero}
  <div class="grid g4" style="margin-bottom:var(--gap)">
    ${[["queue","Waiting now",w.length,avgWait?`Average wait ${avgWait} min`:"No one waiting","queue"],["check","Completed today",done,`of ${t.length} booked`,"appointments"],["ai","Reports to review",pendingReports().length,`${pendingReports().filter(r=>r.severity==="critical").length} critical`,"reports"],["clock","Avg. consultation",S.history.length?Math.round(S.history.reduce((s,h)=>s+(h.duration_min||0),0)/S.history.length)+" min":"–","across recent visits","history"]]
     .map(([i,k,v,d,r])=>`<button class="card stat clickable" data-go="${r}"><span class="k">${ic(i,"sm")}${k}</span><span class="v num">${v}</span><span class="d">${d}</span></button>`).join("")}
  </div>
  <div class="grid g-main">
    <section class="card" aria-label="Today's schedule"><div class="card-head"><h2>Today's schedule</h2><div class="right"><button class="btn quiet sm" data-go="appointments">All appointments</button></div></div>
      ${tl||empty("calendar","Nothing booked today","Booked appointments will appear on this timeline.")}</section>
    <div class="grid" style="align-content:start">
      <section class="card"><div class="card-head"><h2>Today's cases by priority</h2></div>${donut()}</section>
      <section class="card"><div class="card-head"><h2>Needs your review</h2><div class="right"><button class="btn quiet sm" data-go="reports">Open</button></div></div>
        ${alerts.length?alerts.map(r=>`<div class="who" style="margin-bottom:12px"><span class="avatar md alt">${ic("ai","sm")}</span><div style="flex:1;min-width:0"><b style="font-weight:600">${esc(r.report_type)} · ${esc(r.patient.full_name)}</b><small class="muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.findings)}</small></div>${triBadge(r.severity)}</div>`).join(""):empty("check","All caught up","No AI reports are waiting for your review.")}</section>
    </div>
  </div>
  <section class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Consultations, last 7 days</h2><span class="sub">${S.week.reduce((a,b)=>a+b,0)} total</span></div><div style="max-width:620px">${S.week.some(v=>v>0)?barChart(S.week):empty("history","No consultations yet","Completed consultations from the last 7 days will be charted here.")}</div></section>`;
};

VIEWS.queue=()=>{
  const w=waiting();
  return`${head("Patient queue","Waiting patients, ordered by the priority you assign (High, Normal, Low) and then by check-in time. Priority helps you organise care. It does not replace emergency assessment or your clinical judgment.")}
  ${priBanner()}
  <div class="chips" role="group" aria-label="Filter by priority">${[["all","All"],["high","High"],["normal","Normal"],["low","Low"]].map(([k,l])=>`<button class="chip" data-a="tri" data-v="${k}" aria-pressed="${S.triage===k}">${l} (${k==="all"?w.length:w.filter(a=>priOf(a.patient_id)===k).length})</button>`).join("")}</div>
  <div class="rows" id="qlist">${queueRows()}</div>`;
};
function priSelect(p){
  const c=priOf(p.id),ok=S.mode==="live"&&S.priorityReady;
  return`<label class="pri-ctl"><span>Priority</span><select class="field pri" data-pri="${esc(p.id)}" aria-label="Priority for ${esc(p.full_name)}" ${ok?"":"disabled"}>${c?"":'<option value="" selected disabled>Set priority</option>'}${Object.entries(PRI).map(([k,v])=>`<option value="${k}" ${c===k?"selected":""}>${v.l}</option>`).join("")}</select></label>`;
}
const priBanner=()=>S.mode==="live"&&!S.priorityReady?`<div class="disclaimer">${ic("alert","sm")}<span>Priority categories are unavailable until the database migration has been applied.</span></div>`:"";
function queueRows(){
  const l=waiting().filter(a=>S.triage==="all"||priOf(a.patient_id)===S.triage);
  if(!l.length)return S.triage==="all"
    ?`<div class="card">${empty("queue","No patients in the queue","Patients appear here when they check in for a consultation.")}</div>`
    :`<div class="card">${empty("queue",`No ${PRI[S.triage].l} priority patients`,`Waiting patients you categorise as ${PRI[S.triage].l} will appear here.`)}</div>`;
  return l.map(a=>{const c=priOf(a.patient_id);return`<article class="qrow ${c==="high"?"crit":""}">
    <span class="avatar md ${c==="high"?"":"alt"}">${esc(initials(a.patient.full_name))}</span>
    <div><div class="nm" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(a.patient.full_name)} ${priBadge(c)}</div><div class="muted" style="font-size:.86rem">${esc(ageGender(a.patient))}${ageGender(a.patient)?" · ":""}${esc(a.reason)}</div>${TRIAGE[a.triage]?`<div style="margin-top:6px">${triTxt(a.triage)}</div>`:""}</div>
    ${priSelect(a.patient)}
    <div class="wait"><b class="num">${waitMin(a)} min</b>waiting</div>
    <div class="btns"><button class="btn sm" data-a="case" data-pid="${a.patient_id}">Record</button><button class="btn primary sm" data-a="start" data-id="${a.id}">Start</button></div>
  </article>`}).join("");
}

VIEWS.appointments=()=>`${head("Appointments","Everything booked with you, by day.")}
  <div class="chips" role="group" aria-label="Appointment range">${[["today","Today"],["upcoming","Upcoming"],["completed","Completed"],["cancelled","Cancelled"]].map(([k,l])=>`<button class="chip" data-a="atab" data-v="${k}" aria-pressed="${S.apptTab===k}">${l}</button>`).join("")}</div>
  <div class="card flush"><div class="tbl-wrap" id="atbl">${apptTable()}</div></div>`;
function apptTable(){
  const n=now();let l=S.appointments.slice();
  if(S.apptTab==="today")l=l.filter(a=>sameDay(a.scheduled_at,n)&&a.status!=="cancelled");
  else if(S.apptTab==="upcoming")l=l.filter(a=>new Date(a.scheduled_at)>n&&!sameDay(a.scheduled_at,n)&&a.status!=="cancelled");
  else l=l.filter(a=>a.status===S.apptTab);
  l.sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  if(!l.length)return empty("calendar","No appointments here","Try another range, or check back when patients book.");
  const sb=s=>({waiting:'<span class="badge s-pending">Waiting</span>',scheduled:'<span class="badge s-neutral">Scheduled</span>',completed:'<span class="badge s-approved">Completed</span>',cancelled:'<span class="badge s-flagged">Cancelled</span>',in_progress:'<span class="badge t-moderate">In progress</span>'})[s]||s;
  return`<table><thead><tr><th>Time</th><th>Patient</th><th>Reason</th><th>Mode</th><th>Triage</th><th>Priority</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
  ${l.map(a=>`<tr><td class="num" style="white-space:nowrap">${sameDay(a.scheduled_at,n)?fmtT(a.scheduled_at):fmtDT(a.scheduled_at)}</td><td>${who(a.patient)}</td><td>${esc(a.reason)}</td>
   <td><span class="muted" style="display:inline-flex;gap:6px;align-items:center">${ic(a.mode==="video"?"video":"pin","sm")}${a.mode==="video"?"Video":"In person"}</span></td><td>${triTxt(a.triage)}</td><td>${priBadge(priOf(a.patient_id))}</td><td>${sb(a.status)}</td>
   <td style="white-space:nowrap;text-align:right">${["scheduled","waiting"].includes(a.status)?`<button class="btn primary sm" data-a="start" data-id="${a.id}">Start</button> <button class="btn quiet danger sm" data-a="cancel" data-id="${a.id}">Cancel</button>`:`<button class="btn quiet sm" data-a="case" data-pid="${a.patient_id}">Record</button>`}</td></tr>`).join("")}</tbody></table>`;
}

VIEWS.reports=()=>{
  return`${head("AI medical reports","Automated readings of patient scans, lab results and photos, waiting for your sign-off.")}
  <div class="disclaimer">${ic("alert","sm")}<span>AI-generated drafts are not medical advice and are not final until you review, edit and approve them. You remain responsible for every clinical decision.</span></div>
  <div class="chips" role="group" aria-label="Report status">${[["pending","Needs review"],["approved","Reviewed"],["all","All"]].map(([k,l])=>`<button class="chip" data-a="rtab" data-v="${k}" aria-pressed="${S.repState===k}">${l}</button>`).join("")}</div>
  <div class="grid g2" id="rlist">${reportCards()}</div>`;
};
function reportCards(){
  const l=S.reports.filter(r=>S.repState==="all"||r.status===S.repState).sort((a,b)=>(trR(a.severity)-trR(b.severity))||(new Date(b.created_at)-new Date(a.created_at)));
  if(!l.length)return`<div class="card" style="grid-column:1/-1">${empty("ai","No AI reports to show","Draft reports appear here once they have been generated for your patients.")}</div>`;
  const sb={pending:'<span class="badge s-pending">Needs review</span>',approved:'<span class="badge s-approved">Doctor-verified</span>',flagged:'<span class="badge s-flagged">Flagged</span>'};
  return l.map(r=>{const ver=r.status==="approved";return`<article class="card rep"><div class="top-r">${who(r.patient,`${r.report_type||"Report"} · ${ago(r.created_at)}`)}<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${triBadge(r.severity)}${sb[r.status]||""}</span></div>
   <div class="find ${ver?"verified":"aidraft"}"><span class="${ver?"vertag":"aitag"}">${ver?ic("check","sm")+"Doctor-verified":ic("ai","sm")+"AI-generated draft · not verified"}</span><p style="margin-top:8px;white-space:pre-wrap">${esc(ver?(r.verified_content||r.findings):r.findings)}</p></div>
   ${!ver&&r.confidence!=null?`<div class="conf"><span>AI confidence</span><span class="bar" role="img" aria-label="${esc(r.confidence)} percent"><i style="width:${Math.min(100,Math.max(0,Number(r.confidence)||0))}%"></i></span><b class="num" style="color:var(--text)">${esc(r.confidence)}%</b></div>`:""}
   ${ver&&r.verified_at?`<div class="muted" style="font-size:.82rem">Verified by ${esc(S.doctor.full_name)} on ${fmtDT(r.verified_at)}</div>`:""}
   ${r.doctor_note?`<div class="muted" style="font-size:.88rem"><b style="color:var(--text)">Your note:</b> ${esc(r.doctor_note)}</div>`:""}
   <div class="foot">${r.status==="pending"?`<button class="btn primary sm" data-a="rnote" data-id="${r.id}">${ic("check","sm")}Review and approve</button><button class="btn sm danger" data-a="rflag" data-id="${r.id}">Flag for follow-up</button>`:""}<button class="btn quiet sm" data-a="case" data-pid="${r.patient_id}">Patient record</button></div></article>`}).join("");
}

VIEWS.records=()=>{
  const list=allPatients();
  if(!S.recSel&&list.length)S.recSel=list.find(p=>S.recQuery&&p.full_name.toLowerCase().includes(S.recQuery.toLowerCase()))?.id||list[0].id;
  return`${head("Patient records","Search your patients and open their history, vitals and reports.")}${priBanner()}
  <div class="split"><section class="card" style="padding:14px"><label class="search" style="display:block;margin:0 0 12px;flex:none"><span class="sr">Filter patients</span>${ic("search","sm")}<input id="rsearch" type="search" placeholder="Filter by name or condition" value="${esc(S.recQuery)}" autocomplete="off"></label>
    <div class="plist" id="plist">${patientList()}</div></section>
    <section id="pdetail">${patientDetail()}</section></div>`;
};
function patientList(){
  const all=allPatients();
  if(!all.length)return empty("folder","No patient records available","Patients appear here once they have an appointment with you.");
  const q=S.recQuery.trim().toLowerCase();
  const l=all.filter(p=>!q||p.full_name.toLowerCase().includes(q)||(p.conditions||[]).join(" ").toLowerCase().includes(q));
  if(!l.length)return empty("search","No matching patients","Check the spelling or clear the filter.");
  return l.map(p=>`<button class="pitem" data-a="psel" data-pid="${p.id}" aria-current="${S.recSel===p.id}"><span class="avatar md alt">${esc(initials(p.full_name))}</span><span><b>${esc(p.full_name)}</b><small>${esc(ageGender(p))}${ageGender(p)?" · ":""}${esc((p.conditions||[])[0]||"No known conditions")}</small></span></button>`).join("");
}
function summaryPanel(pid){
  if(!S.settings.ai)return`<p class="muted" style="font-size:.88rem">AI record summaries are turned off in Settings.</p>`;
  const s=S.summaries[pid],live=S.mode==="live";
  const btn=`<button class="btn sm" data-a="summ" data-pid="${esc(pid)}" ${live?"":"disabled"}>${ic("ai","sm")}${s?"Regenerate summary":"Generate summary"}</button>`;
  if(!s)return`<p class="muted" style="font-size:.88rem;margin-bottom:10px">Creates a draft summary from this patient's medical records that you are authorised to view. It is not saved until you use it.</p>${btn}`;
  return`<div class="aibox"><span class="aitag">${ic("ai","sm")}AI-generated summary · not verified</span><p style="white-space:pre-wrap;margin-top:8px">${esc(s.text)}</p><p class="muted" style="font-size:.8rem;margin-top:8px">Generated ${fmtT(s.at)}. Check it against the source records before relying on it.</p></div><div style="margin-top:10px">${btn}</div>`;
}
function patientDetail(){
  const p=patById(S.recSel);
  if(!p)return`<div class="card">${empty("folder",allPatients().length?"Select a patient":"No patient records available",allPatients().length?"Choose a patient on the left to see their record.":"Patient records will appear here once they exist.")}</div>`;
  const v=p.vitals||{},hs=S.history.filter(h=>h.patient_id===p.id),rs=S.reports.filter(r=>r.patient_id===p.id),pr=S.priorities[p.id];
  return`<div class="card"><div class="who" style="gap:16px"><span class="avatar lg">${esc(initials(p.full_name))}</span><div><h2 style="font-size:1.3rem">${esc(p.full_name)}</h2><p class="muted">${esc(ageGender(p))}${ageGender(p)?" · ":""}Blood group ${esc(p.blood_group||"–")}</p></div></div>
   <div class="sect"><h3>Priority category</h3><div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap"><div>${priBadge(priOf(p.id))}</div>${priSelect(p)}</div>
    <p class="muted" style="font-size:.84rem;margin-top:8px">${pr?`Last changed by ${esc(pr.updater?.full_name||"a doctor")} on ${fmtDT(pr.updated_at)}.`:"Not set. Only you can set this. It is never assigned automatically."} Categories help organise care and do not replace emergency assessment or clinical judgment.</p><div id="pri-audit"></div></div>
   <div class="sect"><h3>Record summary</h3><div class="sumbox" data-pid="${esc(p.id)}">${summaryPanel(p.id)}</div></div>
   <div class="sect"><h3>Latest vitals</h3><div class="kv"><div><small>Blood pressure</small><b class="num">${esc(v.bp||"–")}</b></div><div><small>Heart rate</small><b class="num">${esc(v.hr??"–")} bpm</b></div><div><small>SpO₂</small><b class="num">${esc(v.spo2??"–")}%</b></div><div><small>Temperature</small><b class="num">${esc(v.temp||"–")}</b></div><div><small>Weight</small><b class="num">${esc(v.weight||"–")}</b></div></div></div>
   <div class="sect"><h3>Conditions</h3><div class="tags">${(p.conditions||[]).length?p.conditions.map(c=>`<span class="tag">${esc(c)}</span>`).join(""):'<span class="muted">None recorded</span>'}</div></div>
   <div class="sect"><h3>Allergies</h3><div class="tags">${(p.allergies||[]).length?p.allergies.map(c=>`<span class="tag al">${esc(c)}</span>`).join(""):'<span class="muted">No known allergies</span>'}</div></div></div>
  <div class="card" style="margin-top:var(--gap)"><div class="card-head"><h3>Medical reports</h3><div class="right"><button class="btn sm" data-a="gendraft" data-pid="${esc(p.id)}" ${S.mode==="live"?"":"disabled"}>${ic("ai","sm")}Generate draft report</button></div></div>${rs.length?rs.map(r=>`<div class="who" style="margin-bottom:12px"><span class="avatar md alt">${ic("ai","sm")}</span><div style="flex:1"><b>${esc(r.report_type||"Report")}</b><small>${esc(r.status==="approved"?(r.verified_content||r.findings):r.findings)}</small></div>${r.status==="approved"?'<span class="vertag">Doctor-verified</span>':'<span class="aitag">AI draft</span>'}</div>`).join(""):'<p class="muted">No reports yet.</p>'}</div>
  <div class="card" style="margin-top:var(--gap)"><h3 style="margin-bottom:12px">Past consultations</h3>${hs.length?hs.map(h=>`<div style="padding:10px 0;border-bottom:1px solid var(--line-soft)"><b>${esc(h.diagnosis)}</b> <span class="muted">· ${fmtD(h.completed_at)}</span><div class="muted" style="font-size:.88rem">${esc(h.notes)}</div></div>`).join(""):'<p class="muted">No past consultations with you.</p>'}</div>`;
}

VIEWS.video=()=>{
  const l=S.appointments.filter(a=>a.mode==="video"&&["waiting","scheduled"].includes(a.status)&&sameDay(a.scheduled_at,now())).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  return`${head("Video consultations","Check your camera and microphone, then join patients who are ready.")}
  <div class="grid g-main"><section class="card"><div class="card-head"><h2>Camera and microphone check</h2></div>
   <div class="room" id="room"><video id="selfview" autoplay muted playsinline hidden></video><div class="ph" id="roomph">${ic("video")}<p>Your camera is off. Start the check to see your own preview.</p></div></div>
   <div class="ctrls"><button class="btn primary" data-a="cam-start" id="camstart">Start camera check</button>
   <button class="btn" data-a="mic" aria-pressed="${S.mic}" ${S.stream?"":"disabled"} id="micb">${ic("mic","sm")}Microphone ${S.mic?"on":"off"}</button>
   <button class="btn" data-a="cam" aria-pressed="${S.cam}" ${S.stream?"":"disabled"} id="camb">${ic("video","sm")}Camera ${S.cam?"on":"off"}</button>
   <button class="btn danger" data-a="cam-stop" ${S.stream?"":"disabled"} id="camstop">${ic("x","sm")}Stop</button></div></section>
   <section class="card"><div class="card-head"><h2>Ready to join</h2><span class="sub">${l.length} today</span></div>
    ${l.length?l.map(a=>`<div style="padding:12px 0;border-bottom:1px solid var(--line-soft)"><div class="who">${`<span class="avatar md alt">${esc(initials(a.patient.full_name))}</span>`}<div style="flex:1"><b>${esc(a.patient.full_name)}</b><small>${esc(a.reason)}</small></div></div>
     <div style="display:flex;gap:8px;align-items:center;margin-top:10px">${a.status==="waiting"?`<span class="badge s-pending">In waiting room · ${waitMin(a)} min</span>`:`<span class="badge s-neutral">${fmtT(a.scheduled_at)}</span>`}<button class="btn primary sm" style="margin-left:auto" data-a="start" data-id="${a.id}" ${a.status==="waiting"?"":"disabled"}>Join</button></div></div>`).join(""):empty("video","No video visits left today","Scheduled video appointments will appear here.")}</section></div>`;
};

VIEWS.availability=()=>{
  const total=Object.values(S.schedule).reduce((s,a)=>s+(a?.length||0),0);
  return`${head("Doctor availability","Pick the hours patients can book with you each week.",`<button class="btn" data-a="preset" data-v="clear">Clear week</button><button class="btn" data-a="preset" data-v="weekdays">Weekdays 9–5</button><button class="btn primary" data-a="asave" id="asave" ${S.dirtyAvail?"":"disabled"}>Save changes</button>`)}
  <div class="grid g-main"><section class="card"><div class="tbl-wrap"><div class="ag" role="group" aria-label="Weekly availability">
   <span></span>${DAYS.map(d=>`<span class="h">${d}</span>`).join("")}
   ${HOURS.map(h=>`<span class="t num">${hLabel(h)}</span>${DAYS.map((d,i)=>`<button class="cell" data-a="cell" data-d="${i}" data-h="${h}" aria-pressed="${(S.schedule[i]||[]).includes(h)}" aria-label="${d} ${hLabel(h)}"></button>`).join("")}`).join("")}</div></div></section>
   <div class="grid" style="align-content:start"><section class="card stat"><span class="k">${ic("clock","sm")}Weekly hours open</span><span class="v num" id="atotal">${total}</span><span class="d">Each highlighted cell is a one-hour booking window.</span></section>
   <section class="card"><div class="setrow"><div><b>Accepting new patients</b><small>Turn off to hide yourself from booking.</small></div><button class="switch" role="switch" data-a="accept" aria-checked="${!!S.doctor.accepting_patients}" aria-label="Accepting new patients"></button></div></section></div></div>`;
};

VIEWS.history=()=>`${head("Consultation history","Completed consultations, newest first.")}
  <label class="search" style="display:block;max-width:420px;margin:0 0 16px"><span class="sr">Search history</span>${ic("search","sm")}<input id="hsearch" type="search" placeholder="Search by patient or diagnosis" value="${esc(S.histQuery)}" autocomplete="off"></label>
  <div class="card flush"><div class="tbl-wrap" id="htbl">${histTable()}</div></div>`;
function histTable(){
  const q=S.histQuery.trim().toLowerCase();
  const l=S.history.filter(h=>!q||h.patient.full_name.toLowerCase().includes(q)||(h.diagnosis||"").toLowerCase().includes(q)).sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at));
  if(!l.length)return empty("history","No consultations found","Completed consultations will be saved here.");
  return`<table><thead><tr><th>Date</th><th>Patient</th><th>Diagnosis</th><th>Prescription</th><th>Duration</th><th>Follow-up</th></tr></thead><tbody>${l.map(h=>`<tr class="link" tabindex="0" data-a="hopen" data-id="${h.id}"><td class="num" style="white-space:nowrap">${fmtDT(h.completed_at)}</td><td>${who(h.patient)}</td><td>${esc(h.diagnosis)}</td><td class="muted">${esc(h.prescription||"–")}</td><td class="num">${h.duration_min||"–"} min</td><td>${esc(h.follow_up||"–")}</td></tr>`).join("")}</tbody></table>`;
}

VIEWS.notifications=()=>`${head("Notifications",`${unread()} unread`,`<button class="btn" data-a="nall" ${unread()?"":"disabled"}>Mark all as read</button>`)}
  <div class="card flush">${S.notifications.length?[...S.notifications].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(n=>`<div class="nrow k-${esc(n.kind)} ${n.read?"":"unread"}"><span class="ni">${ic(n.kind==="alert"?"alert":n.kind==="ai"?"ai":n.kind==="appt"?"calendar":"bell","sm")}</span><div class="body"><b>${esc(n.title)}</b><small>${esc(n.body)}</small></div><span class="when">${ago(n.created_at)}</span>${n.read?`<span style="width:8px"></span>`:`<button class="btn quiet sm" data-a="nread" data-id="${n.id}">Mark read</button>`}</div>`).join(""):empty("bell","No notifications","Alerts about patients, reports and bookings will appear here.")}</div>`;

VIEWS.profile=()=>{const d=S.doctor;
  return`${head("Doctor profile","This is what patients see when they book you.")}
  <div class="grid g-main"><form class="card form" id="pform"><label>Full name<input class="field" name="full_name" value="${esc(d.full_name)}" required></label>
   <label>Specialty<input class="field" name="specialty" value="${esc(d.specialty||"")}"></label>
   <label>Registration number<input class="field" name="registration_no" value="${esc(d.registration_no||"")}"></label>
   <label>Years of experience<input class="field" type="number" min="0" name="experience_years" value="${esc(d.experience_years??"")}"></label>
   <label>Languages<input class="field" name="languages" value="${esc(Array.isArray(d.languages)?d.languages.join(", "):d.languages||"")}"></label>
   <label>Consultation fee (₹)<input class="field" type="number" min="0" name="fee" value="${esc(d.fee??"")}"></label>
   <label>Phone<input class="field" name="phone" value="${esc(d.phone||"")}"></label>
   <label>Email<input class="field" type="email" name="email" value="${esc(d.email||"")}"></label>
   <label class="full">About you<textarea class="field" name="bio" rows="4">${esc(d.bio||"")}</textarea></label>
   <div class="full" style="display:flex;justify-content:flex-end"><button class="btn primary" type="submit">Save profile</button></div></form>
   <section class="card" style="align-self:start;text-align:center"><span class="avatar lg" style="margin:0 auto 12px;width:84px;height:84px;font-size:1.6rem">${esc(initials(d.full_name))}</span><h2>${esc(d.full_name)}</h2><p class="muted">${esc(d.specialty||"")}</p>
   <div class="kv" style="margin-top:16px;text-align:left"><div><small>Experience</small><b>${esc(d.experience_years??"–")} yrs</b></div><div><small>Fee</small><b>₹${esc(d.fee??"–")}</b></div></div></section></div>`;
};

VIEWS.settings=()=>{
  const s=S.settings,row=(k,t,sub)=>`<div class="setrow"><div><b>${t}</b><small>${sub}</small></div><button class="switch" role="switch" data-a="set" data-k="${k}" aria-checked="${!!s[k]}" aria-label="${t}"></button></div>`;
  return`${head("Settings","Preferences are saved on this device.")}
  <div class="grid g2"><section class="card"><h2 style="margin-bottom:6px">Consultation</h2>${row("ai","AI record summaries","Show the AI-generated patient record summary panel. Summaries are drafts for you to verify.")}${row("sound","Alert sound","Play a short tone when a critical patient checks in.")}${row("digest","Daily email summary","Receive a recap of tomorrow's schedule each evening.")}</section>
  <section class="card"><h2 style="margin-bottom:6px">Display</h2>${row("compact","Compact layout","Tighter spacing to fit more on screen.")}${row("motion","Interface animations","Turn off to remove movement and transitions.")}</section>
  <section class="card" style="grid-column:1/-1"><h2 style="margin-bottom:10px">Data connection</h2><div style="display:flex;gap:12px;align-items:center"><span class="dot ${S.connected?"on":""}"></span><div style="flex:1"><b>${S.connected?"Connected to Supabase":"Not connected"}</b><p class="muted" style="font-size:.88rem">${S.connected?`Signed in as ${esc(S.sessionEmail)}. Changes you make are saved to your project, within the access rules your database enforces.`:"Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env.local file. No data is shown or saved until you do."}</p></div>${S.connected?'<button class="btn" data-a="signout">Sign out</button>':""}</div></section></div>`;
};

const AFTER={
  records(){const i=$("#rsearch");i?.addEventListener("input",e=>{S.recQuery=e.target.value;$("#plist").innerHTML=patientList()});loadAudit(S.recSel)},
  history(){$("#hsearch")?.addEventListener("input",e=>{S.histQuery=e.target.value;$("#htbl").innerHTML=histTable()})},
  profile(){$("#pform").addEventListener("submit",saveProfile)},
  video(){if(S.stream)attachStream()}
};

/* =====================================================================
   Actions
   ===================================================================== */
document.addEventListener("click",e=>{
  const g=e.target.closest("[data-go]");if(g){go(g.dataset.go);return}
  const el=e.target.closest("[data-a]");if(!el)return;
  const a=el.dataset.a,d=el.dataset;
  (ACT[a]||(()=>{}))(d,el);
});
document.addEventListener("change",e=>{const s=e.target.closest("select[data-pri]");if(s&&s.value)setPriority(s.dataset.pri,s.value,s)});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){if($("#layer").firstChild){closeLayer()}}
  if((e.key==="Enter"||e.key===" ")&&e.target.matches("tr[data-a]")){e.preventDefault();e.target.click()}
});

document.addEventListener("submit",async e=>{
  if(e.target.id!=="loginform")return;
  e.preventDefault();
  const f=e.target,btn=f.querySelector("button[type=submit]"),err=$("#loginerr");
  btn.disabled=true;err.textContent="";
  const {error}=await S.sb.auth.signInWithPassword({email:f.email.value.trim(),password:f.password.value});
  if(error){err.textContent=error.message;btn.disabled=false;return}
  await bootLive();shell();route();
});

const ACT={
  drawer(){$("#shell").classList.toggle("drawer-open")},
  async retry(){await bootLive();shell();route()},
  async signout(){await S.sb.auth.signOut();toSignedOut()},
  collapse(){S.collapsed=!S.collapsed;renderSide()},
  async accept(){
    const v=!S.doctor.accepting_patients;
    if(!await persist(sb=>sb.from("doctors").update({accepting_patients:v}).eq("id",S.doctor.id).select("id")))return;
    S.doctor.accepting_patients=v;
    toast(v?"You are now accepting patients":"You are no longer accepting patients");rerender();
  },
  tri(d){S.triage=d.v;$("#view").innerHTML=VIEWS.queue()},
  atab(d){S.apptTab=d.v;$("#view").innerHTML=VIEWS.appointments()},
  rtab(d){S.repState=d.v;$("#view").innerHTML=VIEWS.reports()},
  case(d){S.recSel=d.pid;S.recQuery="";go("records")},
  psel(d){S.recSel=d.pid;$("#plist").innerHTML=patientList();$("#pdetail").innerHTML=patientDetail();loadAudit(d.pid)},
  async summ(d,el){
    if(S.mode!=="live")return;
    el.disabled=true;
    try{
      const {data,error}=await S.sb.functions.invoke("summarize-patient-record",{body:{patient_id:d.pid}});
      if(error)throw error;
      if(!data?.summary)throw new Error("The summary service returned no text.");
      S.summaries[d.pid]={text:data.summary,at:data.generated_at||new Date().toISOString()};
    }catch(e){toast("Could not generate a summary: "+(e.message||e),"err")}
    document.querySelectorAll(`.sumbox[data-pid="${CSS.escape(d.pid)}"]`).forEach(b=>b.innerHTML=summaryPanel(d.pid));
  },
  async gendraft(d,el){
    if(S.mode!=="live")return;
    el.disabled=true;
    try{
      const {error}=await S.sb.functions.invoke("draft-medical-report",{body:{patient_id:d.pid}});
      if(error)throw error;
      await reloadReports();toast("Draft report created. Review it under AI Medical Reports.");
    }catch(e){toast("Could not generate a draft report: "+(e.message||e),"err")}
    rerender();
  },
  start(d){openConsult(d.id)},
  async cancel(d){
    const a=apptById(d.id);if(!a)return;
    if(!confirm(`Cancel the appointment with ${a.patient.full_name}? The patient will be notified.`))return;
    if(!await persist(sb=>sb.from("appointments").update({status:"cancelled"}).eq("id",a.id).select("id")))return;
    a.status="cancelled";toast("Appointment cancelled");rerender();
  },
  nread:async d=>{const n=S.notifications.find(x=>x.id===d.id);if(!await persist(sb=>sb.from("notifications").update({read:true}).eq("id",n.id).select("id")))return;n.read=true;rerender()},
  nall:async()=>{if(!await persist(sb=>sb.from("notifications").update({read:true}).eq("doctor_id",S.doctor.id).select("id")))return;S.notifications.forEach(n=>n.read=true);toast("All notifications marked as read");rerender()},
  rnote(d){openReportModal(d.id)},
  async rflag(d){const r=S.reports.find(x=>x.id===d.id);if(!await persist(sb=>sb.from("ai_reports").update({status:"flagged"}).eq("id",r.id).select("id")))return;r.status="flagged";toast("Flagged for follow-up");rerender()},
  hopen(d){openHistory(d.id)},
  set(d,el){const k=d.k;S.settings[k]=!S.settings[k];localStorage.setItem("dj-settings",JSON.stringify(S.settings));applySettings();rerender()},
  cell(d,el){
    const day=+d.d,h=+d.h,arr=S.schedule[day]=S.schedule[day]||[],i=arr.indexOf(h);
    i>-1?arr.splice(i,1):arr.push(h);
    el.setAttribute("aria-pressed",i===-1);S.dirtyAvail=true;$("#asave").disabled=false;
    $("#atotal").textContent=Object.values(S.schedule).reduce((s,a)=>s+(a?.length||0),0);
  },
  preset(d){
    S.schedule={};DAYS.forEach((_,i)=>S.schedule[i]=d.v==="weekdays"&&i<5?[9,10,11,12,13,14,15,16]:[]);
    S.dirtyAvail=true;$("#view").innerHTML=VIEWS.availability();$("#asave").disabled=false;
  },
  async asave(){
    const ok=await persist(sb=>sb.from("doctor_availability").upsert({doctor_id:S.doctor.id,schedule:S.schedule,updated_at:new Date().toISOString()}).select());
    if(ok){S.dirtyAvail=false;$("#asave").disabled=true;toast("Availability saved")}
  },
  async "cam-start"(){
    try{S.stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});S.mic=S.cam=true;attachStream();rerender()}
    catch(e){toast("Could not access camera or microphone. Check your browser permissions.","err")}
  },
  "cam-stop"(){stopStream();rerender()},
  mic(){S.mic=!S.mic;S.stream?.getAudioTracks().forEach(t=>t.enabled=S.mic);rerender()},
  cam(){S.cam=!S.cam;S.stream?.getVideoTracks().forEach(t=>t.enabled=S.cam);rerender()},
  close:()=>closeLayer(),
  "complete"(){completeConsult()},
};
function attachStream(){const v=$("#selfview");if(!v||!S.stream)return;v.srcObject=S.stream;v.hidden=false;$("#roomph").hidden=true}
function stopStream(){S.stream?.getTracks().forEach(t=>t.stop());S.stream=null}

async function saveProfile(e){
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
  ["experience_years","fee"].forEach(k=>f[k]=f[k]===""?null:+f[k]);
  Object.assign(S.doctor,f);
  const row={...f};row.languages=String(f.languages||"").split(",").map(s=>s.trim()).filter(Boolean);
  const ok=await persist(sb=>sb.from("doctors").update(row).eq("id",S.doctor.id).select("id"));
  if(ok){toast("Profile saved");shell()}
}

/* ---------- consultation drawer ---------- */
let timer=null;
function openConsult(id){
  const a=apptById(id);if(!a)return;
  S.consult={id,start:now()};a.status="in_progress";
  const p=a.patient,v=p.vitals||{};
  $("#layer").innerHTML=`<div class="scrim" data-a="noop"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Consultation with ${esc(p.full_name)}">
   <header><span class="avatar md">${esc(initials(p.full_name))}</span><div style="flex:1"><h2>${esc(p.full_name)}</h2><p class="muted" style="font-size:.86rem">${esc(ageGender(p))}${ageGender(p)?" · ":""}${esc(a.reason)}</p></div><span class="timer" id="ctimer" aria-label="Consultation timer">00:00</span><button class="icon-btn" data-a="close" aria-label="Close and keep consultation open later">${ic("x")}</button></header>
   <div class="body">
    <div>${priBadge(priOf(a.patient_id))}${(p.allergies||[]).map(x=>` <span class="tag al">Allergy: ${esc(x)}</span>`).join("")}</div>
    <div class="sumbox" data-pid="${esc(p.id)}">${summaryPanel(p.id)}</div>
    <div class="kv"><div><small>BP</small><b class="num">${esc(v.bp||"–")}</b></div><div><small>Heart rate</small><b class="num">${esc(v.hr??"–")}</b></div><div><small>SpO₂</small><b class="num">${esc(v.spo2??"–")}%</b></div><div><small>Temp</small><b class="num">${esc(v.temp||"–")}</b></div></div>
    <form id="cform" class="form" style="grid-template-columns:1fr"><label>Diagnosis<input class="field" name="diagnosis" required placeholder="e.g. Acute bacterial pharyngitis"></label>
     <label>Clinical notes<textarea class="field" name="notes" rows="4" placeholder="Findings, advice given, tests ordered"></textarea></label>
     <label>Prescription<textarea class="field" name="prescription" rows="3" placeholder="Drug, dose, frequency, duration"></textarea></label>
     <label>Follow-up<select class="field" name="follow_up"><option>None needed</option><option>1 week</option><option selected>2 weeks</option><option>4 weeks</option><option>3 months</option></select></label></form>
   </div>
   <footer><button class="btn" data-a="close">Save and close</button><button class="btn primary" data-a="complete">Complete consultation</button></footer></aside>`;
  clearInterval(timer);const el=$("#ctimer");
  timer=setInterval(()=>{const s=Math.floor((now()-S.consult.start)/1000);const t=$("#ctimer");if(!t){clearInterval(timer);return}t.textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},1000);
  $("#cform input").focus();
}
async function completeConsult(){
  const f=$("#cform");if(!f.reportValidity())return;
  const a=apptById(S.consult.id),fd=Object.fromEntries(new FormData(f));
  const rec={id:uid(),appointment_id:a.id,doctor_id:S.doctor.id,patient_id:a.patient_id,patient:a.patient,...fd,duration_min:Math.max(1,Math.round((now()-S.consult.start)/MIN)),completed_at:new Date().toISOString()};
  a.status="completed";S.history.unshift(rec);S.week=weekCounts();
  const {patient,id,...row}=rec;
  const ok=await persist(async sb=>{const r1=await sb.from("consultations").insert(row);if(r1.error)return r1;return sb.from("appointments").update({status:"completed"}).eq("id",a.id).select("id")});
  if(!ok){a.status="in_progress";S.history.shift();S.week=weekCounts();return}
  closeLayer();toast(`Consultation completed with ${a.patient.full_name}`);rerender();
}
function closeLayer(){
  clearInterval(timer);
  if(S.consult){const a=apptById(S.consult.id);if(a&&a.status==="in_progress"){a.status=a.checked_in_at?"waiting":"scheduled"}S.consult=null}
  $("#layer").innerHTML="";rerender();
}
ACT.noop=()=>{closeLayer()};

/* ---------- modals ---------- */
function openReportModal(id){
  const r=S.reports.find(x=>x.id===id);
  $("#layer").innerHTML=`<div class="scrim" data-a="close"></div><div class="card modal" role="dialog" aria-modal="true" aria-label="Review report"><div class="card-head"><h2>${esc(r.report_type||"Report")} · ${esc(r.patient.full_name)}</h2><div class="right"><button class="icon-btn" data-a="close" aria-label="Close">${ic("x")}</button></div></div>
   <span class="aitag" style="margin-bottom:12px">${ic("ai","sm")}AI-generated draft · not verified</span>
   <form id="rform" class="form" style="grid-template-columns:1fr"><label>Report text (edit as needed)<textarea class="field" name="content" rows="7" required>${esc(r.verified_content||r.findings)}</textarea></label>
   <label>Your clinical note<textarea class="field" name="note" rows="3" placeholder="Optional context for the record">${esc(r.doctor_note||"")}</textarea></label>
   <p class="muted" style="font-size:.84rem">Approving records that you have reviewed this text and take responsibility for it.</p>
   <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn" type="button" data-a="close">Cancel</button><button class="btn primary" type="submit">Verify and approve</button></div></form></div>`;
  $("#rform textarea").focus();
  $("#rform").addEventListener("submit",async e=>{e.preventDefault();
    const fd=new FormData(e.target),upd={status:"approved",doctor_note:fd.get("note"),verified_content:fd.get("content"),verified_by:S.doctor.id,verified_at:new Date().toISOString()};
    if(!await persist(sb=>sb.from("ai_reports").update(upd).eq("id",r.id).select("id")))return;
    Object.assign(r,upd);$("#layer").innerHTML="";toast("Report verified and approved");rerender()});
}
function openHistory(id){
  const h=S.history.find(x=>x.id===id);
  $("#layer").innerHTML=`<div class="scrim" data-a="close"></div><div class="card modal" role="dialog" aria-modal="true" aria-label="Consultation details"><div class="card-head"><h2>${esc(h.patient.full_name)}</h2><div class="right"><button class="icon-btn" data-a="close" aria-label="Close">${ic("x")}</button></div></div>
   <p class="muted" style="margin-bottom:12px">${fmtDT(h.completed_at)} · ${h.duration_min||"–"} min</p>
   <div class="sect" style="margin-top:0"><h3>Diagnosis</h3><p>${esc(h.diagnosis)}</p></div><div class="sect"><h3>Notes</h3><p>${esc(h.notes||"None")}</p></div><div class="sect"><h3>Prescription</h3><p>${esc(h.prescription||"None")}</p></div><div class="sect"><h3>Follow-up</h3><p>${esc(h.follow_up||"None")}</p></div></div>`;
}

/* ---------- patient priority (doctor-assigned) ---------- */
async function setPriority(pid,cat,sel){
  const prev=S.priorities[pid]?.category||"";
  if(!(S.mode==="live"&&S.priorityReady)){if(sel)sel.value=prev;return}
  const {data,error}=await S.sb.from("patient_priorities")
    .upsert({patient_id:pid,doctor_id:S.doctor.id,category:cat},{onConflict:"patient_id,doctor_id"})
    .select("*, updater:doctors!updated_by(full_name)").single();
  if(error){toast("Could not save priority: "+error.message,"err");if(sel)sel.value=prev;return}
  S.priorities[pid]=data;
  toast(`Priority set to ${PRI[cat].l}`);rerender();
  document.querySelector(`select[data-pri="${CSS.escape(pid)}"]`)?.focus();
}
async function loadAudit(pid){
  if(!$("#pri-audit")||!pid||S.mode!=="live"||!S.priorityReady)return;
  const {data,error}=await S.sb.from("patient_priority_audit")
    .select("old_category,new_category,changed_at,by:doctors!changed_by(full_name)")
    .eq("patient_id",pid).eq("doctor_id",S.doctor.id).order("changed_at",{ascending:false}).limit(5);
  const box=$("#pri-audit");if(!box||S.recSel!==pid)return;
  if(error||!data?.length){box.innerHTML="";return}
  box.innerHTML=`<p class="muted" style="font-size:.82rem;margin:10px 0 4px;font-weight:600">Recent changes</p><ul class="muted" style="margin:0;padding-left:18px;font-size:.84rem">${data.map(r=>`<li>${PRI[r.old_category]?.l||"Not set"} to ${PRI[r.new_category]?.l||esc(r.new_category)} · ${esc(r.by?.full_name||"Doctor")} · ${fmtDT(r.changed_at)}</li>`).join("")}</ul>`;
}
async function reloadReports(){
  const {data,error}=await S.sb.from("ai_reports").select("*, patient:patients(*)").eq("doctor_id",S.doctor.id).order("created_at",{ascending:false});
  if(error)throw error;S.reports=data||[];
}

/* ---------- toast / settings ---------- */
function toast(msg,kind){
  const t=document.createElement("div");t.className="toast "+(kind||"");t.innerHTML=`${ic(kind==="err"?"alert":"check","sm")}<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);setTimeout(()=>t.remove(),4200);
}
function applySettings(){
  document.documentElement.dataset.density=S.settings.compact?"compact":"comfortable";
  document.documentElement.dataset.motion=S.settings.motion?"on":"off";
}

/* live refresh of wait times */
setInterval(()=>{if(["dashboard","queue"].includes(S.route)&&!$("#layer").firstChild&&showing()&&document.activeElement?.tagName!=="SELECT"){const y=scrollY;$("#view").innerHTML=viewHtml();scrollTo({top:y})}},60000);

init();
})();
