// Manual liveness (free): random gesture prompt + selfie, compared by an admin. See ./index.js.
const crypto = require('crypto');

const CHALLENGE_TTL_MS = 15 * 60 * 1000; // the selfie must be uploaded within 15 minutes of the prompt

const GESTURES = [
  'Hold up three fingers next to your face',
  'Give a thumbs up with your left hand next to your chin',
  'Touch your right ear with your left hand',
  'Make a peace sign above your head',
  'Cover your left eye with your open hand',
  'Hold up two fingers on each hand beside your face',
  'Rest your chin on your fist and look at the camera',
  'Point at your nose with your right index finger',
  'Make an OK sign next to your right cheek',
  'Hold your open palm flat under your chin',
  'Hold up four fingers of your right hand next to your face',
  'Touch the top of your head with your left hand',
];

const pick = () => GESTURES[crypto.randomInt(0, GESTURES.length)];

module.exports = {
  name: 'manual',
  CHALLENGE_TTL_MS,
  GESTURES,
  configured: () => true,
  start() {
    const challenge = pick();
    return {
      mode: 'manual',
      challenge,
      instructions: [
        'Take a fresh selfie now with the front camera (not a gallery photo).',
        `Do this in the photo: ${challenge}.`,
        'Your whole face must be visible, in good light, with no filters, masks or sunglasses.',
        'A ZENV admin compares it with your Connect photos. The selfie is deleted as soon as they decide.',
      ],
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    };
  },
};
