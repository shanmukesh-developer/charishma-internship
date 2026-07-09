const { getMegaBasketModel } = require('../models/MegaBasket');
const { getMegaBasketItemModel } = require('../models/MegaBasketItem');
const { getUserModel } = require('../models/User');
const { getDeliveryPartnerModel } = require('../models/DeliveryPartner');
const { Op } = require('sequelize');

// @desc    Create a new Mega Basket
// @route   POST /api/mega-basket
const createBasket = async (req, res) => {
  try {
    const { items, deliveryAddress, paymentMethod, upiUTR } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'No items provided in basket' });
    }

    if (!deliveryAddress) {
      return res.status(400).json({ message: 'Delivery address is required' });
    }

    const User = getUserModel();
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Calculate estimated total
    let estimatedTotal = 0;
    const itemsData = items.map(item => {
      const qty = Math.max(1, parseInt(item.quantity) || 1);
      const estPrice = Math.max(0, parseFloat(item.priceEstimated) || 0);
      estimatedTotal += estPrice * qty;

      return {
        name: item.name,
        quantity: qty,
        unit: item.unit || 'pcs',
        priceEstimated: estPrice,
        status: 'Pending'
      };
    });

    const shoppingFee = 30;
    const deliveryFee = 20;
    const deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();

    // Initial status determined by payment method
    // For COD, advance directly to PaidEstimate (ready for shopping)
    const initialStatus = paymentMethod === 'COD' ? 'PaidEstimate' : 'Created';
    const paymentStatus = paymentMethod === 'COD' ? 'Pending' : (upiUTR ? 'Pending' : 'Pending');

    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    const basket = await MegaBasket.create({
      userId: req.user.id,
      status: initialStatus,
      estimatedTotal,
      actualTotal: null,
      shoppingFee,
      deliveryFee,
      deliveryAddress,
      deliveryPin,
      upiUTR: paymentMethod === 'UPI' ? upiUTR : null,
      paymentMethod,
      paymentStatus
    });

    // Create the items associated with the basket
    const itemsWithBasketId = itemsData.map(item => ({
      ...item,
      basketId: basket.id
    }));
    await MegaBasketItem.bulkCreate(itemsWithBasketId);

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
        status: createdBasket.status
      });
    }

    res.status(201).json(createdBasket);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Submit payment UTR for estimation
// @route   POST /api/mega-basket/:id/pay
const payBasket = async (req, res) => {
  try {
    const { upiUTR } = req.body;
    if (!upiUTR) {
      return res.status(400).json({ message: 'UPI UTR is required' });
    }

    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    basket.upiUTR = upiUTR;
    basket.status = 'PaidEstimate';
    await basket.save();

    // Broadcast status update
    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Payment reference submitted', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
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

    res.json(basket);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all baskets of the logged in customer
// @route   GET /api/mega-basket
const getCustomerBaskets = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const MegaBasketItem = getMegaBasketItemModel();

    const baskets = await MegaBasket.findAll({
      where: { userId: req.user.id },
      include: [{ model: MegaBasketItem, as: 'items' }],
      order: [['createdAt', 'DESC']]
    });

    res.json(baskets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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
      where: { status: 'PaidEstimate', deliveryPartnerId: null },
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'hostelBlock'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(baskets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    basket.deliveryPartnerId = req.user.id;
    basket.status = 'PartnerAssigned';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Basket claimed successfully', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Start shopping items (Riders)
// @route   POST /api/delivery/mega-basket/:id/start-shopping
const startShopping = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized: You did not claim this basket' });
    }

    basket.status = 'Shopping';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Shopping started', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    const item = await MegaBasketItem.findByPk(itemId);
    if (!item || item.basketId !== basket.id) {
      return res.status(404).json({ message: 'Item not found in this basket' });
    }

    item.status = status;
    if (priceActual !== undefined) item.priceActual = priceActual;
    if (photoProofUrl !== undefined) item.photoProofUrl = photoProofUrl;
    await item.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('basket_item_updated', item);
    }

    res.json({ message: 'Item status updated', item });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    // Calculate actual total based on items that are not Unavailable
    let actualTotal = 0;
    basket.items.forEach(item => {
      if (item.status !== 'Unavailable') {
        const price = parseFloat(item.priceActual) || parseFloat(item.priceEstimated) || 0;
        actualTotal += price * item.quantity;
      }
    });

    basket.actualTotal = actualTotal;
    basket.status = 'PriceApprovalPending';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status, actualTotal });
      io.to(basket.id.toString()).emit('price_approval_request', { actualTotal });
    }

    res.json({ message: 'Bill submitted for customer approval', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    basket.status = 'Approved';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Prices approved successfully', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Mark purchase completed at shop (Riders)
// @route   POST /api/delivery/mega-basket/:id/purchase-completed
const purchaseCompleted = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    basket.status = 'Purchased';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Purchase marked as completed', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Start delivering the items (Riders)
// @route   POST /api/delivery/mega-basket/:id/start-delivery
const startDelivery = async (req, res) => {
  try {
    const MegaBasket = getMegaBasketModel();
    const basket = await MegaBasket.findByPk(req.params.id);
    if (!basket) {
      return res.status(404).json({ message: 'Basket not found' });
    }

    if (basket.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    basket.status = 'Delivering';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Delivery run started', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    if (basket.deliveryPin !== deliveryPin.trim()) {
      return res.status(400).json({ message: 'Invalid delivery PIN' });
    }

    basket.status = 'Delivered';
    basket.paymentStatus = 'Completed';
    await basket.save();

    const io = req.app.get('io');
    if (io) {
      io.to(basket.id.toString()).emit('statusUpdated', { id: basket.id, status: basket.status });
    }

    res.json({ message: 'Delivery completed successfully', basket });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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
          [Op.ne]: 'Delivered'
        }
      },
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(baskets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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

    const baskets = await MegaBasket.findAll({
      include: [
        { model: MegaBasketItem, as: 'items' },
        { model: User, as: 'user', attributes: ['name', 'phone', 'hostelBlock', 'roomNumber'] },
        { model: DeliveryPartner, as: 'deliveryPartner', attributes: ['name', 'phone', 'photoUrl'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50 // Keep response size manageable for admin dash
    });

    res.json(baskets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
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
