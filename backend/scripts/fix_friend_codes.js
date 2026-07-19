const { connectDB } = require('../config/db');
const { getUserModel } = require('../models/User');

const run = async () => {
  await connectDB();
  const User = getUserModel();
  
  const generateFriendCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'ZNV-' + code;
  };

  const users = await User.findAll({ where: { friendCode: null } });
  console.log(`Found ${users.length} users without a friend code.`);
  
  for (const user of users) {
    user.friendCode = generateFriendCode();
    await user.save();
    console.log(`Generated friendCode ${user.friendCode} for user ${user.id}`);
  }
  
  console.log('Done!');
  process.exit(0);
};

run();
