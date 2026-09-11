/**
 * 密码传输编解码约定（前后端必须保持一致）：
 *   明文 -> base64 -> 字符串反转 -> 加 'HC_' 前缀
 * 这是混淆而非加密，机密性由 HTTPS 保证。
 * 编码端见前端 utils/crypto.js#encodePassword。
 */

const PREFIX = 'HC_';

/**
 * 解码传输态密码
 * @param {*} encoded 请求体中的密码字段
 * @returns {string|null} 明文密码；输入缺失、前缀不符或解码为空时返回 null（由调用方返回 400）
 */
function decodeTransportPassword(encoded) {
  if (typeof encoded !== 'string' || encoded.length <= PREFIX.length) return null;
  if (!encoded.startsWith(PREFIX)) return null;
  try {
    const decoded = Buffer.from(encoded.slice(PREFIX.length).split('').reverse().join(''), 'base64').toString('utf-8');
    return decoded || null;
  } catch (error) {
    return null;
  }
}

module.exports = { decodeTransportPassword };
