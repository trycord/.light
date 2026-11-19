import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncRoute } from '../util.js';

export function statsRoutes() {
  return asyncRoute(async (req, res) => {
    const db = getDb();
    if (req.user.role === 'admin' && req.query.all === 'true') {
      const instances = db.prepare('SELECT status, COUNT(*) AS count FROM instances GROUP BY status').all();
      const nodes = db.prepare('SELECT status, COUNT(*) AS count FROM nodes GROUP BY status').all();
      const deployments = db.prepare('SELECT status, COUNT(*) AS count FROM deployments GROUP BY status').all();
      return res.json({ scope: 'all', instances: countBy(instances), nodes: countBy(nodes), deployments: countBy(deployments) });
    }
    const teamId = req.teamId;
    const instances = db.prepare('SELECT status, COUNT(*) AS count FROM instances WHERE team_id = ? GROUP BY status').all(teamId);
    const deployments = db.prepare('SELECT status, COUNT(*) AS count FROM deployments WHERE team_id = ? GROUP BY status').all(teamId);
    const nodes = db.prepare("SELECT status, COUNT(*) AS count FROM nodes WHERE status = 'online' GROUP BY status").all();
    res.json({ scope: 'team', instances: countBy(instances), nodes: countBy(nodes), deployments: countBy(deployments) });
  });
}

function countBy(rows) {
  return rows.reduce((acc, row) => { acc[row.status] = row.count; return acc; }, {});
}
