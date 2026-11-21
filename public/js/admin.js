// .light — independent Administration Control Center.
import api from '/js/api.js';
import { iconImg, brandMark } from '/js/assets.js';

const root = document.getElementById('admin-app');
const overlays = document.getElementById('overlay-root');
let admin = null, pollTimer = null, currentView = '', adminPermissions = [], adminImpersonatedBy = null;
const can = (p) => adminPermissions.includes('*') || adminPermissions.includes(p);

import { esc, trapFocus } from '/js/shared.js';
const fmtTime = (t) => t ? new Date(t).toLocaleString() : '—';
const fmtAgo = (t) => { if (!t) return 'never'; const s=(Date.now()-t)/1000; if(s<60)return Math.round(s)+'s'; if(s<3600)return Math.round(s/60)+'m'; if(s<86400)return Math.round(s/3600)+'h'; return Math.round(s/86400)+'d'; };
const fmtMoney = (c, cur='USD') => '$'+((c||0)/100).toFixed(2)+' '+cur;
const STATUS = { active:'success', running:'success', online:'success', success:'success', published:'success', paid:'success', ready:'success', verified:'success', suspended:'warning', pending:'warning', deploying:'warning', provisioning:'warning', queued:'info', draft:'neutral', stopped:'neutral', offline:'neutral', archived:'neutral', cancelled:'neutral', failed:'danger', error:'danger', degraded:'danger', offline:'neutral' };
const badge = (s) => { const c=STATUS[s]||'neutral'; return `<span class="admin-badge ${c}">${esc(s||'unknown')}</span>`; };
const fld = (l,n,t='text',v='',x='')=>`<div class="lt-field"><label>${esc(l)}</label><input class="lt-input" name="${n}" type="${t}" value="${esc(v)}" ${x}></div>`;
const sel = (l,n,o,sel='')=>`<div class="lt-field"><label>${esc(l)}</label><select class="lt-select" name="${n}">${o.map(x=>{const v=typeof x==='string'?x:x.value,t=typeof x==='string'?x:x.label;return `<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(t)}</option>`;}).join('')}</select></div>`;
const ta = (l,n,v='')=>`<div class="lt-field"><label>${esc(l)}</label><textarea class="lt-textarea" name="${n}">${esc(v)}</textarea></div>`;
function toast(m,t='info'){const e=document.createElement('div');e.className='lt-toast';e.innerHTML=`<span class="lt-dot lt-dot-${t==='error'?'danger':'success'}"></span><span>${esc(m)}</span>`;let s=overlays.querySelector('.lt-toast-stack');if(!s){s=document.createElement('div');s.className='lt-toast-stack';overlays.appendChild(s);}s.appendChild(e);setTimeout(()=>e.remove(),3500);}
let modalSeq=0;
function modal(title,body,opts={}){return new Promise(res=>{
  const o=document.createElement('div');o.className='lt-modal-overlay';
  const formBody=body.includes('<form')?body:`<form id="mf-${++modalSeq}">${body}</form>`;
  o.innerHTML=`<div class="lt-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="lt-modal-header"><h3 class="lt-h3">${esc(title)}</h3><button type="button" class="lt-btn lt-btn-ghost lt-btn-icon" data-close aria-label="Close dialog">✕</button></div><div class="lt-modal-body">${formBody}</div><div class="lt-modal-footer"><button type="button" class="lt-btn lt-btn-ghost" data-close>Cancel</button><button type="button" class="lt-btn ${opts.danger?'lt-btn-danger':'lt-btn-primary'}" data-ok>${esc(opts.ok||'Save')}</button></div></div>`;
  overlays.appendChild(o);
  const onKey=e=>{if(e.key==='Escape')close(null);trapFocus(o,e);};
  const close=v=>{o.remove();document.removeEventListener('keydown',onKey);res(v);};
  document.addEventListener('keydown',onKey);
  o.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(null)));
  o.querySelector('[data-ok]').addEventListener('click',()=>{const f=o.querySelector('form');if(f){if(!f.reportValidity())return;close(Object.fromEntries(new FormData(f).entries()));}else close(true);});
  o.addEventListener('click',e=>{if(e.target===o)close(null);});
  o.querySelector('[data-ok]')?.focus();
});}
const confirmDialog=(t,m)=>modal(t,`<p style="font-size:13px;color:var(--lt-text-secondary)">${esc(m)}</p>`,{danger:true,ok:'Confirm'});
const panel=(t,s,c,a='')=>`<div class="lt-card"><div class="lt-card-header"><div><h3 class="lt-h3">${esc(t)}</h3>${s?`<div class="lt-meta">${esc(s)}</div>`:''}</div>${a}</div><div class="lt-card-body">${c}</div></div>`;
const table=(cols,rows)=>{const body=Array.isArray(rows)?rows.join(''):(rows||`<tr><td colspan="${cols.length}" class="admin-empty-state">No records</td></tr>`);return `<div class="lt-table-wrap"><table class="admin-table"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;};
const loading=()=>'<div class="lt-loading"><span class="lt-spinner"></span>Loading…</div>';

const NAV=[
  {g:'Overview',items:[['dashboard','Dashboard','monitoring','admin.access'],['analytics','Analytics','monitoring','analytics.read']]},
  {g:'Customers',items:[['customers','Customers','teams','customers.read'],['support','Support tickets','security','tickets.read']]},
  {g:'Hosting',items:[['services','Services','instances','services.read'],['products','Products','applications','products.read'],['plans','Plans','templates','plans.read'],['packages','Software packages','settings','products.read'],['compatibility','Compatibility','security','products.read'],['environments','Environments','settings','environments.read']]},
  {g:'Infrastructure',items:[['nodes','Nodes','nodes','nodes.read'],['deployments','Deployments','schedules','services.read']]},
  {g:'Commercial',items:[['orders','Orders & provisioning','schedules','orders.read'],['subscriptions','Subscriptions','storage','billing.read'],['transactions','Transactions','security','billing.read'],['pricing','Pricing','settings','billing.read']]},
  {g:'Operations',items:[['domains','Domains','network','domains.read'],['backups','Backups','backups','backups.read'],['audit','Audit log','security','audit.read'],['notifications','Notifications','settings','notifications.read']]},
  {g:'System',items:[['system','Platform status','monitoring','settings.read'],['roles','Roles & access','security','roles.read'],['settings','Settings','settings','settings.read']]},
];

function shell(){
  const nav=NAV.map(g=>{const items=g.items.filter(i=>can(i[3]));return items.length?`<div class="admin-nav-group"><div class="admin-nav-label">${g.g}</div>${items.map(i=>`<a class="admin-nav-item" href="#/${i[0]}" data-view="${i[0]}">${iconImg(i[2],16)}<span>${i[1]}</span></a>`).join('')}</div>`:'';}).join('');
  root.innerHTML=`<div class="admin-shell">
    <aside class="admin-sidebar" id="aSidebar"><a class="lt-brand" href="#/dashboard">${brandMark(30)}<span class="lt-brand-word">.light<span class="lt-brand-sub">Admin Center</span></span></a>
      ${nav}<div class="admin-health"><div class="admin-health-row"><span>Platform</span>${badge('active')}</div><div class="admin-health-row"><span>API</span>${badge('active')}</div><div class="admin-health-row"><span>Shade</span><span id="aHealth">—</span></div></div>
      <div style="padding:10px"><a class="lt-btn lt-btn-ghost lt-btn-sm" href="/login" style="width:100%">← Customer view</a></div>
    </aside>
    <div class="admin-scrim" id="aScrim" style="display:none"></div>
    <div class="admin-main"><header class="admin-topbar">
      <button class="lt-btn lt-btn-ghost lt-btn-icon" id="aToggle">☰</button>
      <div class="lt-breadcrumb"><span>Administration</span><span class="sep">/</span><span class="cur" id="aCrumb">Dashboard</span></div>
      <div class="lt-topbar-spacer"></div>
      <div class="lt-global-search admin-search"><input id="aSearch" placeholder="Search records…"></div>
      <button class="lt-icon-btn" data-theme-toggle title="Toggle theme" aria-label="Toggle theme">☀</button>
      <button class="lt-icon-btn" id="aNotifBtn" title="Notifications" style="position:relative">🔔<span class="lt-badge-count" id="aNotifCount" style="display:none">0</span></button>
      <div class="lt-user-menu"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="aUser">${esc(admin?.name||admin?.email||'Admin')} ▾</button></div>
    </header><main class="admin-content" id="aView">${loading()}</main></div></div>`;
  root.querySelector('#aToggle')?.addEventListener('click',()=>{const s=root.querySelector('#aSidebar'),sc=root.querySelector('#aScrim');const o=s.classList.toggle('is-open');sc.style.display=o?'block':'none';});
  root.querySelector('#aScrim')?.addEventListener('click',()=>{root.querySelector('#aSidebar').classList.remove('is-open');root.querySelector('#aScrim').style.display='none';});
  root.querySelector('#aUser').addEventListener('click',(e)=>{e.stopPropagation();const ex=root.querySelector('.admin-user-panel');if(ex){ex.remove();return;}const p=document.createElement('div');p.className='lt-user-menu-panel';p.innerHTML=`<div class="lt-menu-label">${esc(admin?.email||'')}</div><a href="/login#/settings">Account settings</a><a href="/">Public site</a><button id="aLogout">Sign out</button>`;root.querySelector('.lt-user-menu').appendChild(p);p.querySelector('#aLogout').addEventListener('click',async()=>{await api.logout().catch(()=>{});api.setToken('');location.href='/login';});});
  // health
  try{fetch('/health').then(r=>r.json()).then(h=>{const el=root.querySelector('#aHealth');if(el)el.innerHTML=badge(h.status==='ok'?'active':'degraded');});}catch{}
  root.querySelector('#aNotifBtn')?.addEventListener('click',(e)=>{e.stopPropagation();openAdminNotifPanel(e.currentTarget);});
  if(adminImpersonatedBy){
    const bar=document.createElement('div');bar.className='lt-impersonation-bar';
    bar.innerHTML=`<span>⚠ Impersonating <strong>${esc(admin?.email||'')}</strong></span><button class="lt-btn lt-btn-sm" id="aExitImp">Exit</button>`;
    root.querySelector('.admin-main')?.prepend(bar);
    bar.querySelector('#aExitImp')?.addEventListener('click',()=>{api.setToken('');location.href='/login';});
  }
  loadAdminUnread();
}

async function loadAdminUnread(){
  try{const r=await api.unreadNotifications();const el=root.querySelector('#aNotifCount');if(el){el.textContent=r.unread>99?'99+':r.unread;el.style.display=r.unread?'inline-block':'none';}}catch{}
}
async function openAdminNotifPanel(anchor){
  const ex=document.querySelector('.lt-notif-panel');if(ex){ex.remove();return;}
  const p=document.createElement('div');p.className='lt-notif-panel';
  p.innerHTML='<div class="lt-notif-head">Notifications <button class="lt-btn lt-btn-ghost lt-btn-sm" id="anpReadAll">Mark all read</button></div><div id="anpList">'+loading()+'</div>';
  document.body.appendChild(p);
  const rect=anchor.getBoundingClientRect();p.style.top=(rect.bottom+8)+'px';p.style.right=Math.max(8,window.innerWidth-rect.right)+'px';
  const load=async()=>{try{const r=await api.notifications(30);const list=p.querySelector('#anpList');
    list.innerHTML=r.notifications.length?r.notifications.map(n=>`<div class="lt-notif-item ${n.read?'':'is-unread'}"><div class="lt-notif-dot ${esc(n.type)}"></div><div style="flex:1;min-width:0"><div class="lt-notif-title">${esc(n.title)}</div><div class="lt-notif-msg">${esc(n.message)}</div><div class="lt-meta">${fmtAgo(n.createdAt)}</div></div></div>`).join(''):'<div class="lt-notif-empty">You’re all caught up.</div>';
  }catch(e){p.querySelector('#anpList').innerHTML=e.message;}};
  p.querySelector('#anpReadAll').addEventListener('click',async()=>{try{await api.markAllNotificationsRead();await loadAdminUnread();await load();toast('All marked as read','success');}catch(e){toast(e.message,'error');}});
  await load();loadAdminUnread();
  setTimeout(()=>{const h=(ev)=>{if(!p.contains(ev.target)&&!anchor.contains(ev.target)){p.remove();document.removeEventListener('click',h);}};document.addEventListener('click',h);},0);
}

function route(){
  const v=(location.hash||'#/dashboard').replace(/^#\/?/,'').split('?')[0]||'dashboard';
  const allowed=NAV.flatMap(g=>g.items).filter(i=>can(i[3])).map(i=>i[0]);
  if(!allowed.includes(v)){const fallback=allowed[0]||'dashboard';if(v!==fallback){location.replace('#/'+fallback);return;}}
  setNav(v);render(v);
}
function setNav(v){root.querySelectorAll('[data-view]').forEach(a=>a.classList.toggle('active',a.dataset.view===v));const c=root.querySelector('#aCrumb');if(c)c.textContent=v.charAt(0).toUpperCase()+v.slice(1);}

async function render(v){
  stopPoll();currentView=v;const view=root.querySelector('#aView');if(!view)return;
  const R={dashboard:dashboard,analytics:analytics,customers:customers,orders:orders,packages:packages,compatibility:compatibility,system:system,support:support,services:services,products:products,plans:plans,environments:environments,nodes:nodes,deployments:deployments,subscriptions:subscriptions,transactions:transactions,pricing:pricing,domains:domains,backups:backups,audit:audit,notifications:notifications,roles:roles,settings:settings};
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
  const view=root.querySelector('#aView');let users=[],roles=[];
  try{[users,roles]=await Promise.all([api.adminUsers(),api.roles()]);users=users.users||[];roles=roles.roles||[];}catch{}
  const q=(root.querySelector('#aSearch')?.value||'').toLowerCase();
  const list=users.filter(u=>!q||(u.email+' '+(u.name||'')+' '+(u.username||'')).toLowerCase().includes(q));
  const roleOpts=[{value:'user',label:'user'},{value:'admin',label:'admin'},...roles.map(r=>({value:r.id,label:r.name}))];
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Customers</h1><p class="lt-page-subtitle">${users.length} registered accounts</p></div></div>
    ${panel('Customer directory','',table(['ID','Email','Username','Role','Status','Joined','Last login',''],list.map(u=>`<tr><td class="lt-td-mono">${esc(u.id)}</td><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.username||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td><td>${fmtAgo(u.created_at)}</td><td>${fmtAgo(u.last_login)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-customer="${u.id}">Manage</button>${can('*')&&u.role!=='admin'?` <button class="lt-btn lt-btn-ghost lt-btn-sm" data-imp="${u.id}">Impersonate</button>`:''}</td></tr>`)))}`;
  view.querySelectorAll('[data-customer]').forEach(b=>b.addEventListener('click',async()=>{const u=users.find(x=>x.id===b.dataset.customer);const d=await modal('Manage customer',`<p style="font-size:13px">${esc(u.email)}</p>${sel('Role','role',roleOpts,u.role)}${sel('Status','status',['active','suspended'],u.status)}`,{ok:'Save'});if(d){try{await api.updateUser(u.id,d);toast('Customer updated','success');customers();}catch(e){toast(e.message,'error');}}}));
  view.querySelectorAll('[data-imp]').forEach(b=>b.addEventListener('click',async()=>{
    if(!await confirmDialog('Impersonate user','A temporary session will be created as this user. This action is recorded in the audit log.'))return;
    try{const r=await api.impersonate(b.dataset.imp);api.setToken(r.token);toast('Impersonation started — redirecting','success');location.href='/login';}
    catch(e){toast(e.message,'error');}
  }));
}

async function services(){
  const view=root.querySelector('#aView');let inst=[];try{inst=(await api.instances(true)).instances;}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Services</h1><p class="lt-page-subtitle">All customer hosting services</p></div></div>
    ${panel('Service directory','',table(['ID','Name','Customer','Type','Status','Node','Resources','Ports','Created',''],inst.map(i=>`<tr><td class="lt-td-mono">${esc(i.id)}</td><td class="lt-td-strong">${esc(i.name)}</td><td class="lt-td-mono">${esc(i.teamId)}</td><td>${esc(i.category)}</td><td>${badge(i.status)}</td><td>${esc(i.nodeName||'—')}</td><td class="lt-td-mono">${i.cpuCores}c/${i.memoryMb}MB</td><td class="lt-td-mono">${(i.ports||[]).map(p=>`${p.container}/${p.protocol||'tcp'}`).join(', ')||'—'}</td><td>${fmtAgo(i.createdAt)}</td><td><a class="lt-btn lt-btn-ghost lt-btn-sm" href="/login#/server/${i.id}">Inspect</a> <button class="lt-btn lt-btn-ghost lt-btn-sm" data-port="${esc(i.id)}">+ Port</button></td></tr>`)))}`;
  view.querySelectorAll('[data-port]').forEach(b=>b.addEventListener('click',async()=>{
    const d=await modal('Allocate port',fld('Container port','container','number','8080','min="1" max="65535"')+sel('Protocol','protocol',['tcp','udp']),{ok:'Allocate'});
    if(!d)return;
    try{await api.adminAddPort(b.dataset.port,{container:+d.container,protocol:d.protocol});toast('Port allocated — host port assigned randomly','success');services();}catch(e){toast(e.message,'error');}
  }));
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
  const view=root.querySelector('#aView');let pls=[],prods=[],envs=[];
  try{[pls,prods,envs]=await Promise.all([api.adminPlans(),api.adminProducts(),api.adminEnvironments()]);pls=pls.plans||[];prods=prods.products||[];envs=envs.environments||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Plan maker</h1><p class="lt-page-subtitle">Define the plans customers subscribe to. Resources are plan-granted, never customer-selected.</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addPlan">+ New plan</button></div></div>
    ${panel('Plans',`${pls.length} defined`,table(['Name','Product','Price','CPU','RAM','Storage','Instances','Status','Order',''],pls.map(p=>`<tr><td class="lt-td-strong">${esc(p.name)}</td><td>${esc((prods.find(x=>x.id===p.productId)||{}).name||'Global')}</td><td>${fmtMoney(p.priceMonthly,p.currency)}</td><td>${p.cpuCores}</td><td>${p.memoryMb} MB</td><td>${p.diskGb} GB</td><td>${p.instances}</td><td>${badge(p.status)}</td><td>${p.sortOrder}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-pl="${p.id}">Edit</button>${p.id!=='free'?` <button class="lt-btn lt-btn-danger lt-btn-sm" data-pld="${p.id}">Archive</button>`:''}</td></tr>`)))}`;
  const form=(p={})=>`<form id="pf">
    ${fld('Name','name','text',p.name||'','required')}${fld('Description','description','text',p.description||'')}
    ${sel('Product','productId',[{value:'',label:'Global (all products)'},...prods.map(x=>({value:x.id,label:x.name}))],p.productId||'')}
    ${sel('Category','category',['shared','dedicated'],p.category||'shared')}
    ${sel('Default runtime','runtimeId',[{value:'',label:'Auto (from package)'},...envs.map(e=>({value:e.id,label:e.name}))],p.runtimeId||'')}
    <div class="lt-field" style="grid-column:1/-1"><label>Supported runtimes</label>
      <div class="lt-picker">${envs.map(e=>{const on=(p.supportedRuntimes||[]).includes(e.id);return `<label class="lt-pick ${on?'is-on':''}"><input type="checkbox" name="supportedRuntimes" value="${esc(e.id)}" ${on?'checked':''}><span class="lt-pick-ico">◈</span><span><b>${esc(e.name)}</b><small>${esc(e.category)} · ${(e.versions||[]).length} versions</small></span></label>`;}).join('')||'<span class="lt-meta">No runtimes registered</span>'}</div></div>
    ${fld('Price monthly (cents)','priceMonthly','number',p.priceMonthly??0)}${fld('Price yearly (cents)','priceYearly','number',p.priceYearly??0)}
    ${fld('Currency','currency','text',p.currency||'USD')}${sel('Interval','interval',['monthly','yearly'],p.interval||'monthly')}
    ${fld('CPU cores','cpuCores','number',p.cpuCores??1,'min="1"')}${fld('Memory MB (total)','memoryMb','number',p.memoryMb??512,'min="128"')}
    ${fld('Disk GB (total)','diskGb','number',p.diskGb??4,'min="1"')}${fld('Network GB','networkGb','number',p.networkGb??0)}
    ${fld('Max services','instances','number',p.instances??3,'min="1"')}${fld('Sort order','sortOrder','number',p.sortOrder??0)}
    ${sel('Status','status',['published','unpublished','archived'],p.status||'published')}${fld('Features (comma separated)','features','text',(p.features||[]).join(', '))}
    <label class="lt-auth-terms"><input type="checkbox" name="featured" ${p.featured?'checked':''}> Featured</label>
    <label class="lt-auth-terms"><input type="checkbox" name="available" ${p.available!==false?'checked':''}> Available to customers</label>
  </form>`;
  const parse=(d,formEl)=>{
    d.features=String(d.features||'').split(',').map(x=>x.trim()).filter(Boolean);
    d.supportedRuntimes=formEl?[...formEl.querySelectorAll('input[name="supportedRuntimes"]:checked')].map(x=>x.value):[];
    d.productId=d.productId||null;d.featured=!!d.featured;d.available=!!d.available;return d;};
  const submitPlan=(title,body,ok,fn)=>{
    const promise=modal(title,body,{ok});
    const overlay=[...document.querySelectorAll('.lt-modal-overlay')].pop();
    return promise.then(async d=>{if(!d)return;
      const formEl=overlay?.querySelector('form')||null;
      try{await fn(parse(d,formEl));toast(ok==='Create'?'Plan created':'Saved','success');plans();}catch(e){toast(e.message,'error');}});
  };
  view.querySelector('#addPlan').addEventListener('click',()=>submitPlan('New plan',form(),'Create',api.adminCreatePlan));
  view.querySelectorAll('[data-pl]').forEach(b=>b.addEventListener('click',()=>{const p=pls.find(x=>x.id===b.dataset.pl);submitPlan(`Edit plan: ${p.name}`,form(p),'Save',(d)=>api.adminUpdatePlan(p.id,d));}));
  view.querySelectorAll('[data-pld]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Archive plan','Existing subscriptions are preserved.')){try{await api.adminDeletePlan(b.dataset.pld);toast('Archived','success');plans();}catch(e){toast(e.message,'error');}}}));
}

async function packages(){
  const view=root.querySelector('#aView');let pkgs=[],prods=[],envs=[];
  try{[pkgs,prods,envs]=await Promise.all([api.adminPackages(),api.adminProducts(),api.adminEnvironments()]);pkgs=pkgs.packages||[];prods=prods.products||[];envs=envs.environments||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Software packages</h1>
    <p class="lt-page-subtitle">What gets installed for each hosting product</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addPkg">+ New package</button></div></div>
    ${panel('Registry',`${pkgs.length} packages`,table(['ID','Name','Category','Product','Runtime','Versions','Status',''],pkgs.map(p=>`<tr>
      <td class="lt-td-mono">${esc(p.id)}</td><td class="lt-td-strong">${esc(p.name)}</td><td>${esc(p.category)}</td>
      <td>${esc((prods.find(x=>x.id===p.productId)||{}).name||'—')}</td><td>${esc(p.runtimeId||'—')}</td>
      <td class="lt-td-mono">${(p.versions||[]).join(', ')}</td><td>${badge(p.status)}</td>
      <td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-pkg="${esc(p.id)}">Edit</button></td></tr>`)))}`;
  const form=(p={})=>`<form id="pf">
    ${fld('Package ID','id','text',p.id||'','required pattern="[a-z0-9-]+"')}${fld('Name','name','text',p.name||'','required')}
    ${fld('Description','description','text',p.description||'')}
    ${sel('Product','productId',[{value:'',label:'Any'},...prods.map(x=>({value:x.id,label:x.name}))],p.productId||'')}
    ${sel('Runtime','runtimeId',[{value:'',label:'Auto'},...envs.map(e=>({value:e.id,label:e.name}))],p.runtimeId||'')}
    ${fld('Category','category','text',p.category||'application')}${fld('Install kind','installKind','text',p.installKind||'generic')}
    ${fld('Versions (comma)','versions','text',(p.versions||[]).join(', '))}
    ${fld('Startup template','startupTemplate','text',p.startupTemplate||'')}
    ${sel('Status','status',['published','draft','deprecated','disabled'],p.status||'published')}
  </form>`;
  const parse=d=>{d.versions=String(d.versions||'').split(',').map(x=>x.trim()).filter(Boolean);return d;};
  view.querySelector('#addPkg').addEventListener('click',async()=>{const d=await modal('New package',form(),{ok:'Create'});if(d){try{await api.adminCreatePackage(parse(d));toast('Package created','success');packages();}catch(e){toast(e.message,'error');}}});
  view.querySelectorAll('[data-pkg]').forEach(b=>b.addEventListener('click',async()=>{
    const p=pkgs.find(x=>x.id===b.dataset.pkg);
    const d=await modal('Edit package',form(p)+`<div class="lt-field" style="margin-top:12px"><label>Add version</label><input class="lt-input" id="newVer" placeholder="e.g. 1.21.4"></div>`,{ok:'Save'});
    if(!d)return;
    try{
      await api.adminUpdatePackage(p.id,parse(d));
      const v=document.querySelector('#newVer')?.value.trim();
      if(v)await api.adminPackageVersion(p.id,{version:v});
      toast('Saved','success');packages();
    }catch(e){toast(e.message,'error');}
  }));
}

async function compatibility(){
  const view=root.querySelector('#aView');let links=[],pkgs=[],prods=[];
  try{[links,pkgs,prods]=await Promise.all([api.adminCompatibility(),api.adminPackages(),api.adminProducts()]);links=links.links||[];pkgs=pkgs.packages||[];prods=prods.products||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Compatibility</h1>
    <p class="lt-page-subtitle">Which packages each hosting product may offer</p></div></div>
    ${panel('Links',`${links.length} combinations`,table(['Product','Package','Required',''],links.map(l=>`<tr>
      <td>${esc(l.product_name)}</td><td>${esc(l.package_name)}</td><td>${l.required?'Yes':'—'}</td>
      <td><button class="lt-btn lt-btn-danger lt-btn-sm" data-unlink="${esc(l.package_id)}|${esc(l.product_id)}">Remove</button></td></tr>`)))}
    ${panel('Add link','',`<div class="lt-field"><label>Package</label><select class="lt-select" id="cPkg">${pkgs.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="lt-field" style="margin-top:8px"><label>Product</label><select class="lt-select" id="cProd">${prods.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="lt-btn lt-btn-primary" id="addLink" style="margin-top:12px">Add compatibility</button>`)}`;
  view.querySelector('#addLink')?.addEventListener('click',async()=>{
    try{await api.adminSetCompatibility(view.querySelector('#cPkg').value,{productId:view.querySelector('#cProd').value});toast('Link added','success');compatibility();}catch(e){toast(e.message,'error');}
  });
  view.querySelectorAll('[data-unlink]').forEach(b=>b.addEventListener('click',()=>toast('Use package editor to change product links','info')));
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
  view.querySelectorAll('[data-n]').forEach(b=>b.addEventListener('click',async()=>{
    const x=n.find(y=>y.id===b.dataset.n);
    const promise=modal('Manage node',`<p style="font-size:13px">${esc(x.name)} · ${esc(x.host)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="lt-btn lt-btn-secondary" id="drain">${x.availability==='draining'?'Enable scheduling':'Drain node'}</button>
      <button type="button" class="lt-btn lt-btn-secondary" id="rot">Rotate token</button>
      <button type="button" class="lt-btn lt-btn-danger" id="rm">Remove</button></div>`,{ok:'Close'});
    const box=[...document.querySelectorAll('.lt-modal-overlay')].pop();
    const close=()=>box?.querySelector('[data-close]')?.click();
    box?.querySelector('#drain')?.addEventListener('click',async()=>{try{await api.drainNode(x.id);close();toast('Node availability updated','success');nodes();}catch(e){toast(e.message,'error');}});
    box?.querySelector('#rot')?.addEventListener('click',async()=>{try{const r=await api.nodeToken(x.id);close();await modal('New node token',`<div class="lt-console"><div class="lt-console-body" style="height:auto;padding:12px">${esc(r.token)}</div></div>`,{ok:'Done'});nodes();}catch(e){toast(e.message,'error');}});
    box?.querySelector('#rm')?.addEventListener('click',async()=>{if(!await confirmDialog('Remove node','Workloads on this node will be orphaned.'))return;try{await api.deleteNode(x.id);close();toast('Node removed','success');nodes();}catch(e){toast(e.message,'error');}});
    await promise;
  }));
}

async function deployments(){const view=root.querySelector('#aView');let d=[];try{d=(await api.deployments()).deployments;}catch{}view.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Deployments</h1></div>${panel('All deployments','',table(['ID','Instance','Status','Source','Version','Time'],d.map(x=>`<tr><td class="lt-td-mono">${esc(x.id)}</td><td>${esc(x.instanceName||x.instanceId)}</td><td>${badge(x.status)}</td><td>${esc(x.source)}</td><td class="lt-td-mono">${esc(x.version)}</td><td>${fmtTime(x.createdAt)}</td></tr>`)))}`;}
async function orders(){
  const view=root.querySelector('#aView');let o=[];try{o=(await api.adminOrders()).orders||[];}catch{}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Orders & provisioning</h1><p class="lt-page-subtitle">Every purchase, payment and workload from order to container</p></div></div>
    ${panel('Orders',`${o.length} total`,table(['Order','Customer','Plan / product','Service','Status','Attempts','Total','Date',''],o.map(x=>`<tr>
      <td class="lt-td-mono">${esc(x.id)}</td><td class="lt-td-mono">${esc(x.teamId)}</td>
      <td>${esc(x.planSnapshot?.name||x.planId||'Custom')}${x.productId?` · ${esc(x.productId)}`:''}</td>
      <td>${esc(x.serviceName)}</td><td>${badge(x.status)}</td><td>${x.provisionAttempts}</td>
      <td>${fmtMoney(x.total,x.currency)}</td><td>${fmtAgo(x.createdAt)}</td>
      <td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-o="${esc(x.id)}">Inspect</button></td></tr>`)))}`;
  view.querySelectorAll('[data-o]').forEach(b=>b.addEventListener('click',async()=>openAdminOrder(b.dataset.o)));
}

async function openAdminOrder(id){
  let r;try{r=await api.adminOrder(id);}catch(e){toast(e.message,'error');return;}
  const o=r.order;
  const timeline=(o.events||[]).map(e=>`<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--lt-border);font-size:12px"><span class="lt-td-mono">${fmtTime(e.ts)}</span><b>${esc(e.status)}</b><span class="lt-meta">${esc(e.message)}</span></div>`).join('');
  const body=`<div style="font-size:12px;display:grid;gap:6px">
    <div><b>Order</b> <span class="lt-td-mono">${esc(o.id)}</span></div>
    <div><b>Customer</b> <span class="lt-td-mono">${esc(o.teamId)}</span></div>
    <div><b>Plan snapshot</b> <pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(o.planSnapshot,null,2))}</pre></div>
    <div><b>Workload</b> ${esc(o.instanceId||'not created')} · Runtime ${esc(o.environmentId||'—')} ${esc(o.runtimeVersion||'')}</div>
    <div><b>Payment</b> ${esc(o.provider||'none')} · ${esc(o.status)} · ${fmtMoney(o.total,o.currency)}</div>
    ${o.failureReason?`<div class="lt-badge lt-badge-danger">${esc(o.failureReason)}</div>`:''}</div>
    <div style="margin-top:14px"><b>Timeline</b>${timeline}</div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      ${o.total===0&&o.status==='awaiting_payment'?`<button type="button" class="lt-btn lt-btn-primary lt-btn-sm" id="oApprove">Approve free order</button>`:''}
      ${['failed','paid'].includes(o.status)?`<button type="button" class="lt-btn lt-btn-secondary lt-btn-sm" id="oRetry">Retry provisioning</button>`:''}
      ${['awaiting_payment','payment_processing','failed'].includes(o.status)?`<button type="button" class="lt-btn lt-btn-danger lt-btn-sm" id="oCancel">Cancel</button>`:''}
    </div>`;
  const promise=modal(`Order ${o.id}`,body,{ok:'Close'});
  const box=[...document.querySelectorAll('.lt-modal-overlay')].pop();
  const close=()=>box?.querySelector('[data-close]')?.click();
  box?.querySelector('#oApprove')?.addEventListener('click',async()=>{try{await api.adminApproveOrder(o.id);close();toast('Order approved and provisioning started','success');orders();}catch(e){toast(e.message,'error');}});
  box?.querySelector('#oRetry')?.addEventListener('click',async()=>{try{await api.adminRetryOrder(o.id);close();toast('Provisioning retried','success');orders();}catch(e){toast(e.message,'error');}});
  box?.querySelector('#oCancel')?.addEventListener('click',async()=>{if(!await confirmDialog('Cancel order','This cannot be undone.'))return;try{await api.adminCancelOrder(o.id);close();toast('Order cancelled','success');orders();}catch(e){toast(e.message,'error');}});
  await promise;
}

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
async function system(){
  const view=root.querySelector('#aView');let s={};
  if(sessionStorage.getItem('lt_restarted')){sessionStorage.removeItem('lt_restarted');toast('Server restarted successfully','success');}
  try{s=(await api.adminSystem()).system||{};}catch(e){view.innerHTML=`<div class="lt-error">${esc(e.message)}</div>`;return;}
  const uptime=s.uptime||0;const days=Math.floor(uptime/86400),hours=Math.floor((uptime%86400)/3600),mins=Math.floor((uptime%3600)/60);
  let tunnelRows='<p class="lt-meta">Loading…</p>';
  try{
    const t=await fetch('/api/features/cloudflare/tunnels',{headers:{Authorization:'Bearer '+api.token()}}).then(r=>r.json());
    const cap=t.capabilities||{};
    tunnelRows=`<p class="lt-meta">${esc(cap.hint||'')}</p>`+
      (t.tunnels||[]).length?table(['Hostname','Tunnel ID','Status','Service'],t.tunnels.map(x=>`<tr><td class="lt-td-strong">${esc(x.hostname)}</td><td class="lt-td-mono">${esc((x.tunnelId||'').slice(0,12))}</td><td>${badge(x.status)}</td><td class="lt-td-mono">${esc(x.domainId||'')}</td></tr>`)):
      '<p class="lt-meta">No application tunnels yet.</p>';
  }catch(e){tunnelRows=`<p class="lt-meta">${esc(e.message)}</p>`;}
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Platform status</h1>
    <p class="lt-page-subtitle">Control plane runtime and safe restart</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-danger" id="restartPlatform">Restart platform</button></div></div>
    ${panel('Control plane','',`<div class="admin-grid admin-grid-4">
      ${[['Status','online','success'],['Uptime',`${days}d ${hours}h ${mins}m`,'info'],['Node',s.node||'—','info'],['Environment',s.env||'—','info']]
        .map(([l,v,c])=>`<div class="lt-card"><div class="lt-label">${l}</div><div class="admin-stat-value" style="margin-top:8px">${esc(v)}</div></div>`).join('')}
    </div><p class="lt-meta" style="margin-top:14px">PID ${esc(s.pid||'—')} · ${esc(s.platform||'')} · version ${esc(s.version||'1.0.0')}</p>`)}
    ${panel('Restart','',`<p class="lt-meta">Restarting reloads environment variables, settings and configuration changes. Active requests are dropped; Shade workloads keep running and reconnect automatically.</p>
      <p class="lt-meta" style="margin-top:8px">The panel will go offline for a few seconds and return automatically.</p>`)}
    ${panel('Cloudflare tunnels','',tunnelRows)}`;
  view.querySelector('#restartPlatform').addEventListener('click',async()=>{
    if(!await confirmDialog('Restart platform','The control plane will restart. Services continue running. Confirm?'))return;
    try{
      await api.restartSystem();
      toast('Server restarting — the panel will reconnect shortly','success');
      let tries=0;
      const wait=setInterval(async()=>{
        try{const r=await fetch('/health');if(r.ok){clearInterval(wait);sessionStorage.setItem('lt_restarted','1');location.reload();}}catch{}
        if(++tries>40){clearInterval(wait);toast('Still restarting — refresh manually','warning');}
      },1500);
    }catch(e){toast(e.message,'error');}
  });
}

async function settings(){
  const view=root.querySelector('#aView');let s={};
  try{s=(await api.adminSettings()).settings||{};}catch(e){view.innerHTML=`<div class="lt-error">${esc(e.message)}</div>`;return;}
  const sections={general:'General & platform',payments:'Payments',cloudflare:'Cloudflare tunnels',mail:'Email / mail delivery',proxy:'Reverse proxy & TLS',runtime:'Runtime image'};
  const fieldFor=(k,m)=>{
    const v=m.value??'';
    if(m.type==='bool')return `<label class="lt-auth-terms"><input type="checkbox" name="${esc(k)}" ${String(v)==='true'?'checked':''}> ${esc(m.label)}</label>`;
    return fld(m.label,k,m.type==='secret'?'password':'text',v,m.type==='secret'?'autocomplete="new-password"':'');
  };
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Platform settings</h1>
    <p class="lt-page-subtitle">Edit every configurable integration. Secrets are masked — leave blank to keep the current value.</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="saveSettings">Save changes</button></div></div>
    <form id="settingsForm" class="admin-grid admin-grid-2">
    ${Object.entries(sections).map(([key,title])=>{
      const keys=Object.entries(s).filter(([k,m])=>m.section===key);
      return keys.length?panel(title,'',keys.map(([k,m])=>fieldFor(k,m)).join('')):'';
    }).join('')}
    </form>
    <p class="lt-meta" style="margin-top:12px">Ownership attribution is embedded in the software and cannot be changed here. All settings apply immediately — no restart required.</p>`;
  view.querySelector('#saveSettings').addEventListener('click',async()=>{
    const form=view.querySelector('#settingsForm');const values={};
    for(const el of form.elements){if(!el.name)continue;values[el.name]=el.type==='checkbox'?el.checked:el.value;}
    try{const r=await api.updateAdminSettings(values);toast('Settings saved','success');
      if(r.appliedImmediately)toast('Settings applied immediately','success');
      settings();
    }catch(e){toast(e.message,'error');}
  });
}

async function analytics(){
  const view=root.querySelector('#aView');let a;
  try{a=await api.analytics();}catch(e){view.innerHTML=`<div class="lt-error">${esc(e.message)}</div>`;return;}
  const s=a.summary||{};
  const cards=[['Users',s.users,'registered'],['Workspaces',s.teams,'total'],['Services',s.instances,`${s.runningInstances} running`],
    ['Nodes online',`${s.nodesOnline}/${s.nodes}`,'connected'],['Open tickets',s.openTickets,'awaiting reply'],
    ['Revenue',fmtMoney(s.revenueCents||0),`${s.paidTransactions||0} paid transactions`]]
    .map(([l,v,x])=>`<div class="lt-card admin-stat"><div class="lt-label">${l}</div><div class="admin-stat-value" style="margin-top:8px">${esc(v)}</div><div class="lt-meta">${esc(x)}</div></div>`).join('');
  const spark=(series,color)=>{const max=Math.max(1,...series.map(x=>x.count||x.amount||0));return `<div class="admin-spark">${series.map(x=>{const v=x.count??x.amount??0;return `<div class="admin-spark-bar" style="height:${Math.max(2,Math.round(v/max*100))}%;background:${color}" title="${esc(x.day)}: ${v}"></div>`;}).join('')}</div>`;};
  const dist=(rows,key='count')=>rows?.length?rows.map(r=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--lt-border);font-size:12px"><span>${esc(r.status||r.category||r.plan_id||r.priority||'—')}</span><strong>${r[key]}</strong></div>`).join(''):'<p class="lt-meta">No data</p>';
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Analytics</h1><p class="lt-page-subtitle">Platform-wide metrics from persisted data</p></div></div>
    <div class="admin-grid admin-grid-4" style="margin-bottom:14px">${cards}</div>
    <div class="admin-grid admin-grid-2">
      ${panel('Signups · last 30 days','',spark(a.signups||[],'var(--lt-ember-500)'))}
      ${panel('Revenue · last 30 days','',spark(a.revenue||[],'var(--lt-success, #4C9B8A)'))}
      ${panel('Services by category','',dist(a.instancesByCategory))}
      ${panel('Services by status','',dist(a.instancesByStatus))}
      ${panel('Subscriptions by plan','',dist(a.subscriptionsByPlan))}
      ${panel('Tickets by priority','',dist(a.ticketsByPriority))}
      ${panel('Nodes','',table(['Node','Region','Status','Workloads','CPU','Memory'],(a.nodes||[]).map(n=>`<tr><td class="lt-td-strong">${esc(n.name)}</td><td>${esc(n.region)}</td><td>${badge(n.status)}</td><td>${n.workloads}</td><td>${Math.round(n.cpu_used)}%</td><td>${Math.round(n.mem_used)}%</td></tr>`)))}
      ${panel('Recent activity','',table(['Time','Action','Target'],(a.recentActivity||[]).map(x=>`<tr><td class="lt-td-mono">${fmtTime(x.ts)}</td><td>${esc(x.action)}</td><td class="lt-td-mono">${esc(x.target_id||'—')}</td></tr>`)))}
    </div>`;
  poll(async()=>{if(currentView==='analytics')await analytics();},30000);
}

async function support(){
  const view=root.querySelector('#aView');let t=[];
  try{t=(await api.adminTickets()).tickets||[];}catch{}
  const rows=t.map(x=>`<tr><td class="lt-td-strong">${esc(x.subject)}</td><td>${esc(x.userEmail||'—')}</td><td>${esc(x.category)}</td>
    <td><span class="admin-badge ${x.priority==='urgent'||x.priority==='high'?'danger':x.priority==='low'?'neutral':'warning'}">${esc(x.priority)}</span></td>
    <td>${badge(x.status)}</td><td>${x.messageCount}</td><td>${fmtAgo(x.updatedAt)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-t="${esc(x.id)}">Open</button></td></tr>`).join('');
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Support tickets</h1><p class="lt-page-subtitle">${t.length} customer requests</p></div></div>
    ${panel('All tickets','',table(['Subject','Customer','Category','Priority','Status','Msgs','Updated',''],rows))}`;
  view.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',async()=>openAdminTicket(b.dataset.t)));
}

async function openAdminTicket(id){
  let t;try{t=(await api.adminTicket(id)).ticket;}catch(e){toast(e.message,'error');return;}
  const msgs=t.messages.map(m=>`<div style="padding:10px 0;border-bottom:1px solid var(--lt-border)"><div style="display:flex;justify-content:space-between"><strong>${m.isStaff?'Staff':esc(m.author?.email||'Customer')}</strong><span class="lt-meta">${fmtTime(m.createdAt)}</span></div><div style="font-size:13px;line-height:1.6;margin-top:5px;white-space:pre-wrap">${esc(m.message)}</div></div>`).join('');
  const body=`<div style="max-height:240px;overflow:auto;margin-bottom:14px">${msgs||'<p class="lt-meta">No messages.</p>'}</div>
    <form id="tf">${sel('Status','status',['open','pending','closed'],t.status)}${sel('Priority','priority',['low','normal','high','urgent'],t.priority)}<div class="lt-field"><label>Reply</label><textarea class="lt-textarea" name="message" placeholder="Write a reply…"></textarea></div></form>`;
  const d=await modal(`Ticket: ${t.subject}`,body,{ok:'Update & reply'});
  if(!d)return;
  try{
    if(d.status!==t.status||d.priority!==t.priority)await api.adminUpdateTicket(id,{status:d.status,priority:d.priority});
    if(d.message?.trim())await api.adminReplyTicket(id,d.message);
    toast('Ticket updated','success');support();
  }catch(e){toast(e.message,'error');}
}

async function notifications(){
  const view=root.querySelector('#aView');let r={notifications:[],unread:0};
  try{r=await api.notifications(200);}catch{}
  const rows=r.notifications.map(n=>`<tr><td>${badge(n.type)}</td><td class="lt-td-strong">${esc(n.title)}</td><td>${esc(n.message)}</td><td>${n.read?'read':badge('pending')}</td><td>${fmtTime(n.createdAt)}</td></tr>`).join('');
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Notifications</h1><p class="lt-page-subtitle">${r.unread} unread</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-secondary" id="nReadAll">Mark all read</button><button class="lt-btn lt-btn-primary" id="nBroadcast">Broadcast</button></div></div>
    ${panel('Notification feed','',table(['Type','Title','Message','State','Created'],rows))}`;
  view.querySelector('#nReadAll').addEventListener('click',async()=>{try{await api.markAllNotificationsRead();await loadAdminUnread();notifications();toast('Done','success');}catch(e){toast(e.message,'error');}});
  view.querySelector('#nBroadcast').addEventListener('click',async()=>{
    const d=await modal('Broadcast notification',fld('Title','title','text','','required')+ta('Message','message')+sel('Type','type',['info','success','warning','danger'])+`<label class="lt-auth-terms"><input type="checkbox" name="broadcast" checked> Send to all active users</label>`,{ok:'Send'});
    if(!d)return;d.broadcast=!!d.broadcast;
    try{await api.broadcastNotification(d);toast('Broadcast sent','success');notifications();}catch(e){toast(e.message,'error');}
  });
}

async function roles(){
  const view=root.querySelector('#aView');let roles=[],perms=[];
  try{[roles,perms]=await Promise.all([api.roles(),api.permissions()]);roles=roles.roles||[];perms=perms.permissions||[];}catch{}
  const rows=roles.map(r=>`<tr><td class="lt-td-strong">${esc(r.name)} ${r.system?badge('active'):''}</td><td>${esc(r.description||'—')}</td>
    <td class="lt-td-mono" style="max-width:420px;white-space:normal">${(r.permissions||[]).map(p=>`<span class="admin-badge neutral" style="margin:1px">${esc(p)}</span>`).join('')||'—'}</td>
    <td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-r="${esc(r.id)}">Edit</button>${r.system?'':` <button class="lt-btn lt-btn-danger lt-btn-sm" data-rd="${esc(r.id)}">Delete</button>`}</td></tr>`).join('');
  view.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Roles & access</h1><p class="lt-page-subtitle">Custom roles grant a subset of administrative permissions</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addRole">+ New role</button></div></div>
    ${panel('Roles','',table(['Role','Description','Permissions',''],rows))}
    <p class="lt-meta" style="margin-top:12px">The built-in administrator role always has every permission and cannot be edited. System roles cannot be deleted.</p>`;
  const form=(r={})=>`<form id="rf">${fld('Role ID','name','text',r.id||'','required pattern="[a-z0-9_-]+"')}${fld('Description','description','text',r.description||'')}
    <div class="lt-field"><label>Permissions</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;max-height:220px;overflow:auto;border:1px solid var(--lt-border);border-radius:8px;padding:10px">
    ${perms.map(p=>`<label class="lt-auth-terms" style="font-size:11px"><input type="checkbox" name="permissions" value="${esc(p)}" ${(r.permissions||[]).includes(p)?'checked':''}> ${esc(p)}</label>`).join('')}</div></div></form>`;
  view.querySelector('#addRole').addEventListener('click',async()=>{const d=await modal('New role',form(),{ok:'Create'});if(!d)return;
    d.permissions=Array.isArray(d.permissions)?d.permissions:[d.permissions].filter(Boolean);
    try{await api.createRole(d);toast('Role created','success');roles();}catch(e){toast(e.message,'error');}});
  view.querySelectorAll('[data-r]').forEach(b=>b.addEventListener('click',async()=>{const r=roles.find(x=>x.id===b.dataset.r);const d=await modal(`Edit role: ${r.name}`,form(r),{ok:'Save'});if(!d)return;
    d.permissions=Array.isArray(d.permissions)?d.permissions:[d.permissions].filter(Boolean);
    try{await api.updateRole(r.id,d);toast('Role saved','success');roles();}catch(e){toast(e.message,'error');}}));
  view.querySelectorAll('[data-rd]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Delete role','Users assigned to this role must be reassigned first.')){
    try{await api.deleteRole(b.dataset.rd);toast('Role deleted','success');roles();}catch(e){toast(e.message,'error');}}}));
}

window.addEventListener('hashchange',route);
async function boot(){
  let me;
  try{me=await api.me();}catch{api.setToken('');location.href='/login';return;}
  admin=me.user;adminPermissions=me.permissions||[];adminImpersonatedBy=me.impersonatedBy||null;
  if(!can('admin.access')){location.href='/login';return;}
  shell();route();
}
window.addEventListener('lt:unauthorized', () => {
  admin = null; adminPermissions = [];
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  api.setToken('');
  location.href = '/login';
});
boot();
