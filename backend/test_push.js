require('dotenv').config();
const { connectDB, getSequelize } = require('./config/db');
const { sendPushToTokens } = require('./utils/push');

async function run() {
  try {
    await connectDB();
    const sequelize = getSequelize();
    
    const User = sequelize.models.User;
    
    let tokens = [];
    
    if (User) {
      const users = await User.findAll({ where: { isActive: true } });
      users.forEach(user => {
        let fcm = user.fcmTokens;
        if (typeof fcm === 'string') {
          try { fcm = JSON.parse(fcm); } catch (e) { fcm = []; }
        }
        if (Array.isArray(fcm) && fcm.length > 0) {
          tokens = tokens.concat(fcm);
        }
      });
    }

    tokens = [...new Set(tokens)];
    console.log('Found tokens in Production:', tokens);

    if (tokens.length > 0) {
      console.log('Sending test notifications to production tokens...');
      await sendPushToTokens(tokens, '🍕 Midnight Craving?', 'Use code PIZZA30 for 30% off your next order!', { type: 'promo' });
      
      // Delay slightly for effect
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendPushToTokens(tokens, '🏆 Elite Status Unlocked', 'Congratulations! You reached a new tier. Tap to claim rewards.', { type: 'badge' });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await sendPushToTokens(tokens, '🛵 Order #ZV-9941 Arriving', 'Your delivery partner is near your hostel block. Be ready!', { type: 'order' });
      
      console.log('All notifications sent successfully!');
    } else {
      console.log('No FCM tokens found even in production DB.');
    }
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
