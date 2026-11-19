import { getDb } from './db.js';
import { conflict } from './util.js';

export function planFor(teamId) {
  const row = getDb().prepare(`
    SELECT p.* FROM teams t JOIN plans p ON p.id = t.plan_id WHERE t.id = ?
  `).get(teamId);
  return row || getDb().prepare('SELECT * FROM plans WHERE id = ?').get('free');
}

export function teamUsage(teamId) {
  const db = getDb();
  const instances = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(memory_mb),0) AS memory, COALESCE(SUM(disk_gb),0) AS disk, COALESCE(SUM(cpu_cores),0) AS cpu FROM instances WHERE team_id = ? AND status != ?').get(teamId, 'error');
  return { instances: instances.count, memoryMb: instances.memory, diskGb: instances.disk, cpuCores: instances.cpu };
}

export function checkQuota(teamId, extraMemory = 0, extraDisk = 0, excludeInstanceId = null) {
  const plan = planFor(teamId);
  let usage = teamUsage(teamId);
  if (excludeInstanceId) {
    const row = getDb().prepare('SELECT memory_mb, disk_gb FROM instances WHERE id = ?').get(excludeInstanceId);
    if (row) { usage.memoryMb -= row.memory_mb; usage.diskGb -= row.disk_gb; }
  }
  if (usage.memoryMb + extraMemory > plan.memory_mb) throw conflict('memory_quota_exceeded');
  if (usage.diskGb + extraDisk > plan.disk_gb) throw conflict('storage_quota_exceeded');
  return plan;
}
