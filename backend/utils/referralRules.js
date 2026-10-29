// Referral rewards (sign-up with a code, or POST /api/features/referral/apply later): both people get 50 ZCS
// Points. 29 Oct 2026 security pass: points add up to free delivery (middleware/rewardEngine, 200 points), so a
// referrer is paid for at most MAX_PAID_REFERRALS friends; later referrals still count, without points. New
// accounts must prove their phone number (SMS / Firebase), so each referral is a real number.
const MAX_PAID_REFERRALS = 10;
const REFERRAL_POINTS = 50;

module.exports = { MAX_PAID_REFERRALS, REFERRAL_POINTS };
