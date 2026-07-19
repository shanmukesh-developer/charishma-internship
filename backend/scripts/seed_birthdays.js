const { getBirthdayCelebrationModel } = require('../models/BirthdayCelebration');
const { getBirthdayWishModel } = require('../models/BirthdayWish');
const { connectDB } = require('../config/db');

(async () => {
  try {
    await connectDB();
    const BirthdayCelebration = getBirthdayCelebrationModel();
    const BirthdayWish = getBirthdayWishModel();

    if (!BirthdayCelebration || !BirthdayWish) {
      console.error('Models not initialized.');
      process.exit(1);
    }

    // Clear existing
    await BirthdayCelebration.destroy({ where: {} });
    await BirthdayWish.destroy({ where: {} });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23 hours from now

    // 1. Seed Active Approved Birthday 1
    const b1 = await BirthdayCelebration.create({
      userId: 'system',
      candidateName: 'Rahul Sharma',
      candidatePhotoUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&q=80',
      birthdayDate: new Date('2002-07-19'),
      status: 'approved',
      approvedAt: now,
      expiresAt: expiresAt,
      wishCount: 2
    });

    // Seed Wishes for b1
    await BirthdayWish.create({
      celebrationId: b1.id,
      userId: 'test_user_1',
      userName: 'Amit Patel',
      message: 'Happy Birthday Rahul! Have an amazing year ahead! 🎉🎂'
    });
    await BirthdayWish.create({
      celebrationId: b1.id,
      userId: 'test_user_2',
      userName: 'Sneha Reddy',
      message: 'Many more happy returns of the day! 🥳✨'
    });

    // 2. Seed Active Approved Birthday 2
    const b2 = await BirthdayCelebration.create({
      userId: 'system',
      candidateName: 'Priya Verma',
      candidatePhotoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80',
      birthdayDate: new Date('2003-07-19'),
      status: 'approved',
      approvedAt: now,
      expiresAt: expiresAt,
      wishCount: 1
    });

    await BirthdayWish.create({
      celebrationId: b2.id,
      userId: 'test_user_3',
      userName: 'Vikram Singh',
      message: 'HBD Priya! Let\'s celebrate tonight! 🎁🎈'
    });

    // 3. Seed Pending Nomination
    await BirthdayCelebration.create({
      userId: 'test_user_4',
      candidateName: 'Karthik Rao',
      candidatePhotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80',
      birthdayDate: new Date('2002-07-20'),
      status: 'pending',
      wishCount: 0
    });

    console.log('✅ [SEED_SUCCESS] Seeding of birthday celebrations completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ [SEED_FAILED] Error seeding birthdays:', err);
    process.exit(1);
  }
})();
