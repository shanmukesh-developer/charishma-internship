// C5 wallet history for the owner: customers (GET /api/users/wallet/transactions) and riders
// (GET /api/delivery/wallet/transactions). Newest first, ?page=&limit= (max 100). Each row: signed
// amount, human label, running balance after it, and a link to the order / booking it belongs to.
const walletLedger = require('../utils/walletLedger');
const { sendServerError } = require('../utils/httpErrors');

const respond = async (req, res, ownerType) => {
  const Owner = ownerType === 'user' ? require('../models/User').getUserModel() : require('../models/DeliveryPartner').getDeliveryPartnerModel();
  const owner = await Owner.findByPk(req.user.id, { attributes: ['id', 'walletBalance'] });
  if (!owner) return res.status(404).json({ message: 'Account not found' });
  const { rows, page, limit, hasMore } = await walletLedger.listFor({ ownerType, ownerId: owner.id, page: req.query.page, limit: req.query.limit });
  res.set('Cache-Control', 'no-store');
  res.json({
    balance: walletLedger.toRupees(walletLedger.toPaise(owner.walletBalance)),
    transactions: rows.map(walletLedger.toPublic),
    page,
    limit,
    hasMore,
  });
};

exports.getMyWalletTransactions = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'rider' || role === 'restaurant') return res.status(403).json({ message: 'Customer accounts only.' });
    await respond(req, res, 'user');
  } catch (error) {
    sendServerError(res, error, '[WALLET_HISTORY_ERROR]');
  }
};

exports.getRiderWalletTransactions = async (req, res) => {
  try {
    await respond(req, res, 'rider');
  } catch (error) {
    sendServerError(res, error, '[WALLET_HISTORY_ERROR]');
  }
};
