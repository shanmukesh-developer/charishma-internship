/**
 * Zenvy Nexus: WhatsApp Notification Bridge
 * A modular utility to handle automated WhatsApp alerts for customers and riders.
 * Designed to support multi-provider transition (Twilio -> UltraMsg -> Custom)
 */

const axios = require('axios');

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'CONSOLE'; // CONSOLE, TWILIO, or WEBHOOK
let waFailures = 0;
let waLastLogAt = 0;

/**
 * Formats order details into a clean WhatsApp-ready message
 */
const formatOrderMessage = (order, type = 'CUSTOMER_CONFIRMATION') => {
  const orderId = (order._id || order.id || 'UNKNOWN').toString().slice(-6).toUpperCase();
  let parsedItems = [];
  if (order && order.items) {
    if (Array.isArray(order.items)) {
      parsedItems = order.items;
    } else {
      try {
        parsedItems = JSON.parse(order.items);
      } catch (err) {
        console.error('[WHATSAPP_PARSE_ERROR] Failed to parse order items:', err.message);
        parsedItems = [];
      }
    }
  }
  const items = parsedItems.map(i => `• ${i.name || 'Item'} x${i.quantity || 1}`).join('\n');
  const restaurant = order.restaurant?.name || 'ZCS Partner';
  const trackUrl = require('./publicUrl').orderTrackingUrl(order._id || order.id || '');

  if (type === 'CUSTOMER_CONFIRMATION') {
    return `🛍️ *Order Confirmed!* #${orderId}\n\nHi! Your order from *${restaurant}* is now being prepared.\n\n*Items:*\n${items}\n\n*Total:* ₹${order.finalPrice || order.totalPrice}\n\n📍 *Tracking:* ${trackUrl}\n\n_Thank you for choosing ZCS!_`;
  }

  if (type === 'STATUS_UPDATE') {
    const statusEmoji = {
      'Accepted': '👨‍🍳',
      'Preparing': '🥘',
      'PickedUp': '🛵',
      'Delivered': '✅',
      'Cancelled': '❌'
    };
    return `${statusEmoji[order.status] || '🔔'} *Order Update!* #${orderId}\n\nYour order from *${restaurant}* is now: *${order.status}*.\n\n📍 *Track here:* ${trackUrl}`;
  }

  if (type === 'RIDER_ALERT') {
    return `🛵 *New Delivery Request!* #${orderId}\n\nPickup: *${restaurant}*\nDrop: *${order.deliveryAddress}*\n\n💰 *Earnings:* ₹${order.deliveryFee}\n\n_Open ZCS Rider app to accept immediately!_`;
  }

  return `🔔 *ZCS Alert:* Order #${orderId} - ${order.status}`;
};

/**
 * Primary delivery function
 */
const sendWhatsAppMessage = async (to, messageContent, type = 'LOG') => {
  // No provider configured (the default): nothing is sent, and we say so honestly.
  // Message bodies are never logged (they contain names, phones and addresses).
  if (PROVIDER === 'CONSOLE') {
    console.log('[WHATSAPP_BRIDGE] [' + type + '] skipped: WHATSAPP_PROVIDER is not configured');
    return { success: false, simulated: true, provider: 'CONSOLE' };
  }

  // Example Webhook Integration (UltraMsg/Wati pattern)
  if (PROVIDER === 'WEBHOOK') {
    try {
      // A5: bounded (WHATSAPP_TIMEOUT_MS, default 8 s), no retries; failures logged at most once a minute.
      const response = await axios.post(process.env.WHATSAPP_WEBHOOK_URL, {
        to: to,
        body: messageContent
      }, { timeout: Math.max(1000, Number(process.env.WHATSAPP_TIMEOUT_MS) || 8000) });
      return { success: true, response: response.data };
    } catch (err) {
      waFailures++;
      if (Date.now() - waLastLogAt > 60000) {
        waLastLogAt = Date.now();
        console.error('[WHATSAPP_WEBHOOK_ERROR]', err.code === 'ECONNABORTED' ? 'timeout' : err.message, waFailures > 1 ? `(${waFailures} failures since last log)` : '');
        waFailures = 0;
      }
      return { success: false, error: err.code === 'ECONNABORTED' ? 'timeout' : err.message };
    }
  }

  return { success: false, error: 'Provider not configured' };
};

module.exports = {
  sendWhatsAppMessage,
  formatOrderMessage
};
