// .light — brand assets from /assets (single source of truth for all visuals).
export const ASSETS = {
  mark: '/assets/logos/light-mark.svg',
  wordmark: '/assets/logos/light-wordmark.svg',
  primary: '/assets/logos/light-primary.svg',
  favicon: '/assets/logos/favicon.svg',
  background: '/assets/backgrounds/volcanic-strata-16x9.svg',
  backgroundPng: '/assets/backgrounds/volcanic-strata-16x9.png',
  pattern: '/assets/patterns/tectonic-contours.svg',
};

const ICONS = {
  overview: 'monitoring', instances: 'instances', game: 'game-servers', web: 'applications',
  deployments: 'schedules', nodes: 'nodes', domains: 'network', backups: 'backups',
  schedules: 'schedules', account: 'settings', admin: 'security',
  storage: 'storage', teams: 'teams', templates: 'templates', terminal: 'terminal',
};

export function icon(name, size = 18) {
  const file = ICONS[name] || name || 'applications';
  return `/assets/icons/${file}.svg`;
}

export function iconImg(name, size = 18, className = '') {
  return `<img src="${icon(name)}" width="${size}" height="${size}" alt="" class="lt-icon ${className}" aria-hidden="true">`;
}

export function brandMark(size = 36) {
  return `<img src="${ASSETS.mark}" width="${size}" height="${size}" alt=".light" class="lt-brand-mark-img" aria-hidden="true">`;
}

export function brandWordmark(height = 28) {
  return `<img src="${ASSETS.wordmark}" height="${height}" alt=".light" class="lt-brand-wordmark-img">`;
}

window.__LT_ASSETS__ = { ASSETS, icon, iconImg, brandMark, brandWordmark };
