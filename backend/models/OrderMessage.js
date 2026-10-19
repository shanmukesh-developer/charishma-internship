// C9: persisted order chat (socket 'sendMessage' in an order / Mega Basket room). Before C9 the messages were
// only broadcast, so a dispute had no record. Read access: the order's customer, its CURRENTLY assigned rider
// and admins (utils/orderMessages.canReadOrderChat). Kept ORDER_CHAT_RETENTION_DAYS (default 90) days, then
// deleted by the hourly retention job (jobs/index.js -> utils/orderMessages.purgeOldOrderMessages).
const { DataTypes } = require('sequelize');

let OrderMessage;

const initOrderMessageModel = (sequelize) => {
  if (!sequelize) return null;
  OrderMessage = sequelize.define('OrderMessage', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Order id, or a Mega Basket id (both are order rooms for the chat).
    orderId: { type: DataTypes.UUID, allowNull: false },
    // 'customer' | 'rider' | 'admin'
    senderType: { type: DataTypes.STRING(16), allowNull: false },
    senderId: { type: DataTypes.UUID, allowNull: false },
    text: { type: DataTypes.STRING(500), allowNull: false },
  }, {
    tableName: 'OrderMessages',
    timestamps: true,
    updatedAt: false,
    indexes: [
      { name: 'order_messages_order_created', fields: ['orderId', 'createdAt'] },
      { name: 'order_messages_created', fields: ['createdAt'] },
    ],
  });
  return OrderMessage;
};

const getOrderMessageModel = () => OrderMessage;

module.exports = { initOrderMessageModel, getOrderMessageModel };
