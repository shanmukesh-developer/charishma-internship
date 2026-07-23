const { getSequelize } = require('../config/db');
const { connectDB } = require('../config/db');

const run = async () => {
  await connectDB();
  const sequelize = getSequelize();
  
  try {
    await sequelize.query('ALTER TABLE Users ADD COLUMN friendCode VARCHAR(10);');
    console.log('Added friendCode to Users');
  } catch (e) {
    console.log('friendCode might already exist or failed:', e.message);
  }

  try {
    await sequelize.query('ALTER TABLE Users ADD COLUMN statusSeenBy TEXT;');
    console.log('Added statusSeenBy to Users');
  } catch (e) {
    console.log('statusSeenBy might already exist or failed:', e.message);
  }

  try {
    await sequelize.query('ALTER TABLE Messages ADD COLUMN expiresAt DATETIME;');
    console.log('Added expiresAt to Messages');
  } catch (e) {
    console.log('expiresAt might already exist or failed:', e.message);
  }

  try {
    await sequelize.query('ALTER TABLE Messages ADD COLUMN attachmentUrl VARCHAR(255);');
    console.log('Added attachmentUrl to Messages');
  } catch (e) {
    console.log('attachmentUrl might already exist or failed:', e.message);
  }

  // Force sync the new tables
  const { getRoomModel } = require('../models/Room');
  const { getRoomParticipantModel } = require('../models/RoomParticipant');
  const { getFriendshipModel } = require('../models/Friendship');
  
  const Room = getRoomModel();
  const RoomParticipant = getRoomParticipantModel();
  const Friendship = getFriendshipModel();
  
  if (Room) await Room.sync({ alter: true });
  if (RoomParticipant) await RoomParticipant.sync({ alter: true });
  if (Friendship) await Friendship.sync({ alter: true });
  
  console.log('New tables synced.');
  
  process.exit(0);
};

run();
