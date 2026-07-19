const { getConversationModel } = require('../models/Conversation');
const { getMessageModel } = require('../models/Message');

const checkAfterDarkHours = (req, res, next) => {
  // Temporarily unlocked for testing
  next();
};

const getConversations = async (req, res) => {
  try {
    const Conversation = getConversationModel();
    const { Op } = require('sequelize');
    
    // Fetch all conversations where user is a participant
    // Using string matching since participants is serialized JSON text for simplicity
    const convos = await Conversation.findAll({
      where: {
        participants: {
          [Op.like]: `%${req.user.id}%`
        }
      },
      order: [['lastMessageAt', 'DESC']]
    });

    res.json(convos);
  } catch (error) {
    console.error('[CHAT_GET_CONVOS_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getMessages = async (req, res) => {
  try {
    const Message = getMessageModel();
    const Conversation = getConversationModel();

    const conversationId = req.params.conversationId;
    const conversation = await Conversation.findByPk(conversationId);
    
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const messages = await Message.findAll({
      where: { conversationId },
      order: [['createdAt', 'ASC']]
    });

    res.json(messages);
  } catch (error) {
    console.error('[CHAT_GET_MESSAGES_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const createGroup = async (req, res) => {
  try {
    const { name, participants } = req.body;
    const Conversation = getConversationModel();
    
    // Ensure creator is in participants
    if (!participants.includes(req.user.id)) {
      participants.push(req.user.id);
    }

    const group = await Conversation.create({
      isGroup: true,
      name,
      participants
    });

    res.status(201).json(group);
  } catch (error) {
    console.error('[CHAT_CREATE_GROUP_ERROR]', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  checkAfterDarkHours,
  getConversations,
  getMessages,
  createGroup
};
