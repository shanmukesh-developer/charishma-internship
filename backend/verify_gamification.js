/* eslint-disable */
const { Sequelize } = require('sequelize');
const { initUserModel } = require('./models/User');
const { evaluateBadges } = require('./services/BadgeService');
const path = require('path');

async function verify() {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './local_dev.sqlite',
    logging: false
  });

  try {
    const User = initUserModel(sequelize);
    await sequelize.sync();

    // Create a dummy user for testing
    const [testUser, created] = await User.findOrCreate({
      where: { phone: '9999999991' },
      defaults: {
        name: 'Badge Tester',
        password: 'password',
        hostelBlock: 'X',
        roomNumber: '101',
        completedOrders: 4,
        badges: []
      }
    });

    console.log(`Testing with user: ${testUser.name} (Orders: ${testUser.completedOrders})`);

    // Simulate 5th order completion
    testUser.completedOrders += 1;
    const newBadges = evaluateBadges(testUser);
    
    console.log(`After 5 orders, new badges earned: ${JSON.stringify(newBadges)}`);
    
    if (newBadges.includes('Bronze Beginner')) {
      console.log('✅ PASS: Bronze Beginner badge awarded at 5 orders.');
    } else {
      console.log('❌ FAIL: Bronze Beginner badge not awarded.');
    }

    // Simulate 15th order completion
    testUser.completedOrders = 15;
    const silverBadges = evaluateBadges(testUser);
    console.log(`After 15 orders, new badges earned: ${JSON.stringify(silverBadges)}`);
    if (silverBadges.includes('Silver Scaler')) {
        console.log('✅ PASS: Silver Scaler badge awarded at 15 orders.');
    }

    // Cleanup
    await testUser.destroy();
    console.log('Verification finished.');
  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await sequelize.close();
  }
}

verify();
