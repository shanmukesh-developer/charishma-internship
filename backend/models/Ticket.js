const { DataTypes } = require('sequelize');

let Ticket;

const initTicketModel = (sequelize) => {
  if (!sequelize) return null;

  Ticket = sequelize.define('Ticket', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Customer tickets set userId; rider tickets (POST /api/delivery/support) set riderId instead
    // (riders are DeliveryPartner rows, so they cannot satisfy the userId → Users foreign key).
    userId: { type: DataTypes.UUID, allowNull: true },
    riderId: { type: DataTypes.UUID, allowNull: true },
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
    slaBreachAt: { type: DataTypes.DATE, allowNull: true },
    // Admin who owns the ticket (set from the admin dashboard; name kept so the list needs no join).
    // Added to existing databases by config/db.js addMissingColumns.
    assigneeId: { type: DataTypes.UUID, allowNull: true },
    assigneeName: { type: DataTypes.STRING(120), allowNull: true },
    // Whole support conversation as text (every reply, oldest first, each stamped with its IST
    // time). Apps render it as-is; `responses` holds the same replies as structured data.
    adminResponse: { type: DataTypes.TEXT, allowNull: true },
    // Up to 3 photos the customer attached (campus media paths, purpose 'support', private).
    attachments: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('attachments');
        try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
      },
      set(val) {
        this.setDataValue('attachments', JSON.stringify(Array.isArray(val) ? val : []));
      }
    },
    responses: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('responses');
        if (!raw) return [];
        try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
      },
      set(val) {
        this.setDataValue('responses', JSON.stringify(Array.isArray(val) ? val : []));
      }
    }
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
