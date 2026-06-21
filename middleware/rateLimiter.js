const otpRequestLimits = new Map(); // IP -> Array of timestamps

const otpRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const oneMinute = 60 * 1000;
  const limit = 3; // Max 3 OTP requests per minute

  if (!otpRequestLimits.has(ip)) {
    otpRequestLimits.set(ip, []);
  }

  // Filter timestamps in the last 1 minute
  const requests = otpRequestLimits.get(ip).filter(timestamp => now - timestamp < oneMinute);
  
  if (requests.length >= limit) {
    return res.status(429).json({ 
      message: 'Too many OTP requests. Please wait a minute before requesting another code.' 
    });
  }

  requests.push(now);
  otpRequestLimits.set(ip, requests);
  next();
};

module.exports = { otpRateLimiter };
