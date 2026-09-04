/**
 * 统一响应格式：{ code, msg, data }
 * 全站接口收发一致，前端按此标准解析。
 */

/**
 * 成功响应
 * @param {import('express').Response} res
 * @param {*} data 业务数据，无则为 null
 * @param {string} msg 提示信息
 * @param {number} code 业务码（与 HTTP 状态一致，默认 200；创建成功用 201）
 */
function ok(res, data = null, msg = '', code = 200) {
  return res.status(code).json({ code, msg, data });
}

/**
 * 失败响应
 * @param {import('express').Response} res
 * @param {number} code 错误码（与 HTTP 状态一致，默认 500）
 * @param {string} msg 错误信息
 */
function fail(res, code = 500, msg = '服务器内部错误') {
  return res.status(code).json({ code, msg, data: null });
}

module.exports = { ok, fail };
