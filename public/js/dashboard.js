// .light — new customer dashboard application. Rebuilt from scratch.
import api from '/js/api.js';
import { ASSETS, iconImg, brandMark } from '/js/assets.js';

const app = document.getElementById('app');
const overlays = document.getElementById('overlay-root');
let session = null, brand = {}, pollTimer = null, currentView = null, currentParam = null;
let serversState = { search: '', category: 'all', status: 'all', sort: 'name', dir: 1, page: 1, per: 10 };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtBytes = (b) => { b = Number(b || 0); if (b > 1073741824) return (b/1073741824).toFixed(1)+' GB'; if (b > 1048576) return (b/1048576).toFixed(1)+' MB'; return b+' B'; };
const fmtTime = (ts) => ts ? new Date(ts).toLocaleString() : '—';
const fmtAgo = (ts) => { if (!ts) return 'never'; const s=Math.floor((Date.now()-ts)/1000); if(s<60)return s+'s'; if(s<3600)return Math.floor(s/60)+'m'; if(s<86400)return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d'; };
const STATUS = { running:'success', online:'success', ready:'success', success:'success', active:'success', stopped:'neutral', offline:'neutral', suspended:'warning', draining:'warning', deploying:'warning', pending:'info', creating:'info', queued:'info', error:'danger', failed:'danger', missing:'danger' };
const badge = (s) => { const c=STATUS[s]||'neutral'; return `<span class="lt-badge lt-badge-${c}"><span class="lt-dot lt-dot-${c}"></span>${esc(s?s.charAt(0).toUpperCase()+s.slice(1):'Unknown')}</span>`; };

function toast(msg, type='info') {
  const el=document.createElement('div'); el.className='lt-toast '+(type==='error'?'is-error':'');
  el.innerHTML=`<span class="lt-dot lt-dot-${type==='error'?'danger':type==='warning'?'warning':'success'}"></span><span>${esc(msg)}</span>`;
  let stack=overlays.querySelector('.lt-toast-stack'); if(!stack){stack=document.createElement('div');stack.className='lt-toast-stack';overlays.appendChild(stack);} stack.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),300);},3500);
}
function modal(title, body, opts={}) {
  return new Promise((resolve)=>{
    const o=document.createElement('div'); o.className='lt-modal-overlay';
    const formBody=body.includes('<form')?body:`<form id="modalForm">${body}</form>`;
    o.innerHTML=`<div class="lt-modal" role="dialog" aria-modal="true"><div class="lt-modal-header"><h3 class="lt-h3">${esc(title)}</h3><button class="lt-btn lt-btn-ghost lt-btn-icon" data-close>✕</button></div><div class="lt-modal-body">${formBody}</div><div class="lt-modal-footer">${opts.danger?`<button class="lt-btn lt-btn-danger" data-confirm>${esc(opts.confirm||'Delete')}</button>`:`<button class="lt-btn lt-btn-ghost" data-close>Cancel</button><button class="lt-btn lt-btn-primary" data-confirm>${esc(opts.confirm||'Save')}</button>`}</div></div>`;
    overlays.appendChild(o);
    const close=(v)=>{o.remove();resolve(v);};
    o.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(null)));
    o.querySelector('[data-confirm]')?.addEventListener('click',()=>{const f=o.querySelector('form');if(f){if(!f.reportValidity())return;close(Object.fromEntries(new FormData(f).entries()));}else close(true);});
    o.addEventListener('click',e=>{if(e.target===o)close(null);});
  });
}
const confirmDialog=(t,m)=>modal(t,`<p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6">${esc(m)}</p>`,{danger:true,confirm:'Confirm'});
const field=(l,n,t='text',v='',x='')=>`<div class="lt-field"><label for="f-${n}">${esc(l)}</label><input class="lt-input" id="f-${n}" name="${n}" type="${t}" value="${esc(v)}" ${x}></div>`;
const selectField=(l,n,opts,sel='')=>`<div class="lt-field"><label for="f-${n}">${esc(l)}</label><select class="lt-select" id="f-${n}" name="${n}">${opts.map(o=>{const v=typeof o==='string'?o:o.value,t=typeof o==='string'?o:o.label;return `<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(t)}</option>`;}).join('')}</select></div>`;
const textarea=(l,n,v='')=>`<div class="lt-field"><label for="f-${n}">${esc(l)}</label><textarea class="lt-textarea" id="f-${n}" name="${n}">${esc(v)}</textarea></div>`;
const loading=()=>'<div class="lt-loading"><span class="lt-spinner"></span>Loading…</div>';
const empty=(t,d,a='')=>`<div class="lt-empty"><div class="lt-empty-icon">◇</div><div class="lt-empty-title">${esc(t)}</div><div class="lt-empty-desc">${esc(d)}</div>${a}</div>`;
const errState=(e)=>`<div class="lt-error">${esc(e.message||e)}</div>`;
const section=(t,s,c,a='')=>`<div class="lt-card"><div class="lt-card-header"><div><h3 class="lt-h3">${esc(t)}</h3>${s?`<div class="lt-meta">${esc(s)}</div>`:''}</div>${a}</div><div class="lt-card-body">${c}</div></div>`;

/* ---------- auth ---------- */
function renderAuth(mode='login') {
  stopPoll();
  const reg=mode==='register';
  app.innerHTML=`<div class="lt-auth"><section class="lt-auth-brand-panel"><div class="lt-auth-brand-inner">
    <a href="/site.html" class="lt-auth-logo">${brandMark(40)}<span>${esc(brand.product||'.light')}</span></a>
    <div class="lt-auth-visual" aria-hidden="true"><div class="v-glow"></div><div class="v-ring"></div><div class="v-ring alt"></div><div class="v-stack">
      <div class="lt-auth-node"><div class="row"><span class="led"></span><span class="lt-meta">node-01 · online</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
      <div class="lt-auth-node"><div class="row"><span class="led"></span><span class="lt-meta">node-02 · online</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
      <div class="lt-auth-node warn"><div class="row"><span class="led"></span><span class="lt-meta">services · monitored</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
    </div></div>
    <div class="lt-auth-pitch"><h1>Your infrastructure.<br><span class="hl">Without the complexity.</span></h1><p>Deploy, manage and scale your servers and applications from one place.</p></div>
    <div class="lt-auth-brand-foot">${esc(brand.attribution||'.light POWERED BY TRYCORD')} · ${esc(brand.domain||'trycord.dev')}</div>
  </div></section>
  <section class="lt-auth-form-panel"><div class="lt-auth-form-wrap">
    <div class="lt-auth-mobile-logo">${brandMark(34)}<span>${esc(brand.product||'.light')}</span></div>
    <div class="lt-auth-tabs"><button class="lt-auth-tab ${reg?'':'active'}" data-mode="login">Sign in</button><button class="lt-auth-tab ${reg?'active':''}" data-mode="register">Create account</button></div>
    <h2 class="lt-auth-title">${reg?'Create your account':'Welcome back'}</h2>
    <p class="lt-auth-sub">${reg?'Deploy and manage your hosting services.':`Sign in to your ${esc(brand.product||'.light')} account.`}</p>
    <form id="authForm" novalidate>
      ${reg?field('Username','username','text','','autocomplete="username" required pattern="[a-zA-Z0-9_]+" placeholder="your_username"'):''}
      ${reg?field('Email','email','email','','autocomplete="email" required placeholder="you@example.com"'):`<div class="lt-field"><label for="f-email">Username or email</label><input class="lt-input" id="f-email" name="email" type="text" autocomplete="username" required placeholder="you@example.com or username"></div>`}
      <div class="lt-field"><label for="f-password">Password</label><div class="lt-input-wrap"><input class="lt-input" id="f-password" name="password" type="password" autocomplete="${reg?'new-password':'current-password'}" required minlength="${reg?10:1}" placeholder="${reg?'At least 10 characters':'Enter your password'}"><button type="button" class="lt-auth-eye" id="togglePw" aria-label="Show password">◉</button></div></div>
      ${reg?`<label class="lt-auth-terms"><input type="checkbox" name="acceptTerms" required><span>I accept the <a href="/legal.html" target="_blank">Terms of Service</a> and <a href="/legal.html" target="_blank">Privacy Policy</a>.</span></label>`:`<div style="text-align:right;margin:-2px 0 8px"><button type="button" id="forgotBtn" class="lt-auth-link">Forgot password?</button></div>`}
      <div class="lt-auth-error" id="authError" role="alert"></div>
      <button class="lt-btn lt-btn-primary" type="submit" style="width:100%;margin-top:8px">${reg?'Create account':'Sign in'}</button>
    </form>
    ${!reg?`<div class="lt-auth-divider">or continue with</div><div class="lt-field"><label for="f-sso">Organization email (SSO)</label><input class="lt-input" id="f-sso" type="email" placeholder="you@company.com"></div><button class="lt-btn lt-btn-secondary" id="ssoBtn" style="width:100%">${esc(brand.sso?.label||'Continue with SSO')}</button>`:''}
    <div class="lt-auth-footer">${esc(brand.attribution||'.light POWERED BY TRYCORD')} · ${esc(brand.tagline||'Universal hosting platform')}<div class="lt-auth-watermark"><span class="lt-wm-mark">ΔΓΟ</span> <a href="${esc(brand.watermark?.source||'https://trycord.dev')}" target="_blank">${esc(brand.watermark?.short||'POWERED BY TRYCORD')}</a></div></div>
  </div></section></div>`;
  app.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>renderAuth(b.dataset.mode)));
  app.querySelector('#togglePw')?.addEventListener('click',()=>{const i=app.querySelector('#f-password'),b=app.querySelector('#togglePw');const s=i.type==='password';i.type=s?'text':'password';b.textContent=s?'◌':'◉';});
  app.querySelector('#forgotBtn')?.addEventListener('click',async()=>{const d=await modal('Reset password',field('Email or username','identity','text','','required'),{confirm:'Send link'});if(!d)return;try{const r=await api.forgotPassword(d.identity);toast(r.ok?'Reset link sent':(r.message||'Email disabled — contact administrator'),r.ok?'success':'info');}catch(e){toast(e.message,'error');}});
  app.querySelector('#ssoBtn')?.addEventListener('click',()=>{const s=brand.sso||{},email=app.querySelector('#f-sso')?.value.trim();if(!s.enabled||!s.url){toast('SSO not configured — contact your administrator','info');return;}if(!email){toast('Enter your organization email','warning');return;}location.href=s.url+(s.url.includes('?')?'&':'?')+'login_hint='+encodeURIComponent(email);});
  app.querySelector('#authForm').addEventListener('submit',async(e)=>{
    e.preventDefault();const f=e.target,data=Object.fromEntries(new FormData(f).entries()),err=app.querySelector('#authError'),btn=f.querySelector('[type=submit]');
    err.textContent='';btn.disabled=true;btn.textContent='Please wait…';
    try{const r=mode==='register'?await api.register(data):await api.login(data);api.setToken(r.token);session=await api.me();
      if(r.verifyRequired||session.user?.emailVerified===false){location.hash='#/verify';renderShell();await navigate();toast('Check your email to verify','info');return;}
      location.hash='#/overview';renderShell();navigate();toast(mode==='register'?'Account created':'Signed in','success');
    }catch(error){err.textContent=error.message;}finally{btn.disabled=false;btn.textContent=mode==='register'?'Create account':'Sign in';}
  });
}

const NAV=[
  {group:'Overview',items:[{v:'overview',label:'Dashboard',i:'monitoring'}]},
  {group:'Hosting',items:[{v:'servers',label:'All Servers',i:'instances'},{v:'game',label:'Game Servers',i:'game-servers'},{v:'web',label:'Applications',i:'applications'},{v:'websites',label:'Websites',i:'network'},{v:'database',label:'Databases',i:'storage'}]},
  {group:'Management',items:[{v:'deployments',label:'Deployments',i:'schedules'},{v:'domains',label:'Domains',i:'network'},{v:'backups',label:'Backups',i:'backups'},{v:'schedules',label:'Schedules',i:'schedules'},{v:'files',label:'Files',i:'storage'}]},
  {group:'Account',items:[{v:'usage',label:'Usage & Resources',i:'monitoring'},{v:'billing',label:'Billing & Plans',i:'settings'},{v:'notifications',label:'Notifications',i:'settings'},{v:'support',label:'Support',i:'security'},{v:'settings',label:'Settings',i:'settings'},{v:'admin',label:'Administration',i:'security',admin:true}]},
];

function renderShell(){
  const nav=NAV.map(g=>{const items=g.items.filter(i=>!i.admin||session.user.role==='admin');if(!items.length)return '';
    return `<nav class="lt-nav-section"><div class="lt-nav-section-label">${esc(g.group)}</div>${items.map(i=>`<a class="lt-nav-item" href="#/${i.v}" data-nav="${i.v}">${iconImg(i.i,17)}<span>${esc(i.label)}</span></a>`).join('')}</nav>`;}).join('');
  app.innerHTML=`<div class="lt-shell">
    <aside class="lt-sidebar" id="sidebar"><a class="lt-brand" href="#/overview">${brandMark(32)}<span class="lt-brand-word">${esc(brand.product||'.light')}<span class="lt-brand-sub">${esc((brand.tagline||'Universal hosting platform').split(' ')[0])}</span></span></a>${nav}
    <div class="lt-nav-footer"><div class="lt-watermark"><span class="lt-wm-mark">ΔΓΟ</span> <a href="https://trycord.dev" target="_blank">POWERED BY TRYCORD</a></div></div></aside>
    <div class="lt-scrim" id="scrim" style="display:none"></div>
    <div class="lt-main"><header class="lt-topbar">
      <button class="lt-btn lt-btn-ghost lt-btn-icon lt-sidebar-toggle" id="navToggle">☰</button>
      <div class="lt-breadcrumb"><span>${esc(brand.product||'.light')}</span><span class="sep">/</span><span class="cur" id="crumb">Dashboard</span></div>
      <div class="lt-topbar-spacer"></div>
      <div class="lt-global-search"><input id="globalSearch" placeholder="Search servers, domains…" aria-label="Search"></div>
      <button class="lt-icon-btn" id="notifBtn" title="Notifications" style="position:relative">🔔<span class="lt-badge-count" id="notifCount" style="display:none">0</span></button>
      <a class="lt-icon-btn" href="/docs.html" title="Help">?</a>
      <div class="lt-user-menu"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="userBtn">${esc(session.user.name||session.user.username||session.user.email)} ▾</button></div>
    </header><main class="lt-content" id="view">${loading()}</main></div></div>`;
  app.querySelector('#navToggle')?.addEventListener('click',()=>{const s=app.querySelector('#sidebar'),sc=app.querySelector('#scrim');const open=s.classList.toggle('is-open');sc.style.display=open?'block':'none';});
  app.querySelector('#scrim')?.addEventListener('click',()=>{app.querySelector('#sidebar').classList.remove('is-open');app.querySelector('#scrim').style.display='none';});
  app.querySelector('#userBtn').addEventListener('click',(e)=>{e.stopPropagation();const ex=app.querySelector('.lt-user-menu-panel');if(ex){ex.remove();return;}const p=document.createElement('div');p.className='lt-user-menu-panel';p.innerHTML=`<div class="lt-menu-label">${esc(session.user.email)}</div><a href="#/settings">Settings</a><a href="#/admin" ${session.user.role!=='admin'?'style="display:none"':''}>Administration</a><a href="/site.html">Public site</a><button id="logoutBtn">Sign out</button>`;app.querySelector('.lt-user-menu').appendChild(p);p.querySelector('#logoutBtn').addEventListener('click',async()=>{await api.logout().catch(()=>{});api.setToken('');session=null;renderAuth('login');});setTimeout(()=>{const h=(ev)=>{if(!ev.target.closest('.lt-user-menu')){p.remove();document.removeEventListener('click',h);}};document.addEventListener('click',h);},0);});
  app.querySelector('#globalSearch')?.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&e.target.value.trim()){serversState.search=e.target.value.trim();location.hash='#/servers';setTimeout(()=>renderServers(),50);}});
}
function setActive(v){app.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===v));const labels={overview:'Dashboard',servers:'All Servers',game:'Game Servers',web:'Applications',websites:'Websites',database:'Databases',deployments:'Deployments',domains:'Domains',backups:'Backups',schedules:'Schedules',files:'Files',usage:'Usage & Resources',billing:'Billing & Plans',notifications:'Notifications',support:'Support',settings:'Settings',admin:'Administration',server:'Server',verify:'Verify',reset:'Reset'};const c=app.querySelector('#crumb');if(c)c.textContent=labels[v]||v;}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
function poll(fn,ms=8000){stopPoll();pollTimer=setInterval(()=>{if(currentView&&session)fn().catch(()=>{});},ms);}
function parseHash(){const raw=(location.hash||'#/overview').replace(/^#\/?/,'');const [p,q]=raw.split('?');const [v,param]=p.split('/');return{v:v||'overview',param,query:new URLSearchParams(q||'')};}

/* ---------- router ---------- */
async function navigate(){if(!session)return;const{v,param,query}=parseHash();setActive(v);stopPoll();currentView=v;currentParam=param;const view=app.querySelector('#view');if(!view)return;
  const R={overview:renderOverview,servers:renderServers,game:()=>renderServers('game'),web:()=>renderServers('web'),websites:()=>renderServers('website'),database:()=>renderServers('database'),deployments:renderDeployments,domains:renderDomains,backups:renderBackups,schedules:renderSchedules,files:renderFiles,usage:renderUsage,billing:renderBilling,notifications:renderNotifications,support:renderSupport,settings:renderSettings,admin:renderAdmin,server:()=>renderServer(param),verify:()=>renderVerify(query),reset:()=>renderReset(query)};
  view.innerHTML=loading();try{await (R[v]||renderOverview)();}catch(e){view.innerHTML=errState(e);}
}

window.addEventListener('hashchange',navigate);
window.addEventListener('lt:unauthorized',()=>{toast('Session expired','error');api.setToken('');session=null;renderAuth('login');});

async function boot(){try{brand=await api.branding();}catch{}document.documentElement.setAttribute('data-theme',localStorage.getItem('lt_theme')||'dark');document.title=brand.docTitle||'.light';let f=document.querySelector('link[rel=icon]');if(f&&brand.favicon)f.href=brand.favicon;
  if(!api.token()){renderAuth('login');return;}
  try{session=await api.me();renderShell();await navigate();}catch(e){api.setToken('');renderAuth('login');}
}
boot();

/* ---------- views ---------- */
async function renderVerify(q){const v=app.querySelector('#view'),t=q?.get('token');let msg='',ok=false;if(t){try{await api.verifyEmail(t);ok=true;msg='Your email has been verified.';}catch(e){msg=e.message;}}else msg='Open the verification link from your email.';
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Verify email</h1></div>${section('Verification','', `<p style="font-size:13px;color:var(--lt-text-secondary)">${esc(msg)}</p><div style="margin-top:16px;display:flex;gap:8px"><button class="lt-btn lt-btn-secondary" id="resend">Resend verification</button><a class="lt-btn lt-btn-primary" href="#/overview">Continue</a></div>`)}`;
  v.querySelector('#resend')?.addEventListener('click',async()=>{try{const r=await api.resendVerification();toast(r.ok?'Sent':(r.reason||'Unavailable'),r.ok?'success':'info');}catch(e){toast(e.message,'error');}});
}
async function renderReset(q){const v=app.querySelector('#view'),t=q?.get('token');
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Reset password</h1></div>${section('New password','', `<form id="rf">${field('New password (min 10)','password','password','','minlength="10" required')}<button class="lt-btn lt-btn-primary" type="submit" ${t?'':'disabled'}>Set password</button>${t?'':'<p class="lt-meta">Missing or invalid reset token.</p>'}</form>`)}`;
  v.querySelector('#rf')?.addEventListener('submit',async(e)=>{e.preventDefault();const pw=new FormData(e.target).get('password');try{await api.resetPassword(t,pw);toast('Password updated — sign in','success');api.setToken('');session=null;renderAuth('login');}catch(err){toast(err.message,'error');}});
}

async function renderOverview(){const v=app.querySelector('#view');const [st,ins,deps,nodes]=await Promise.all([api.stats(),api.instances(),api.deployments(),api.nodes()]);
  const running=st.instances?.running||0,online=nodes.nodes.filter(n=>n.status==='online').length;
  const kpis=[['Total services',ins.instances.length,`${running} running`],['Running',running,'active now'],['Nodes online',`${online}/${nodes.nodes.length}`,'connected'],['Deployments',deps.deployments.length,'total']]
    .map(([l,val,s])=>`<div class="lt-card" style="padding:18px"><div class="lt-kpi-label">${l}</div><div class="lt-kpi" style="margin-top:8px">${esc(val)}</div><div class="lt-kpi-sub">${esc(s)}</div></div>`).join('');
  const onb=ins.instances.length===0?`<div class="lt-card" style="padding:28px;border-color:var(--lt-border-ember);margin-bottom:16px"><div style="font-size:20px;font-weight:800">Welcome to ${esc(brand.product||'.light')} 👋</div><p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6;max-width:620px;margin:8px 0 16px">Create your first server to host a game, website, application, bot or database. Choose a template or bring your own image — the platform handles the rest.</p><a class="lt-btn lt-btn-primary" href="#/servers">Create Your First Server</a></div>`:'';
  const rows=ins.instances.slice(0,6).map(i=>`<tr><td><a class="lt-td-strong" href="#/server/${i.id}" style="color:var(--lt-text);text-decoration:none">${esc(i.name)}</a><div class="lt-meta">${esc(i.image)}</div></td><td>${badge(i.status)}</td><td>${esc(i.category)}</td><td class="lt-td-mono">${i.memoryMb} MB</td><td>${fmtAgo(i.updatedAt)}</td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Dashboard</h1><p class="lt-page-subtitle">Your hosting at a glance</p></div><div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="#/servers">Create Your First Server</a></div></div>${onb}
    <div class="lt-grid lt-grid-4" style="margin-bottom:16px">${kpis}</div>
    ${section('Recent services','',rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Memory</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No services yet','Create your first server to get started.','<a class="lt-btn lt-btn-primary" href="#/servers">Create Server</a>'))}`;
  poll(async()=>{if(currentView==='overview')await renderOverview();});
}

async function renderServers(category='all'){
  if(category!=='all')serversState.category=category;
  const v=app.querySelector('#view');const [list,templates]=await Promise.all([api.instances(),api.templates()]);
  let rows=list.instances.filter(i=>serversState.category==='all'||i.category===serversState.category||(serversState.category==='website'&&i.category==='web'));
  if(serversState.status!=='all')rows=rows.filter(i=>i.status===serversState.status);
  if(serversState.search)rows=rows.filter(i=>(i.name+' '+i.image).toLowerCase().includes(serversState.search.toLowerCase()));
  rows=[...rows].sort((a,b)=>{const x=a[serversState.sort]??'',y=b[serversState.sort]??'';return (String(x).localeCompare(String(y)))*serversState.dir;});
  const pages=Math.max(1,Math.ceil(rows.length/serversState.per));if(serversState.page>pages)serversState.page=pages;
  const paged=rows.slice((serversState.page-1)*serversState.per,serversState.page*serversState.per);
  const cats=[['all','All Servers'],['game','Game Servers'],['web','Applications'],['website','Websites'],['database','Databases']];
  const table=paged.map(i=>`<tr><td><a class="lt-td-strong" href="#/server/${i.id}" style="color:var(--lt-text);text-decoration:none">${esc(i.name)}</a><div class="lt-meta">${esc(i.image)}</div></td><td>${esc(i.category)}</td><td>${badge(i.status)}</td><td class="lt-td-mono">${i.cpuCores} / ${i.memoryMb}MB</td><td class="lt-td-mono">${(i.ports||[]).map(p=>p.container).join(', ')||'—'}</td><td>${fmtAgo(i.createdAt)}</td><td><a class="lt-btn lt-btn-ghost lt-btn-sm" href="#/server/${i.id}">Manage</a></td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">${(cats.find(c=>c[0]===serversState.category)||cats[0])[1]}</h1><p class="lt-page-subtitle">${list.instances.length} total services</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="createBtn">+ Create Server</button></div></div>
    <div class="lt-toolbar"><div class="lt-search-field"><input class="lt-input" id="srvSearch" placeholder="Search servers…" value="${esc(serversState.search)}"></div>
      ${selectField('Status','statusFilter',[['all','All statuses'],['running','Running'],['stopped','Stopped'],['deploying','Deploying'],['error','Error']],serversState.status)}
      ${selectField('Sort','sortField',[['name','Name'],['createdAt','Created'],['status','Status'],['category','Type']],serversState.sort)}</div>
    ${table?`<div class="lt-card"><div class="lt-table-wrap"><table class="lt-table"><thead><tr><th class="sortable" data-sort="name">Name</th><th>Type</th><th class="sortable" data-sort="status">Status</th><th>CPU / RAM</th><th>Ports</th><th>Created</th><th></th></tr></thead><tbody>${table}</tbody></table></div><div class="lt-pagination"><span>Showing ${paged.length} of ${rows.length}</span><div style="display:flex;gap:6px"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="prev" ${serversState.page<=1?'disabled':''}>Prev</button><span style="padding:6px">${serversState.page}/${pages}</span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="next" ${serversState.page>=pages?'disabled':''}>Next</button></div></div></div>`
      :empty('No servers found','Create a server or adjust your filters.','<button class="lt-btn lt-btn-primary" id="createBtn2">Create Server</button>')}`;
  v.querySelector('#srvSearch')?.addEventListener('input',e=>{serversState.search=e.target.value;serversState.page=1;renderServers(serversState.category);});
  v.querySelector('#statusFilter')?.addEventListener('change',e=>{serversState.status=e.target.value;renderServers(serversState.category);});
  v.querySelector('#sortField')?.addEventListener('change',e=>{serversState.sort=e.target.value;renderServers(serversState.category);});
  v.querySelectorAll('[data-sort]')?.forEach(th=>th.addEventListener('click',()=>{serversState.dir=serversState.sort===th.dataset.sort?-serversState.dir:1;serversState.sort=th.dataset.sort;renderServers(serversState.category);}));
  v.querySelector('#prev')?.addEventListener('click',()=>{serversState.page--;renderServers(serversState.category);});
  v.querySelector('#next')?.addEventListener('click',()=>{serversState.page++;renderServers(serversState.category);});
  const create=()=>openCreate(templates);
  v.querySelector('#createBtn')?.addEventListener('click',create);v.querySelector('#createBtn2')?.addEventListener('click',create);
}

async function openCreate(templates){
  const t=templates.templates||[];const gameOpts=[{value:'',label:'Custom image…'},...t.filter(x=>x.category==='game').map(x=>({value:x.id,label:x.name}))];
  const webOpts=[{value:'',label:'Custom image…'},...t.filter(x=>x.category!=='game').map(x=>({value:x.id,label:`${x.category}: ${x.name}`}))];
  const d=await modal('Create Server',`<form id="cf">
    ${field('Server name','name','text','','required')}
    ${selectField('Template','templateId',[...gameOpts,...webOpts])}
    ${field('Docker image','image','text','nginx:alpine','required')}
    ${selectField('Category','category',[['web','Web application'],['game','Game server'],['website','Website'],['database','Database'],['bot','Bot'],['app','Application']])}
    ${field('Steam game (optional)','game','text','','placeholder="rust, valheim, cs2…"')}
    ${field('Startup command','command','text','')}
    ${field('Ports (comma separated)','ports','text','80')}
    ${field('CPU cores','cpuCores','number','1','min="1" max="32"')}${field('Memory (MB)','memoryMb','number','512','min="128"')}${field('Storage (GB)','diskGb','number','4','min="1"')}
    ${textarea('Environment (KEY=value per line)','env')}
  </form>`,{confirm:'Create'});
  if(!d)return;
  const tpl=t.find(x=>x.id===d.templateId);const image=d.image||tpl?.image||'nginx:alpine';
  const ports=String(d.ports||'').split(',').map(p=>p.trim()).filter(Boolean).map(p=>({container:Number(p)||80}));
  const env={};for(const line of String(d.env||'').split('\n')){const m=line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2];}
  try{await api.createInstance({name:d.name,image,category:d.category,game:d.game||undefined,command:d.command,ports,env,cpuCores:+d.cpuCores,memoryMb:+d.memoryMb,diskGb:+d.diskGb});toast('Server created — provisioning started','success');navigate();}catch(e){toast(e.message,'error');}
}

async function renderServer(id){
  const v=app.querySelector('#view');const [{instance:i},logs,metrics]=await Promise.all([api.instance(id),api.logs(id,200),api.metrics(id,60)]);
  const tab=currentServerTab||'overview';const tabs=['overview','console','files','configuration','startup','networking','domains','backups','schedules','monitoring','activity'];
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">${esc(i.name)}</h1><p class="lt-page-subtitle">${esc(i.image)} · ${badge(i.status)}</p></div><div class="lt-page-actions">
    ${i.status==='running'?'<button class="lt-btn lt-btn-secondary" data-a="stop">Stop</button>':'<button class="lt-btn lt-btn-secondary" data-a="start">Start</button>'}
    <button class="lt-btn lt-btn-secondary" data-a="restart">Restart</button><button class="lt-btn lt-btn-secondary" data-a="deploy">Deploy</button><button class="lt-btn lt-btn-danger" data-a="delete">Delete</button></div></div>
    <div class="lt-tabs">${tabs.map(t=>`<button class="lt-tab ${t===tab?'active':''}" data-tab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}</div><div id="tabView"></div>`;
  v.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{currentServerTab=b.dataset.tab;renderServer(id);}));
  v.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',async()=>{const a=b.dataset.a;try{
    if(a==='delete'){if(await confirmDialog('Delete server',`Permanently delete ${i.name}?`,'Delete')){await api.deleteInstance(id);toast('Deleted','success');location.hash='#/servers';}return;}
    if(a==='deploy'){await api.deploy(id,{});toast('Deployment started','success');}else{await api.action(id,a);toast(`Server ${a}ped`,'success');}renderServer(id);
  }catch(e){toast(e.message,'error');}}));
  const tv=v.querySelector('#tabView');const last=metrics.metrics[metrics.metrics.length-1]||{};
  if(tab==='overview'){
    tv.innerHTML=`<div class="lt-grid lt-grid-4" style="margin-bottom:16px">${[['CPU',(last.cpu||0)+'%'],['Memory',(last.mem||0)+'%'],['Disk',(last.disk||0)+'%'],['Temp',(last.temp||0)+'°C']].map(([l,x])=>`<div class="lt-card" style="padding:18px"><div class="lt-kpi-label">${l}</div><div class="lt-kpi" style="margin-top:8px">${x}</div></div>`).join('')}</div>
    ${section('Configuration','', `<div class="lt-grid lt-grid-2"><div><div class="lt-meta">Image</div><div style="font-weight:700">${esc(i.image)}</div></div><div><div class="lt-meta">Command</div><div class="lt-td-mono">${esc(i.command||'default')}</div></div><div><div class="lt-meta">Resources</div><div style="font-weight:700">${i.cpuCores} cores · ${i.memoryMb} MB · ${i.diskGb} GB</div></div><div><div class="lt-meta">Ports</div><div class="lt-td-mono">${(i.ports||[]).map(p=>p.container+'/'+p.protocol).join(', ')||'none'}</div></div></div>`)}
    ${section('Recent logs','', `<div class="lt-console"><div class="lt-console-body" style="height:200px">${logs.logs.map(l=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')||'<div class="lt-console-line">No output yet.</div>'}</div></div>`)}`;
  }else if(tab==='console'){
    tv.innerHTML=section('Live console','', `<div class="lt-console"><div class="lt-console-toolbar"><span class="lt-label">console</span><span style="flex:1"></span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="clr">Clear</button></div><div class="lt-console-body" id="cb">${logs.logs.map(l=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')}</div><div class="lt-console-input"><span class="prompt">❯</span><input id="ci" placeholder="Type a command…" ${i.status!=='running'?'disabled':''}></div></div>`);
    tv.querySelector('#clr').addEventListener('click',async()=>{await api.clearLogs(id);toast('Cleared','success');});
    tv.querySelector('#ci').addEventListener('keydown',async(e)=>{if(e.key!=='Enter'||!e.target.value.trim())return;const c=e.target.value;e.target.value='';const b=tv.querySelector('#cb');b.innerHTML+=`<div class="lt-console-line cmd"><span class="ts">${fmtTime(Date.now())}</span><span>❯ ${esc(c)}</span></div>`;try{const r=await api.console(id,c);b.innerHTML+=`<div class="lt-console-line"><span class="ts">${fmtTime(Date.now())}</span><span>${esc(r.output||'')}</span></div>`;}catch(err){b.innerHTML+=`<div class="lt-console-line error">${esc(err.message)}</div>`;}b.scrollTop=b.scrollHeight;});
  }else if(tab==='files'){
    const f=await api.files(id,currentFilePath||'/');currentFilePath=f.path;
    tv.innerHTML=section('File manager',f.path,`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Actions</th></tr></thead><tbody>
      ${f.path!=='/'?`<tr><td colspan="4"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="up">← Parent</button></td></tr>`:''}
      ${(f.entries||[]).map(e=>`<tr><td class="lt-td-strong">${e.type==='dir'?'📁':'📄'} ${esc(e.name)}</td><td>${e.type}</td><td class="lt-td-mono">${fmtBytes(e.size)}</td><td>${e.type==='file'?`<button class="lt-btn lt-btn-ghost lt-btn-sm" data-edit="${esc(e.name)}">Edit</button>`:`<button class="lt-btn lt-btn-ghost lt-btn-sm" data-open="${esc(e.name)}">Open</button>`} <button class="lt-btn lt-btn-ghost lt-btn-sm" data-del="${esc(e.name)}">Delete</button></td></tr>`).join('')}</tbody></table></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="lt-btn lt-btn-secondary" id="nf">New file</button><button class="lt-btn lt-btn-secondary" id="nd">New folder</button></div>`);
    tv.querySelector('#up')?.addEventListener('click',()=>{currentFilePath=f.path.split('/').slice(0,-1).join('/')||'/';renderServer(id);});
    tv.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{currentFilePath=f.path+'/'+b.dataset.open;renderServer(id);}));
    tv.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',async()=>{const p=f.path+'/'+b.dataset.edit,d=await api.readFile(id,p);const r=await modal('Edit '+b.dataset.edit,textarea('Content','content',d.content||''),{confirm:'Save'});if(r){await api.writeFile(id,{path:p,content:r.content});toast('Saved','success');renderServer(id);}}));
    tv.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Delete',`Delete ${b.dataset.del}?`)){await api.writeFile(id,{op:'delete',path:f.path+'/'+b.dataset.del});renderServer(id);}}));
    tv.querySelector('#nf').addEventListener('click',async()=>{const d=await modal('New file',field('Name','name','text','','required')+textarea('Content','content',''),{confirm:'Create'});if(d){await api.writeFile(id,{path:f.path+'/'+d.name,content:d.content||''});renderServer(id);}});
    tv.querySelector('#nd').addEventListener('click',async()=>{const d=await modal('New folder',field('Name','name','text','','required'),{confirm:'Create'});if(d){await api.writeFile(id,{op:'mkdir',path:f.path+'/'+d.name});renderServer(id);}});
  }else if(tab==='configuration'||tab==='startup'){
    tv.innerHTML=section(tab==='configuration'?'Configuration':'Startup settings','',`<form id="sf">${field('Image','image','text',i.image)}${field('Command','command','text',i.command)}${field('CPU','cpuCores','number',i.cpuCores)}${field('Memory (MB)','memoryMb','number',i.memoryMb)}${field('Disk (GB)','diskGb','number',i.diskGb)}${textarea('Environment (KEY=value)','env',Object.entries(i.env||{}).map(([k,x])=>k+'='+x).join('\n'))}<button class="lt-btn lt-btn-primary" type="submit">Save</button></form>`);
    tv.querySelector('#sf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const env={};for(const l of String(d.env||'').split('\n')){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2];}try{await api.updateInstance(id,{...d,cpuCores:+d.cpuCores,memoryMb:+d.memoryMb,diskGb:+d.diskGb,env});toast('Saved','success');renderServer(id);}catch(err){toast(err.message,'error');}});
  }else if(tab==='monitoring'){
    tv.innerHTML=section('Resource usage','',metrics.metrics.length?metrics.metrics.slice(-40).map(m=>`<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--lt-border);font-size:12px"><span class="lt-td-mono" style="width:160px">${fmtTime(m.ts)}</span><span>CPU ${m.cpu}%</span><span>MEM ${m.mem}%</span><span>NET ${fmtNum(m.net_in)}/${fmtNum(m.net_out)}</span></div>`).join(''):empty('No metrics yet','Metrics appear once the agent reports.'));
    poll(async()=>{if(currentView==='server'&&currentServerTab==='monitoring')await renderServer(id);},10000);
  }else if(tab==='backups'){
    const b=await api.backups(id);
    tv.innerHTML=section('Backups','',`<button class="lt-btn lt-btn-primary" id="bk" style="margin-bottom:14px">Create backup</button>${b.backups.length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Status</th><th>Size</th><th>Created</th><th></th></tr></thead><tbody>${b.backups.map(x=>`<tr><td class="lt-td-strong">${esc(x.name)}</td><td>${badge(x.status)}</td><td class="lt-td-mono">${fmtBytes(x.size_bytes)}</td><td>${fmtTime(x.created_at)}</td><td>${x.status==='ready'?`<button class="lt-btn lt-btn-ghost lt-btn-sm" data-restore="${x.id}">Restore</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('No backups','Create a backup to protect your data.')}`);
    tv.querySelector('#bk').addEventListener('click',async()=>{const d=await modal('Create backup',field('Name','name','text','manual'),{confirm:'Create'});if(d){await api.createBackup(id,d.name);renderServer(id);}});
    tv.querySelectorAll('[data-restore]').forEach(x=>x.addEventListener('click',async()=>{if(await confirmDialog('Restore','Overwrite current data?')){await api.restoreBackup(id,x.dataset.restore);toast('Restored','success');}}));
  }else if(tab==='domains'){
    const d=await api.domains();const own=d.domains.filter(x=>x.instance_id===id);
    tv.innerHTML=section('Domains','',own.length?own.map(x=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--lt-border)"><span class="lt-td-mono">${esc(x.domain)}</span>${badge(x.verified?'active':'pending')}</div>`).join(''):empty('No domains','Assign a domain from the Domains page.'));
  }else if(tab==='schedules'){
    const s=await api.schedules();const own=s.schedules.filter(x=>x.instance_id===id);
    tv.innerHTML=section('Schedules','',own.length?own.map(x=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--lt-border)"><span>${esc(x.name)}</span><span class="lt-td-mono">${esc(x.cron)}</span>${badge(x.enabled?'active':'stopped')}</div>`).join(''):empty('No schedules','Create a schedule from the Schedules page.'));
  }else if(tab==='networking'){
    tv.innerHTML=section('Networking','',`<div class="lt-grid lt-grid-2"><div><div class="lt-meta">Port mappings</div><div class="lt-td-mono">${(i.ports||[]).map(p=>`${p.container}/${p.protocol} → ${p.host||p.container}`).join('<br>')||'none'}</div></div><div><div class="lt-meta">Project subdomain</div><div class="lt-td-mono">${esc(i.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}.${esc(brand.domain||'trycord.dev')}</div></div></div>`);
  }else if(tab==='activity'){
    tv.innerHTML=section('Activity','',`<p class="lt-meta">Server created ${fmtTime(i.createdAt)} · last updated ${fmtTime(i.updatedAt)}</p>`);
  }
}
let currentServerTab='overview',currentFilePath='/';

async function renderDeployments(){const v=app.querySelector('#view'),d=await api.deployments();
  const rows=d.deployments.map(x=>`<tr><td class="lt-td-strong">${esc(x.instanceName||x.instanceId)}</td><td>${badge(x.status)}</td><td class="lt-td-mono">${esc(x.source)}</td><td class="lt-td-mono">${esc(x.version)}</td><td>${fmtTime(x.createdAt)}</td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Deployments</h1></div>${section('History',`${d.deployments.length} records`,rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Server</th><th>Status</th><th>Source</th><th>Version</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No deployments','Deploy a server to see history.'))}`;
  poll(async()=>{if(currentView==='deployments')await renderDeployments();});
}
async function renderDomains(){const v=app.querySelector('#view'),[d,ins]=await Promise.all([api.domains(),api.instances()]);
  const rows=d.domains.map(x=>`<tr><td class="lt-td-strong">${esc(x.domain)}</td><td>${badge(x.verified?'active':'pending')}</td><td>${badge(x.ssl_status)}</td><td>${esc(ins.instances.find(i=>i.id===x.instance_id)?.name||x.instance_id)}</td><td>${!x.verified?`<button class="lt-btn lt-btn-ghost lt-btn-sm" data-v="${x.id}">Verify</button>`:''}<button class="lt-btn lt-btn-danger lt-btn-sm" data-d="${x.id}">Remove</button></td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Domains</h1></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="add">+ Add domain</button></div></div>${section('Assigned domains','DNS TXT record: _light.<domain>',rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Domain</th><th>Verified</th><th>SSL</th><th>Server</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No domains','Add a custom domain to route traffic.'))}`;
  v.querySelector('#add').addEventListener('click',async()=>{const opts=ins.instances.map(i=>({value:i.id,label:i.name}));const d=await modal('Add domain',field('Domain','domain','text','app.example.com','required')+selectField('Server','instanceId',opts),{confirm:'Add'});if(d){try{await api.createDomain(d);renderDomains();}catch(e){toast(e.message,'error');}}});
  v.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',async()=>{const r=await api.verifyDomain(b.dataset.v);toast(r.verified?'Verified':'DNS not found yet',r.verified?'success':'info');renderDomains();}));
  v.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Remove','Detach domain?')){await api.deleteDomain(b.dataset.d);renderDomains();}}));
}
async function renderBackups(){const v=app.querySelector('#view'),r=await api.backupsAll();const rows=r.backups.map(b=>`<tr><td class="lt-td-strong">${esc(b.name)}</td><td>${esc(b.instance_name||b.instance_id)}</td><td>${badge(b.status)}</td><td class="lt-td-mono">${fmtBytes(b.size_bytes)}</td><td>${fmtTime(b.created_at)}</td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Backups</h1></div>${section('All backups','',rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Server</th><th>Status</th><th>Size</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No backups','Create backups from a server’s Backups tab.'))}`;
}
async function renderSchedules(){const v=app.querySelector('#view'),[s,ins]=await Promise.all([api.schedules(),api.instances()]);const rows=s.schedules.map(x=>`<tr><td class="lt-td-strong">${esc(x.name)}</td><td>${esc(x.instance_name||x.instance_id)}</td><td>${esc(x.action)}</td><td class="lt-td-mono">${esc(x.cron)}</td><td>${badge(x.enabled?'active':'stopped')}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-t="${x.id}">${x.enabled?'Disable':'Enable'}</button> <button class="lt-btn lt-btn-danger lt-btn-sm" data-d="${x.id}">Delete</button></td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Schedules</h1></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="add">+ New schedule</button></div></div>${section('Automation','',rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Server</th><th>Action</th><th>Cron</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No schedules','Automate starts, stops, backups and deploys.'))}`;
  v.querySelector('#add').addEventListener('click',async()=>{const d=await modal('New schedule',field('Name','name','text','daily backup','required')+selectField('Server','instanceId',ins.instances.map(i=>({value:i.id,label:i.name})))+selectField('Action','action',['start','stop','restart','backup','deploy'])+field('Cron','cron','text','0 3 * * *','required'),{confirm:'Create'});if(d){await api.createSchedule(d);renderSchedules();}});
  v.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',async()=>{const x=s.schedules.find(y=>y.id===b.dataset.t);await api.updateSchedule(x.id,{enabled:!x.enabled});renderSchedules();}));
  v.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',async()=>{if(await confirmDialog('Delete','Remove schedule?')){await api.deleteSchedule(b.dataset.d);renderSchedules();}}));
}
async function renderFiles(){const v=app.querySelector('#view'),[ins]=await Promise.all([api.instances()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Files</h1><p class="lt-page-subtitle">Manage files inside your servers</p></div>${section('Select a server','',ins.instances.length?`<div class="lt-grid lt-grid-3">${ins.instances.map(i=>`<a class="lt-card lt-card-hover" style="padding:16px;text-decoration:none;color:var(--lt-text)" href="#/server/${i.id}"><div style="font-weight:700">${esc(i.name)}</div><div class="lt-meta">${esc(i.image)}</div></a>`).join('')}</div>`:empty('No servers','Create a server to manage files.'))}`;
}
async function renderUsage(){const v=app.querySelector('#view'),[us,me]=await Promise.all([api.stats(),api.me()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Usage & Resources</h1><p class="lt-page-subtitle">Your current resource consumption</p></div>
    ${section('Usage overview','',`<div class="lt-grid lt-grid-3">${[['Services',us.instances?.running||0],['Nodes online',us.nodes?.online||0],['Deployments',us.deployments?.success||0]].map(([l,x])=>`<div class="lt-card" style="padding:18px"><div class="lt-kpi-label">${l}</div><div class="lt-kpi" style="margin-top:8px">${x}</div></div>`).join('')}</div>`)}`;
}
async function renderBilling(){const v=app.querySelector('#view'),[plans,me]=await Promise.all([api.plans(),api.me()]);const cur=plans.plans.find(p=>p.id===me.team?.plan_id)||plans.plans[0];
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Billing & Plans</h1></div><div class="lt-grid lt-grid-2">
    ${section('Current plan',cur?.name,`<p class="lt-meta">${esc(cur?.description||'')}</p><div class="lt-grid lt-grid-3" style="margin-top:14px">${[['RAM',(cur?.memory_mb||0)+' MB'],['Storage',(cur?.disk_gb||0)+' GB'],['Instances',cur?.instances||0]].map(([l,x])=>`<div><div class="lt-meta">${l}</div><div style="font-weight:700;font-size:18px">${x}</div></div>`).join('')}</div>`)}
    ${section('Available plans','',plans.plans.map(p=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--lt-border)"><span>${esc(p.name)}</span><span class="lt-meta">${p.memory_mb}MB · ${p.disk_gb}GB · ${p.price_monthly?'$'+(p.price_monthly/100)+'/mo':'Free'}</span></div>`).join(''))}</div>`;
}
async function renderNotifications(){const v=app.querySelector('#view');v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Notifications</h1></div>${section('Notification preferences','',`<p class="lt-meta">Notifications are delivered according to your operator's email configuration. Configure email delivery in your environment settings.</p>`)}`;}
async function renderSupport(){const v=app.querySelector('#view');v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Support</h1></div>${section('Get help','',`<p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6">Need assistance? Check the <a href="/docs.html" style="color:var(--lt-ember-500)">documentation</a> or contact your operator at <a href="mailto:${esc(brand.supportEmail||'support@trycord.dev')}" style="color:var(--lt-ember-500)">${esc(brand.supportEmail||'support@trycord.dev')}</a>.</p>`)}`;}
async function renderSettings(){const v=app.querySelector('#view'),[me,sessions]=await Promise.all([api.me(),api.sessions()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Settings</h1></div><div class="lt-grid lt-grid-2">
    ${section('Profile','',`<form id="pf">${field('Name','name','text',me.user.name||'')}${field('Username','username','text',me.user.username||'')}<button class="lt-btn lt-btn-primary" type="submit">Save</button></form>`)}
    ${section('Appearance','',`<div style="display:flex;gap:8px"><button class="lt-btn ${document.documentElement.getAttribute('data-theme')!=='light'?'lt-btn-primary':'lt-btn-secondary'}" data-theme="dark">Dark</button><button class="lt-btn ${document.documentElement.getAttribute('data-theme')==='light'?'lt-btn-primary':'lt-btn-secondary'}" data-theme="light">Light</button></div>`)}
    ${section('Password','',`<form id="pwf">${field('Current password','currentPassword','password')}${field('New password','newPassword','password','','minlength="10"')}<button class="lt-btn lt-btn-primary" type="submit">Change password</button></form>`)}
    ${section('Sessions','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Device</th><th>IP</th><th></th></tr></thead><tbody>${(sessions.sessions||[]).map(s=>`<tr><td class="lt-td-mono">${esc((s.user_agent||'Unknown').slice(0,40))}</td><td>${esc(s.ip||'—')}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-s="${s.id}">Revoke</button></td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Danger zone','',`<button class="lt-btn lt-btn-danger" id="delAcc">Delete account</button>`)}</div>`;
  v.querySelector('#pf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());await api.updateProfile(d);toast('Saved','success');});
  v.querySelector('#pwf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());try{const r=await api.changePassword(d);api.setToken(r.token);toast('Password changed','success');e.target.reset();}catch(err){toast(err.message,'error');}});
  v.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',async()=>{document.documentElement.setAttribute('data-theme',b.dataset.theme);localStorage.setItem('lt_theme',b.dataset.theme);await api.updateProfile({theme:b.dataset.theme}).catch(()=>{});renderSettings();}));
  v.querySelectorAll('[data-s]').forEach(b=>b.addEventListener('click',async()=>{await api.deleteSession(b.dataset.s);toast('Revoked','success');renderSettings();}));
  v.querySelector('#delAcc').addEventListener('click',async()=>{const d=await modal('Delete account',field('Type DELETE to confirm','confirm','text',''),{danger:true,confirm:'Delete account'});if(d?.confirm==='DELETE'){await api.deleteAccount();api.setToken('');session=null;renderAuth('login');}});
}
async function renderAdmin(){const v=app.querySelector('#view'),[users,teams,audit]=await Promise.all([api.adminUsers(),api.teams(),api.audit()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Administration</h1></div><div class="lt-stack">
    ${section('Users','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>${users.users.map(u=>`<tr><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.name||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Workspaces','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Members</th><th>Services</th><th>Plan</th></tr></thead><tbody>${teams.teams.map(t=>`<tr><td class="lt-td-strong">${esc(t.name)}</td><td>${t.members}</td><td>${t.instances}</td><td>${esc(t.plan_id)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Audit log','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Time</th><th>Action</th><th>Target</th></tr></thead><tbody>${audit.events.slice(0,30).map(e=>`<tr><td class="lt-td-mono">${fmtTime(e.ts)}</td><td>${esc(e.action)}</td><td>${esc(e.target_id||'—')}</td></tr>`).join('')}</tbody></table></div>`)}</div>`;
}
