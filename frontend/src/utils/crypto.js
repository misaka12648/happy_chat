/**
 * 密码传输编码（与后端 utils/password.js 的解码约定严格一致）：
 *   明文 -> UTF-8 字节 -> base64 -> 字符串反转 -> 加 'HC_' 前缀
 * 这是混淆而非加密，机密性由 HTTPS 保证。
 */

const PREFIX = 'HC_';

/**
 * 编码密码为传输格式
 * 说明：btoa 仅支持 Latin1，直接对含中文等非 ASCII 字符的密码调用会抛
 * InvalidCharacterError，故先经 TextEncoder 转 UTF-8 字节再逐字节编码；
 * 纯 ASCII 密码的产物与直接 btoa 完全一致，向后兼容。
 * @param {string} password 明文密码
 * @returns {string} 编码后的传输态密码
 */
export const encodePassword = (password) => {
  const bytes = new TextEncoder().encode(password);
  let latin1 = '';
  for (const b of bytes) {
    latin1 += String.fromCharCode(b);
  }
  return PREFIX + btoa(latin1).split('').reverse().join('');
};
