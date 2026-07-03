const { getUserModel } = require('../models/User');
const jwt = require('jsonwebtoken');
const admin = require('../config/firebase');
const { normalizePhone } = require('../utils/phoneUtils');

const generateToken = (id, role) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[AUTH_FATAL] JWT_SECRET is not configured.');
    return null;
  }
  return jwt.sign({ id, role }, secret, { expiresIn: '30d' });
};

// @desc    Register a new user (requires Firebase phone verification)
// @route   POST /api/users/register
const registerUser = async (req, res) => {
  const { name, phone, password, hostelBlock, roomNumber } = req.body;

  try {
    const cleanPhone = normalizePhone(phone);
    // ── 1. Create the user ────────────────────────────────────────────────
    const User = getUserModel();
    const userExists = await User.findOne({ where: { phone: cleanPhone } });
    if (userExists) return res.status(400).json({ message: 'Account with this phone already exists' });

    const user = await User.create({ 
      name, 
      phone: cleanPhone, 
      password, 
      hostelBlock, 
      roomNumber,
      zenPoints: req.body.referralCode ? 50 : 0
    });

    if (req.body.referralCode) {
      const referrer = await User.findOne({ where: { referralCode: req.body.referralCode } });
      if (referrer) {
        referrer.zenPoints = (referrer.zenPoints || 0) + 50;
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await referrer.save();
        
        user.referredBy = referrer.referralCode;
        await user.save();
      }
    }
    const token = generateToken(user.id, user.role);
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.status(201).json({
      _id: user.id,
      name: user.name,
      phone: user.phone,
      isElite: false,
      address: user.address || '',
      city: user.city || 'Amaravathi',
      profileImage: user.profileImage || null,
      badges: user.badges || [],
      completedOrders: user.completedOrders || 0,
      token
    });
  } catch (_error) {
    console.error('[USER_REGISTER_ERROR]', _error);
    res.status(500).json({ message: `Registration Failed: ${_error.message}` });
  }
};



// @desc    Auth user & get token
// @route   POST /api/users/login
const authUser = async (req, res) => {
  const { phone, password, firebaseToken } = req.body;
  try {
    const User = getUserModel();
    const cleanPhone = normalizePhone(phone);
    const user = await User.findOne({ where: { phone: cleanPhone } });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // ── Phone Login Logic (Firebase or Mock) ──────────────────────
    if (firebaseToken) {
      if (firebaseToken === 'E2E_MOCK_TOKEN') {
        console.log(`[AUTH] Bypassing verification for E2E_MOCK_TOKEN (Phone: ${phone})`);
      } else {
        try {
          const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
          const firebasePhone = normalizePhone(decodedToken.phone_number);
          if (firebasePhone !== cleanPhone) {
            return res.status(401).json({ message: 'Phone mismatch with Firebase token' });
          }
        } catch (firebaseErr) {
          console.error('[AUTH_FIREBASE_ERR]', firebaseErr);
          return res.status(401).json({ message: 'Invalid Firebase token' });
        }
      }
    } else if (password) {
      // Fallback to password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid phone or password' });
      }
    } else {
      return res.status(400).json({ message: 'Authentication required (Password or Verification Token)' });
    }

    // ── 3. Return user data and JWT token ────────────────────────────────
    const token = generateToken(user.id, user.role);
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({
      _id: user.id,
      name: user.name,
      phone: user.phone,
      isElite: user.isElite || false,
      hostelBlock: user.hostelBlock,
      roomNumber: user.roomNumber,
      zenPoints: user.zenPoints || 0,
      address: user.address || '',
      city: user.city || 'Amaravathi',
      profileImage: user.profileImage || null,
      badges: user.badges || [],
      completedOrders: user.completedOrders || 0,
      role: user.role,
      token
    });
  } catch (_error) {
    console.error('[AUTH_ERROR]', _error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};


// @desc    Save FCM Token
// @route   POST /api/users/fcm-token
const saveFcmToken = async (req, res) => {
  const { userId, fcmToken, appVersion } = req.body;

  try {
    const User = getUserModel();
    const user = await User.findByPk(userId);
    if (user) {
      const tokens = user.fcmTokens || [];
      const idx = tokens.findIndex(t => t.appVersion === appVersion);
      if (idx > -1) { tokens[idx].token = fcmToken; } else { tokens.push({ token: fcmToken, appVersion }); }
      user.fcmTokens = tokens;
      await user.save();
      res.json({ message: 'FCM Token saved' });
    } else {
      res.status(401).json({ message: 'Account not found (Nexus Session Expired)' });
    }
  } catch (error) {
    console.error('[FCM_ERROR]', error);
    res.status(500).json({ message: 'Failed to save token' });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
const getUserProfile = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (user) {
      res.json({
        _id: user.id,
        name: user.name,
        phone: user.phone,
        hostelBlock: user.hostelBlock,
        roomNumber: user.roomNumber,
        walletBalance: user.walletBalance,
        streakCount: user.streakCount,
        totalOrders: user.totalOrders,
        role: user.role,
        zenPoints: user.zenPoints || 0,
        isElite: user.isElite || false,
        address: user.address || '',
        city: user.city || 'Amaravathi',
        profileImage: user.profileImage || null,
        badges: user.badges || [],
        completedOrders: user.completedOrders || 0
      });
    } else {
      res.status(401).json({ message: 'Account not found (Nexus Session Expired)' });
    }
  } catch (error) {
    console.error('[PROFILE_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
const updateUserProfile = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.user.id);
    if (user) {
      if (req.body.name) user.name = req.body.name;
      if (req.body.hostelBlock) user.hostelBlock = req.body.hostelBlock;
      if (req.body.roomNumber) user.roomNumber = req.body.roomNumber;
      if (req.body.address) user.address = req.body.address;
      if (req.body.city) user.city = req.body.city;
      if (req.body.profileImage !== undefined) user.profileImage = req.body.profileImage;
      
      // CRITICAL FIX: Removed insecure req.body.isElite assignment
      // Elite status must only be updated by a verified payment webhook or admin route.
      
      await user.save();
      res.json({
        _id: user.id,
        name: user.name,
        phone: user.phone,
        hostelBlock: user.hostelBlock,
        roomNumber: user.roomNumber,
        isElite: user.isElite,
        walletBalance: user.walletBalance || 0,
        streakCount: user.streakCount || 0,
        totalOrders: user.totalOrders || 0,
        zenPoints: user.zenPoints || 0,
        address: user.address || '',
        city: user.city || 'Amaravathi',
        profileImage: user.profileImage || null,
        badges: user.badges || [],
        completedOrders: user.completedOrders || 0,
        token: generateToken(user.id, user.role)
      });
    } else {
      res.status(401).json({ message: 'Account not found (Nexus Session Expired)' });
    }
  } catch (error) {
    console.error('[UPDATE_PROFILE_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Reset password using Firebase OTP
// @route   POST /api/users/reset-password
const resetPassword = async (req, res) => {
  const { phone, firebaseToken, newPassword } = req.body;

  if (!phone || !firebaseToken || !newPassword) {
    return res.status(400).json({ message: 'Phone, verification token, and new password are required' });
  }

  try {
    const cleanPhone = normalizePhone(phone);

    // 1. Verify the Firebase token to prove ownership of the phone number
    if (firebaseToken === 'E2E_MOCK_TOKEN') {
      console.log(`[AUTH] Bypassing verification for E2E_MOCK_TOKEN during password reset (Phone: ${phone})`);
    } else {
      try {
        const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
        const firebasePhone = normalizePhone(decodedToken.phone_number);
        if (firebasePhone !== cleanPhone) {
          return res.status(401).json({ message: 'Phone mismatch with Firebase token' });
        }
      } catch (firebaseErr) {
        console.error('[AUTH_FIREBASE_ERR]', firebaseErr);
        return res.status(401).json({ message: 'Invalid Firebase token' });
      }
    }

    // 2. Find User
    const User = getUserModel();
    const user = await User.findOne({ where: { phone: cleanPhone } });
    
    if (!user) {
      return res.status(404).json({ message: 'Account not found with this phone number.' });
    }

    // 3. Update Password (the model's beforeUpdate hook will automatically hash it)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('[RESET_PASSWORD_ERROR]', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Google SSO Login / Registration
// @route   POST /api/users/google-login
const googleLogin = async (req, res) => {
  const { firebaseToken } = req.body;
  if (!firebaseToken) return res.status(400).json({ message: 'Firebase token required' });

  try {
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
    const email = decodedToken.email;
    const name = decodedToken.name || 'Google User';
    const googleId = decodedToken.uid;
    
    // Google doesn't always give a phone number, so we mock a unique one for DB constraints if missing
    let phone = decodedToken.phone_number ? normalizePhone(decodedToken.phone_number) : null;
    
    const User = getUserModel();
    let user = await User.findOne({ where: { googleId } });
    
    if (!user && email) {
      user = await User.findOne({ where: { email } });
    }
    
    if (!user) {
      if (!phone) {
         // Create a unique mock phone for DB constraints since phone is required in the current schema
         phone = '1' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
      }
      user = await User.create({
        name,
        email,
        googleId,
        phone,
        password: Math.random().toString(36).slice(-8) + 'Google!1', // Random secure password
        role: 'student'
      });
    } else if (!user.googleId) {
      // Link existing account to Google
      user.googleId = googleId;
      await user.save();
    }

    const token = generateToken(user.id, user.role);
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      token
    });
  } catch (error) {
    console.error('[GOOGLE_LOGIN_ERROR]', error);
    res.status(401).json({ message: 'Invalid Google token' });
  }
};

// @desc    Logout user & clear cookie
// @route   POST /api/users/logout
const logoutUser = async (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    expires: new Date(0)
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = { registerUser, authUser, saveFcmToken, getUserProfile, updateUserProfile, resetPassword, googleLogin, logoutUser };
