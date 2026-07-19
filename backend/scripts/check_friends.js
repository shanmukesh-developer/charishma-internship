const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { connectDB, getSequelize } = require('../config/db');

async function run() {
  await connectDB();
  const sequelize = getSequelize();
  const User = sequelize.models.User;
  const Friendship = sequelize.models.Friendship;
  const Room = sequelize.models.Room;
  const RoomParticipant = sequelize.models.RoomParticipant;

  console.log('--- USERS ---');
  const users = await User.findAll({ attributes: ['id', 'name', 'phone', 'friendCode'] });
  users.forEach(u => {
    console.log(`User: ${u.name} | Phone: ${u.phone} | FriendCode: ${u.friendCode} | ID: ${u.id}`);
  });

  console.log('\n--- FRIENDSHIPS ---');
  if (Friendship) {
    const friendships = await Friendship.findAll();
    friendships.forEach(f => {
      console.log(`Friendship: ${f.id} | Requester: ${f.requesterId} | Recipient: ${f.recipientId} | Status: ${f.status}`);
    });
  }

  console.log('\n--- ROOMS ---');
  if (Room) {
    const rooms = await Room.findAll();
    rooms.forEach(r => {
      console.log(`Room: ${r.name} | Code: ${r.joinCode} | Admin: ${r.adminId} | Active: ${r.isActive}`);
    });
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
