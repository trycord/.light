// .light — shared brand bootstrap for every public/static page.
// Applies operator branding to the document shell. Ownership attribution is
// embedded server-side and is never modified here.
(function () {
  fetch('/api/branding').then((r) => r.json()).then((b) => {
    if (!b) return;
    if (b.docTitle) document.title = b.docTitle;
    const favicon = b.favicon || document.querySelector('link[rel=icon]')?.getAttribute('href');
    if (favicon) {
      let link = document.querySelector('link[rel=icon]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = favicon;
    }
    const root = document.documentElement;
    // Keep configured brand colours for decorative fills, but never override
    // the theme's accessible text tokens — doing so broke light-theme contrast.
    if (b.primaryColor) root.style.setProperty('--lt-brand-primary', b.primaryColor);
    if (b.accentColor) root.style.setProperty('--lt-brand-accent', b.accentColor);
    if (b.product) root.setAttribute('data-product', b.product);
  }).catch(() => { /* static fallback remains */ });
})();
