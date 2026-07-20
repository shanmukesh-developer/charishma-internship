/**
 * Zenvy Nexus: WhatsApp Notification Bridge
 * A modular utility to handle automated WhatsApp alerts for customers and riders.
 * Designed to support multi-provider transition (Twilio -> UltraMsg -> Custom)
 */

const axios = require('axios');

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'CONSOLE'; // CONSOLE, TWILIO, or WEBHOOK

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
  const restaurant = order.restaurant?.name || 'Zenvy Partner';
  const trackUrl = `${process.env.FRONTEND_URL || 'https://zenvy.app'}/orders/${order._id || order.id || ''}`;

  if (type === 'CUSTOMER_CONFIRMATION') {
    return `🛍️ *Order Confirmed!* #${orderId}\n\nHi! Your order from *${restaurant}* is now being prepared.\n\n*Items:*\n${items}\n\n*Total:* ₹${order.finalPrice || order.totalPrice}\n\n📍 *Tracking:* ${trackUrl}\n\n_Thank you for choosing Zenvy!_`;
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
    return `🛵 *New Delivery Request!* #${orderId}\n\nPickup: *${restaurant}*\nDrop: *${order.deliveryAddress}*\n\n💰 *Earnings:* ₹${order.deliveryFee}\n\n_Open Zenvy Rider app to accept immediately!_`;
  }

  return `🔔 *Zenvy Alert:* Order #${orderId} - ${order.status}`;
};

/**
 * Primary delivery function
 */
const sendWhatsAppMessage = async (to, messageContent, type = 'LOG') => {
  console.log(`[WHATSAPP_BRIDGE] [${type}] Sending to ${to}...`);

  if (PROVIDER === 'CONSOLE') {
    console.log('──────────────────────────────────────────────────');
    console.log(`To: ${to}`);
    console.log('Content:');
    console.log(messageContent);
    console.log('──────────────────────────────────────────────────');
    return { success: true, provider: 'CONSOLE' };
  }

  // Example Webhook Integration (UltraMsg/Wati pattern)
  if (PROVIDER === 'WEBHOOK') {
    try {
      const response = await axios.post(process.env.WHATSAPP_WEBHOOK_URL, {
        to: to,
        body: messageContent
      });
      return { success: true, response: response.data };
    } catch (err) {
      console.error('[WHATSAPP_WEBHOOK_ERROR]', err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Provider not configured' };
};

module.exports = {
  sendWhatsAppMessage,
  formatOrderMessage
};
