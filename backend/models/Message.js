const { DataTypes } = require('sequelize');

let Message;

const initMessageModel = (sequelize) => {
  if (!sequelize) return null;

  Message = sequelize.define('Message', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    conversationId: { 
      type: DataTypes.UUID, 
      allowNull: false 
    },
    senderId: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    senderName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    text: { 
      type: DataTypes.TEXT, 
      allowNull: false 
    },
    isSystemMessage: {
      type: DataTypes.BOOLEAN,
      defaultValue: false // Used for "Zenvy After Dark Opens" or "Call Started" markers
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    attachmentUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    replyTo: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    reactions: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, { timestamps: true });

  return Message;
};

module.exports = { initMessageModel, getMessageModel: () => Message };
