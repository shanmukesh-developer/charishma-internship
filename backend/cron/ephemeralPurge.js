const cron = require('node-cron');
const { Op } = require('sequelize');
const { getMessageModel } = require('../models/Message');
const { getRoomModel } = require('../models/Room');

const initEphemeralPurge = () => {
  // Run every hour to clean up expired messages and rooms
  cron.schedule('0 * * * *', async () => {
    try {
      const Message = getMessageModel();
      const Room = getRoomModel();
      
      const now = new Date();

      if (Message) {
        // Hard delete all messages that have expired (12h TTL)
        const deletedMessages = await Message.destroy({
          where: {
            expiresAt: {
              [Op.lt]: now
            }
          }
        });
        if (deletedMessages > 0) {
          console.log(`[EPHEMERAL PURGE] Hard-deleted ${deletedMessages} expired messages.`);
        }
      }

      if (Room) {
        // Archive or delete expired rooms
        // We set them to inactive instead of hard deleting to prevent zombie rooms
        // while maintaining the ability for admins to recreate or audit if absolutely necessary
        const archivedRooms = await Room.update(
          { isActive: false },
          {
            where: {
              expiresAt: {
                [Op.lt]: now
              },
              isActive: true
            }
          }
        );
        if (archivedRooms[0] > 0) {
          console.log(`[EPHEMERAL PURGE] Archived ${archivedRooms[0]} expired rooms.`);
        }
      }

    } catch (error) {
      console.error('[EPHEMERAL PURGE] Error during purge cycle:', error);
    }
  });

  console.log('[CRON] Ephemeral purge job initialized (runs hourly).');
};

module.exports = { initEphemeralPurge };
