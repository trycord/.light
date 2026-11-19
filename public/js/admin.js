// .light — independent Administration Control Center.
import api from '/js/api.js';
import { iconImg, brandMark } from '/js/assets.js';

const root = document.getElementById('admin-app');
const overlays = document.getElementById('overlay-root');
let admin = null, pollTimer = null, currentView = '';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => t ? new Date(t).toLocaleString() : '—';
const fmtAgo = (t) => { if (!t) return 'never'; const s=(Date.now()-t)/1000; if(s<60)return Math.round(s)+'s'; if(s<3600)return Math.round(s/60)+'m'; if(s<86400)return Math.round(s/3600)+'h'; return Math.round(s/86400)+'d'; };
const fmtMoney = (c, cur='USD') => '$'+((c||0)/100).toFixed(2)+' '+cur;
const STATUS = { active:'success', running:'success', online:'success', success:'success', published:'success', paid:'success', ready:'success', verified:'success', suspended:'warning', pending:'warning', deploying:'warning', provisioning:'warning', queued:'info', draft:'neutral', stopped:'neutral', offline:'neutral', archived:'neutral', cancelled:'neutral', failed:'danger', error:'danger', degraded:'danger', offline:'neutral' };
const badge = (s) => { const c=STATUS[s]||'neutral'; return `<span class="admin-badge ${c}">${esc(s||'unknown')}</span>`; };
const fld = (l,n,t='text',v='',x='')=>`<div class="lt-field"><label>${esc(l)}</label><input class="lt-input" name="${n}" type="${t}" value="${esc(v)}" ${x}></div>`;
const sel = (l,n,o,sel='')=>`<div class="lt-field"><label>${esc(l)}</label><select class="lt-select" name="${n}">${o.map(x=>{const v=typeof x==='string'?x:x.value,t=typeof x==='string'?x:x.label;return `<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(t)}</option>`;}).join('')}</select></div>`;
const ta = (l,n,v='')=>`<div class="lt-field"><label>${esc(l)}</label><textarea class="lt-textarea" name="${n}">${esc(v)}</textarea></div>`;
function toast(m,t='info'){const e=document.createElement('div');e.className='lt-toast';e.innerHTML=`<span class="lt-dot lt-dot-${t==='error'?'danger':'success'}"></span><span>${esc(m)}</span>`;let s=overlays.querySelector('.lt-toast-stack');if(!s){s=document.createElement('div');s.className='lt-toast-stack';overlays.appendChild(s);}s.appendChild(e);setTimeout(()=>e.remove(),3500);}
function modal(title,body,opts={}){return new Promise(res=>{const o=document.createElement('div');o.className='lt-modal-overlay';const formBody=body.includes('<form')?body:`<form id="mf">${body}</form>`;o.innerHTML=`<div class="lt-modal"><div class="lt-modal-header"><h3 class="lt-h3">${esc(title)}</h3><button class="lt-btn lt-btn-ghost lt-btn-icon" data-close>✕</button></div><div class="lt-modal-body">${formBody}</div><div class="lt-modal-footer"><button class="lt-btn lt-btn-ghost" data-close>Cancel</button><button class="lt-btn ${opts.danger?'lt-btn-danger':'lt-btn-primary'}" data-ok>${esc(opts.ok||'Save')}</button></div></div>`;overlays.appendChild(o);const close=v=>{o.remove();res(v);};o.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(null)));o.querySelector('[data-ok]').addEventListener('click',()=>{const f=o.querySelector('form');if(f){if(!f.reportValidity())return;close(Object.fromEntries(new FormData(f).entries()));}else close(true);});o.addEventListener('click',e=>{if(e.target===o)close(null);});});}
const confirmDialog=(t,m)=>modal(t,`<p style="font-size:13px;color:var(--lt-text-secondary)">${esc(m)}</p>`,{danger:true,ok:'Confirm'});
const panel=(t,s,c,a='')=>`<div class="lt-card"><div class="lt-card-header"><div><h3 class="lt-h3">${esc(t)}</h3>${s?`<div class="lt-meta">${esc(s)}</div>`:''}</div>${a}</div><div class="lt-card-body">${c}</div></div>`;
const table=(cols,rows)=>`<div class="lt-table-wrap"><table class="admin-table"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${cols.length}" class="admin-empty-state">No records</td></tr>`}</tbody></table></div>`;
const loading=()=>'<div class="lt-loading"><span class="lt-spinner"></span>Loading…</div>';

const NAV=[
  {g:'Overview',items:[['dashboard','Dashboard','monitoring']]},
  {g:'Customers',items:[['customers','Customers','teams']]},
  {g:'Hosting',items:[['services','Services','instances'],['products','Products','applications'],['plans','Plans','templates'],['environments','Environments','settings']]},
  {g:'Infrastructure',items:[['nodes','Nodes','nodes'],['deployments','Deployments','schedules']]},
  {g:'Commercial',items:[['subscriptions','Subscriptions','storage'],['transactions','Transactions','security'],['pricing','Pricing','settings']]},
  {g:'Operations',items:[['domains','Domains','network'],['backups','Backups','backups'],['audit','Audit log','security']]},
  {g:'System',items:[['settings','Settings','settings']]},
];

function shell(){
  const nav=NAV.map(g=>`<div class="admin-nav-group"><div class="admin-nav-label">${g.g}</div>${g.items.map(i=>`<a class="admin-nav-item" href="#/${i[0]}" data-view="${i[0]}">${iconImg(i[2],16)}<span>${i[1]}</span></a>`).join('')}</div>`).join('');
  root.innerHTML=`<div class="admin-shell">
    <aside class="admin-sidebar" id="aSidebar"><a class="lt-brand" href="#/dashboard">${brandMark(30)}<span class="lt-brand-word">.light<span class="lt-brand-sub">Admin Center</span></span></a>
      ${nav}<div class="admin-health"><div class="admin-health-row"><span>Platform</span>${badge('active')}</div><div class="admin-health-row"><span>API</span>${badge('active')}</div><div class="admin-health-row"><span>Shade</span><span id="aHealth">—</span></div></div>
      <div style="padding:10px"><a class="lt-btn lt-btn-ghost lt-btn-sm" href="/login" style="width:100%">← Customer view</a></div>
    </aside>
    <div class="admin-scrim" id="aScrim" style="display:none"></div>
    <div class="admin-main"><header class="admin-topbar">
      <button class="lt-btn lt-btn-ghost lt-btn-icon" id="aToggle" style="display:none">☰</button>
      <div class="lt-breadcrumb"><span>Administration</span><span class="sep">/</span><span class="cur" id="aCrumb">Dashboard</span></div>
      <div class="lt-topbar-spacer"></div>
      <div class="lt-global-search admin-search"><input id="aSearch" placeholder="Search records…"></div>
      <button class="lt-icon-btn" title="Notifications">🔔</button>
      <div class="lt-user-menu"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="aUser">${esc(admin?.name||admin?.email||'Admin')} ▾</button></div>
    </header><main class="admin-content" id="aView">${loading()}</main></div></div>`;
  root.querySelector('#aToggle')?.addEventListener('click',()=>{const s=root.querySelector('#aSidebar'),sc=root.querySelector('#aScrim');const o=s.classList.toggle('is-open');sc.style.display=o?'block':'none';});
  root.querySelector('#aScrim')?.addEventListener('click',()=>{root.querySelector('#aSidebar').classList.remove('is-open');root.querySelector('#aScrim').style.display='none';});
  root.querySelector('#aUser').addEventListener('click',(e)=>{e.stopPropagation();const ex=root.querySelector('.admin-user-panel');if(ex){ex.remove();return;}const p=document.createElement('div');p.className='lt-user-menu-panel';p.innerHTML=`<div class="lt-menu-label">${esc(admin?.email||'')}</div><a href="/login#/settings">Account settings</a><a href="/">Public site</a><button id="aLogout">Sign out</button>`;root.querySelector('.lt-user-menu').appendChild(p);p.querySelector('#aLogout').addEventListener('click',async()=>{await api.logout().catch(()=>{});api.setToken('');location.href='/login';});});
  // health
  try{fetch('/health').then(r=>r.json()).then(h=>{const el=root.querySelector('#aHealth');if(el)el.innerHTML=badge(h.status==='ok'?'active':'degraded');});}catch{}
}

function route(){const v=(location.hash||'#/dashboard').replace(/^#\/?/,'').split('?')[0];setNav(v);render(v);}
function setNav(v){root.querySelectorAll('[data-view]').forEach(a=>a.classList.toggle('active',a.dataset.view===v));const c=root.querySelector('#aCrumb');if(c)c.textContent=v.charAt(0).toUpperCase()+v.slice(1);}

async function render(v){
  stopPoll();currentView=v;const view=root.querySelector('#aView');if(!view)return;
  const R={dashboard:dashboard,customers:customers,services:services,products:products,plans:plans,environments:environments,nodes:nodes,deployments:deployments,subscriptions:subscriptions,transactions:transactions,pricing:pricing,domains:domains,backups:backups,audit:audit,settings:settings};
  view.innerHTML=loading();try{await (R[v]||dashboard)();}catch(e){view.innerHTML=`<div class="lt-error">${esc(e.message)}</div>`;}}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
function poll(fn,ms=15000){stopPoll();pollTimer=setInterval(()=>{if(currentView&&admin)fn().catch(()=>{});},ms);}

/* ---------- views ---------- */
async function dashboard(){
  const view=root.querySelector('#aView');
  let users=[],nodes=[],stats={},subs=[],tx=[],instances=[];
  try{[users,nodes,subs,tx]=await Promise.all([api.adminUsers(),api.nodes(),api.adminSubscriptions(),api.adminTransactions()]);stats=await api.stats();instances=(await api.instances(true)).instances;}catch{}
  const online=nodes.nodes.filter(n=>n.status==='online').length;
  const cards=[['Customers',users.users.length,'registered'],['Services',instances.length,'total'],['Nodes online',`${online}/${nodes.nodes.length}`,'connected'],['Subscriptions',subs.subscriptions.length,'total']]
    .map(([l,v,s])=>`<div class="lt-card admin-stat"><div class="lt-label">${l}</div><div class="admin-stat-value" style="margin-top:8px">${esc(v)}</div><div class="lt-meta">${esc(s)}</div></div>`).join('');
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Dashboard</h1><p class="lt-page-subtitle">Platform operations overview</p></div><div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="#/products">New product</a><a class="lt-btn lt-btn-secondary" href="#/plans">New plan</a></div></div>
    <div class="admin-grid admin-grid-4" style="margin-bottom:14px">${cards}</div>
    <div class="admin-grid admin-grid-2">
      ${panel('Recent customers','',table(['Email','Name','Role','Status','Joined'],users.users.slice(0,8).map(u=>`<tr><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.name||u.username||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td><td>${fmtAgo(u.created_at)}</td></tr>`)))}
      ${panel('Recent transactions','',table(['ID','Amount','Status','Date'],tx.transactions.slice(0,8).map(t=>`<tr><td class="lt-td-mono">${esc(t.id)}</td><td>${fmtMoney(t.amount,t.currency)}</td><td>${badge(t.status)}</td><td>${fmtTime(t.created_at)}</td></tr>`)))}
      ${panel('Infrastructure','',table(['Node','Status','CPU','Memory','Heartbeat'],nodes.nodes.map(n=>`<tr><td class="lt-td-strong">${esc(n.name)}</td><td>${badge(n.status)}</td><td>${Math.round(n.cpu_used)}%</td><td>${Math.round(n.mem_used)}%</td><td>${fmtAgo(n.last_heartbeat)}</td></tr>`)))}
      ${panel('Recent audit events','',table(['Time','Action','Target'],(await api.audit()).events.slice(0,8).map(e=>`<tr><td class="lt-td-mono">${fmtTime(e.ts)}</td><td>${esc(e.action)}</td><td>${esc(e.target_id||'—')}</td></tr>`)))}
    </div>`;
  poll(async()=>{if(currentView==='dashboard')await dashboard();},15000);
}

async function customers(){
  const view=root.querySelector('#aView');let users=[];try{users=(await api.adminUsers()).users;}catch{}
  const q=(root.querySelector('#aSearch')?.value||'').toLowerCase();
  const list=users.filter(u=>!q||(u.email+' '+(u.name||'')+' '+(u.username||'')).toLowerCase().includes(q));
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Customers</h1><p class="lt-page-subtitle">${users.length} registered accounts</p></div></div>
    ${panel('Customer directory','',table(['ID','Email','Username','Role','Status','Joined','Last login',''],list.map(u=>`<tr><td class="lt-td-mono">${esc(u.id)}</td><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.username||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td><td>${fmtAgo(u.created_at)}</td><td>${fmtAgo(u.last_login)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-customer="${u.id}">Manage</button></td></tr>`)))}`;
  view.querySelectorAll('[data-customer]').forEach(b=>b.addEventListener('click',async()=>{const u=users.find(x=>x.id===b.dataset.customer);const d=await modal('Manage customer',`<p style="font-size:13px">${esc(u.email)}</p>${sel('Role','role',['user','admin'],u.role)}${sel('Status','status',['active','suspended'],u.status)}`,{ok:'Save'});if(d){await api.updateUser(u.id,d);toast('Customer updated','success');customers();}}));
}

async function services(){
  const view=root.querySelector('#aView');let inst=[];try{inst=(await api.instances(true)).instances;}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Services</h1><p class="lt-page-subtitle">All customer hosting services</p></div></div>
    ${panel('Service directory','',table(['ID','Name','Customer','Type','Status','Node','Resources','Created',''],inst.map(i=>`<tr><td class="lt-td-mono">${esc(i.id)}</td><td class="lt-td-strong">${esc(i.name)}</td><td class="lt-td-mono">${esc(i.teamId)}</td><td>${esc(i.category)}</td><td>${badge(i.status)}</td><td>${esc(i.nodeName||'—')}</td><td class="lt-td-mono">${i.cpuCores}c/${i.memoryMb}MB</td><td>${fmtAgo(i.createdAt)}</td><td><a class="lt-btn lt-btn-ghost lt-btn-sm" href="/login#/server/${i.id}">Inspect</a></td></tr>`)))}`;
}

async function products(){
  const view=root.querySelector('#aView');let prods=[],cats=[];try{[prods,cats]=await Promise.all([api.adminProducts(),api.adminCategories()]);prods=prods.products||[];cats=cats.categories||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Products</h1><p class="lt-page-subtitle">Hosting catalogue management</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addProd">+ New product</button></div></div>
    ${panel('Product catalogue',`${prods.length} products`,table(['Name','Slug','Category','Price','Status','Featured','Order',''],prods.map(p=>`<tr><td class="lt-td-strong">${esc(p.name)}</td><td class="lt-td-mono">${esc(p.slug)}</td><td>${esc((cats.find(c=>c.id===p.categoryId)||{}).name||p.categoryId)}</td><td>${fmtMoney(p.startingPriceMonthly,p.currency)}</td><td>${badge(p.status)}</td><td>${p.featured?'Yes':'—'}</td><td>${p.sortOrder}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-p="${p.id}">Edit</button> <button class="lt-btn lt-btn-danger lt-btn-sm" data-pd="${p.id}">Archive</button></td></tr>`)))}`;
  view.querySelector('#addProd').addEventListener('click',async()=>{const d=await modal('New product',fld('Name','name','text','','required')+fld('Slug','slug')+sel('Category','categoryId',cats.map(c=>({value:c.id,label:c.name}))) +fld('Short description','shortDescription')+fld('Starting price (cents)','startingPriceMonthly','number','0')+fld('Icon','icon','text','◈'),{ok:'Create'});if(d){try{await api.adminCreateProduct(d);toast('Product created','success');products();}catch(e){toast(e.message,'error');}}});
  view.querySelectorAll('[data-p]').forEach(b=>b.addEventListener('click',async()=>{const p=prods.find(x=>x.id===b.dataset.p);const d=await modal('Edit product',fld('Name','name','text',p.name)+fld('Description','shortDescription','text',p.shortDescription)+fld('Price','startingPriceMonthly','number',p.startingPriceMonthly)+sel('Status','status',['published','draft','unpublished','archived'],p.status)+`<label class="lt-auth-terms"><input type="checkbox" name="featured" ${p.featured?'checked':''}> Featured</label>`,{ok:'Save'});if(d){d.featured=!!d.featured;await api.adminUpdateProduct(p.id,d);toast('Saved','success');products();}}));
  view.querySelectorAll('[data-pd]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Archive product','Archive this product? Existing services are unaffected.')){await api.adminUpdateProduct(b.dataset.pd,{status:'archived'});products();}}));
}

async function plans(){
  const view=root.querySelector('#aView');let pls=[];try{pls=(await api.adminPlans()).plans||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Plans</h1><p class="lt-page-subtitle">Preset hosting plan management</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addPlan">+ New plan</button></div></div>
    ${panel('Preset plans','',table(['Name','Price','CPU','RAM','Storage','Instances','Status','Order',''],pls.map(p=>`<tr><td class="lt-td-strong">${esc(p.name)}</td><td>${fmtMoney(p.priceMonthly,p.currency)}</td><td>${p.cpuCores}</td><td>${p.memoryMb} MB</td><td>${p.diskGb} GB</td><td>${p.instances}</td><td>${badge(p.status)}</td><td>${p.sortOrder}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-pl="${p.id}">Edit</button></td></tr>`)))}`;
  view.querySelector('#addPlan').addEventListener('click',async()=>{const d=await modal('New plan',fld('Name','name','text','','required')+fld('Description','description')+fld('Price monthly (cents)','priceMonthly','number','0')+fld('CPU cores','cpuCores','number','1')+fld('Memory MB','memoryMb','number','512')+fld('Disk GB','diskGb','number','4')+fld('Instances','instances','number','3'),{ok:'Create'});if(d){await api.adminCreatePlan(d);toast('Plan created','success');plans();}});
  view.querySelectorAll('[data-pl]').forEach(b=>b.addEventListener('click',async()=>{const p=pls.find(x=>x.id===b.dataset.pl);const d=await modal('Edit plan',fld('Name','name','text',p.name)+fld('Price','priceMonthly','number',p.priceMonthly)+fld('CPU','cpuCores','number',p.cpuCores)+fld('Memory','memoryMb','number',p.memoryMb)+fld('Disk','diskGb','number',p.diskGb)+sel('Status','status',['published','unpublished','archived'],p.status),{ok:'Save'});if(d){await api.adminUpdatePlan(p.id,d);toast('Saved','success');plans();}}));
}

async function environments(){
  const view=root.querySelector('#aView');let envs=[];try{envs=(await api.adminEnvironments()).environments||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Environments</h1><p class="lt-page-subtitle">Runtime catalogue managed by Shade</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addEnv">+ New environment</button></div></div>
    ${panel('Runtimes & images','',table(['Name','Category','Versions','Image','Default command','Status',''],envs.map(e=>`<tr><td class="lt-td-strong">${esc(e.name)}</td><td>${esc(e.category)}</td><td class="lt-td-mono">${e.versions.join(', ')}</td><td class="lt-td-mono">${esc(e.image)}</td><td class="lt-td-mono">${esc(e.defaultCommand||'—')}</td><td>${badge(e.status)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-e="${e.id}">Edit</button></td></tr>`)))}`;
  view.querySelector('#addEnv').addEventListener('click',async()=>{const d=await modal('New environment',fld('ID','id','text','','required pattern="[a-z0-9-]+"')+fld('Name','name','text','','required')+sel('Category','category',['runtime','database','game','web','general'])+fld('Image','image','text','','required')+fld('Versions (comma)','versions')+fld('Default command','defaultCommand'),{ok:'Create'});if(d){d.versions=d.versions.split(',').map(x=>x.trim()).filter(Boolean);try{await api.adminCreateEnvironment(d);toast('Created','success');environments();}catch(e){toast(e.message,'error');}}});
  view.querySelectorAll('[data-e]').forEach(b=>b.addEventListener('click',async()=>{const e=envs.find(x=>x.id===b.dataset.e);const d=await modal('Edit environment',fld('Name','name','text',e.name)+fld('Default command','defaultCommand','text',e.defaultCommand)+sel('Status','status',['published','unpublished'],e.status),{ok:'Save'});if(d){await api.adminUpdateEnvironment(e.id,d);toast('Saved','success');environments();}}));
}

async function nodes(){
  const view=root.querySelector('#aView');let n=[];try{n=(await api.nodes()).nodes;}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Nodes</h1><p class="lt-page-subtitle">Shade infrastructure nodes</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addNode">+ Register node</button></div></div>
    ${panel('Infrastructure nodes','',table(['Name','Host','Region','Status','CPU','RAM','Workloads','Heartbeat','Availability',''],n.map(x=>`<tr><td class="lt-td-strong">${esc(x.name)}</td><td class="lt-td-mono">${esc(x.host)}</td><td>${esc(x.region)}</td><td>${badge(x.status)}</td><td>${Math.round(x.cpu_used)}%</td><td>${Math.round(x.mem_used)}%</td><td>${x.workload_count}</td><td>${fmtAgo(x.last_heartbeat)}</td><td>${badge(x.availability)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-n="${x.id}">Manage</button></td></tr>`)))}`;
  view.querySelector('#addNode').addEventListener('click',async()=>{const d=await modal('Register node',fld('Name','name','text','node-02','required')+fld('Host','host','text','node.local','required')+fld('Region','region','text','local')+fld('CPU cores','cpuCores','number','4')+fld('Memory MB','memoryMb','number','8192')+fld('Disk GB','diskGb','number','100'),{ok:'Register'});if(d){const r=await api.createNode(d);await modal('Node token',`<p style="font-size:12px;color:var(--lt-text-secondary)">Save this token for Shade:</p><div class="lt-console"><div class="lt-console-body" style="height:auto;padding:12px">${esc(r.token)}</div></div>`,{ok:'Done'});nodes();}});
  view.querySelectorAll('[data-n]').forEach(b=>b.addEventListener('click',async()=>{const x=n.find(y=>y.id===b.dataset.n);const d=await modal('Manage node',`<p style="font-size:13px">${esc(x.name)} · ${esc(x.host)}</p><button class="lt-btn lt-btn-secondary" id="drain">${x.availability==='draining'?'Enable scheduling':'Drain node'}</button> <button class="lt-btn lt-btn-secondary" id="rot">Rotate token</button> <button class="lt-btn lt-btn-danger" id="rm">Remove</button>`,{ok:'Close'});if(!d)return;}));
}

async function deployments(){const view=root.querySelector('#aView');let d=[];try{d=(await api.deployments()).deployments;}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Deployments</h1></div>${panel('All deployments','',table(['ID','Instance','Status','Source','Version','Time'],d.map(x=>`<tr><td class="lt-td-mono">${esc(x.id)}</td><td>${esc(x.instanceName||x.instanceId)}</td><td>${badge(x.status)}</td><td>${esc(x.source)}</td><td class="lt-td-mono">${esc(x.version)}</td><td>${fmtTime(x.createdAt)}</td></tr>`)))}`;}
async function subscriptions(){const view=root.querySelector('#aView');let s=[];try{s=(await api.adminSubscriptions()).subscriptions||[];}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Subscriptions</h1></div>${panel('All subscriptions','',table(['ID','Team','Plan','Status','Price','Started'],s.map(x=>`<tr><td class="lt-td-mono">${esc(x.id)}</td><td class="lt-td-mono">${esc(x.team_id)}</td><td>${esc(x.plan_id||'custom')}</td><td>${badge(x.status)}</td><td>${fmtMoney(x.price_monthly,x.currency)}</td><td>${fmtTime(x.started_at)}</td></tr>`)))}`;}
async function transactions(){const view=root.querySelector('#aView');let t=[];try{t=(await api.adminTransactions()).transactions||[];}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Transactions</h1></div>${panel('All transactions','',table(['ID','Type','Description','Amount','Status','Provider','Date'],t.map(x=>`<tr><td class="lt-td-mono">${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.description)}</td><td>${fmtMoney(x.amount,x.currency)}</td><td>${badge(x.status)}</td><td>${esc(x.provider)}</td><td>${fmtTime(x.created_at)}</td></tr>`)))}`;}
async function pricing(){const view=root.querySelector('#aView');let c={};try{c=(await api.adminPricing()).config||{};}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Pricing configuration</h1><p class="lt-page-subtitle">Authoritative custom-plan pricing rules</p></div>${panel('Build Your Own Plan pricing','',`<form id="pf" class="admin-grid admin-grid-3">
    ${fld('Currency','currency','text',c.currency)}${fld('Tax %','taxPercent','number',c.tax_percent)}${fld('Yearly discount %','yearlyDiscountPercent','number',c.yearly_discount_percent)}
    ${fld('CPU unit price','priceCpu','number',c.price_cpu)}${fld('RAM per MB','priceMemoryMb','number',c.price_memory_mb)}${fld('Disk per GB','priceDiskGb','number',c.price_disk_gb)}
    ${fld('Network per GB','priceNetworkGb','number',c.price_network_gb)}${fld('Min CPU','minCpu','number',c.min_cpu)}${fld('Max CPU','maxCpu','number',c.max_cpu)}
    ${fld('Min RAM','minMemoryMb','number',c.min_memory_mb)}${fld('Max RAM','maxMemoryMb','number',c.max_memory_mb)}${fld('Min disk','minDiskGb','number',c.min_disk_gb)}${fld('Max disk','maxDiskGb','number',c.max_disk_gb)}
    <div><button class="lt-btn lt-btn-primary" type="submit">Save pricing</button></div></form>`)}`;
  view.querySelector('#pf').addEventListener('submit',async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());await api.adminUpdatePricing(d);toast('Pricing saved','success');});}

async function domains(){const view=root.querySelector('#aView');let d=[];try{d=(await api.domains()).domains||[];}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Domains</h1></div>${panel('All domains','',table(['Domain','Service','Verified','SSL','Status','Created'],d.map(x=>`<tr><td class="lt-td-strong">${esc(x.domain)}</td><td class="lt-td-mono">${esc(x.instance_id)}</td><td>${badge(x.verified?'active':'pending')}</td><td>${badge(x.ssl_status)}</td><td>${badge(x.status)}</td><td>${fmtTime(x.created_at)}</td></tr>`)))}`;}
async function backups(){const view=root.querySelector('#aView');let b=[];try{b=(await api.backupsAll()).backups||[];}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Backups</h1></div>${panel('All backups','',table(['Name','Instance','Status','Size','Created','Location'],b.map(x=>`<tr><td class="lt-td-strong">${esc(x.name)}</td><td class="lt-td-mono">${esc(x.instance_id)}</td><td>${badge(x.status)}</td><td>${fmtBytes(x.size_bytes)}</td><td>${fmtTime(x.created_at)}</td><td class="lt-td-mono">${esc(x.location||'—')}</td></tr>`)))}`;}
const fmtBytes=(b)=>{b=Number(b||0);return b>1073741824?(b/1073741824).toFixed(1)+' GB':b>1048576?(b/1048576).toFixed(1)+' MB':b+' B';};
async function audit(){const view=root.querySelector('#aView');let e=[];try{e=(await api.audit()).events||[];}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Audit log</h1></div>${panel('Administrative & lifecycle events','',table(['Time','Action','Target type','Target ID','Details'],e.slice(0,100).map(x=>`<tr><td class="lt-td-mono">${fmtTime(x.ts)}</td><td>${esc(x.action)}</td><td>${esc(x.target_type||'—')}</td><td class="lt-td-mono">${esc(x.target_id||'—')}</td><td class="lt-td-mono">${esc((x.details||'').slice(0,80))}</td></tr>`)))}`;}
async function settings(){const view=root.querySelector('#aView');let b={};try{b=await api.branding();}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Platform settings</h1></div>${panel('Branding & identity','',`<p class="lt-meta">Product: ${esc(b.product)} · Owner: ${esc(b.identity?.owner)} · Domain: ${esc(b.domain)}</p><p class="lt-meta">Branding is configured by the self-hoster through environment variables. Ownership attribution is embedded in the software and cannot be removed.</p>`)}`;}

window.addEventListener('hashchange',route);
async function boot(){
  try{const me=await api.me();admin=me.user;}catch{api.setToken('');location.href='/login';return;}
  if(admin.role!=='admin'){location.href='/login';return;}
  shell();route();
}
boot();
