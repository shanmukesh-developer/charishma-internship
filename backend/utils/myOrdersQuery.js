// GET /api/orders/myorders: optional paging and search (all additive; no parameters = the newest 50,
// exactly as before).
//   ?before=<ISO date>  only orders placed before this instant (the app passes its oldest createdAt)
//   ?limit=<1..50>      page size (default 50)
//   ?q=<text>           store name or a dish / item name in the order (case-insensitive)
const { Op, fn, col, cast, where: sqlWhere } = require('sequelize');

const MAX_LIMIT = 50;

const parseMyOrdersQuery = (query = {}) => {
  const n = parseInt(query.limit, 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : MAX_LIMIT;
  let before = null;
  if (query.before) {
    const d = new Date(String(query.before));
    if (!Number.isNaN(d.getTime())) before = d;
  }
  // LIKE wildcards are dropped (a search for "50%" just looks for "50").
  const q = String(query.q || '').toLowerCase().replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { limit, before, q: q.length >= 2 ? q : '' };
};

const buildMyOrdersWhere = async ({ userId, before, q, Restaurant }) => {
  const where = { userId };
  if (before) where.createdAt = { [Op.lt]: before };
  if (q) {
    const like = `%${q}%`;
    // "ZEN-123" / "123": the human order ID too (utils/orderNumbers).
    const number = require('./orderNumbers').parseCode(q);
    const stores = await Restaurant.findAll({
      where: sqlWhere(fn('lower', col('name')), { [Op.like]: like }),
      attributes: ['id'],
      limit: 200,
    });
    where[Op.and] = [{
      [Op.or]: [
        ...(number !== null ? [{ orderNumber: number }] : []),
        ...(stores.length ? [{ restaurantId: { [Op.in]: stores.map((s) => s.id) } }] : []),
        sqlWhere(fn('lower', cast(col('Order.items'), 'TEXT')), { [Op.like]: like }),
      ],
    }];
  }
  return where;
};

module.exports = { parseMyOrdersQuery, buildMyOrdersWhere, MAX_LIMIT };
