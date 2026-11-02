// Delivery-slot tests: the c5 harness (real order / rider / admin routes on a temp SQLite file) plus the
// Mega Basket models and routes, store tokens, and a controllable slot clock (utils/deliverySlots._setNow).
const path = require('path');
const H = require('../c5/helpers');

process.env.DELIVERY_SLOTS = 'on'; // after the c5 harness (it defaults slots off for the older suites)

const S = H.r('utils/deliverySlots');
const express = require(path.join(H.B, 'node_modules/express'));
const jwt = require(path.join(H.B, 'node_modules/jsonwebtoken'));

const IST = (s) => new Date(`${s}+05:30`);
let basketServer = null;
let basketBase = null;

const setup = async () => {
  const ctx = await H.setup();
  if (!ctx.sequelize.models.MegaBasket) {
    H.r('models/MegaBasket').initMegaBasketModel(ctx.sequelize);
    H.r('models/MegaBasketItem').initMegaBasketItemModel(ctx.sequelize);
    const M = ctx.sequelize.models;
    M.MegaBasket.hasMany(M.MegaBasketItem, { foreignKey: 'basketId', as: 'items' });
    M.MegaBasketItem.belongsTo(M.MegaBasket, { foreignKey: 'basketId', as: 'basket' });
    M.MegaBasket.belongsTo(M.User, { foreignKey: 'userId', as: 'user' });
    M.MegaBasket.belongsTo(M.DeliveryPartner, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });
    await ctx.sequelize.sync();
  }
  if (!basketServer) {
    const app = express();
    app.use(express.json());
    app.set('io', null);
    app.use('/api/mega-basket', H.r('routes/megaBasketRoutes'));
    basketServer = await require('../listenFree').listenFree(app);
    basketBase = `http://127.0.0.1:${basketServer.address().port}`;
  }
  S._resetConfig();
  return ctx;
};

const teardown = async () => {
  S._setNow(null);
  if (basketServer) await new Promise((res) => basketServer.close(() => res()));
  basketServer = null;
  await H.teardown();
};

const basketApi = async (method, url, token, body) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(basketBase + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

let n = 0;
/** A store with a partner login (orders wait for the store) + one item; token = the store's partner token. */
const mkStore = async ({ name, price = 150, hours = { start: '00:00', end: '00:00' }, item = {}, store = {} } = {}) => {
  n++;
  const st = await H.ctx.M('Restaurant').create({ name: `Slot Kitchen ${n}`, location: 'SRM AP Food Court', password: 'storepass1', operatingHours: hours, isActive: true, isOpenNow: true, lat: 16.4632, lon: 80.5064, ...store });
  const it = await H.ctx.M('MenuItem').create({ restaurantId: st.id, name: name || `Slot Dish ${n}`, price, isAvailable: true, ...item });
  st.token = jwt.sign({ id: st.id, role: 'restaurant', tv: 0 }, process.env.JWT_SECRET);
  return { store: st, item: it };
};

module.exports = { ...H, H, S, IST, setup, teardown, basketApi, mkStore, setNow: (d) => S._setNow(d) };
