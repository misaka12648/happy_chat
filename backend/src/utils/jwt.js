const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
// 双 token：access（短期，用于接口/WebSocket 鉴权）+ refresh（长期，用于静默续期）
// refresh 使用独立密钥；未单独配置时从 JWT_SECRET 派生，保证与 access 签名密钥不同
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET}:refresh`;
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '2h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

// 安全要求：JWT 密钥必须通过环境变量提供高强度随机值，禁止硬编码兜底。
// 生成方式：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 未配置：请在 .env 中设置一个高强度随机密钥后再启动服务');
}

/**
 * 生成 access token（短期，用于接口/WebSocket 鉴权）
 * @param {Object} payload - 载荷（如 { userId }）
 * @returns {string}
 */
function generateAccessToken(payload) {
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES_IN });
}

/**
 * 生成 refresh token（长期，仅用于换取新的 access token）
 * @param {Object} payload - 载荷（如 { userId }）
 * @returns {string}
 */
function generateRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}

/**
 * 验证 access token
 * @param {string} token
 * @returns {Object} 解码后的数据
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * 验证 refresh token
 * @param {string} token
 * @returns {Object} 解码后的数据
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

// 兼容旧调用：generateToken 等价于生成 access token
const generateToken = generateAccessToken;

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken
};
