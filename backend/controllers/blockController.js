const { getOrderModel } = require('../models/Order');

// SRM Hostels List
const SRM_HOSTELS = [
  'Vedavathi', 'Krishna', 'Ganga-A', 'Ganga-B', 'Yamuna', 'Godavari', 'Narmada'
];

// 60 s in-process cache: the leaderboard is the same for everyone (B10).
let activityCache = { at: 0, body: null };
const ACTIVITY_TTL_MS = 60 * 1000;

// @desc    Get order activity per block (aggregated in SQL, cached 60 s)
// @route   GET /api/blocks/activity (signed in)
const getBlockActivity = async (req, res) => {
  try {
    if (activityCache.body && Date.now() - activityCache.at < ACTIVITY_TTL_MS) return res.json(activityCache.body);
    const Order = getOrderModel();
    const sequelize = Order.sequelize;

    // Delivered orders of the last 30 days, counted per customer hostel block by the database
    // (was: every order row + every customer row loaded into memory on each call).
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await sequelize.query(
      `SELECT u."hostelBlock" AS "block", COUNT(*) AS "n"
         FROM "Orders" o JOIN "Users" u ON u."id" = o."userId"
        WHERE o."status" = 'Delivered' AND o."updatedAt" >= :since AND u."hostelBlock" IN (:blocks)
          AND o."isTestData" IS NOT TRUE
        GROUP BY u."hostelBlock"`,
      { replacements: { since, blocks: SRM_HOSTELS }, type: sequelize.QueryTypes.SELECT }
    );
    const activityMap = {};
    SRM_HOSTELS.forEach((h) => { activityMap[h] = 0; });
    rows.forEach((r) => { if (activityMap[r.block] !== undefined) activityMap[r.block] = Number(r.n) || 0; });

    const liveCounts = Object.keys(activityMap).map((name) => ({
      name,
      count: activityMap[name]
    })).sort((a, b) => b.count - a.count);

    activityCache = { at: Date.now(), body: liveCounts };
    res.json(liveCounts);
  } catch (error) {
    console.error('[BLOCK_ERROR]', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getBlockActivity, SRM_HOSTELS };
