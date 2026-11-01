// Demo PG listings, once (GlobalConfig DEMO_PGS_REMOVED_V1_DONE). Owner, 1 Nov 2026 evening: "remove all test data",
// "only keep the entered data". The 20 PG listings live on the server were invented by an old seed script
// (backend/seed_mega_50_stores_20_pgs.js, commit 52ffa5a6, deleted in c56e73e0: made-up names, addresses, rents and
// amenities); students would see them and could try to book. Only a PG with exactly one of those names is touched:
// deleted with its rooms and promotions when nothing else points at it (booking, review, rent record, complaint,
// PG Partner link), otherwise hidden (isActive false) so that history stays. DISABLE_DEMO_PG_REMOVAL=true switches
// it off.
const { Op } = require('sequelize');

const MARKER = 'DEMO_PGS_REMOVED_V1_DONE';
const DEMO_PG_NAMES = [
  'Zenvy Premium Boys Hostel', 'Starlight Girls Residence', 'Nexus Co-Living Residency', 'SRM Scholars PG for Men',
  'Lotus Female Elite Residency', 'Green Villa PG', 'Royal Heritage Boys Hostel', 'Savitribai Phule Women Hostel',
  'Capital Executive PG for Men', 'Parijata Girls Hostel', 'Vanguard Co-Living & Suites', 'Nandi Hills Student Residency',
  'Sunrise Women Residence', 'Amaravathi Deluxe Boys PG', 'Shree Krishna PG for Students', 'Falcon Heights Luxury Hostel',
  'Aura Girls Mansion', 'St. Mary Student House', 'SRM Park View Boys PG', 'Zenith Elite Residence for Women',
];

const runDemoPgRemoval = async () => {
  if (String(process.env.DISABLE_DEMO_PG_REMOVAL || '').toLowerCase() === 'true') return { skipped: 'disabled' };
  const { getSequelize } = require('../config/db');
  const sequelize = getSequelize();
  const M = (name) => (sequelize && sequelize.models && sequelize.models[name]) || null;
  const GlobalConfig = M('GlobalConfig');
  const PGHostel = M('PGHostel');
  if (!sequelize || !GlobalConfig || !PGHostel) return { skipped: 'models not ready' };
  if (await GlobalConfig.findOne({ where: { key: MARKER } })) return { skipped: 'already done' };

  const pgOwner = require('../modules/pgOwner');
  const count = async (Model, where) => (Model ? Model.count({ where }) : 0);
  const pgs = await PGHostel.findAll({ where: { name: { [Op.in]: DEMO_PG_NAMES } } });
  const out = { found: pgs.length, deleted: 0, hidden: 0, errors: [] };
  for (const pg of pgs) {
    try {
      const refs = (await count(M('PGBooking'), { hostelId: pg.id })) + (await count(M('PGReview'), { hostelId: pg.id }))
        + (await count(pgOwner.getModel('PgRentRecord'), { hostelId: pg.id })) + (await count(pgOwner.getModel('PgComplaint'), { hostelId: pg.id }))
        + (await count(pgOwner.getModel('PgOwnerListing'), { hostelId: pg.id }));
      if (refs) {
        if (pg.isActive !== false) await pg.update({ isActive: false });
        out.hidden++;
        continue;
      }
      await sequelize.transaction(async (t) => {
        if (M('PgPromotion')) await M('PgPromotion').destroy({ where: { hostelId: pg.id }, transaction: t });
        if (M('PGRoom')) await M('PGRoom').destroy({ where: { hostelId: pg.id }, transaction: t });
        await pg.destroy({ transaction: t });
      });
      out.deleted++;
    } catch (err) {
      // Something else still points at it: hide it instead, never leave it listed.
      try { await pg.update({ isActive: false }); out.hidden++; } catch { /* reported below */ }
      out.errors.push(`${pg.name}: ${String(err.message).slice(0, 100)}`);
    }
  }
  await GlobalConfig.create({ key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), ...out, errors: out.errors.length }) });
  try { require('../utils/responseCache').invalidate('pg_home'); } catch { /* the 60 s cache just expires */ }
  return out;
};

module.exports = { runDemoPgRemoval, MARKER, DEMO_PG_NAMES };
