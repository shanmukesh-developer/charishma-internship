const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getUserModel } = require('../models/User');
const { getVaultItemModel } = require('../models/VaultItem');
const { Op } = require('sequelize');

// @desc    Get all active vault items
// @route   GET /api/vault
router.get('/', async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const items = await VaultItem.findAll({ 
      where: { 
        isActive: true, 
        remainingCount: { [Op.gt]: 0 } 
      } 
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Claim a vault item
// @route   POST /api/vault/claim/:id
router.post('/claim/:id', protect, async (req, res) => {
  try {
    const VaultItem = getVaultItemModel();
    const User = getUserModel();
    
    const { getSequelize } = require('../config/db');
    const sequelize = getSequelize();

    let securedItem;

    await sequelize.transaction(async (t) => {
      // Re-fetch vault item with a row lock (FOR UPDATE)
      const item = await VaultItem.findByPk(req.params.id, { transaction: t, lock: true });
      if (!item) {
        throw new Error('Vault item not found');
      }

      if (item.remainingCount <= 0) {
        throw new Error('Sequence terminated: Item out of stock');
      }

      const user = await User.findByPk(req.user.id, { transaction: t, lock: true });
      if (!user) {
        throw new Error('User not found');
      }

      if (item.streakRequirement > 0 && (user.streakCount || 0) < item.streakRequirement) {
        throw new Error(`Insufficient streak: ${item.streakRequirement} days required`);
      }

      // Decrement stock
      item.remainingCount -= 1;
      await item.save({ transaction: t });

      securedItem = {
        id: item.id,
        name: item.name,
        remainingCount: item.remainingCount
      };
    });

    res.json({ 
      message: 'ACCESS GRANTED: Item secured in your vault.',
      item: securedItem
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Claim failed.' });
  }
});

module.exports = router;
