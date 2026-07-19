const { DataTypes } = require('sequelize');

let Conversation;

const initConversationModel = (sequelize) => {
  if (!sequelize) return null;

  Conversation = sequelize.define('Conversation', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    isGroup: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: false 
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: true // Only required for groups
    },
    participants: {
      type: DataTypes.TEXT, // Store as JSON array of User UUIDs for simplicity in SQLite/Postgres compatibility
      allowNull: false,
      get() {
        const val = this.getDataValue('participants');
        return val ? JSON.parse(val) : [];
      },
      set(val) {
        this.setDataValue('participants', JSON.stringify(val));
      }
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    callActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    callParticipantCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // Hard limit to 20 inside socket logic
    }
  }, { timestamps: true });

  return Conversation;
};

module.exports = { initConversationModel, getConversationModel: () => Conversation };
