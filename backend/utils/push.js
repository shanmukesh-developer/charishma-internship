const admin = require('../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');

const sendPushToTokens = async (tokens, title, body, data = {}) => {
  const apps = (admin.getApps ? admin.getApps() : admin.apps) || [];
  if (!apps.length) return console.log('Firebase not initialized');
  let tokenList = tokens;
  if (typeof tokens === 'string') {
    try {
      tokenList = JSON.parse(tokens);
    } catch {
      tokenList = [];
    }
  }
  if (!tokenList || !Array.isArray(tokenList) || tokenList.length === 0) return;

  const validTokens = tokenList.map(t => typeof t === 'string' ? t : t.token).filter(Boolean);
  if (validTokens.length === 0) return;

  const message = {
    notification: {
      title,
      body
    },
    data,
    tokens: validTokens,
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`Successfully sent message:`, response);
    // You could also clean up old/invalid tokens here
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

const sendPushToTopic = async (topic, title, body, data = {}) => {
  const apps = (admin.getApps ? admin.getApps() : admin.apps) || [];
  if (!apps.length) return console.log('Firebase not initialized');

  const message = {
    notification: { title, body },
    data,
    topic
  };

  try {
    const response = await getMessaging().send(message);
    console.log(`Successfully sent topic message to ${topic}:`, response);
  } catch (error) {
    console.error(`Error sending message to topic ${topic}:`, error);
  }
};

module.exports = { sendPushToTokens, sendPushToTopic };
