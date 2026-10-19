// A5: outbound HTTP timeouts.
//
// Every call the backend makes to another service is bounded (none retries in a loop):
//   Fast2SMS OTP          controllers/userController.js   fetch, 10 s (AbortSignal.timeout)
//   Brevo mail            utils/mailer.js                 fetch, MAIL_TIMEOUT_MS (default 10 s)
//   WhatsApp webhook      utils/whatsappUtil.js           axios, WHATSAPP_TIMEOUT_MS (default 8 s)
//   Nominatim proxy       routes/systemRoutes.js          fetch, 8 s
//   Razorpay orders/refund modules/campusEvents/.../razorpay.js  axios, 10 s
//   Cloudflare R2 (S3)    utils/s3Lite.js                 fetch, MEDIA_STORAGE_TIMEOUT_MS (default 15 s; 10 MB uploads)
//   FCM                   firebase-admin                  its own 15 s per request (+ its built-in retries)
//   Error webhook         utils/errorReporter.js          fetch, ERROR_REPORT_TIMEOUT_MS (default 5 s)
//   Keep-alive self ping  server.js                       http(s).get, 10 s
//   Redis                 utils/redis.js                  connect 3 s, command 500 ms (REDIS_*_TIMEOUT_MS)
// Safety net: any axios call without its own timeout uses OUTBOUND_TIMEOUT_MS (default 10 s).

const applyAxiosDefaultTimeout = (axiosLib) => {
  try {
    const ax = axiosLib || require('axios');
    if (!ax.defaults.timeout) ax.defaults.timeout = Math.max(1000, Number(process.env.OUTBOUND_TIMEOUT_MS) || 10000);
    return ax.defaults.timeout;
  } catch {
    return null; // axios optional
  }
};

module.exports = { applyAxiosDefaultTimeout };
