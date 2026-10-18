const { getCampusModel } = require('../models/Campus');
const { getCampusProfileModel } = require('../models/CampusProfile');
const { getVerificationModel } = require('../models/Verification');
const { getUserModel } = require('../../../models/User');
const realtime = require('../../../utils/realtime');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { isMailerConfigured, sendVerificationCode } = require('../../../utils/mailer');
const { cleanImageRef, pushToUsers } = require('../campusHelpers');
const { signedMediaUrl } = require('./mediaController');

// ── Email OTP settings ─────────────────────────────────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_DAILY_CAP_PER_USER = 8;
const OTP_DAILY_CAP_PER_EMAIL = 10;
const VERIFY_REWARD_POINTS = 150;

const otpHashFor = (userId, email, code) =>
  crypto.createHmac('sha256', `campus-otp:${process.env.JWT_SECRET || ''}`)
    .update(`${userId}|${String(email).toLowerCase()}|${String(code)}`)
    .digest('hex');

const envDomains = () => String(process.env.COLLEGE_EMAIL_DOMAINS || '')
  .split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

const domainMatches = (domain, allowed) => allowed.some((d) => domain === d || domain.endsWith(`.${d}`));

/**
 * Finds the campus for a college email and whether the domain is allowed.
 * Allowed domains: COLLEGE_EMAIL_DOMAINS (comma list) when set, otherwise every active campus's emailDomains.
 */
const resolveEmailCampus = async (domain, campusId) => {
  await ensureDefaultCampuses();
  const Campus = getCampusModel();
  const campuses = await Campus.findAll({ where: { isActive: true } });
  const fromEnv = envDomains();
  const allowedList = fromEnv.length ? fromEnv : [...new Set(campuses.flatMap((c) => c.emailDomains || []).map((d) => String(d).toLowerCase()))];
  const allowed = domainMatches(domain, allowedList);
  let campus = campuses.find((c) => domainMatches(domain, (c.emailDomains || []).map((d) => String(d).toLowerCase()))) || null;
  if (!campus && campusId) campus = campuses.find((c) => String(c.id) === String(campusId)) || null;
  if (!campus) campus = campuses.find((c) => c.code === 'SRMAP') || null;
  return { allowed, campus, allowedList };
};

// Friends caches eligibility (verification, campus, DOB) for 30 s; drop it when any of these change.
const clearFriendsEligibility = (userId) => {
  try { require('../../friends/services/eligibility').clearEligibility(userId); } catch { /* optional */ }
};

/** Tells the student's open apps (campus + main namespace) that their verification changed, and pushes. */
const notifyStudentVerification = async (req, userId, payload, push) => {
  clearFriendsEligibility(userId);
  try {
    const io = req.app && req.app.get('io');
    if (io) {
      io.of('/campus').to(`user:${userId}`).emit('profile:updated', payload);
      io.to(`user_${userId}`).emit('campus:verification', payload);
    }
  } catch (err) {
    console.warn('[CAMPUS_VERIFY_NOTIFY_WARN]', err.message);
  }
  if (push) {
    await pushToUsers([userId], push.title, push.body, {
      type: 'CAMPUS_VERIFICATION',
      status: payload.verificationStatus,
      screen: 'campus_verification',
    });
  }
};

/** Latest ID-card request for the app (shows pending / rejection note). */
const latestVerificationFor = async (req, userId) => {
  const Verification = getVerificationModel();
  if (!Verification) return null;
  const row = await Verification.findOne({
    where: { userId, type: 'id_card', status: { [Op.in]: ['pending', 'approved', 'rejected'] } },
    order: [['createdAt', 'DESC']],
  });
  if (!row) return null;
  const img = row.idCardImageUrl && !String(row.idCardImageUrl).startsWith('data:') ? row.idCardImageUrl : null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    reviewNotes: row.reviewNotes || null,
    idCardImageUrl: img ? signedMediaUrl(req, img) : null,
    submittedAt: row.createdAt,
    reviewedAt: row.status === 'pending' ? null : row.updatedAt,
  };
};

// Helper to seed default campuses if none exist
const ensureDefaultCampuses = async () => {
  const Campus = getCampusModel();
  if (!Campus) return;
  const count = await Campus.count();
  if (count === 0) {
    await Campus.bulkCreate([
      {
        name: 'SRM University AP',
        code: 'SRMAP',
        emailDomains: ['srmap.edu.in'],
        city: 'Amaravathi',
        isActive: true,
        settings: {
          branches: ['CSE', 'ECE', 'MECH', 'CIVIL', 'BBA', 'MBA', 'AI & ML'],
          hostelBlocks: ['Ganga-1', 'Ganga-2', 'Yamuna-1', 'Yamuna-2', 'Godavari', 'Narmada', 'Krishna'],
        }
      },
      {
        name: 'VIT-AP University',
        code: 'VITAP',
        emailDomains: ['vitap.ac.in', 'vitapstudent.ac.in'],
        city: 'Amaravathi',
        isActive: true,
        settings: {
          branches: ['CSE', 'ECE', 'MECH', 'LAW', 'BBA'],
          hostelBlocks: ['MH-1', 'MH-2', 'MH-3', 'LH-1', 'LH-2'],
        }
      },
      {
        name: 'KL University',
        code: 'KLU',
        emailDomains: ['kluniversity.in'],
        city: 'Vaddeswaram',
        isActive: true,
        settings: {
          branches: ['CSE', 'ECE', 'MECH', 'CIVIL', 'BT'],
          hostelBlocks: ['BH-1', 'BH-2', 'GH-1'],
        }
      }
    ]);
    console.log('🏛️ [CAMPUS_INIT] Seeded initial campuses.');
  }
};

// @desc    List available campuses
// @route   GET /api/campus/campuses
const getCampuses = async (req, res) => {
  try {
    await ensureDefaultCampuses();
    const Campus = getCampusModel();
    const campuses = await Campus.findAll({ where: { isActive: true } });
    res.json(campuses);
  } catch (error) {
    console.error('[GET_CAMPUSES_ERR]', error);
    res.status(500).json({ message: 'Failed to fetch campuses' });
  }
};

// @desc    Get or auto-create campus profile for user
// @route   GET /api/campus/profile
const getCampusProfile = async (req, res) => {
  try {
    await ensureDefaultCampuses();
    const CampusProfile = getCampusProfileModel();
    const Campus = getCampusModel();
    const User = getUserModel();

    if (!CampusProfile) {
      return res.status(500).json({ message: 'CampusProfile model not initialized' });
    }

    let profile = await CampusProfile.findOne({
      where: { userId: req.user.id },
      include: Campus ? [{ model: Campus, as: 'campus' }] : []
    });

    if (!profile) {
      // Find default campus (SRMAP)
      const defaultCampus = Campus ? await Campus.findOne({ where: { code: 'SRMAP' } }) : null;
      // Only real data: the student fills branch, year, section, bio and interests themselves.
      profile = await CampusProfile.create({
        userId: req.user.id,
        campusId: defaultCampus ? defaultCampus.id : null,
        branch: null,
        year: null,
        section: null,
        hostelBlock: req.user.hostelBlock || null,
        roomNumber: req.user.roomNumber || null,
        verificationStatus: 'unverified',
        isAdult: false,
        roles: ['student'],
        bio: null,
        interests: []
      });

      if (defaultCampus) {
        profile = await CampusProfile.findByPk(profile.id, {
          include: [{ model: Campus, as: 'campus' }]
        });
      }
    }

    // Attach basic user info. protect() only loads id/role/name/phone/email/hostel onto req.user,
    // so photo, status and friend code are read from the account row (they were always null here).
    const extra = await getUserModel().findByPk(req.user.id, {
      attributes: ['profileImage', 'statusEmoji', 'statusText', 'friendCode'],
    }).catch(() => null);
    const userData = {
      id: req.user.id,
      name: req.user.name,
      phone: req.user.phone,
      profileImage: extra ? extra.profileImage : (req.user.profileImage || null),
      statusEmoji: extra ? extra.statusEmoji : (req.user.statusEmoji || null),
      statusText: extra ? extra.statusText : (req.user.statusText || null),
      // Lets Campus > Me show and share the student's own friend code.
      friendCode: (extra && extra.friendCode) || req.user.friendCode || null,
    };

    // ID-card photos used to be stored as multi-MB data: URLs and were sent on every open.
    const profileJson = profile.toJSON ? profile.toJSON() : { ...profile };
    const idImg = profileJson.idCardImageUrl;
    profileJson.hasIdCard = !!idImg;
    profileJson.idCardImageUrl = idImg && !String(idImg).startsWith('data:') ? signedMediaUrl(req, idImg) : null;

    let lastVerification = null;
    try { lastVerification = await latestVerificationFor(req, req.user.id); } catch { /* optional */ }

    res.json({
      profile: profileJson,
      user: userData,
      lastVerification,
      verificationMethods: { email: isMailerConfigured(), idCard: true },
    });
  } catch (error) {
    console.error('[GET_CAMPUS_PROFILE_ERR]', error);
    res.status(500).json({ message: 'Failed to fetch campus profile' });
  }
};

// @desc    Update campus profile
// @route   PUT /api/campus/profile
const updateCampusProfile = async (req, res) => {
  try {
    const CampusProfile = getCampusProfileModel();
    const User = getUserModel();

    let profile = await CampusProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) {
      profile = await CampusProfile.create({ userId: req.user.id });
    }

    const {
      campusId,
      collegeId,
      branch,
      year,
      section,
      hostelBlock,
      roomNumber,
      dob,
      bio,
      interests
    } = req.body || {};

    // Friendly 400s instead of Postgres length / type errors (which surfaced as a 500).
    const LIMITS = { collegeId: 50, branch: 50, hostelBlock: 50, roomNumber: 50, section: 20, bio: 250 };
    const LABELS = { collegeId: 'College ID', branch: 'Branch', hostelBlock: 'Hostel block', roomNumber: 'Room number', section: 'Section', bio: 'Bio' };
    for (const [field, max] of Object.entries(LIMITS)) {
      const v = req.body?.[field];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string' && typeof v !== 'number') {
        return res.status(400).json({ code: 'INVALID_FIELD', field, message: `${LABELS[field]} is not valid.` });
      }
      if (String(v).length > max) {
        return res.status(400).json({ code: 'FIELD_TOO_LONG', field, message: `${LABELS[field]} can be at most ${max} characters.` });
      }
    }
    if (year !== undefined && year !== null && year !== '') {
      const y = Number(year);
      if (!Number.isInteger(y) || y < 1 || y > 6) {
        return res.status(400).json({ code: 'INVALID_YEAR', field: 'year', message: 'Year must be between 1 and 6.' });
      }
    }
    if (dob !== undefined && dob !== null && dob !== '' && Number.isNaN(new Date(dob).getTime())) {
      return res.status(400).json({ code: 'INVALID_DOB', field: 'dob', message: 'Enter a valid date of birth.' });
    }
    if (interests !== undefined && interests !== null && (!Array.isArray(interests) || interests.length > 30)) {
      return res.status(400).json({ code: 'INVALID_INTERESTS', field: 'interests', message: 'Pick up to 30 interests.' });
    }

    // A verified student's campus and college id are tied to the verification (admins can change them).
    const isVerified = profile.verificationStatus === 'verified';
    const isAdminCaller = String(req.user.role || '').toLowerCase() === 'admin';
    if (isVerified && !isAdminCaller) {
      const changingCampus = campusId !== undefined && String(campusId || '') !== String(profile.campusId || '');
      // An empty roll number (e.g. verified by college email) can be set once; a set one stays locked.
      const changingCollegeId = collegeId !== undefined && !!String(profile.collegeId || '').trim()
        && String(collegeId || '') !== String(profile.collegeId || '');
      if (changingCampus || changingCollegeId) {
        return res.status(400).json({
          code: 'VERIFIED_FIELDS_LOCKED',
          message: 'Your campus and college ID are locked after verification. Contact Zenvy support to change them.'
        });
      }
    }

    // Zenvy Friends: once Connect is activated (or an admin confirmed it) the DOB cannot change.
    if (dob !== undefined && profile.dobLockedAt && !isAdminCaller) {
      const current = profile.dob ? String(profile.dob).slice(0, 10) : '';
      const next = dob ? new Date(dob).toISOString().slice(0, 10) : '';
      if (next !== current) {
        return res.status(400).json({
          code: 'DOB_LOCKED',
          field: 'dob',
          message: 'Your date of birth is locked. Contact Zenvy support if it is wrong.'
        });
      }
    }

    let isAdult = profile.isAdult;
    if (dob === null || dob === '') isAdult = false; // unknown age is treated as under 18
    if (dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      isAdult = age >= 18;
    }

    await profile.update({
      campusId: campusId !== undefined ? campusId : profile.campusId,
      collegeId: collegeId !== undefined ? collegeId : profile.collegeId,
      branch: branch !== undefined ? branch : profile.branch,
      year: year !== undefined ? Number(year) : profile.year,
      section: section !== undefined ? section : profile.section,
      hostelBlock: hostelBlock !== undefined ? hostelBlock : profile.hostelBlock,
      roomNumber: roomNumber !== undefined ? roomNumber : profile.roomNumber,
      dob: dob !== undefined ? dob : profile.dob,
      isAdult,
      bio: bio !== undefined ? bio : profile.bio,
      interests: interests !== undefined ? interests : profile.interests,
    });

    clearFriendsEligibility(req.user.id);

    // Also sync hostelBlock and roomNumber to User model for food delivery
    if (hostelBlock || roomNumber) {
      const dbUser = await User.findByPk(req.user.id);
      if (dbUser) {
        if (hostelBlock) dbUser.hostelBlock = hostelBlock;
        if (roomNumber) dbUser.roomNumber = roomNumber;
        await dbUser.save();
      }
    }

    const Campus = getCampusModel();
    const updated = await CampusProfile.findByPk(profile.id, {
      include: Campus ? [{ model: Campus, as: 'campus' }] : []
    });

    res.json({
      message: 'Profile updated successfully',
      profile: updated
    });
  } catch (error) {
    console.error('[UPDATE_CAMPUS_PROFILE_ERR]', error);
    res.status(500).json({ message: 'Failed to update campus profile' });
  }
};

// @desc    Which verification methods work right now (email needs BREVO_API_KEY)
// @route   GET /api/campus/verify/methods
const getVerificationMethods = async (req, res) => {
  try {
    await ensureDefaultCampuses();
    const Campus = getCampusModel();
    const campuses = Campus ? await Campus.findAll({ where: { isActive: true } }) : [];
    const fromEnv = envDomains();
    const emailDomains = fromEnv.length ? fromEnv : [...new Set(campuses.flatMap((c) => c.emailDomains || []))];
    res.json({
      email: isMailerConfigured(),
      idCard: true,
      emailDomains,
      otpTtlSeconds: OTP_TTL_MS / 1000,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    });
  } catch (error) {
    console.error('[VERIFY_METHODS_ERR]', error.message);
    res.status(500).json({ message: 'Could not load verification options' });
  }
};

// @desc    The student's own verification state (+ rejection note)
// @route   GET /api/campus/verify/status
const getVerificationStatus = async (req, res) => {
  try {
    const CampusProfile = getCampusProfileModel();
    const profile = await CampusProfile.findOne({ where: { userId: req.user.id } });
    res.json({
      verificationStatus: profile ? profile.verificationStatus : 'unverified',
      collegeEmail: profile ? profile.collegeEmail : null,
      verifiedAt: profile ? profile.verifiedAt : null,
      lastVerification: await latestVerificationFor(req, req.user.id),
      methods: { email: isMailerConfigured(), idCard: true },
    });
  } catch (error) {
    console.error('[VERIFY_STATUS_ERR]', error.message);
    res.status(500).json({ message: 'Could not load verification status' });
  }
};

// @desc    Request college email verification OTP
// @route   POST /api/campus/verify/email-otp   { email, campusId? }
const requestEmailOtp = async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const campusId = req.body && req.body.campusId;
    if (email.length > 120 || !/^[^\s@]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return res.status(400).json({ code: 'INVALID_EMAIL', message: 'Enter a valid college email address.' });
    }
    const domain = email.split('@')[1];

    const { allowed, campus, allowedList } = await resolveEmailCampus(domain, campusId);
    if (!allowed) {
      return res.status(400).json({
        code: 'DOMAIN_NOT_ALLOWED',
        message: `@${domain} is not a supported college email.${allowedList.length ? ` Use ${allowedList.map((d) => '@' + d).join(', ')}` : ''} or verify with your ID card.`,
        allowedDomains: allowedList,
      });
    }

    if (!isMailerConfigured()) {
      return res.status(503).json({
        code: 'EMAIL_NOT_CONFIGURED',
        message: 'Email verification is not switched on yet. Please verify with a photo of your student ID card.',
        fallback: 'id_card',
      });
    }

    const CampusProfile = getCampusProfileModel();
    const profile = await CampusProfile.findOne({ where: { userId: req.user.id } });
    if (profile && profile.verificationStatus === 'verified') {
      return res.status(400).json({ code: 'ALREADY_VERIFIED', message: 'You are already verified.' });
    }

    // One college email = one Zenvy account.
    const taken = await CampusProfile.findOne({
      where: { collegeEmail: email, verificationStatus: 'verified', userId: { [Op.ne]: req.user.id } },
      attributes: ['id'],
    });
    if (taken) {
      return res.status(409).json({ code: 'EMAIL_IN_USE', message: 'This college email is already verified on another Zenvy account.' });
    }

    const Verification = getVerificationModel();
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const last = await Verification.findOne({
      where: { userId: req.user.id, type: 'email_otp', status: { [Op.ne]: 'failed' } },
      order: [['createdAt', 'DESC']],
    });
    const sinceLast = last ? now - new Date(last.createdAt).getTime() : Infinity;
    if (sinceLast < OTP_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - sinceLast) / 1000);
      return res.status(429).json({ code: 'OTP_COOLDOWN', message: `Please wait ${retryAfter}s before asking for a new code.`, retryAfter });
    }
    const [sentByUser, sentToEmail] = await Promise.all([
      Verification.count({ where: { userId: req.user.id, type: 'email_otp', createdAt: { [Op.gt]: dayAgo } } }),
      Verification.count({ where: { collegeEmail: email, type: 'email_otp', createdAt: { [Op.gt]: dayAgo } } }),
    ]);
    if (sentByUser >= OTP_DAILY_CAP_PER_USER || sentToEmail >= OTP_DAILY_CAP_PER_EMAIL) {
      return res.status(429).json({ code: 'OTP_DAILY_LIMIT', message: 'Too many codes today. Try again tomorrow, or verify with your ID card.' });
    }

    // Any older unused code stops working.
    await Verification.update(
      { status: 'expired' },
      { where: { userId: req.user.id, type: 'email_otp', status: 'pending' } }
    );

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const record = await Verification.create({
      userId: req.user.id,
      campusId: campus ? campus.id : null,
      type: 'email_otp',
      collegeEmail: email,
      otp: null,
      otpHash: otpHashFor(req.user.id, email, code),
      otpExpiresAt: new Date(now + OTP_TTL_MS),
      attempts: 0,
      status: 'pending',
    });

    const sent = await sendVerificationCode({
      to: email,
      code,
      name: req.user.name,
      campusName: campus ? campus.name : null,
      minutes: OTP_TTL_MS / 60000,
    });
    if (!sent.ok) {
      await record.update({ status: 'failed', otpHash: null });
      return res.status(502).json({
        code: 'EMAIL_SEND_FAILED',
        message: 'We could not send the email right now. Please try again in a minute, or verify with your ID card.',
      });
    }

    res.json({
      message: `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
      email,
      campusId: campus ? campus.id : null,
      expiresInSeconds: OTP_TTL_MS / 1000,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    });
  } catch (error) {
    console.error('[REQUEST_EMAIL_OTP_ERR]', error.message);
    res.status(500).json({ message: 'Failed to send verification email' });
  }
};

// @desc    Confirm college email OTP
// @route   POST /api/campus/verify/confirm-otp   { email, otp }
const confirmEmailOtp = async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const otp = String((req.body && (req.body.otp || req.body.code)) || '').replace(/\D/g, '');
    if (!email || otp.length !== 6) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'Enter the 6-digit code from your email.' });
    }

    const Verification = getVerificationModel();
    const record = await Verification.findOne({
      where: { userId: req.user.id, collegeEmail: email, type: 'email_otp', status: 'pending' },
      order: [['createdAt', 'DESC']],
    });
    if (!record || !record.otpHash || record.consumedAt) {
      return res.status(400).json({ code: 'OTP_NOT_FOUND', message: 'No active code for this email. Ask for a new one.' });
    }
    if (!record.otpExpiresAt || new Date(record.otpExpiresAt).getTime() < Date.now()) {
      await record.update({ status: 'expired' });
      return res.status(400).json({ code: 'OTP_EXPIRED', message: 'This code has expired. Ask for a new one.' });
    }
    if ((record.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      await record.update({ status: 'expired' });
      return res.status(429).json({ code: 'OTP_LOCKED', message: 'Too many wrong tries. Ask for a new code.' });
    }

    // Reserve one attempt atomically BEFORE comparing: a burst of parallel guesses all read
    // attempts = 0 above, so a check-then-increment let hundreds of guesses through per code.
    const [reserved] = await Verification.update(
      { attempts: Verification.sequelize.literal('"attempts" + 1') },
      { where: { id: record.id, status: 'pending', consumedAt: null, attempts: { [Op.lt]: OTP_MAX_ATTEMPTS } } }
    );
    if (!reserved) {
      return res.status(429).json({ code: 'OTP_LOCKED', message: 'Too many wrong tries. Ask for a new code.', attemptsLeft: 0 });
    }

    const want = Buffer.from(record.otpHash, 'hex');
    const got = Buffer.from(otpHashFor(req.user.id, email, otp), 'hex');
    const ok = want.length === got.length && crypto.timingSafeEqual(want, got);
    if (!ok) {
      await record.reload({ attributes: ['id', 'attempts'] });
      const left = Math.max(0, OTP_MAX_ATTEMPTS - (record.attempts || 0));
      if (left === 0) await Verification.update({ status: 'expired' }, { where: { id: record.id, status: 'pending' } });
      return res.status(left === 0 ? 429 : 400).json({
        code: left === 0 ? 'OTP_LOCKED' : 'OTP_INVALID',
        message: left === 0 ? 'Too many wrong tries. Ask for a new code.' : `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
        attemptsLeft: left,
      });
    }

    const CampusProfile = getCampusProfileModel();
    const taken = await CampusProfile.findOne({
      where: { collegeEmail: email, verificationStatus: 'verified', userId: { [Op.ne]: req.user.id } },
      attributes: ['id'],
    });
    if (taken) {
      return res.status(409).json({ code: 'EMAIL_IN_USE', message: 'This college email is already verified on another Zenvy account.' });
    }

    // Single use: only the request that flips pending -> approved wins.
    const [claimed] = await Verification.update(
      { status: 'approved', consumedAt: new Date() },
      { where: { id: record.id, status: 'pending', consumedAt: null } }
    );
    if (!claimed) {
      return res.status(400).json({ code: 'OTP_NOT_FOUND', message: 'This code was already used. Ask for a new one.' });
    }

    let profile = await CampusProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) profile = await CampusProfile.create({ userId: req.user.id });

    const alreadyVerified = profile.verificationStatus === 'verified';
    await profile.update({
      collegeEmail: email,
      campusId: record.campusId || profile.campusId,
      verificationStatus: 'verified',
      verifiedAt: new Date(),
      buddyPoints: (profile.buddyPoints || 0) + (alreadyVerified ? 0 : VERIFY_REWARD_POINTS),
    });

    // Any pending ID-card request is no longer needed.
    await Verification.update(
      { status: 'approved', reviewNotes: 'Verified by college email' },
      { where: { userId: req.user.id, type: 'id_card', status: 'pending' } }
    );

    realtime.notifyAdmin('verification', 'updated', record.id, { scope: 'email' });
    await notifyStudentVerification(req, req.user.id, { verificationStatus: 'verified', method: 'email' }, null);

    const Campus = getCampusModel();
    const fresh = await CampusProfile.findByPk(profile.id, { include: Campus ? [{ model: Campus, as: 'campus' }] : [] });
    const out = fresh.toJSON();
    out.hasIdCard = !!out.idCardImageUrl;
    out.idCardImageUrl = null;
    res.json({
      message: 'You are verified! Welcome to Zenvy Campus.',
      verificationStatus: 'verified',
      pointsAwarded: alreadyVerified ? 0 : VERIFY_REWARD_POINTS,
      profile: out,
    });
  } catch (error) {
    console.error('[CONFIRM_EMAIL_OTP_ERR]', error.message);
    res.status(500).json({ message: 'Verification failed' });
  }
};

// @desc    Upload ID card photo for manual verification
// @route   POST /api/campus/verify/upload-id   { idCardImageUrl, campusId?, collegeId? }
// idCardImageUrl: '/api/campus/media/<id>' from POST /api/campus/media (purpose=id_card), or a legacy data:image URL.
const submitIdCard = async (req, res) => {
  try {
    const { campusId } = req.body || {};
    // Private media only (owner + admins): inline base64 is moved to a private media row.
    const { storeImageRef } = require('../../../utils/imageStore');
    const idImg = await storeImageRef(req.body && req.body.idCardImageUrl, { req, ownerId: req.user.id, purpose: 'id_card', isPrivate: true, allowExternal: false });
    const idCardImageUrl = idImg.ok ? idImg.value : null;
    if (!idCardImageUrl) {
      return res.status(400).json({ code: 'ID_IMAGE_REQUIRED', message: 'Add a clear photo of your student ID card.' });
    }
    // A media reference must be the caller's own upload: otherwise anyone who saw another person's
    // private photo id (a Connect photo, a chat image) could attach it here and get fresh signed links.
    {
      const { mediaIdOf } = require('../../../utils/imageStore');
      const mid = mediaIdOf(idCardImageUrl);
      const { getCampusMediaModel } = require('../models/CampusMedia');
      const Media = getCampusMediaModel && getCampusMediaModel();
      if (mid && Media) {
        const row = await Media.findByPk(mid, { attributes: ['id', 'ownerId', 'isPrivate'] });
        // S0: and it must be a PRIVATE upload (purpose id_card): a public photo would be served to anyone.
        if (!row || String(row.ownerId) !== String(req.user.id) || !row.isPrivate) {
          return res.status(400).json({ code: 'ID_IMAGE_REQUIRED', message: 'Upload a photo of your own student ID card.' });
        }
      }
    }
    const collegeId = req.body && req.body.collegeId != null ? String(req.body.collegeId).trim().slice(0, 50) : null;

    const CampusProfile = getCampusProfileModel();
    let profile = await CampusProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) profile = await CampusProfile.create({ userId: req.user.id });
    if (profile.verificationStatus === 'verified') {
      return res.status(400).json({ code: 'ALREADY_VERIFIED', message: 'You are already verified.' });
    }

    let validCampusId = profile.campusId;
    if (campusId) {
      const c = await getCampusModel().findByPk(campusId);
      if (!c) return res.status(400).json({ code: 'INVALID_CAMPUS', message: 'Pick your campus again.' });
      validCampusId = c.id;
    }

    // One open request per student: a re-submit replaces the photo of the pending one.
    const Verification = getVerificationModel();
    let verification = await Verification.findOne({
      where: { userId: req.user.id, type: 'id_card', status: 'pending' },
      order: [['createdAt', 'DESC']],
    });
    let action = 'created';
    if (verification) {
      await verification.update({ idCardImageUrl, campusId: validCampusId, reviewNotes: null });
      action = 'updated';
    } else {
      verification = await Verification.create({
        userId: req.user.id,
        campusId: validCampusId,
        type: 'id_card',
        idCardImageUrl,
        status: 'pending',
      });
    }

    await profile.update({
      campusId: validCampusId,
      collegeId: collegeId || profile.collegeId,
      idCardImageUrl,
      verificationStatus: 'pending',
    });
    clearFriendsEligibility(req.user.id);

    realtime.notifyAdmin('verification', action, verification.id);
    res.json({
      message: 'ID card submitted. An admin usually reviews it within a few hours. We will notify you.',
      verificationStatus: 'pending',
      requestId: verification.id,
    });
  } catch (error) {
    console.error('[SUBMIT_ID_CARD_ERR]', error.message);
    res.status(500).json({ message: 'Failed to submit ID card' });
  }
};

// @desc    List student verification requests (admin only)
// @route   GET /api/campus/verify/requests?status=pending
const getVerificationRequests = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { status = 'pending' } = req.query;
    const type = req.query.type ? String(req.query.type) : null;
    const Verification = getVerificationModel();
    const User = getUserModel();

    // Admins review ID cards; email OTP rows are automatic (pass ?type=email_otp to see them).
    const rows = await Verification.findAll({
      where: { status: String(status), type: type || 'id_card' },
      order: [['createdAt', 'ASC']],
      limit: 100,
    });

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await User.findAll({ where: { id: userIds }, attributes: ['id', 'name', 'phone'] })
      : [];
    const byId = {};
    users.forEach((u) => { byId[u.id] = u; });

    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: byId[r.userId] ? byId[r.userId].name : 'Unknown',
        userPhone: byId[r.userId] ? byId[r.userId].phone : null,
        type: r.type,
        collegeEmail: r.collegeEmail,
        idCardImageUrl: signedMediaUrl(req, r.idCardImageUrl),
        status: r.status,
        reviewNotes: r.reviewNotes,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('[GET_VERIFICATION_REQUESTS_ERR]', error);
    res.status(500).json({ message: 'Failed to load verification requests' });
  }
};

// @desc    Approve or reject a student verification (admin only)
// @route   POST /api/campus/verify/:id/review
const reviewVerification = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { action, notes } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }

    const Verification = getVerificationModel();
    const record = await Verification.findByPk(req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'Verification request not found' });
    }
    if (record.status !== 'pending') {
      return res.status(400).json({ message: `Request already ${record.status}` });
    }

    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 250) : '';
    record.status = action === 'approve' ? 'approved' : 'rejected';
    record.reviewedBy = req.user.id;
    record.reviewNotes = cleanNotes || null;
    await record.save();

    const CampusProfile = getCampusProfileModel();
    let profile = await CampusProfile.findOne({ where: { userId: record.userId } });
    if (!profile) {
      profile = await CampusProfile.create({ userId: record.userId });
    }

    if (action === 'approve') {
      const alreadyVerified = profile.verificationStatus === 'verified';
      await profile.update({
        verificationStatus: 'verified',
        verifiedAt: new Date(),
        campusId: record.campusId || profile.campusId,
        buddyPoints: (profile.buddyPoints || 0) + (alreadyVerified ? 0 : VERIFY_REWARD_POINTS),
      });
    } else if (profile.verificationStatus !== 'verified') {
      // A late rejection of an old request never un-verifies a student verified another way.
      await profile.update({ verificationStatus: 'rejected' });
    }

    realtime.notifyAdmin('verification', 'updated', record.id);
    await notifyStudentVerification(
      req,
      record.userId,
      {
        verificationStatus: profile.verificationStatus,
        method: 'id_card',
        decision: action,
        requestId: record.id,
        reviewNotes: action === 'reject' ? record.reviewNotes : null,
      },
      action === 'approve'
        ? { title: 'You are verified on Zenvy Campus', body: 'Your student ID was approved. Welcome to Zenvy Campus!' }
        : profile.verificationStatus === 'verified'
        ? null // already verified another way: an old request's rejection is not news
        : { title: 'Your ID card needs another look', body: record.reviewNotes ? `Reason: ${record.reviewNotes.replace(/[.!\s]+$/, '')}. Please upload a clearer photo.` : 'Please upload a clearer photo of your student ID card.' }
    );
    res.json({
      message: action === 'approve' ? 'Student verified' : 'Verification rejected',
      verificationStatus: profile.verificationStatus,
      profile,
    });
  } catch (error) {
    console.error('[REVIEW_VERIFICATION_ERR]', error);
    res.status(500).json({ message: 'Failed to review verification' });
  }
};

module.exports = {
  getCampuses,
  getCampusProfile,
  updateCampusProfile,
  requestEmailOtp,
  confirmEmailOtp,
  submitIdCard,
  getVerificationRequests,
  reviewVerification,
  getVerificationMethods,
  getVerificationStatus,
};
