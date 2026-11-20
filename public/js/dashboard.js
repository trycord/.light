// .light — new customer dashboard application. Rebuilt from scratch.
import api from '/js/api.js';
import { ASSETS, iconImg, brandMark } from '/js/assets.js';

const app = document.getElementById('app');
const overlays = document.getElementById('overlay-root');
let session = null, brand = {}, pollTimer = null, currentView = null, currentParam = null;
let serversState = { search: '', category: 'all', status: 'all', sort: 'name', dir: 1, page: 1, per: 10 };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtMoney = (c, cur='USD') => new Intl.NumberFormat(undefined, { style:'currency', currency:cur||'USD' }).format(Number(c||0)/100);
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
const confirmDialog=(t,m,confirmText='Confirm')=>modal(t,`<p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6">${esc(m)}</p>`,{danger:true,confirm:confirmText});
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
    <a href="/" class="lt-auth-logo">${brandMark(40)}<span>${esc(brand.product||'.light')}</span></a>
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
      ${reg?`<label class="lt-auth-terms"><input type="checkbox" name="acceptTerms" required><span>I accept the <a href="/legal" target="_blank">Terms of Service</a> and <a href="/legal" target="_blank">Privacy Policy</a>.</span></label>`:`<div style="text-align:right;margin:-2px 0 8px"><button type="button" id="forgotBtn" class="lt-auth-link">Forgot password?</button></div>`}
      <div class="lt-auth-error" id="authError" role="alert"></div>
      <button class="lt-btn lt-btn-primary" type="submit" style="width:100%;margin-top:8px">${reg?'Create account':'Sign in'}</button>
    </form>
    ${!reg?`<div class="lt-auth-divider">or continue with</div><div class="lt-field"><label for="f-sso">Organization email (SSO)</label><input class="lt-input" id="f-sso" type="email" placeholder="you@company.com"></div><button class="lt-btn lt-btn-secondary" id="ssoBtn" style="width:100%">${esc(brand.sso?.label||'Continue with SSO')}</button>`:''}
    <div class="lt-auth-footer">${esc(brand.attribution||'.light POWERED BY TRYCORD')} · ${esc(brand.tagline||'Universal hosting platform')}<div class="lt-auth-watermark"><span class="lt-wm-mark">ΔΓΟ</span> <a href="${esc(brand.watermark?.source||'https://trycord.dev')}" target="_blank">${esc(brand.watermark?.short||'POWERED BY TRYCORD')}</a></div></div>
  </div></section></div>`;
  app.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{const mode=b.dataset.mode;if(location.hash!==`#/${mode}`)location.hash=`#/${mode}`;renderAuth(mode);}));
  app.querySelector('#togglePw')?.addEventListener('click',()=>{const i=app.querySelector('#f-password'),b=app.querySelector('#togglePw');const s=i.type==='password';i.type=s?'text':'password';b.textContent=s?'◌':'◉';});
  app.querySelector('#forgotBtn')?.addEventListener('click',async()=>{const d=await modal('Reset password',field('Email or username','identity','text','','required'),{confirm:'Send link'});if(!d)return;try{const r=await api.forgotPassword(d.identity);toast(r.ok?'Reset link sent':(r.message||'Email disabled — contact administrator'),r.ok?'success':'info');}catch(e){toast(e.message,'error');}});
  app.querySelector('#ssoBtn')?.addEventListener('click',()=>{const s=brand.sso||{},email=app.querySelector('#f-sso')?.value.trim();if(!s.enabled||!s.url){toast('SSO not configured — contact your administrator','info');return;}if(!email){toast('Enter your organization email','warning');return;}location.href=s.url+(s.url.includes('?')?'&':'?')+'login_hint='+encodeURIComponent(email);});
  app.querySelector('#authForm').addEventListener('submit',async(e)=>{
    e.preventDefault();const f=e.target,data=Object.fromEntries(new FormData(f).entries()),err=app.querySelector('#authError'),btn=f.querySelector('[type=submit]');
    err.textContent='';btn.disabled=true;btn.textContent='Please wait…';
    try{const r=mode==='register'?await api.register(data):await api.login(data);api.setToken(r.token);session=await api.me();
      if(r.verifyRequired||session.user?.emailVerified===false){location.hash='#/verify';renderShell();await navigate();toast('Check your email to verify','info');return;}
      renderShell();toast(mode==='register'?'Account created':'Signed in','success');
      const selectedPlan=new URLSearchParams(location.search).get('plan');
      if(selectedPlan&&await checkoutPlan(selectedPlan))return;
      location.hash='#/overview';navigate();
    }catch(error){err.textContent=error.message;}finally{btn.disabled=false;btn.textContent=mode==='register'?'Create account':'Sign in';}
  });
}

const NAV=[
  {group:'Overview',items:[{v:'overview',label:'Dashboard',i:'monitoring'},{v:'activity',label:'Activity',i:'schedules'},{v:'notifications',label:'Notifications',i:'settings'}]},
  {group:'Hosting',items:[{v:'market',label:'Marketplace',i:'applications'},{v:'servers',label:'All services',i:'instances'},{v:'game',label:'Game servers',i:'game-servers'},{v:'web',label:'Applications',i:'applications'},{v:'websites',label:'Websites',i:'network'},{v:'database',label:'Databases',i:'storage'},{v:'domains',label:'Domains',i:'network'},{v:'backups',label:'Backups',i:'backups'},{v:'files',label:'Files',i:'storage'}]},
  {group:'Account',items:[{v:'orders',label:'Orders',i:'schedules'},{v:'billing',label:'Billing & plans',i:'settings'},{v:'invoices',label:'Invoices',i:'storage'},{v:'payment-methods',label:'Payment methods',i:'security'},{v:'usage',label:'Usage & resources',i:'monitoring'}]},
  {group:'Support',items:[{v:'support',label:'Support tickets',i:'security'},{v:'help',label:'Documentation',i:'settings',external:'/docs'}]},
  {group:'Settings',items:[{v:'settings',label:'Profile & preferences',i:'settings'},{v:'admin',label:'Administration',i:'security',admin:true}]},
];
// Views that leave the customer SPA and load a separate application.
const EXTERNAL_VIEWS = { admin: '/admin', files: '/files', help: '/docs' };

function renderShell(){
  const nav=NAV.map(g=>{const items=g.items.filter(i=>!i.admin||session.user.role==='admin');if(!items.length)return '';
    return `<nav class="lt-nav-section"><div class="lt-nav-section-label">${esc(g.group)}</div>${items.map(i=>`<a class="lt-nav-item" href="${EXTERNAL_VIEWS[i.v]||`#/${i.v}`}" data-nav="${i.v}">${iconImg(i.i,17)}<span>${esc(i.label)}</span></a>`).join('')}</nav>`;}).join('');
  app.innerHTML=`<a class="lt-skip" href="#view">Skip to main content</a><div class="lt-shell">
    <aside class="lt-sidebar" id="sidebar" aria-label="Primary navigation"><a class="lt-brand" href="#/overview">${brandMark(32)}<span class="lt-brand-word">${esc(brand.product||'.light')}<span class="lt-brand-sub">${esc((brand.tagline||'Universal hosting platform').split(' ')[0])}</span></span></a>${nav}
    <div class="lt-nav-footer"><div class="lt-watermark"><span class="lt-wm-mark">ΔΓΟ</span> <a href="https://trycord.dev" target="_blank">POWERED BY TRYCORD</a></div></div></aside>
    <div class="lt-scrim" id="scrim" style="display:none"></div>
    <div class="lt-main"><header class="lt-topbar">
      <button class="lt-btn lt-btn-ghost lt-btn-icon lt-sidebar-toggle" id="navToggle">☰</button>
      <div class="lt-breadcrumb"><span>${esc(brand.product||'.light')}</span><span class="sep">/</span><span class="cur" id="crumb">Dashboard</span></div>
      <div class="lt-topbar-spacer"></div>
      <div class="lt-global-search"><input id="globalSearch" placeholder="Search servers, domains…" aria-label="Search"></div>
      <button class="lt-icon-btn" id="notifBtn" title="Notifications" style="position:relative">🔔<span class="lt-badge-count" id="notifCount" style="display:none">0</span></button>
      <a class="lt-icon-btn" href="/docs" title="Help">?</a>
      <div class="lt-user-menu"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="userBtn">${esc(session.user.name||session.user.username||session.user.email)} ▾</button></div>
    </header><main class="lt-content" id="view">${loading()}</main></div></div>`;
  app.querySelector('#navToggle')?.addEventListener('click',()=>{const s=app.querySelector('#sidebar'),sc=app.querySelector('#scrim');const open=s.classList.toggle('is-open');sc.style.display=open?'block':'none';});
  app.querySelector('#scrim')?.addEventListener('click',()=>{app.querySelector('#sidebar').classList.remove('is-open');app.querySelector('#scrim').style.display='none';});
  app.querySelector('#userBtn').addEventListener('click',(e)=>{e.stopPropagation();const ex=app.querySelector('.lt-user-menu-panel');if(ex){ex.remove();return;}const p=document.createElement('div');p.className='lt-user-menu-panel';p.innerHTML=`<div class="lt-menu-label">${esc(session.user.email)}</div><a href="#/settings">Settings</a><a href="/admin" ${session.user.role!=='admin'?'style="display:none"':''}>Administration</a><a href="/">Public site</a><button id="logoutBtn">Sign out</button>`;app.querySelector('.lt-user-menu').appendChild(p);p.querySelector('#logoutBtn').addEventListener('click',async()=>{await api.logout().catch(()=>{});api.setToken('');session=null;renderAuth('login');});setTimeout(()=>{const h=(ev)=>{if(!ev.target.closest('.lt-user-menu')){p.remove();document.removeEventListener('click',h);}};document.addEventListener('click',h);},0);});
  app.querySelector('#globalSearch')?.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&e.target.value.trim()){serversState.search=e.target.value.trim();location.hash='#/servers';setTimeout(()=>renderServers(),50);}});
  app.querySelector('#notifBtn')?.addEventListener('click',(e)=>{e.stopPropagation();openNotifPanel(e.currentTarget);});
  if(session?.impersonatedBy){
    const bar=document.createElement('div');bar.className='lt-impersonation-bar';
    bar.innerHTML=`<span>⚠ Viewing as <strong>${esc(session.user.email)}</strong> — actions are performed on behalf of this account.</span><button class="lt-btn lt-btn-sm" id="exitImpersonate">Exit</button>`;
    app.querySelector('.lt-main')?.prepend(bar);
    bar.querySelector('#exitImpersonate')?.addEventListener('click',()=>{api.setToken('');session=null;location.href='/login';});
  }
}

async function loadUnread(){
  if(!session)return;
  try{const r=await api.unreadNotifications();const el=app.querySelector('#notifCount');if(el){el.textContent=r.unread>99?'99+':r.unread;el.style.display=r.unread?'inline-block':'none';}}catch{}
}

async function openNotifPanel(anchor){
  const ex=document.querySelector('.lt-notif-panel');if(ex){ex.remove();return;}
  const p=document.createElement('div');p.className='lt-notif-panel';
  p.innerHTML='<div class="lt-notif-head">Notifications <button class="lt-btn lt-btn-ghost lt-btn-sm" id="npReadAll">Mark all read</button></div><div id="npList">'+loading()+'</div>';
  document.body.appendChild(p);
  const rect=anchor.getBoundingClientRect();p.style.top=(rect.bottom+8)+'px';p.style.right=Math.max(8,window.innerWidth-rect.right)+'px';
  const load=async()=>{try{const r=await api.notifications(30);const list=p.querySelector('#npList');
    list.innerHTML=r.notifications.length?r.notifications.map(n=>`<div class="lt-notif-item ${n.read?'':'is-unread'}" data-n="${esc(n.id)}">
      <div class="lt-notif-dot ${esc(n.type)}"></div><div style="flex:1;min-width:0"><div class="lt-notif-title">${esc(n.title)}</div>
      <div class="lt-notif-msg">${esc(n.message)}</div><div class="lt-meta">${fmtAgo(n.createdAt)}</div></div></div>`).join(''):'<div class="lt-notif-empty">You’re all caught up.</div>';
    list.querySelectorAll('[data-n]').forEach(el=>el.addEventListener('click',async()=>{const n=r.notifications.find(x=>x.id===el.dataset.n);if(n&&!n.read){try{await api.markNotificationRead(n.id);await loadUnread();}catch{}}if(n?.data?.ticketId)location.hash='#/support';el.remove();}));
  }catch(e){p.querySelector('#npList').innerHTML=errState(e);}};
  p.querySelector('#npReadAll').addEventListener('click',async()=>{try{await api.markAllNotificationsRead();await loadUnread();await load();toast('All marked as read','success');}catch(e){toast(e.message,'error');}});
  await load();loadUnread();
  setTimeout(()=>{const h=(ev)=>{if(!p.contains(ev.target)&&!anchor.contains(ev.target)){p.remove();document.removeEventListener('click',h);}};document.addEventListener('click',h);},0);
}
function setActive(v){app.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===v));const labels={overview:'Dashboard',activity:'Activity',market:'Marketplace',servers:'All services',game:'Game servers',web:'Applications',websites:'Websites',database:'Databases',deployments:'Deployments',domains:'Domains',backups:'Backups',schedules:'Schedules',files:'Files',usage:'Usage & resources',orders:'Orders',billing:'Billing & plans',invoices:'Invoices','payment-methods':'Payment methods',notifications:'Notifications',support:'Support tickets',help:'Documentation',settings:'Profile & preferences',admin:'Administration',server:'Server',verify:'Verify',reset:'Reset'};const c=app.querySelector('#crumb');if(c)c.textContent=labels[v]||v;}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
function poll(fn,ms=8000){stopPoll();pollTimer=setInterval(()=>{if(currentView&&session)fn().catch(()=>{});},ms);}
function parseHash(){const raw=(location.hash||'#/overview').replace(/^#\/?/,'');const [p,q]=raw.split('?');const [v,param]=p.split('/');return{v:v||'overview',param,query:new URLSearchParams(q||'')};}

/* ---------- router ---------- */
async function navigate(){
  const{v,param,query}=parseHash();
  const publicRoute=['verify','reset'].includes(v);
  if(!session&&!publicRoute)return;
  if(!app.querySelector('#view')){
    if(session)renderShell();
    else app.innerHTML='<main class="lt-content" id="view"></main>';
  }
  setActive(v);stopPoll();currentView=v;currentParam=param;const view=app.querySelector('#view');if(!view)return;
  const R={overview:renderOverview,activity:renderActivity,market:()=>renderMarketplace(),marketplace:()=>renderMarketplace(),servers:renderServers,game:()=>renderServers('game'),web:()=>renderServers('web'),websites:()=>renderServers('website'),database:()=>renderServers('database'),deployments:renderDeployments,domains:renderDomains,backups:renderBackups,schedules:renderSchedules,files:renderFiles,usage:renderUsage,orders:renderOrders,billing:renderBilling,invoices:renderInvoices,'payment-methods':renderPaymentMethods,notifications:renderNotifications,support:renderSupport,settings:renderSettings,admin:renderAdmin,server:()=>renderServer(param),verify:()=>renderVerify(query),reset:()=>renderReset(query)};
  view.innerHTML=loading();try{await (R[v]||renderOverview)();}catch(e){view.innerHTML=errState(e);}
}

window.addEventListener('hashchange',navigate);
window.addEventListener('lt:unauthorized',()=>{toast('Session expired','error');api.setToken('');session=null;renderAuth('login');});

async function boot(){try{brand=await api.branding();}catch{}document.documentElement.setAttribute('data-theme',localStorage.getItem('lt_theme')||'dark');document.title=brand.docTitle||'.light';let f=document.querySelector('link[rel=icon]');if(f&&brand.favicon)f.href=brand.favicon;
  const{v}=parseHash();
  if(!api.token()){
    // Email links (#/verify, #/reset) must work even before signing in.
    if(['verify','reset'].includes(v)){await navigate();return;}
    renderAuth(['register','signup'].includes(v)?'register':'login');return;
  }
  try{
    session=await api.me();renderShell();
    const selectedPlan=new URLSearchParams(location.search).get('plan');
    if(selectedPlan&&await checkoutPlan(selectedPlan)){await loadUnread();return;}
    await navigate();await loadUnread();
  }
  catch(e){api.setToken('');const{v:hashView}=parseHash();if(['verify','reset'].includes(hashView)){await navigate();}else renderAuth('login');}
}
boot();

/* ---------- views ---------- */
async function renderVerify(q){const v=app.querySelector('#view'),t=q?.get('token');let msg='',ok=false;if(t){try{await api.verifyEmail(t);ok=true;msg='Your email has been verified.';}catch(e){msg=e.message;}}else msg='Open the verification link from your email.';
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Verify email</h1></div>${section('Verification','', `<p style="font-size:13px;color:var(--lt-text-secondary)">${esc(msg)}</p><div style="margin-top:16px;display:flex;gap:8px"><button class="lt-btn lt-btn-secondary" id="resend">Resend verification</button><a class="lt-btn lt-btn-primary" href="${session?'#/overview':'/login'}">Continue</a></div>`)}`;
  v.querySelector('#resend')?.addEventListener('click',async()=>{try{const r=await api.resendVerification();toast(r.ok?'Sent':(r.reason||'Unavailable'),r.ok?'success':'info');}catch(e){toast(e.message,'error');}});
}
async function renderReset(q){const v=app.querySelector('#view'),t=q?.get('token');
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Reset password</h1></div>${section('New password','', `<form id="rf">${field('New password (min 10)','password','password','','minlength="10" required')}<button class="lt-btn lt-btn-primary" type="submit" ${t?'':'disabled'}>Set password</button>${t?'':'<p class="lt-meta">Missing or invalid reset token.</p>'}</form>`)}`;
  v.querySelector('#rf')?.addEventListener('submit',async(e)=>{e.preventDefault();const pw=new FormData(e.target).get('password');try{await api.resetPassword(t,pw);toast('Password updated — sign in','success');api.setToken('');session=null;renderAuth('login');}catch(err){toast(err.message,'error');}});
}

async function renderOverview(){
  const v=app.querySelector('#view');
  const [st,ins,deps,nodes,orders,domains,notes]=await Promise.all([
    api.stats().catch(()=>({})),api.instances().catch(()=>({instances:[]})),
    api.deployments().catch(()=>({deployments:[]})),api.nodes().catch(()=>({nodes:[]})),
    api.orders().catch(()=>({orders:[]})),api.domains().catch(()=>({domains:[]})),
    api.notifications(8).catch(()=>({notifications:[]})),
  ]);
  const prefs=loadPrefs();document.documentElement.setAttribute('data-density',prefs.density);
  const services=ins.instances||[];
  const metrics=await Promise.all(services.slice(0,8).map(i=>api.metrics(i.id,5).catch(()=>({metrics:[]}))));
  const latest=(idx)=>metrics[idx]?.metrics?.[metrics[idx].metrics.length-1]||{};
  const running=st.instances?.running||0,online=nodes.nodes.filter(n=>n.status==='online').length;
  const plan=(await api.subscription().catch(()=>({}))).plan||{};

  const onb=services.length===0?`<div class="lt-card" style="padding:28px;border-color:var(--lt-border-ember);margin-bottom:16px">
    <div style="font-size:20px;font-weight:800">Welcome to ${esc(brand.product||'.light')} 👋</div>
    <p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6;max-width:640px;margin:8px 0 16px">Browse a hosting plan to deploy a game, website, application, bot or database. ${esc(brand.product||'.light')} and Shade handle the Debian runtime, resources and networking underneath.</p>
    <a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting plans</a></div>`:'';

  const cards=services.slice(0,8).map((i,idx)=>{const m=latest(idx);return `<a class="lt-card" href="#/server/${esc(i.id)}" style="padding:18px;text-decoration:none;color:var(--lt-text);display:block">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <div style="min-width:0"><div style="font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</div>
        <div class="lt-meta">${esc(i.environmentId||i.image||i.category)} ${esc(i.environmentVersion||'')} · ${esc(plan.name||'plan')}</div></div>${badge(i.status)}</div>
    <div class="lt-grid lt-grid-3" style="gap:8px;margin-top:16px">
      ${[['CPU',(m.cpu||0)+'%'],['RAM',i.memoryMb+' MB'],['DISK',(m.disk||0)+'%']].map(([l,x])=>`<div><div class="lt-label">${l}</div><div style="font-weight:800;font-size:14px;margin-top:2px">${x}</div></div>`).join('')}
    </div>
    <div class="lt-meta" style="margin-top:12px">${(i.ports||[]).map(p=>p.host?`${p.container}→${p.host}`:p.container).join(', ')||'no ports'} · updated ${fmtAgo(i.updatedAt)}</div>
  </a>`;}).join('');

  const widgets={
    stats:()=>`<div class="lt-grid lt-grid-4">${[['Services',services.length,`${running} running`],['Nodes',`${online}/${nodes.nodes.length}`,'connected'],['Orders',(orders.orders||[]).length,'total'],['Deployments',(deps.deployments||[]).length,'all time']]
      .map(([l,x,s])=>`<div class="lt-card" style="padding:18px"><div class="lt-kpi-label">${l}</div><div class="lt-kpi" style="margin-top:8px">${esc(x)}</div><div class="lt-kpi-sub">${esc(s)}</div></div>`).join('')}</div>`,
    services:()=>section('Your services',`${services.length} provisioned`,cards||empty('No services yet','Purchase a plan to get your first service.','<a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting</a>')),
    orders:()=>section('Recent orders','',(orders.orders||[]).length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Order</th><th>Plan</th><th>Status</th><th>Service</th></tr></thead><tbody>${(orders.orders||[]).slice(0,5).map(o=>`<tr><td class="lt-td-mono">${esc(o.id)}</td><td>${esc(o.planSnapshot?.name||o.planId||'Custom')}</td><td>${badge(o.status)}</td><td>${o.instanceId?`<a href="#/server/${esc(o.instanceId)}">Manage</a>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="lt-meta">No orders yet.</p>'),
    deployments:()=>section('Deployments','',(deps.deployments||[]).length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Service</th><th>Status</th><th>Time</th></tr></thead><tbody>${(deps.deployments||[]).slice(0,5).map(d=>`<tr><td>${esc(d.instanceName||d.instanceId)}</td><td>${badge(d.status)}</td><td>${fmtAgo(d.createdAt)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="lt-meta">No deployments yet.</p>'),
    domains:()=>section('Domains','',(domains.domains||[]).length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Domain</th><th>SSL</th><th>Status</th></tr></thead><tbody>${(domains.domains||[]).slice(0,5).map(d=>`<tr><td class="lt-td-mono">${esc(d.domain)}</td><td>${badge(d.ssl_status)}</td><td>${badge(d.verified?'active':'pending')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="lt-meta">No domains yet.</p>'),
    activity:()=>section('Notifications','',(notes.notifications||[]).length?(notes.notifications||[]).slice(0,6).map(n=>`<div style="padding:9px 0;border-bottom:1px solid var(--lt-border);font-size:12px"><b>${esc(n.title)}</b><div class="lt-meta">${esc(n.message)} · ${fmtAgo(n.createdAt)}</div></div>`).join(''):'<p class="lt-meta">All caught up.</p>'),
  };
  const order=prefs.widgets.filter(id=>widgets[id]);
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Dashboard</h1><p class="lt-page-subtitle">Your hosting at a glance · ${esc(plan.name||'Free')} plan</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-secondary" id="customizeDash">Customize</button><a class="lt-btn lt-btn-primary" href="/hosting">Get hosting</a></div></div>
    ${onb}<div id="widgetArea" style="display:grid;gap:16px">${order.map(id=>widgets[id]()).join('')}</div>
    <div id="dashCustom" style="display:none"></div>`;
  v.querySelector('#customizeDash').addEventListener('click',()=>showDashCustomizer(v,prefs));
  poll(async()=>{if(currentView==='overview')await renderOverview();});
}

function showDashCustomizer(v,prefs){
  const box=v.querySelector('#dashCustom');
  if(box.style.display==='block'){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  const row=(w,i)=>`<div class="lt-row" style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--lt-border)">
    <input type="checkbox" data-w="${w.id}" ${prefs.widgets.includes(w.id)?'checked':''}>
    <span style="flex:1">${esc(w.label)}</span>
    <button class="lt-btn lt-btn-ghost lt-btn-sm" data-move="up" data-id="${w.id}">↑</button>
    <button class="lt-btn lt-btn-ghost lt-btn-sm" data-move="down" data-id="${w.id}">↓</button></div>`;
  box.innerHTML=`<div class="lt-card" style="padding:18px;margin-bottom:16px"><h3 class="lt-h3">Customize dashboard</h3>
    <p class="lt-meta">Changes save automatically and persist across sessions.</p>
    ${WIDGETS.map(row).join('')}
    <div class="lt-field" style="margin-top:14px"><label>Density</label><select class="lt-select" id="dashDensity">
      ${['compact','comfortable','spacious'].map(d=>`<option value="${d}" ${prefs.density===d?'selected':''}>${d}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="lt-btn lt-btn-secondary lt-btn-sm" id="dashReset">Restore defaults</button><button class="lt-btn lt-btn-primary lt-btn-sm" id="dashDone">Done</button></div>
  </div>`;
  const commit=()=>{savePrefs(prefs);renderOverview();};
  box.querySelectorAll('[data-w]').forEach(el=>el.addEventListener('change',()=>{
    if(el.checked&&!prefs.widgets.includes(el.dataset.w))prefs.widgets.push(el.dataset.w);
    if(!el.checked)prefs.widgets=prefs.widgets.filter(x=>x!==el.dataset.w);
    commit();
  }));
  box.querySelectorAll('[data-move]').forEach(el=>el.addEventListener('click',()=>{
    const i=prefs.widgets.indexOf(el.dataset.id),j=el.dataset.move==='up'?i-1:i+1;
    if(i<0||j<0||j>=prefs.widgets.length)return;
    [prefs.widgets[i],prefs.widgets[j]]=[prefs.widgets[j],prefs.widgets[i]];commit();
  }));
  box.querySelector('#dashDensity').addEventListener('change',e=>{prefs.density=e.target.value;commit();});
  box.querySelector('#dashReset').addEventListener('click',()=>{Object.assign(prefs,DEFAULT_PREFS);commit();});
  box.querySelector('#dashDone').addEventListener('click',()=>{box.style.display='none';box.innerHTML='';});
}

async function renderServers(category='all'){
  serversState.category=(category==='all'?'all':category);
  const v=app.querySelector('#view');const [list,templates,sub]=await Promise.all([api.instances(),api.environments(),api.subscription().catch(()=>({}))]);
  let rows=list.instances.filter(i=>serversState.category==='all'||i.category===serversState.category||(serversState.category==='website'&&i.category==='web'));
  if(serversState.status!=='all')rows=rows.filter(i=>i.status===serversState.status);
  if(serversState.search)rows=rows.filter(i=>(i.name+' '+i.image).toLowerCase().includes(serversState.search.toLowerCase()));
  rows=[...rows].sort((a,b)=>{const x=a[serversState.sort]??'',y=b[serversState.sort]??'';return (String(x).localeCompare(String(y)))*serversState.dir;});
  const pages=Math.max(1,Math.ceil(rows.length/serversState.per));if(serversState.page>pages)serversState.page=pages;
  const paged=rows.slice((serversState.page-1)*serversState.per,serversState.page*serversState.per);
  const cats=[['all','All Servers'],['game','Game Servers'],['web','Applications'],['website','Websites'],['database','Databases']];
  const table=paged.map(i=>`<tr><td><a class="lt-td-strong" href="#/server/${i.id}" style="color:var(--lt-text);text-decoration:none">${esc(i.name)}</a><div class="lt-meta">${esc(i.image)}</div></td><td>${esc(i.category)}</td><td>${badge(i.status)}</td><td class="lt-td-mono">${i.cpuCores} / ${i.memoryMb}MB</td><td class="lt-td-mono">${(i.ports||[]).map(p=>p.host?`${p.container}→${p.host}`:`${p.container} (auto)`).join(', ')||'—'}</td><td>${fmtAgo(i.createdAt)}</td><td><a class="lt-btn lt-btn-ghost lt-btn-sm" href="#/server/${i.id}">Manage</a></td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">${(cats.find(c=>c[0]===serversState.category)||cats[0])[1]}</h1><p class="lt-page-subtitle">${list.instances.length} total services</p></div><div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="/hosting">+ Get hosting</a></div></div>
    <div class="lt-toolbar"><div class="lt-search-field"><input class="lt-input" id="srvSearch" placeholder="Search servers…" value="${esc(serversState.search)}"></div>
      ${selectField('Status','statusFilter',[['all','All statuses'],['running','Running'],['stopped','Stopped'],['deploying','Deploying'],['error','Error']],serversState.status)}
      ${selectField('Sort','sortField',[['name','Name'],['createdAt','Created'],['status','Status'],['category','Type']],serversState.sort)}</div>
    ${table?`<div class="lt-card"><div class="lt-table-wrap"><table class="lt-table"><thead><tr><th class="sortable" data-sort="name">Name</th><th>Type</th><th class="sortable" data-sort="status">Status</th><th>CPU / RAM</th><th>Ports</th><th>Created</th><th></th></tr></thead><tbody>${table}</tbody></table></div><div class="lt-pagination"><span>Showing ${paged.length} of ${rows.length}</span><div style="display:flex;gap:6px"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="prev" ${serversState.page<=1?'disabled':''}>Prev</button><span style="padding:6px">${serversState.page}/${pages}</span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="next" ${serversState.page>=pages?'disabled':''}>Next</button></div></div></div>`
      :empty('No services yet','Purchase a hosting plan to get your first service.','<a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting</a>')}`;
  v.querySelector('#srvSearch')?.addEventListener('input',e=>{serversState.search=e.target.value;serversState.page=1;renderServers(serversState.category);});
  v.querySelector('#statusFilter')?.addEventListener('change',e=>{serversState.status=e.target.value;renderServers(serversState.category);});
  v.querySelector('#sortField')?.addEventListener('change',e=>{serversState.sort=e.target.value;renderServers(serversState.category);});
  v.querySelectorAll('[data-sort]')?.forEach(th=>th.addEventListener('click',()=>{serversState.dir=serversState.sort===th.dataset.sort?-serversState.dir:1;serversState.sort=th.dataset.sort;renderServers(serversState.category);}));
  v.querySelector('#prev')?.addEventListener('click',()=>{serversState.page--;renderServers(serversState.category);});
  v.querySelector('#next')?.addEventListener('click',()=>{serversState.page++;renderServers(serversState.category);});
  // Service creation happens only through checkout + verified payment.
}

async function openCreate(envData,sub){
  const envs=envData.environments||[];const plan=sub?.plan||{};
  // Debian is fixed — customers pick a runtime + exact version, never an OS.
  const runtimeOpts=envs.flatMap(e=>(e.versions||[]).map(v=>({value:`${e.id}|${v}`,label:`${e.name} ${v} · ${e.category}`})));
  const d=await modal('Create Server',`<form id="cf">
    <p class="lt-meta" style="margin-bottom:12px">Plan: <strong>${esc(plan.name||'Free')}</strong> · ${esc(plan.memoryMb||512)} MB RAM · ${esc(plan.cpuCores||1)} vCPU · ${esc(plan.diskGb||4)} GB disk · ${esc(plan.instances||3)} services. Resources are set by your plan.</p>
    ${field('Server name','name','text','','required')}
    ${selectField('Runtime & version','runtime',runtimeOpts)}
    ${selectField('Category','category',[['web','Web application'],['game','Game server'],['website','Website'],['database','Database'],['bot','Bot'],['app','Application']])}
    ${field('Startup command (optional)','command','text','','placeholder="Leave blank to use the runtime default"')}
    <p class="lt-meta">Ports are assigned automatically. Public host ports are randomized for security.</p>
    ${textarea('Environment (KEY=value per line)','env')}
  </form>`,{confirm:'Create'});
  if(!d)return;
  const [environmentId,version]=String(d.runtime||'').split('|');
  if(!environmentId||!version){toast('Choose a runtime and version','error');return;}
  const env={};for(const line of String(d.env||'').split('\n')){const m=line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2];}
  try{await api.createInstance({name:d.name,environmentId,version,category:d.category,command:d.command,env});toast('Server created — provisioning started','success');navigate();}catch(e){toast(e.message,'error');}
}

async function renderServer(id){
  if(currentServerId!==id){currentServerId=id;currentServerTab='overview';currentFilePath='/';}
  const v=app.querySelector('#view');const [{instance:i},logs,metrics,domainData]=await Promise.all([api.instance(id),api.logs(id,200),api.metrics(id,60),api.domains().catch(()=>({domains:[]}))]);
  const domains=(domainData.domains||[]).filter(d=>d.instance_id===id);
  const tab=currentServerTab||'overview';const tabs=['overview','console','logs','files','configuration','startup','networking','domains','backups','schedules','monitoring','activity'];
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">${esc(i.name)}</h1><p class="lt-page-subtitle">${esc(i.image)} · ${badge(i.status)}</p></div><div class="lt-page-actions">
    ${i.status==='running'?'<button class="lt-btn lt-btn-secondary" data-a="stop">Stop</button>':'<button class="lt-btn lt-btn-secondary" data-a="start">Start</button>'}
    <button class="lt-btn lt-btn-secondary" data-a="restart">Restart</button><button class="lt-btn lt-btn-secondary" data-a="deploy">Deploy</button><button class="lt-btn lt-btn-danger" data-a="delete">Delete</button></div></div>
    <div class="lt-tabs">${tabs.map(t=>`<button class="lt-tab ${t===tab?'active':''}" data-tab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}</div>
    <div class="lt-grid lt-grid-2" style="grid-template-columns:minmax(0,2fr) minmax(260px,1fr);align-items:start"><div id="tabView"></div>
      <aside class="lt-card" style="padding:16px"><h3 class="lt-h3" style="margin-bottom:12px">Server info</h3>
        <div class="lt-meta">Service ID</div><div class="lt-td-mono" style="font-size:12px;margin-bottom:10px">${esc(i.id)}</div>
        <div class="lt-meta">Runtime</div><div style="font-weight:700;margin-bottom:10px">${esc(i.environmentId||i.image)} ${i.environmentVersion?badge(i.environmentVersion):''}</div>
        <div class="lt-meta">Ports (auto-assigned host mapping)</div><div class="lt-td-mono" style="font-size:12px;margin-bottom:10px">${(i.ports||[]).map(p=>`${p.container}/${esc(p.protocol||'tcp')} → ${p.host?p.host:'pending'}`).join('<br>')||'none'}</div>
        <div class="lt-meta">Project domain</div><div class="lt-td-mono" style="font-size:12px;margin-bottom:6px">${domains.map(d=>esc(d.domain)).join('<br>')||'—'}</div>
        <div class="lt-meta">SSL</div><div style="margin-bottom:10px">${domains.map(d=>badge(d.ssl_status)).join(' ')||badge('pending')}</div>
        <div class="lt-meta">Resources (plan)</div><div style="font-weight:700;margin-bottom:10px">${i.cpuCores} vCPU · ${i.memoryMb} MB RAM · ${i.diskGb} GB disk</div>
        <div class="lt-meta">Node</div><div style="font-weight:700;margin-bottom:10px">${esc(i.nodeName||i.nodeId||'—')}</div>
        <div class="lt-meta">Created</div><div style="font-weight:700">${fmtTime(i.createdAt)}</div>
      </aside></div>`;
  v.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{currentServerTab=b.dataset.tab;renderServer(id);}));
  v.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',async()=>{const a=b.dataset.a;try{
    if(a==='delete'){if(await confirmDialog('Delete server',`Permanently delete ${i.name}?`,'Delete')){await api.deleteInstance(id);toast('Deleted','success');location.hash='#/servers';}return;}
    if(a==='deploy'){await api.deploy(id,{});toast('Deployment started','success');}else{await api.action(id,a);toast(`Server ${a}ped`,'success');}renderServer(id);
  }catch(e){toast(e.message,'error');}}));
  const tv=v.querySelector('#tabView');const last=metrics.metrics[metrics.metrics.length-1]||{};
  if(tab==='overview'){
    tv.innerHTML=`<div class="lt-grid lt-grid-3" style="margin-bottom:16px">${[['CPU',(last.cpu||0)+'%'],['Network',`${fmtNum(last.net_in||0)} ↓ / ${fmtNum(last.net_out||0)} ↑`],['Disk',(last.disk||0)+'%']].map(([l,x])=>`<div class="lt-card" style="padding:18px"><div class="lt-kpi-label">${l}</div><div class="lt-kpi" style="margin-top:8px">${x}</div></div>`).join('')}</div>
    ${section('Configuration','', `<div class="lt-grid lt-grid-2"><div><div class="lt-meta">Image</div><div style="font-weight:700">${esc(i.image)}</div></div><div><div class="lt-meta">Command</div><div class="lt-td-mono">${esc(i.command||'default')}</div></div><div><div class="lt-meta">Resources</div><div style="font-weight:700">${i.cpuCores} cores · ${i.memoryMb} MB · ${i.diskGb} GB</div></div><div><div class="lt-meta">Ports</div><div class="lt-td-mono">${(i.ports||[]).map(p=>p.container+'/'+p.protocol).join(', ')||'none'}</div></div></div>`)}
    ${section('Recent logs','', `<div class="lt-console"><div class="lt-console-body" style="height:200px">${logs.logs.map(l=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')||'<div class="lt-console-line">No output yet.</div>'}</div></div>`)}`;
  }else if(tab==='console'){
    const lineHtml=(l)=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`;
    const seen=new Set(logs.logs.map(l=>l.id));
    tv.innerHTML=section('Live console','Streaming output · commands run inside the service container', `<div class="lt-console"><div class="lt-console-toolbar"><span class="lt-label">console</span><span style="flex:1"></span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="clr">Clear</button></div><div class="lt-console-body" id="cb">${logs.logs.map(lineHtml).join('')}</div><div class="lt-console-input"><span class="prompt">❯</span><input id="ci" placeholder="Type a command…" ${i.status!=='running'?'disabled':''}></div></div>${i.status!=='running'?'<p class="lt-meta" style="margin-top:8px">Start the service to enable commands.</p>':''}`);
    const box=tv.querySelector('#cb');
    const append=(l)=>{seen.add(l.id);box.innerHTML+=lineHtml(l);box.scrollTop=box.scrollHeight;};
    tv.querySelector('#clr').addEventListener('click',async()=>{try{await api.clearLogs(id);box.innerHTML='';seen.clear();toast('Cleared','success');}catch(e){toast(e.message,'error');}});
    tv.querySelector('#ci')?.addEventListener('keydown',async(e)=>{
      if(e.key!=='Enter'||!e.target.value.trim())return;
      const c=e.target.value;e.target.value='';
      box.innerHTML+=`<div class="lt-console-line cmd"><span class="ts">${fmtTime(Date.now())}</span><span>❯ ${esc(c)}</span></div>`;
      try{const r=await api.console(id,c);box.innerHTML+=`<div class="lt-console-line"><span class="ts">${fmtTime(Date.now())}</span><span>${esc(r.output||'(no output)')}</span></div>`;}
      catch(err){box.innerHTML+=`<div class="lt-console-line error">${esc(err.message)}</div>`;}
      box.scrollTop=box.scrollHeight;
    });
    // Live tail: append only lines we have not rendered yet.
    poll(async()=>{if(currentView==='server'&&currentServerTab==='console'&&document.body.contains(box)){
      try{const r=await api.logs(id,200);for(const l of r.logs)if(!seen.has(l.id))append(l);}catch{}
    }},2000);
  }else if(tab==='logs'){
    tv.innerHTML=section('Container logs',`Last ${logs.logs.length} lines`,`<div class="lt-console"><div class="lt-console-toolbar"><span class="lt-label">stdout / stderr</span><span style="flex:1"></span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="logRefresh">Refresh</button></div>
      <div class="lt-console-body" id="logBody" style="height:420px">${logs.logs.map(l=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')||'<div class="lt-console-line">No output yet.</div>'}</div></div>`);
    tv.querySelector('#logRefresh').addEventListener('click',async()=>{try{const r=await api.logs(id,300);const b=tv.querySelector('#logBody');b.innerHTML=r.logs.map(l=>`<div class="lt-console-line ${l.stream==='stderr'?'error':''}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')||'<div class="lt-console-line">No output yet.</div>';}catch(e){toast(e.message,'error');}});
    poll(async()=>{if(currentView==='server'&&currentServerTab==='logs')await renderServer(id);},10000);
  }else if(tab==='files'){
    const f=await api.files(id,currentFilePath||'/');currentFilePath=f.path;
    tv.innerHTML=`<p style="margin-bottom:12px"><a class="lt-btn lt-btn-secondary lt-btn-sm" href="/files?id=${esc(id)}">Open full drag-and-drop file manager ↗</a></p>`+
      section('File manager',f.path,`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Actions</th></tr></thead><tbody>
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
    tv.innerHTML=section(tab==='configuration'?'Configuration':'Startup settings','',`<p class="lt-meta" style="margin-bottom:12px">Runtime: ${esc(i.environmentId||'—')} ${esc(i.environmentVersion||'')} · ${i.cpuCores} vCPU · ${i.memoryMb} MB RAM · ${i.diskGb} GB disk (set by your plan)</p>
      <form id="sf">${field('Startup command','command','text',i.command)}${textarea('Environment (KEY=value)','env',Object.entries(i.env||{}).map(([k,x])=>k+'='+x).join('\n'))}<button class="lt-btn lt-btn-primary" type="submit">Save</button></form>`);
    tv.querySelector('#sf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const env={};for(const l of String(d.env||'').split('\n')){const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2];}try{await api.updateInstance(id,{command:d.command,env});toast('Saved — restart to apply','success');renderServer(id);}catch(err){toast(err.message,'error');}});
  }else if(tab==='monitoring'){
    tv.innerHTML=section('Resource usage','',metrics.metrics.length?metrics.metrics.slice(-40).map(m=>`<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--lt-border);font-size:12px"><span class="lt-td-mono" style="width:160px">${fmtTime(m.ts)}</span><span>CPU ${m.cpu}%</span><span>NET ${fmtNum(m.net_in)}/${fmtNum(m.net_out)}</span><span>DISK ${m.disk}%</span></div>`).join(''):empty('No metrics yet','Metrics appear once the agent reports.'));
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
let currentServerTab='overview',currentFilePath='/',currentServerId=null;

/* ---------- dashboard personalisation (persists across sessions) ---------- */
const WIDGETS=[
  {id:'stats',label:'Key metrics'},
  {id:'services',label:'Your services'},
  {id:'orders',label:'Recent orders'},
  {id:'deployments',label:'Deployments'},
  {id:'domains',label:'Domains'},
  {id:'activity',label:'Activity'},
];
const DEFAULT_PREFS={widgets:WIDGETS.map(w=>w.id),density:'comfortable',hidden:[]};
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('lt_dash_prefs')||'{}');return {...DEFAULT_PREFS,...p};}catch{return {...DEFAULT_PREFS};}}
function savePrefs(p){localStorage.setItem('lt_dash_prefs',JSON.stringify(p));document.documentElement.setAttribute('data-density',p.density);}

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
async function renderSettings(){const v=app.querySelector('#view'),[me,sessions]=await Promise.all([api.me(),api.sessions()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Settings</h1></div><div class="lt-grid lt-grid-2">
    ${section('Profile','',`<form id="pf">${field('Name','name','text',me.user.name||'')}${field('Username','username','text',me.user.username||'')}<button class="lt-btn lt-btn-primary" type="submit">Save</button></form>`)}
    ${section('Appearance','',`<p class="lt-meta">System preference is used by default. Your choice is saved across sessions.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${['system','light','dark','high-contrast'].map(t=>`<button class="lt-btn ${(window.__LT_THEME__?.get()||'system')===t?'lt-btn-primary':'lt-btn-secondary'}" data-theme-mode="${t}">${t.replace('-',' ')}</button>`).join('')}</div>`)}
    ${section('Password','',`<form id="pwf">${field('Current password','currentPassword','password')}${field('New password','newPassword','password','','minlength="10"')}<button class="lt-btn lt-btn-primary" type="submit">Change password</button></form>`)}
    ${section('Sessions','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Device</th><th>IP</th><th></th></tr></thead><tbody>${(sessions.sessions||[]).map(s=>`<tr><td class="lt-td-mono">${esc((s.user_agent||'Unknown').slice(0,40))}</td><td>${esc(s.ip||'—')}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-s="${s.id}">Revoke</button></td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Danger zone','',`<button class="lt-btn lt-btn-danger" id="delAcc">Delete account</button>`)}</div>`;
  v.querySelector('#pf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());await api.updateProfile(d);toast('Saved','success');});
  v.querySelector('#pwf').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());try{const r=await api.changePassword(d);api.setToken(r.token);toast('Password changed','success');e.target.reset();}catch(err){toast(err.message,'error');}});
  v.querySelectorAll('[data-theme-mode]').forEach(b=>b.addEventListener('click',()=>{window.__LT_THEME__?.set(b.dataset.themeMode);renderSettings();}));
  v.querySelectorAll('[data-s]').forEach(b=>b.addEventListener('click',async()=>{await api.deleteSession(b.dataset.s);toast('Revoked','success');renderSettings();}));
  v.querySelector('#delAcc').addEventListener('click',async()=>{const d=await modal('Delete account',field('Type DELETE to confirm','confirm','text',''),{danger:true,confirm:'Delete account'});if(d?.confirm==='DELETE'){await api.deleteAccount();api.setToken('');session=null;renderAuth('login');}});
}
async function renderAdmin(){const v=app.querySelector('#view'),[users,teams,audit]=await Promise.all([api.adminUsers(),api.teams(),api.audit()]);
  v.innerHTML=`<div class="lt-page-header"><h1 class="lt-page-title">Administration</h1></div><div class="lt-stack">
    ${section('Users','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>${users.users.map(u=>`<tr><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.name||'—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Workspaces','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Members</th><th>Services</th><th>Plan</th></tr></thead><tbody>${teams.teams.map(t=>`<tr><td class="lt-td-strong">${esc(t.name)}</td><td>${t.members}</td><td>${t.instances}</td><td>${esc(t.plan_id)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${section('Audit log','',`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Time</th><th>Action</th><th>Target</th></tr></thead><tbody>${audit.events.slice(0,30).map(e=>`<tr><td class="lt-td-mono">${fmtTime(e.ts)}</td><td>${esc(e.action)}</td><td>${esc(e.target_id||'—')}</td></tr>`).join('')}</tbody></table></div>`)}</div>`;
}

/* ---------- account: activity, invoices, payment methods ---------- */
async function renderActivity(){
  const v=app.querySelector('#view');
  const [orders,notes,deps]=await Promise.all([api.orders().catch(()=>({orders:[]})),api.notifications(50).catch(()=>({notifications:[]})),api.deployments().catch(()=>({deployments:[]}))]);
  const items=[
    ...(orders.orders||[]).map(o=>({ts:o.createdAt,type:o.status,title:`Order ${o.id}`,text:`${o.planSnapshot?.name||o.planId||'Custom'} · ${o.serviceName}`})),
    ...(deps.deployments||[]).map(d=>({ts:d.createdAt,type:d.status,title:`Deployment ${d.id}`,text:`${d.instanceName||d.instanceId} · ${d.source||''}`})),
    ...(notes.notifications||[]).map(n=>({ts:n.createdAt,type:n.type,title:n.title,text:n.message})),
  ].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,80);
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Activity</h1><p class="lt-page-subtitle">Orders, deployments and notifications in one timeline</p></div></div>
    ${section('Recent activity','',items.length?items.map(i=>`<div style="display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--lt-border)">
      <span class="lt-td-mono" style="width:150px;flex-shrink:0">${fmtTime(i.ts)}</span>${badge(i.type)}
      <div style="min-width:0"><b>${esc(i.title)}</b><div class="lt-meta">${esc(i.text)}</div></div></div>`).join(''):empty('No activity yet','Purchases and service events will appear here.'))}`;
}
async function renderInvoices(){
  const v=app.querySelector('#view');let rows=[];
  try{rows=(await api.invoices()).invoices||[];}catch(e){v.innerHTML=errState(e);return;}
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Invoices</h1><p class="lt-page-subtitle">Receipts for confirmed payments</p></div></div>
    ${section('Invoices',`${rows.length} records`,rows.length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Number</th><th>Amount</th><th>Tax</th><th>Status</th><th>Issued</th></tr></thead><tbody>
      ${rows.map(i=>`<tr><td class="lt-td-mono">${esc(i.number)}</td><td>${fmtMoney(i.amount,i.currency)}</td><td>${fmtMoney(i.tax,i.currency)}</td><td>${badge(i.status)}</td><td>${fmtTime(i.issuedAt||i.issued_at)}</td></tr>`).join('')}
      </tbody></table></div>`:empty('No invoices yet','Invoices appear after a confirmed payment.'))}`;
}
async function renderPaymentMethods(){
  const v=app.querySelector('#view');let methods=[];
  try{methods=(await api.billingMethods?.()).providers||[];}catch{}
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Payment methods</h1><p class="lt-page-subtitle">How payments are taken for this account</p></div></div>
    ${section('Available providers','',methods.length?methods.map(m=>`<div class="mkt-card" style="margin-bottom:10px"><b>${esc(m.label||m.provider)}</b><div class="lt-meta">Cards are entered on the secure provider checkout page. This platform never stores card numbers.</div></div>`).join(''):empty('No payment provider configured','Use the manual confirmation path for free orders, or ask the operator to configure Stripe.'))}`;
}

/* ---------- orders & provisioning ---------- */
async function renderOrders(){
  const v=app.querySelector('#view');let orders=[];
  try{orders=(await api.orders()).orders||[];}catch(e){v.innerHTML=errState(e);return;}
  const rows=orders.map(o=>`<tr><td class="lt-td-mono">${esc(o.id)}</td><td>${esc(o.planSnapshot?.name||o.planId||'Custom')}</td>
    <td>${esc(o.serviceName)}</td><td>${badge(o.status)}</td><td>${o.instanceId?`<a href="#/server/${esc(o.instanceId)}">${esc(o.instanceId)}</a>`:'—'}</td>
    <td>${fmtMoney(o.total,o.currency)}</td><td>${fmtTime(o.createdAt)}</td>
    <td>${o.status==='failed'?`<button class="lt-btn lt-btn-secondary lt-btn-sm" data-retry="${esc(o.id)}">Retry</button>`:''}
    ${o.instanceId?`<a class="lt-btn lt-btn-ghost lt-btn-sm" href="#/server/${esc(o.instanceId)}">Manage</a>`:''}</td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Orders & provisioning</h1><p class="lt-page-subtitle">Purchases and the services created from them</p></div>
    <div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="/hosting">Get hosting</a></div></div>
    ${section('Orders','',rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Order</th><th>Plan</th><th>Service</th><th>Status</th><th>Workload</th><th>Total</th><th>Date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      :empty('No orders yet','Choose a hosting plan to get started.','<a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting</a>'))}`;
  v.querySelectorAll('[data-retry]').forEach(b=>b.addEventListener('click',async()=>{
    try{await api.retryOrder(b.dataset.retry);toast('Provisioning retried','success');renderOrders();}catch(e){toast(e.message,'error');}
  }));
  if(orders.some(o=>['payment_processing','queued','provisioning'].includes(o.status)))poll(async()=>{if(currentView==='orders')await renderOrders();},6000);
}

/* ---------- plan checkout ---------- */
async function checkoutPlan(planId){
  if(!session||!planId)return false;
  // Purchasing always goes through the real checkout. .light and Shade create
  // the service after payment is confirmed — never from a browser form.
  location.href=`/checkout?plan=${encodeURIComponent(planId)}`;
  return true;
}

/* ---------- commercial dashboard views ---------- */
async function renderMarketplace(){
  const v=app.querySelector('#view');let cats=[],prods=[],byop=false;
  try{[cats,prods]=await Promise.all([api.categories(),api.products()]);cats=cats.categories||[];prods=prods.products||[];}catch{}
  try{byop=!!(await api.pricing()).config?.customPlansEnabled;}catch{}
  const active=currentParam||'all';
  const filtered=active==='all'?prods:prods.filter(p=>p.categoryId===active);
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Browse Hosting</h1><p class="lt-page-subtitle">Choose what you want to host and deploy in minutes</p></div>
    <div class="lt-page-actions">${byop?'<button class="lt-btn lt-btn-secondary" id="custom">Build your own plan</button>':''}<a class="lt-btn lt-btn-primary" href="/hosting">Full catalogue ↗</a></div></div>
    <div class="lt-tabs">${['all',...cats.map(c=>c.id)].map(c=>`<button class="lt-tab ${c===active?'active':''}" data-cat="${c}">${c==='all'?'All products':esc((cats.find(x=>x.id===c)||{}).name||c)}</button>`).join('')}</div>
    ${filtered.length?`<div class="lt-grid lt-grid-3">${filtered.map(p=>`<div class="lt-card lt-card-hover" style="padding:0;overflow:hidden">
      <div style="height:96px;background:linear-gradient(135deg,var(--lt-ember-alpha-12),var(--lt-success-dim));display:flex;align-items:center;justify-content:center;font-size:36px;color:var(--lt-ember-500)">${esc(p.icon)}</div>
      <div style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lt-badge lt-badge-neutral">${esc((cats.find(c=>c.id===p.categoryId)||{}).name||p.categoryId)}</span>${p.featured?'<span class="lt-badge lt-badge-ember">Featured</span>':''}</div>
        <div style="font-weight:750;font-size:15px;margin-top:10px">${esc(p.name)}</div><div class="lt-meta" style="margin-top:3px">${esc(p.shortDescription)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">${(p.features||[]).slice(0,3).map(f=>`<span class="lt-badge lt-badge-neutral" style="font-size:10px">${esc(f)}</span>`).join('')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><span style="font-weight:700">From $${(p.startingPriceMonthly/100).toFixed(0)}/mo</span><a class="lt-btn lt-btn-primary lt-btn-sm" href="/product?id=${p.slug}">View Plans</a></div>
      </div></div>`).join('')}</div>`:empty('No products','Products will appear here once configured by an administrator.')}`;
  v.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{location.hash='#/market/'+b.dataset.cat;}));
  v.querySelector('#custom')?.addEventListener('click',()=>{location.href='/configure';});
}

async function renderBilling(){
  const v=app.querySelector('#view');let sub={},plan=null,history=[],byop=false;
  try{const [s,h,p]=await Promise.all([api.subscription(),api.billingHistory(),api.pricing()]);sub=s.subscription||{};plan=s.plan;history=h.transactions||[];byop=!!p.config?.customPlansEnabled;}catch{}
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Plans & Billing</h1><p class="lt-page-subtitle">Your current plan, usage and billing history</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-secondary" id="browse">Browse plans</button>${byop?'<button class="lt-btn lt-btn-primary" id="custom">Build your own plan</button>':''}</div></div>
    <div class="lt-grid lt-grid-2">
      ${section('Current plan',sub.source==='custom'?'Custom configuration':(plan?.name||'Free'),`<div class="lt-grid lt-grid-3">${[['RAM',(plan?.memoryMb||sub.customConfig?.memoryMb||512)+' MB'],['CPU',(plan?.cpuCores||sub.customConfig?.cpuCores||1)+' cores'],['Storage',(plan?.diskGb||sub.customConfig?.diskGb||4)+' GB']].map(([l,x])=>`<div><div class="lt-meta">${l}</div><div style="font-weight:700;font-size:18px">${x}</div></div>`).join('')}</div>
        <div class="lt-meta" style="margin-top:14px">Status: ${badge(sub.status||'active')} · Price: $${((sub.priceMonthly||0)/100).toFixed(2)}/${sub.currency||'USD'}</div>`)}
      ${section('Available plans','Click to switch plans',`<div id="planList"><div class="lt-loading"><span class="lt-spinner"></span></div></div>`)}
      ${section('Billing history','',history.length?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Description</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${history.map(t=>`<tr><td class="lt-td-strong">${esc(t.description)}</td><td class="lt-td-mono">$${(t.amount/100).toFixed(2)} ${esc(t.currency)}</td><td>${badge(t.status)}</td><td>${fmtTime(t.createdAt)}</td></tr>`).join('')}</tbody></table></div>`:empty('No transactions','Plan activations and payments will appear here.'))}
    </div>`;
  v.querySelector('#browse').addEventListener('click',()=>{location.hash='#/market';});
  v.querySelector('#custom')?.addEventListener('click',()=>{location.href='/configure';});
  // load plans for switching
  try{const pl=(await api.plans()).plans||[];const list=v.querySelector('#planList');
    if(list)list.innerHTML=pl.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--lt-border)">
      <div><div style="font-weight:700">${esc(p.name)} ${sub.planId===p.id?badge('active'):''}</div><div class="lt-meta">${p.memoryMb}MB · ${p.cpuCores} vCPU · ${p.diskGb}GB</div></div>
      <div style="display:flex;align-items:center;gap:10px"><span style="font-weight:700">$${(p.price/100).toFixed(0)}/${p.interval==='yearly'?'yr':'mo'}</span>${sub.planId===p.id?'':`<button class="lt-btn lt-btn-secondary lt-btn-sm" data-plan="${p.id}">Select</button>`}</div></div>`).join('');
    list?.querySelectorAll('[data-plan]').forEach(b=>b.addEventListener('click',async()=>{
      if(!await confirmDialog('Switch plan','Activate this plan and provision a service with its resources? Your existing services are preserved.','Activate'))return;
      await checkoutPlan(b.dataset.plan);
    }));
  }catch{}
}

/* ---------- notifications & support ---------- */
async function renderNotifications(){
  const v=app.querySelector('#view');let r={notifications:[],unread:0};
  try{r=await api.notifications(200);}catch(e){v.innerHTML=errState(e);return;}
  const rows=r.notifications.map(n=>`<div class="lt-card" style="padding:14px 16px;${n.read?'':'border-color:var(--lt-border-ember)'}">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
      <div style="display:flex;gap:12px;min-width:0"><span class="lt-badge lt-badge-${n.type==='danger'?'danger':n.type==='warning'?'warning':n.type==='success'?'success':'neutral'}">${esc(n.type)}</span>
        <div style="min-width:0"><div style="font-weight:700">${esc(n.title)} ${n.read?'':badge('pending')}</div>
          <div class="lt-meta" style="white-space:pre-wrap;margin-top:4px">${esc(n.message)}</div>
          <div class="lt-meta" style="margin-top:6px">${fmtTime(n.createdAt)}</div></div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">${n.read?'':`<button class="lt-btn lt-btn-ghost lt-btn-sm" data-read="${esc(n.id)}">Mark read</button>`}
        <button class="lt-btn lt-btn-ghost lt-btn-sm" data-del="${esc(n.id)}">Delete</button></div>
    </div></div>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Notifications</h1><p class="lt-page-subtitle">${r.unread} unread · ${r.notifications.length} total</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-secondary" id="readAll">Mark all as read</button></div></div>
    ${r.notifications.length?`<div class="lt-stack">${rows}</div>`:empty('No notifications','Important account and service updates will appear here.')}`;
  v.querySelector('#readAll')?.addEventListener('click',async()=>{try{await api.markAllNotificationsRead();toast('All marked as read','success');await loadUnread();renderNotifications();}catch(e){toast(e.message,'error');}});
  v.querySelectorAll('[data-read]').forEach(b=>b.addEventListener('click',async()=>{try{await api.markNotificationRead(b.dataset.read);await loadUnread();renderNotifications();}catch(e){toast(e.message,'error');}}));
  v.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{try{await api.deleteNotification(b.dataset.del);await loadUnread();renderNotifications();}catch(e){toast(e.message,'error');}}));
}

async function renderSupport(){
  const v=app.querySelector('#view');let r={tickets:[]};
  try{r=await api.tickets();}catch(e){v.innerHTML=errState(e);return;}
  const rows=r.tickets.map(t=>`<tr><td class="lt-td-strong">${esc(t.subject)}</td><td>${esc(t.category)}</td>
    <td><span class="lt-badge lt-badge-${t.priority==='urgent'||t.priority==='high'?'danger':t.priority==='low'?'neutral':'warning'}">${esc(t.priority)}</span></td>
    <td>${badge(t.status)}</td><td class="lt-td-mono">${t.messageCount}</td><td>${fmtAgo(t.createdAt)}</td>
    <td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-t="${esc(t.id)}">Open</button></td></tr>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">Support</h1><p class="lt-page-subtitle">Ask questions and track your requests</p></div>
    <div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="newTicket">+ New ticket</button></div></div>
    ${section('Your tickets',`${r.tickets.length} requests`,rows?`<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Messages</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      :empty('No tickets yet','Need help? Open a support ticket and our team will reply.'))}`;
  v.querySelector('#newTicket').addEventListener('click',async()=>{
    const d=await modal('New support ticket',`<form id="tf">
      ${field('Subject','subject','text','','required')}
      ${selectField('Category','category',['general','technical','billing','account','feature'])}
      ${selectField('Priority','priority',['low','normal','high','urgent'],'normal')}
      ${textarea('Describe your issue','message','')}
    </form>`,{confirm:'Submit ticket'});
    if(!d)return;
    try{await api.createTicket(d);toast('Ticket created','success');renderSupport();}catch(e){toast(e.message,'error');}
  });
  v.querySelectorAll('[data-t]').forEach(b=>b.addEventListener('click',async()=>openTicket(b.dataset.t)));
}

async function openTicket(id){
  const v=app.querySelector('#view');let t;
  try{t=(await api.ticket(id)).ticket;}catch(e){toast(e.message,'error');return;}
  const msgs=t.messages.map(m=>`<div style="padding:12px 0;border-bottom:1px solid var(--lt-border)">
    <div style="display:flex;justify-content:space-between"><strong>${m.isStaff?'Support team':esc(m.author?.name||m.author?.email||'You')}</strong><span class="lt-meta">${fmtTime(m.createdAt)}</span></div>
    <div style="font-size:13px;line-height:1.6;margin-top:6px;white-space:pre-wrap">${esc(m.message)}</div></div>`).join('');
  v.innerHTML=`<div class="lt-page-header"><div><h1 class="lt-page-title">${esc(t.subject)}</h1>
    <p class="lt-page-subtitle">${esc(t.category)} · ${esc(t.priority)} priority · ${badge(t.status)}</p></div>
    <div class="lt-page-actions"><a class="lt-btn lt-btn-ghost" href="#/support">← All tickets</a>
    ${t.status!=='closed'?`<button class="lt-btn lt-btn-secondary" id="closeTicket">Close</button>`:`<button class="lt-btn lt-btn-secondary" id="reopenTicket">Reopen</button>`}</div></div>
    ${section('Conversation','',msgs||'<p class="lt-meta">No messages yet.</p>')}
    ${t.status!=='closed'?section('Reply','',`<form id="replyForm">${textarea('Your message','message','')}<button class="lt-btn lt-btn-primary" type="submit">Send reply</button></form>`):''}`;
  v.querySelector('#replyForm')?.addEventListener('submit',async(e)=>{e.preventDefault();const msg=new FormData(e.target).get('message');if(!String(msg||'').trim())return;
    try{await api.replyTicket(id,msg);toast('Reply sent','success');openTicket(id);await loadUnread();}catch(err){toast(err.message,'error');}});
  v.querySelector('#closeTicket')?.addEventListener('click',async()=>{try{await api.updateTicket(id,{status:'closed'});toast('Ticket closed','success');openTicket(id);}catch(err){toast(err.message,'error');}});
  v.querySelector('#reopenTicket')?.addEventListener('click',async()=>{try{await api.updateTicket(id,{status:'open'});toast('Ticket reopened','success');openTicket(id);}catch(err){toast(err.message,'error');}});
}
