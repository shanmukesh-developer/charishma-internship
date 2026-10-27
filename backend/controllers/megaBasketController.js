const { getMegaBasketModel } = require('../models/MegaBasket');
const { getMegaBasketItemModel } = require('../models/MegaBasketItem');
const { getUserModel } = require('../models/User');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { Op } = require('sequelize');

const broadcastBasketStatus = (req, basketId, payload) => {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const room = basketId.toString();
    io.to(room).emit('statusUpdated', payload);
    io.to('admin-room').emit('statusUpdated', payload);
  } catch (err) {
    console.warn('[BASKET_SOCKET_BROADCAST_WARN]', err.message);
  }
};

// The delivery PIN is the customer's secret: the rider must ask for it at the door,
// so it is never included in rider-facing responses.
// Mega Basket fees (one source for createBasket and the public GET /api/mega-basket/fees).
const MEGA_BASKET_SHOPPING_FEE = 30;
const MEGA_BASKET_DELIVERY_FEE = 20;

// @desc    Current Mega Basket fees (public, cached) so the app never hard-codes them
// @route   GET /api/mega-basket/fees
const getBasketFees = (req, res) => {
  res.json({ shoppingFee: MEGA_BASKET_SHOPPING_FEE, deliveryFee: MEGA_BASKET_DELIVERY_FEE, currency: 'INR' });
};

// S0: item proof photos are private media ('basket'); the basket's customer, rider and admins get
// short-lived signed links.
const signBasketItems = async (req, baskets) => {
  const list = (Array.isArray(baskets) ? baskets : [baskets]).map((b) => (b && typeof b.toJSON === 'function' ? b.toJSON() : b));
  const items = [];
  for (const b of list) if (b && Array.isArray(b.items)) items.push(...b.items);
  if (items.length) {
    const { signMediaFields, ORDER_PURPOSES } = require('../utils/mediaAccess');
    await signMediaFields(req, items, ['photoProofUrl'], { purposes: ORDER_PURPOSES });
  }
  return Array.isArray(baskets) ? list : list[0];
};
const signItem = async (req, item) => {
  const j = item && typeof item.toJSON === 'function' ? item.toJSON() : item;
  const { signMediaFields, ORDER_PURPOSES } = require('../utils/mediaAccess');
  if (j) await signMediaFields(req, j, ['photoProofUrl'], { purposes: ORDER_PURPOSES });
  return j;
};

const withoutPin = (basket) => {
  if (!basket) return basket;
  const json = typeof basket.toJSON === 'function' ? basket.toJSON() : { ...basket };
  delete json.deliveryPin;
  return json;
};

// Rider-side state machine: a basket moves forward only from the allowed statuses, with a
// conditional write so two taps / two riders can never both win (and the customer's price
// approval can never be skipped).
const BASKET_STEP_MESSAGES = {
  Shopping: 'Claim this basket before you start shopping.',
  PriceApprovalPending: 'Start shopping before you submit the bill.',
  Purchased: 'Wait for the customer to approve the bill before you buy.',
  Delivering: 'Finish the purchase before you start the delivery.',
  Delivered: 'This basket is not out for delivery yet.'
};
const advanceBasket = async (req, res, from, to, extra = {}) => {
  const MegaBasket = getMegaBasketModel();
  const basket = await MegaBasket.findByPk(req.params.id);
  if (!basket) { res.status(404).json({ message: 'Basket not found' }); return null; }
  if (basket.deliveryPartnerId !== req.user.id) { res.status(403).json({ message: 'Not authorized: You did not claim this basket' }); return null; }
  if (!from.includes(basket.status)) {
    res.status(400).json({ message: basket.status === 'Cancelled' ? 'This basket was cancelled.' : (BASKET_STEP_MESSAGES[to] || 'This basket is not at that step.'), status: basket.status });
    return null;
  }
  const [n] = await MegaBasket.update({ status: to, ...extra }, { where: { id: basket.id, deliveryPartnerId: req.user.id, status: { [Op.in]: from } } });
  if (n === 0) { res.status(409).json({ message: 'This basket was just updated. Please refresh.' }); return null; }
  basket.set({ status: to, ...extra });
  return basket;
};

// Wrong delivery PINs per basket, stored on the basket row (survives restarts; claimed atomically).
const MAX_BASKET_PIN_ATTEMPTS = 5;

// Log the real error, send the client a friendly fixed message (no SQL / table names).
const serverError = (res, tag, error) => {
  console.error(tag, error && error.message ? error.message : error);
  if (!res.headersSent) res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
};

// @desc    Create a new Mega Basket
// @route   POST /api/mega-basket
// Retry key (customer-3), same pattern as createOrder: a repeat returns the first basket with
// duplicate: true; 409 only while the first request is still running.
const BASKET_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;
const createBasket = async (req, res) => {
  const { readIdempotencyKey, claim } = require('../utils/idempotency');
  const basketKey = readIdempotencyKey(req, (req.body || {}).idempotencyKey);
  const slot = await claim('mega-basket', req.user.id, basketKey);
  if (slot.state === 'busy') {
    return res.status(409).json({ code: 'BASKET_IN_PROGRESS', message: 'Your list is still being placed. Hang tight.' });
  }
  if (slot.state === 'done') return res.status(slot.status).json({ ...slot.body, duplicate: true });
  const replayBasket = async (id) => {
    const MegaBasket = getMegaBasketModel();
    const existing = await MegaBasket.findByPk(id, { include: [{ model: getMegaBasketItemModel(), as: 'items' }] });
    return existing ? res.status(200).json({ ...existing.toJSON(), duplicate: true }) : null;
  };
  try {
    const { items, deliveryAddress, paymentMethod, upiUTR, deliverySlot } = req.body || {};
    // Survives restarts: the key is stored on the basket itself.
    if (basketKey) {
      const stored = await getMegaBasketModel().findOne({
        where: { userId: req.user.id, idempotencyKey: basketKey, createdAt: { [Op.gt]: new Date(Date.now() - BASKET_KEY_WINDOW_MS) } },
        attributes: ['id'],
      });
      if (stored && await replayBasket(stored.id)) return;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'No items provided in basket' });
    }

    if (items.length > 50) {
      return res.status(400).json({ message: 'A shopping list can have up to 50 items. Please split it into two lists.' });
    }
    if (items.some(item => !item || typeof item.name !== 'string' || !item.name.trim())) {
      return res.status(400).json({ message: 'Every item needs a name. Please check your list.' });
    }

    if (!deliveryAddress || typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 3) {
      return res.status(400).json({ message: 'Please add your delivery address (hostel block and room) so the rider can find you.' });
    }

    // The final bill is only known after shopping, so Mega Basket is Cash on Delivery only.
    if (String(paymentMethod || 'COD').trim().toUpperCase() !== 'COD') {
      return res.status(400).json({
        message: 'A shopping list is paid in cash when it arrives (the shop bill is known only after shopping). Please choose Cash on Delivery.',
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        allowed: ['COD']
      });
    }

    // Same campus ordering hours as regular orders (riders are off at night). With delivery slots ordering is
    // open at night too: the list is delivered in the chosen slot (shopping-list lead, 1 hour before the slot).
    const slotsLib = require('../utils/deliverySlots');
    await slotsLib.loadConfig();
    const serviceability = require('../utils/storeHours').getCampusServiceability(slotsLib.now());
    if (!serviceability.open) {
      return res.status(403).json({ message: serviceability.message, code: 'ORDERING_CLOSED', reopensAt: serviceability.reopensAt });
    }
    // New apps send the slot id; older builds send nothing -> the earliest open slot. A closed slot -> 409.
    let slotCols = {};
    if (slotsLib.slotsEnabled()) {
      const picked = slotsLib.resolveSlot(deliverySlot, slotsLib.slotsForOrder({ lead: slotsLib.leadForType('list'), at: slotsLib.now() }));
      if (!picked.ok) return res.status(picked.status).json(picked.body);
      slotCols = slotsLib.slotColumns(picked.slot);
    }

    const User = getUserModel();
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }

    // Calculate estimated total
    let estimatedTotal = 0;
    // Clamp BEFORE totalling (B24): the estimate used the raw quantity / price while the stored
    // item was clamped, so the shown estimate and the items disagreed.
    const itemsData = items.map(item => {
      const qty = Math.min(99, Math.max(1, parseInt(item.quantity) || 1));
      const rawPrice = parseFloat(item.priceEstimated);
      const estPrice = Math.round(Math.min(100000, Math.max(0, Number.isFinite(rawPrice) ? rawPrice : 0)) * 100) / 100;
      estimatedTotal += estPrice * qty;

      return {
        name: item.name.replace(/[<>]/g, '').trim().slice(0, 80),
        quantity: qty,
        unit: String(item.unit || 'pcs').replace(/[<>]/g, '').trim().slice(0, 20) || 'pcs',
        priceEstimated: estPrice,
        status: 'Pending'
      };
    });
    estimatedTotal = Math.round(estimatedTotal * 100) / 100;

    const shoppingFee = MEGA_BASKET_SHOPPING_FEE;
    const deliveryFee = MEGA_BASKET_DELIVERY_FEE;
    const deliveryPin = String(require('crypto').randomInt(1000, 10000));

    // Initial status determined by payment method
    // For COD, advance directly to PaidEstimate (ready for shopping)
    const initialStatus = 'PaidEstimate'; // COD: ready for shopping
    const paymentStatus = 'Pending'; // collected in cash on delivery

    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    // Basket + items in one transaction: a failure never leaves an empty basket behind.
    let basket;
    try {
    basket = await MegaBasket.sequelize.transaction(async (t) => {
    const created = await MegaBasket.create({
      userId: req.user.id,
      idempotencyKey: basketKey || null,
      status: initialStatus,
      estimatedTotal,
      actualTotal: null,
      shoppingFee,
      deliveryFee,
      deliveryAddress: deliveryAddress.replace(/[<>]/g, '').trim().slice(0, 500),
      ...slotCols,
      deliveryPin,
      upiUTR: null,
      paymentMethod: 'COD',
      paymentStatus
    }, { transaction: t });

    // Create the items associated with the basket
    const itemsWithBasketId = itemsData.map(item => ({
      ...item,
      basketId: created.id
    }));
    await MegaBasketItem.bulkCreate(itemsWithBasketId, { transaction: t });
    return created;
    });
    } catch (createErr) {
      // Same key raced in from another process: the unique index kept one basket, return it.
      if (basketKey && createErr && createErr.name === 'SequelizeUniqueConstraintError') {
        const winner = await MegaBasket.findOne({ where: { userId: req.user.id, idempotencyKey: basketKey }, attributes: ['id'] });
        if (winner && await replayBasket(winner.id)) return;
      }
      throw createErr;
    }

    // Fetch the full basket representation to return
    const createdBasket = await MegaBasket.findByPk(basket.id, {
      include: [{ model: MegaBasketItem, as: 'items' }]
    });

    // Notify Admin via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('admin_newMegaBasket', {
        id: createdBasket.id,
        customer: currentUser.name,
        address: createdBasket.deliveryAddress,
        estimatedTotal: createdBasket.estimatedTotal,
        paymentMethod: createdBasket.paymentMethod,
        status: createdBasket.status,
        ...require('../utils/deliverySlots').slotFields(createdBasket),
      });
    }

    const body = createdBasket.toJSON();
    await slot.finish(200, body); // a repeat is answered 200 + duplicate:true
    res.status(201).json(body);
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  } finally {
    await slot.release(); // no-op after finish(); frees the key after a refusal so a retry can run
  }
};

// @desc    Submit payment UTR for estimation
// @route   POST /api/mega-basket/:id/pay
const payBasket = async (req, res) => {
  // Online/UPI payments are switched off: a pasted UTR was never verified by anyone.
  res.status(400).json({
    message: 'A shopping list is paid in cash when it arrives.',
    code: 'PAYMENT_METHOD_UNAVAILABLE',
    allowed: ['COD']
  });
};

// @desc    Get a single Mega Basket details
// @route   GET /api/mega-basket/:id
const getBasket = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();
    const User = getUserModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    const basket = await MegaBasket.findByPk(req.params.id, {
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'phone', 'photoUrl'] }
      ]
    });

    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }
    const role = String(req.user.role || '').toLowerCase();
    if (basket.userId !== req.user.id && basket.deliveryPartnerId !== req.user.id && role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this basket' });
    }

    res.json(await signBasketItems(req, basket.userId === req.user.id || role === 'admin' ? basket : withoutPin(basket)));
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Get all baskets of the logged in customer
// @route   GET /api/mega-basket
const getCustomerBaskets = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    const DeliveryPartner = getDeliveryPartnerModel();
    const baskets = await MegaBasket.findAll({
      where: { userId: req.user.id },
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['id', 'name', 'phone', 'photoUrl'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(await signBasketItems(req, baskets));
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Get all pending baskets ready for shopping (Riders)
// @route   GET /api/delivery/mega-basket/pending
const getPendingBaskets = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();
    const User = getUserModel();

    const baskets = await MegaBasket.findAll({
      // Delivery slots: a list shows in the rider pool from DISPATCH_WINDOW_MIN before its slot start.
      where: { status: 'PaidEstimate', deliveryPartnerId: null, ...require('../utils/deliverySlots').dispatchDueWhere() },
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['hostelBlock'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Open pool = every rider sees it: only what is needed to decide on a claim (B11). The exact
    // address, customer identity and payment details are shown after the claim (rider's own list).
    res.json(baskets.map((b) => {
      const j = b.toJSON();
      return {
        id: j.id,
        status: j.status,
        estimatedTotal: j.estimatedTotal,
        shoppingFee: j.shoppingFee,
        deliveryFee: j.deliveryFee,
        paymentMethod: j.paymentMethod,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        area: j.user ? j.user.hostelBlock || null : null,
        ...require('../utils/deliverySlots').slotFields(j),
        user: { hostelBlock: j.user ? j.user.hostelBlock || null : null },
        items: (j.items || []).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, priceEstimated: i.priceEstimated, status: i.status })),
      };
    }));
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Claim a basket for shopping (Riders)
// @route   POST /api/delivery/mega-basket/:id/claim
const claimBasket = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.status !== 'PaidEstimate' || basket.deliveryPartnerId) {
      return res.status(400).json({ message: 'Basket already claimed or not ready' });
    }
    const slotsLib = require('../utils/deliverySlots');
    if (!slotsLib.isDispatchDue(basket)) {
      const opens = slotsLib.dispatchOpensAt(basket);
      return res.status(409).json({ code: 'SLOT_NOT_OPEN', message: `This list is for the ${basket.deliverySlot} slot. Riders can take it from ${slotsLib.timeLabel(opens)}.`, riderVisibleFrom: opens.toISOString() });
    }

    const [claimed] = await MegaBasket.update(
      { deliveryPartnerId: req.user.id, status: 'PartnerAssigned' },
      { where: { id: basket.id, status: 'PaidEstimate', deliveryPartnerId: null, ...require('../utils/deliverySlots').dispatchDueWhere() } }
    );
    if (claimed === 0) return res.status(400).json({ message: 'Another rider just claimed this basket.' });
    basket.set({ deliveryPartnerId: req.user.id, status: 'PartnerAssigned' });

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Basket claimed successfully', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Start shopping items (Riders)
// @route   POST /api/delivery/mega-basket/:id/start-shopping
const startShopping = async (req, res) => {
  try {
    const basket = await advanceBasket(req, res, ['PartnerAssigned', 'Shopping'], 'Shopping');
    if (!basket) return;

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Shopping started', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Update an item's actual price / purchase status (Riders)
// @route   PUT /api/delivery/mega-basket/:id/item-status
const updateItemStatus = async (req, res) => {
  try {
    const { itemId, status, priceActual, photoProofUrl } = req.body;

    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    let item = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId || '')) ? await MegaBasketItem.findByPk(itemId) : null;
    if (!item || item.basketId !== basket.id) {
      return res.status(404).json({ message: 'Item not found in this basket' });
    }

    if (!['PartnerAssigned', 'Shopping', 'PriceApprovalPending'].includes(basket.status)) {
      return res.status(400).json({ message: 'Items can only be updated while shopping.' });
    }
    if (status !== undefined && !['Pending', 'Approved', 'Purchased', 'Unavailable'].includes(status)) {
      return res.status(400).json({ message: 'Invalid item status' });
    }
    if (priceActual !== undefined && priceActual !== null) {
      const p = Number(priceActual);
      if (!Number.isFinite(p) || p < 0 || p > 100000) return res.status(400).json({ message: 'Please enter a valid price.' });
    }

    let photoValue;
    if (photoProofUrl !== undefined) {
      const { storeImageRef, sendImageError } = require('../utils/imageStore');
      const img = await storeImageRef(photoProofUrl, { req, ownerId: req.user.id, purpose: 'basket' });
      if (!img.ok) return sendImageError(res, img);
      photoValue = img.value;
    }

    // Item change + bill withdrawal in one transaction under the basket row lock (B24): a customer
    // approval racing this edit either lands first (we then refuse the edit) or waits and then
    // finds the bill withdrawn. An approved bill can never get a changed item behind it.
    let reopened = false;
    // SQLite (local dev): IMMEDIATE so the read-then-write cannot hit SQLITE_BUSY.
    const txOpts = MegaBasket.sequelize.getDialect() === 'sqlite' ? { type: require('sequelize').Transaction.TYPES.IMMEDIATE } : {};
    const outcome = await MegaBasket.sequelize.transaction(txOpts, async (t) => {
      const fresh = await MegaBasket.findByPk(basket.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!fresh || !['PartnerAssigned', 'Shopping', 'PriceApprovalPending'].includes(fresh.status)) return { refused: true };
      const row = await MegaBasketItem.findByPk(item.id, { transaction: t });
      const prevStatus = row.status;
      const prevPrice = row.priceActual;
      if (photoValue !== undefined) row.photoProofUrl = photoValue;
      if (status !== undefined) row.status = status;
      if (priceActual !== undefined) row.priceActual = priceActual === null ? null : Number(priceActual);
      const billChanged = row.status !== prevStatus || Number(row.priceActual) !== Number(prevPrice);
      await row.save({ transaction: t });
      // The customer was shown a bill: any price / availability change after that withdraws it, so
      // the rider must resubmit and the customer approves the new total (never a stale one).
      if (billChanged && fresh.status === 'PriceApprovalPending') {
        const [n] = await MegaBasket.update({ status: 'Shopping' }, { where: { id: basket.id, status: 'PriceApprovalPending' }, transaction: t });
        reopened = n > 0;
      }
      return { item: row };
    });
    if (outcome.refused) return res.status(409).json({ message: 'The bill for this basket was already approved. Items can no longer change.' });
    item = outcome.item;
    if (reopened) broadcastBasketStatus(req, basket.id, { id: basket.id, status: 'Shopping' });

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('basket_item_updated', await signItem(req, item));
    }

    res.json({ message: 'Item status updated', item: await signItem(req, item) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Submit bill / prices for customer approval (Riders)
// @route   POST /api/delivery/mega-basket/:id/submit-bill
const submitBill = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    const basket = await MegaBasket.findByPk(req.params.id, {
      include: [{ model: MegaBasketItem, as: 'items' }]
    });

    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!['PartnerAssigned', 'Shopping', 'PriceApprovalPending'].includes(basket.status)) {
      return res.status(400).json({ message: basket.status === 'Cancelled' ? 'This basket was cancelled.' : 'The bill for this basket was already approved.' });
    }

    // Calculate actual total based on items that are not Unavailable
    let actualTotal = 0;
    basket.items.forEach(item => {
      if (item.status !== 'Unavailable') {
        // A real ₹0 price (free item) counts as 0, not as "fall back to the estimate" (B24).
        const actual = item.priceActual === null || item.priceActual === undefined || item.priceActual === '' ? NaN : parseFloat(item.priceActual);
        const price = Number.isFinite(actual) ? actual : (parseFloat(item.priceEstimated) || 0);
        actualTotal += price * item.quantity;
      }
    });

    actualTotal = Math.round(actualTotal * 100) / 100;
    // Conditional: never revive a basket that was approved / cancelled after our read.
    const [submitted] = await MegaBasket.update(
      { actualTotal, status: 'PriceApprovalPending' },
      { where: { id: basket.id, status: { [Op.in]: ['PartnerAssigned', 'Shopping', 'PriceApprovalPending'] } } }
    );
    if (!submitted) return res.status(409).json({ message: 'This basket was just updated. Please refresh.' });
    basket.actualTotal = actualTotal;
    basket.status = 'PriceApprovalPending';

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status, actualTotal });
    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('price_approval_request', { actualTotal });
    }

    res.json({ message: 'Bill submitted for customer approval', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Approve actual prices (Customer)
// @route   POST /api/mega-basket/:id/approve
const approvePrices = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (basket.status !== 'PriceApprovalPending') {
      return res.status(400).json({ message: 'No approval request pending' });
    }

    // Bound to the exact bill: the client may send the total it showed (actualTotal); the update
    // also requires the stored total to be the one we just read.
    const seen = req.body && (req.body.actualTotal ?? req.body.expectedTotal);
    if (seen !== undefined && seen !== null && Math.abs(Number(seen) - Number(basket.actualTotal)) > 0.009) {
      return res.status(409).json({ code: 'BILL_CHANGED', message: 'The bill changed. Please check the new total and approve again.', actualTotal: basket.actualTotal });
    }
    const [approved] = await MegaBasket.update(
      { status: 'Approved' },
      { where: { id: basket.id, status: 'PriceApprovalPending', actualTotal: basket.actualTotal } }
    );
    if (approved === 0) return res.status(409).json({ message: 'The bill was just updated. Please refresh and check it again.' });
    basket.status = 'Approved';

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Prices approved successfully', basket });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Mark purchase completed at shop (Riders)
// @route   POST /api/delivery/mega-basket/:id/purchase-completed
const purchaseCompleted = async (req, res) => {
  try {
    const basket = await advanceBasket(req, res, ['Approved'], 'Purchased');
    if (!basket) return;

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Purchase marked as completed', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Start delivering the items (Riders)
// @route   POST /api/delivery/mega-basket/:id/start-delivery
const startDelivery = async (req, res) => {
  try {
    const basket = await advanceBasket(req, res, ['Approved', 'Purchased'], 'Delivering');
    if (!basket) return;

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Delivery run started', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Complete delivery with PIN validation (Riders)
// @route   POST /api/delivery/mega-basket/:id/complete-delivery
const completeDelivery = async (req, res) => {
  try {
    const { deliveryPin } = req.body;
    if (!deliveryPin) {
      return res.status(400).json({ message: 'Delivery PIN is required' });
    }

    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (basket.status === 'Delivered') {
      return res.status(409).json({ message: 'This basket is already delivered.' });
    }
    if (!['Approved', 'Purchased', 'Delivering'].includes(basket.status)) {
      return res.status(400).json({ message: BASKET_STEP_MESSAGES.Delivered });
    }

    // Claim one attempt atomically before comparing (parallel guesses cannot share one count).
    const [claimed] = await MegaBasket.update(
      { deliveryPinAttempts: MegaBasket.sequelize.literal('COALESCE("deliveryPinAttempts", 0) + 1') },
      { where: { id: basket.id, [Op.or]: [{ deliveryPinAttempts: null }, { deliveryPinAttempts: { [Op.lt]: MAX_BASKET_PIN_ATTEMPTS } }] } }
    );
    if (claimed === 0) {
      return res.status(429).json({ code: 'PIN_LOCKED', message: 'Too many wrong PINs for this basket. Please contact ZCS support to complete the handover.' });
    }
    if (basket.deliveryPin !== String(deliveryPin).trim()) {
      const fresh = await MegaBasket.findByPk(basket.id, { attributes: ['id', 'deliveryPinAttempts'] });
      const used = Number(fresh?.deliveryPinAttempts) || MAX_BASKET_PIN_ATTEMPTS;
      const left = Math.max(0, MAX_BASKET_PIN_ATTEMPTS - used);
      return res.status(400).json({ code: 'INVALID_PIN', attemptsLeft: left, message: left > 0 ? `That PIN doesn't match. Ask the customer for the 4-digit PIN in their ZCS app (${left} ${left === 1 ? 'try' : 'tries'} left).` : 'Too many wrong PINs for this basket. Please contact ZCS support to complete the handover.' });
    }

    const [done] = await MegaBasket.update(
      { status: 'Delivered', paymentStatus: 'Completed', deliveryPinAttempts: 0 },
      { where: { id: basket.id, deliveryPartnerId: req.user.id, status: { [Op.in]: ['Approved', 'Purchased', 'Delivering'] } } }
    );
    if (done === 0) return res.status(409).json({ message: 'This basket was just updated. Please refresh.' });
    basket.set({ status: 'Delivered', paymentStatus: 'Completed' });

    broadcastBasketStatus(req, basket.id, { id: basket.id, status: basket.status });

    res.json({ message: 'Delivery completed successfully', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Get active baskets claimed by the logged in rider
// @route   GET /api/mega-basket/rider/active
const getActiveBaskets = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();
    const User = getUserModel();

    const baskets = await MegaBasket.findAll({
      where: {
        deliveryPartnerId: req.user.id,
        status: {
          [Op.notIn]: ['Delivered', 'Cancelled']
        }
      },
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    res.json(await signBasketItems(req, baskets.map(withoutPin)));
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Get all baskets for admin panel
// @route   GET /api/mega-basket/admin/all
const getAllBaskets = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();
    const User = getUserModel();
    const DeliveryPartner = getDeliveryPartnerModel();

    // ?summary=1 (dashboard overview feed): totals, status and names only, no item rows, and an
    // optional smaller ?limit (1-50). The full list (Mega Basket page) is unchanged.
    const summary = req.query.summary === '1' || req.query.summary === 'true';
    if (summary) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 50);
      const rows = await MegaBasket.findAll({
        attributes: ['id', 'userId', 'deliveryPartnerId', 'status', 'estimatedTotal', 'actualTotal', 'shoppingFee', 'deliveryFee', 'deliveryAddress', 'paymentMethod', 'paymentStatus', 'createdAt', 'updatedAt'],
        include: [
          { model: User, as: 'user', attributes: ['name'] },
          { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'photoUrl'] }
        ],
        order: [['createdAt', 'DESC']],
        limit
      });
      return res.json(rows);
    }

    const baskets = await MegaBasket.findAll({
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'phone', 'photoUrl'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50 // Keep response size manageable for admin dash
    });

    res.json(await signBasketItems(req, baskets));
  } catch (error) {
    serverError(res, '[MEGA_BASKET_ERROR]', error);
  }
};

// @desc    Cancel a basket. Customer: only before shopping starts (Created / PaidEstimate /
//          PartnerAssigned). Admin: any time before delivery. COD only, so nothing to refund.
// @route   PUT /api/mega-basket/:id/cancel
const CUSTOMER_CANCELLABLE_BASKET = ['Created', 'PaidEstimate', 'PartnerAssigned'];
const ADMIN_CANCELLABLE_BASKET = ['Created', 'PaidEstimate', 'PartnerAssigned', 'Shopping', 'PriceApprovalPending', 'Approved', 'Purchased', 'Delivering'];
const cancelBasket = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) return res.status(404).json({ message: 'Basket not found' });
    const isAdmin = String(req.user.role || '').toLowerCase() === 'admin';
    if (!isAdmin && basket.userId !== req.user.id) return res.status(403).json({ message: 'Not authorized to cancel this basket' });
    if (basket.status === 'Cancelled') return res.status(400).json({ code: 'ALREADY_CANCELLED', message: 'This basket is already cancelled.' });
    const from = isAdmin ? ADMIN_CANCELLABLE_BASKET : CUSTOMER_CANCELLABLE_BASKET;
    if (!from.includes(basket.status)) {
      return res.status(400).json({ code: 'CANCEL_WINDOW_CLOSED', message: 'Your rider has already started shopping, so this basket can no longer be cancelled. Need help? Contact support.' });
    }
    const [n] = await MegaBasket.update({ status: 'Cancelled' }, { where: { id: basket.id, status: { [Op.in]: from } } });
    if (n === 0) return res.status(409).json({ message: 'This basket was just updated. Please refresh.' });
    basket.set({ status: 'Cancelled' });
    broadcastBasketStatus(req, basket.id, { id: basket.id, status: 'Cancelled' });
    try {
      const io = req.app.get('io');
      if (io && basket.deliveryPartnerId) io.to(`rider_${basket.deliveryPartnerId}`).emit('statusUpdated', { id: basket.id, status: 'Cancelled' });
    } catch (_e) { /* best effort */ }
    res.json({ message: 'Basket cancelled', basket: withoutPin(basket) });
  } catch (error) {
    serverError(res, '[MEGA_BASKET_CANCEL_ERROR]', error);
  }
};

// Baskets no rider claims are cancelled after MEGA_BASKET_TIMEOUT_MINUTES (default 60), so they do
// not sit in the rider pool forever. Runs from jobs/index.js together with the order auto-cancel job.
const BASKET_TIMEOUT_MINUTES = Math.max(15, parseInt(process.env.MEGA_BASKET_TIMEOUT_MINUTES, 10) || 60);
const expireStaleBaskets = async (io) => {
  const MegaBasket = getMegaBasketModel();
  if (!MegaBasket) return 0;
  const cutoff = new Date(Date.now() - BASKET_TIMEOUT_MINUTES * 60 * 1000);
  const OPEN = ['Created', 'PaidEstimate'];
  const stale = await MegaBasket.findAll({
    // Delivery slots: a list for a later slot is only cancelled once its slot started SLOT_UNCLAIMED_GRACE_MIN ago.
    where: { status: { [Op.in]: OPEN }, deliveryPartnerId: null, createdAt: { [Op.lt]: cutoff }, ...require('../utils/deliverySlots').slotGracePassedWhere(new Date()) },
    attributes: ['id', 'userId'],
    limit: 50,
  });
  let count = 0;
  for (const b of stale) {
    const [n] = await MegaBasket.update({ status: 'Cancelled' }, { where: { id: b.id, deliveryPartnerId: null, status: { [Op.in]: OPEN } } });
    if (n === 0) continue;
    count++;
    if (io) {
      const payload = { id: b.id, status: 'Cancelled', reason: 'NO_RIDER_TIMEOUT' };
      io.to(String(b.id)).emit('statusUpdated', payload);
      io.to('admin-room').emit('statusUpdated', payload);
    }
    try {
      const customer = await getUserModel().findByPk(b.userId, { attributes: ['id', 'fcmTokens'] });
      if (customer) {
        await require('../utils/push').sendPushToTokens(
          customer.fcmTokens,
          'Shopping list cancelled',
          'No rider could take your shopping list in time. Nothing was charged.',
          { basketId: String(b.id), type: 'ORDER_UPDATE' },
          { recipients: [customer.id] }
        );
      }
    } catch (pushErr) {
      console.warn('[BASKET_EXPIRE_PUSH_WARN]', pushErr.message);
    }
  }
  if (count) console.log(`[BASKET_EXPIRE] Cancelled ${count} unclaimed Mega Basket(s) after ${BASKET_TIMEOUT_MINUTES} min`);
  return count;
};


module.exports = {
  getBasketFees,
  MEGA_BASKET_SHOPPING_FEE,
  MEGA_BASKET_DELIVERY_FEE,
  cancelBasket,
  expireStaleBaskets,
  createBasket,
  payBasket,
  getBasket,
  getCustomerBaskets,
  getPendingBaskets,
  claimBasket,
  startShopping,
  updateItemStatus,
  submitBill,
  approvePrices,
  purchaseCompleted,
  startDelivery,
  completeDelivery,
  getActiveBaskets,
  getAllBaskets
};
