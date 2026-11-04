// ZCS Auto union-queue stands (runs on every startup from server.js, once per database).
//
// The driver app showed "No stands yet" (prod had no AutoRoutes / AutoPickupPoints, so "Put on charge" was
// disabled). data/auto_routes_v1_2026-10-24.json lists the owner's routes from SRM AP Main Gate (Mangalagiri,
// Vijayawada (Benz Circle), Guntur, Tadepalli, Undavalli) with the seat fare default + min-max range drivers may
// pick from, and one pickup point (the stand) per route. They are ordinary AutoRoute / AutoPickupPoint rows, so
// Admin > Auto-Ride > Routes lists and edits them like any other route.
// Rules, same pattern as scripts/catalogue_cleanup_import.js:
//  - every route and pickup goes through the admin controller's own routeInput / pickupInput validation, so the
//    seed can never write a row the admin UI would refuse;
//  - create-only: a route whose destination label already exists (any case) is skipped, whether or not it has a
//    pickup of the same name (no duplicate stand; an existing route is never edited, so admin edits win);
//  - one transaction for the routes, their pickups and the GlobalConfig marker AUTO_ROUTES_V1_DONE: two instances
//    booting at once can never both create the stands (the second one's marker insert fails and rolls back), and
//    once the marker exists the seed never runs again (a route the admin deletes is not re-created).
// Delete the marker row to re-run. Set DISABLE_AUTO_ROUTES_SEED=true to switch this off.
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'auto_routes_v1_2026-10-24.json');
const DEFAULT_MARKER = 'AUTO_ROUTES_V1_DONE';

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const runAutoRoutesSeed = async ({ dataPath = DATA_PATH } = {}) => {
  if (String(process.env.DISABLE_AUTO_ROUTES_SEED || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getModel, getSequelize } = require('../modules/autoRide');
  const { getGlobalConfigModel } = require('../models/GlobalConfig');
  const sequelize = getSequelize();
  const Route = getModel('AutoRoute');
  const Pickup = getModel('AutoPickupPoint');
  const GlobalConfig = getGlobalConfigModel();
  if (!sequelize || !Route || !Pickup || !GlobalConfig) return { skipped: 'models not ready' };
  if (!fs.existsSync(dataPath)) return { skipped: 'no auto route data' };
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const marker = data.marker || DEFAULT_MARKER;
  if (await GlobalConfig.findOne({ where: { key: marker } })) return { skipped: 'already done' };

  const { routeInput, pickupInput } = require('../modules/autoRide/controllers/admin');
  // Validate everything before writing anything: one bad entry creates nothing.
  const planned = (data.routes || []).map((entry) => ({
    route: routeInput(entry || {}),
    pickups: (Array.isArray(entry && entry.pickupPoints) ? entry.pickupPoints : []).map((p) => pickupInput(p || {})),
  }));

  const result = { created: 0, skipped: 0, pickupsCreated: 0, createdNames: [], skippedNames: [] };
  try {
    await sequelize.transaction(async (t) => {
      const existing = await Route.findAll({ attributes: ['id', 'destinationLabel'], transaction: t });
      const existingPickups = existing.length
        ? await Pickup.findAll({ where: { routeId: existing.map((r) => r.id) }, attributes: ['routeId', 'name'], transaction: t })
        : [];
      const taken = new Set(existing.map((r) => norm(r.destinationLabel)));
      for (const { route, pickups } of planned) {
        const dest = norm(route.destinationLabel);
        if (taken.has(dest)) {
          const sameDest = new Set(existing.filter((r) => norm(r.destinationLabel) === dest).map((r) => String(r.id)));
          const samePickup = pickups.some((p) => existingPickups.some((x) => sameDest.has(String(x.routeId)) && norm(x.name) === norm(p.name)));
          result.skipped++;
          result.skippedNames.push(`${route.destinationLabel}${samePickup ? '' : ' (destination exists, no matching pickup)'}`);
          continue;
        }
        const row = await Route.create(route, { transaction: t });
        for (const p of pickups) {
          await Pickup.create({ ...p, routeId: row.id }, { transaction: t });
          result.pickupsCreated++;
        }
        taken.add(dest);
        result.created++;
        result.createdNames.push(route.destinationLabel);
      }
      await GlobalConfig.create({
        key: marker,
        value: { doneAt: new Date().toISOString(), ...result },
        description: `ZENV Auto stands seeded (scripts/auto_routes_seed.js, ${path.basename(dataPath)}); delete to re-run.`,
      }, { transaction: t });
    });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return { skipped: 'already done' }; // another instance finished first
    throw err;
  }
  console.log(`[AUTO_ROUTES_SEED] created ${result.created}, skipped ${result.skipped}`);
  if (result.created) {
    try { require('../modules/autoRide/services/notify').admin('auto_route', 'created', null); } catch { /* admin list refreshes on its own */ }
  }
  return result;
};

module.exports = { runAutoRoutesSeed, DATA_PATH, DEFAULT_MARKER };

// CLI: node scripts/auto_routes_seed.js  (uses the same DATABASE_URL as the server)
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const { connectDB } = require('../config/db');
    await connectDB();
    const result = await runAutoRoutesSeed();
    console.log('[AUTO_ROUTES_SEED]', result);
    process.exit(0);
  })().catch((err) => { console.error('[AUTO_ROUTES_SEED_FAILED]', err); process.exit(1); });
}
