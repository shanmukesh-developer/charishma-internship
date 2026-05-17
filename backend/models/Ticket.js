const { DataTypes } = require('sequelize');

let Ticket;

const initTicketModel = (sequelize) => {
  if (!sequelize) return null;

  Ticket = sequelize.define('Ticket', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    orderId: { type: DataTypes.UUID, allowNull: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    status: { 
      type: DataTypes.ENUM('Open', 'In Progress', 'Resolved', 'Closed'), 
      defaultValue: 'Open' 
    },
    priority: {
      type: DataTypes.ENUM('Low', 'Medium', 'High', 'Critical'),
      defaultValue: 'Medium'
    },
    adminResponse: { type: DataTypes.TEXT, allowNull: true }
  }, {
    timestamps: true,
  });

  return Ticket;
};

const getTicketModel = () => {
  if (!Ticket) throw new Error('Ticket model not initialized. Call initTicketModel first.');
  return Ticket;
};

module.exports = { initTicketModel, getTicketModel };
