// .light — product-aware software package registry and compatibility engine.
// The backend is the ONLY authority for which packages/runtimes a product may
// use. The frontend asks for options; every submitted selection is validated.
import { getDb } from './db.js';
import { json, badRequest } from './util.js';

export function viewPackage(p) {
  return {
    id: p.id, name: p.name, description: p.description, category: p.category,
    productId: p.product_id, runtimeId: p.runtime_id, installKind: p.install_kind,
    versions: json(p.versions, []), defaultVersion: p.default_version,
    startupTemplate: p.startup_template, configSchema: json(p.config_schema, {}),
    ports: json(p.ports, []), storage: json(p.storage, {}),
    healthcheck: json(p.healthcheck, {}), featured: !!p.featured, status: p.status,
    sortOrder: p.sort_order,
  };
}

/** All published packages compatible with a product, including their versions. */
export function optionsForProduct(productId) {
  const db = getDb();
  if (!productId) return { packages: [], runtimes: [] };
  const rows = db.prepare(`SELECT p.* FROM software_packages p
    JOIN product_packages pp ON pp.package_id = p.id
    WHERE pp.product_id = ? AND p.status = 'published'
    ORDER BY p.featured DESC, p.sort_order`).all(productId);
  const packages = rows.map((p) => {
    const versions = db.prepare("SELECT version, runtime_version, status FROM package_versions WHERE package_id = ? AND status='published' ORDER BY created_at").all(p.id);
    return { ...viewPackage(p), versions: versions.length ? versions.map((v) => ({ version: v.version, runtimeVersion: v.runtime_version })) : json(p.versions, []) };
  });
  const runtimeIds = [...new Set(packages.map((p) => p.runtimeId).filter(Boolean))];
  // Rich runtime details let the checkout show what the backend auto-selected
  // for a package without the customer ever choosing infrastructure.
  const runtimeCatalog = runtimeIds.map((rid) => {
    const env = db.prepare("SELECT id, name, category, versions, default_version FROM environments WHERE id = ? AND status = 'published'").get(rid);
    return env
      ? { id: env.id, name: env.name, category: env.category, versions: json(env.versions, []), defaultVersion: env.default_version }
      : { id: rid, name: rid, versions: [] };
  });
  return { packages, runtimes: runtimeIds, runtimeCatalog };
}

/** Validate a customer's package selection against the purchased product. */
export function validateSelection({ productId, packageId, version, config = {} } = {}) {
  if (!productId) throw badRequest('product_required');
  if (!packageId) throw badRequest('package_required');
  const db = getDb();
  const link = db.prepare('SELECT package_id FROM product_packages WHERE product_id = ? AND package_id = ?').get(productId, packageId);
  if (!link) throw badRequest('package_not_compatible_with_product');
  const pkg = db.prepare("SELECT * FROM software_packages WHERE id = ? AND status='published'").get(packageId);
  if (!pkg) throw badRequest('package_unavailable');
  const versions = json(pkg.versions, []);
  const selectedVersion = String(version || pkg.default_version || '').trim();
  if (!selectedVersion || !versions.includes(selectedVersion)) throw badRequest('unsupported_package_version');
  const pver = db.prepare("SELECT * FROM package_versions WHERE package_id = ? AND version = ? AND status='published'").get(packageId, selectedVersion);

  // Validate configuration against the package schema. Unknown keys are dropped;
  // required options (e.g. EULA acceptance) must be explicitly set.
  const schema = json(pkg.config_schema, {});
  const clean = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = config?.[key];
    if (rule.required && !(value === true || value === 'true' || (typeof value === 'string' && value.trim()))) {
      throw badRequest(`${key}_required`);
    }
    if (value === undefined) { if (rule.default !== undefined) clean[key] = rule.default; continue; }
    if (rule.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw badRequest(`${key}_invalid`);
      if (rule.min !== undefined && n < rule.min) throw badRequest(`${key}_too_low`);
      if (rule.max !== undefined && n > rule.max) throw badRequest(`${key}_too_high`);
      clean[key] = n;
    } else if (rule.type === 'bool') clean[key] = value === true || value === 'true' || value === '1';
    else if (rule.type === 'select') {
      if (!rule.options?.includes(String(value))) throw badRequest(`${key}_invalid`);
      clean[key] = String(value);
    } else clean[key] = String(value).slice(0, 500);
  }
  return { package: viewPackage(pkg), version: selectedVersion,
    runtimeVersion: pver?.runtime_version || '', config: clean };
}

/** Used by the provisioning core to install the right software. */
export function packageForProvisioning(packageId, version) {
  const pkg = getDb().prepare("SELECT * FROM software_packages WHERE id = ?").get(packageId);
  if (!pkg) throw badRequest('package_not_found');
  const pver = getDb().prepare('SELECT * FROM package_versions WHERE package_id = ? AND version = ?').get(packageId, version);
  return { ...viewPackage(pkg), version, runtimeVersion: pver?.runtime_version || '',
    downloadUrl: pver?.download_url || '', sha256: pver?.sha256 || '' };
}
