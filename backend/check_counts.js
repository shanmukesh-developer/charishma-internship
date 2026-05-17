const { connectDB, getSequelize } = require('./config/db');
require('dotenv').config();

async function check() {
    await connectDB();
    const instance = getSequelize();
    const User = instance.models.User;
    const Restaurant = instance.models.Restaurant;
    const userCount = await User.count();
    const restCount = await Restaurant.count();
    console.log(`Users: ${userCount}, Restaurants: ${restCount}`);
    process.exit(0);
}

check();
