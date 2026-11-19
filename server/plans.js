import { getDb } from './db.js';
import { conflict, json } from './util.js';

export function planFor(teamId) {
  const sub = getDb().prepare("SELECT * FROM subscriptions WHERE team_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(teamId);
  if (sub?.source === 'custom') {
    const c = json(sub.custom_config, {});
    if (c.cpuCores || c.memoryMb || c.diskGb) {
      return {
        id: 'custom', name: 'Custom Plan',
        memory_mb: c.memoryMb || 512, disk_gb: c.diskGb || 4, cpu_cores: c.cpuCores || 1,
        instances: c.instances || 10,
      };
    }
  }
  if (sub?.plan_id) {
    const plan = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id);
    if (plan) return plan;
  }
  const team = getDb().prepare('SELECT plan_id FROM teams WHERE id = ?').get(teamId);
  return getDb().prepare('SELECT * FROM plans WHERE id = ?').get(team?.plan_id || 'free') || getDb().prepare('SELECT * FROM plans WHERE id = ?').get('free');
}

export function teamUsage(teamId) {
  const db = getDb();
  const instances = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(memory_mb),0) AS memory, COALESCE(SUM(disk_gb),0) AS disk, COALESCE(SUM(cpu_cores),0) AS cpu FROM instances WHERE team_id = ? AND status != 'error'").get(teamId);
  return { instances: instances.count, memoryMb: instances.memory, diskGb: instances.disk, cpuCores: instances.cpu };
}

export function checkQuota(teamId, extraMemory = 0, extraDisk = 0, excludeInstanceId = null) {
  const plan = planFor(teamId);
  let usage = teamUsage(teamId);
  if (excludeInstanceId) {
    const row = getDb().prepare('SELECT memory_mb, disk_gb FROM instances WHERE id = ?').get(excludeInstanceId);
    if (row) { usage.memoryMb -= row.memory_mb; usage.diskGb -= row.disk_gb; }
  }
  if (usage.instances + 1 > (plan.instances || 3)) throw conflict('instance_quota_exceeded');
  if (usage.memoryMb + extraMemory > plan.memory_mb) throw conflict('memory_quota_exceeded');
  if (usage.diskGb + extraDisk > plan.disk_gb) throw conflict('storage_quota_exceeded');
  return plan;
}
