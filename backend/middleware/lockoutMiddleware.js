const failedLogins = new Map();

// Clean up expired entries every 15 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failedLogins.entries()) {
    if (record.lockTime && now > record.lockTime) {
      failedLogins.delete(key);
    }
  }
}, 15 * 60 * 1000);

const accountLockout = (req, res, next) => {
  const key = String(req.body.phone || req.body.email || req.body.id || req.ip);
  const record = failedLogins.get(key);

  if (record && record.count >= 5) {
    if (Date.now() < record.lockTime) {
      return res.status(429).json({
        message: 'Account locked due to too many failed login attempts. Try again in 15 minutes.'
      });
    } else {
      failedLogins.delete(key);
    }
  }

  // Intercept the response to track success/failure
  const originalSend = res.send;
  res.send = function (body) {
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      failedLogins.delete(key);
    } else if (statusCode === 401 || statusCode === 400) {
      const current = failedLogins.get(key) || { count: 0, lockTime: 0 };
      current.count += 1;
      if (current.count >= 5) {
        current.lockTime = Date.now() + 15 * 60 * 1000; // 15 mins lock
      }
      failedLogins.set(key, current);
    }
    return originalSend.apply(this, arguments);
  };

  next();
};

module.exports = { accountLockout };
