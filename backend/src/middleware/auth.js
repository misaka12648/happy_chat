const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const { fail } = require('../utils/response');

/**
 * JWT 认证中间件
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return fail(res, 401, '访问被拒绝，未提供 token');
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return fail(res, 401, '用户不存在');
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return fail(res, 401, 'Token 已过期');
    }
    
    if (error.name === 'JsonWebTokenError') {
      return fail(res, 401, 'Token 无效');
    }

    next(error);
  }
}

module.exports = { authenticateToken };
