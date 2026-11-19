// .light — shared UI type metadata (no mock data).

const WORKLOAD_TYPES = {
  game: { label: 'Game server', color: 'var(--lt-ember-500)', icon: '◆' },
  web: { label: 'Web app', color: 'var(--lt-mineral)', icon: '◈' },
  db: { label: 'Database', color: 'var(--lt-sulfur)', icon: '◇' },
};

function statusBadge(status) {
  const map = {
    running: 'success', stopped: 'neutral', deploying: 'warning', error: 'danger', pending: 'info',
    online: 'success', offline: 'neutral',
  };
  const color = map[status] || 'neutral';
  const label = status === 'running' ? 'Running' : status.charAt(0).toUpperCase() + status.slice(1);
  return '<span class="lt-badge lt-badge-' + color + '"><span class="lt-dot lt-dot-' + color + '"></span>' + label + '</span>';
}

window.__LT_DATA__ = { WORKLOAD_TYPES: WORKLOAD_TYPES, statusBadge: statusBadge };
