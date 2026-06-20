const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  // Get token from header
  const authHeader = req.header('Authorization');
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7, authHeader.length);
  }

  // Check if token exists
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  // Verify token
  try {
    const secret = process.env.JWT_SECRET || 'campusxchange_secret_key_123';
    const decoded = jwt.verify(token, secret);
    req.user = decoded.user; // Contains { id: userId }
    next();
  } catch (err) {
    console.error('Auth middleware verification error:', err.message);
    res.status(401).json({ message: 'Token is not valid or has expired' });
  }
};
