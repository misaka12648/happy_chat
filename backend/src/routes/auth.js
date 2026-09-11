const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { decodeTransportPassword } = require('../utils/password');
const { ok, fail } = require('../utils/response');

/**
 * POST /api/auth/register
 * 用户注册
 */
router.post('/register', async (req, res) => {
  try {
    const { username, nickname } = req.body;
    const password = decodeTransportPassword(req.body.password);
    if (!password) {
      return fail(res, 400, '密码格式错误');
    }

    // 参数验证
    if (!username || !password) {
      return fail(res, 400, '用户名和密码为必填项');
    }

    if (username.length < 3 || username.length > 20) {
      return fail(res, 400, '用户名长度应为 3-20 个字符');
    }

    if (password.length < 6) {
      return fail(res, 400, '密码长度应不少于 6 个字符');
    }

    // 检查用户名是否已存在
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return fail(res, 400, '用户名已存在');
    }

    // 创建用户
    const user = new User({
      username,
      password,
      nickname: nickname || username
    });

    await user.save();

    // 生成双 token：access（短期）+ refresh（长期，用于静默续期）
    const token = generateAccessToken({ userId: user._id });
    const refreshToken = generateRefreshToken({ userId: user._id });

    ok(res, { token, refreshToken, user: user.toJSON() }, '注册成功', 201);
  } catch (error) {
    console.error('注册错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', async (req, res) => {
  try {
    const { username } = req.body;
    const password = decodeTransportPassword(req.body.password);
    if (!password) {
      return fail(res, 400, '密码格式错误');
    }

    // 参数验证
    if (!username || !password) {
      return fail(res, 400, '用户名和密码为必填项');
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return fail(res, 401, '用户名或密码错误');
    }

    // 验证密码
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return fail(res, 401, '用户名或密码错误');
    }

    // 生成双 token：access（短期）+ refresh（长期，用于静默续期）
    const token = generateAccessToken({ userId: user._id });
    const refreshToken = generateRefreshToken({ userId: user._id });

    // 更新用户在线状态
    user.online = true;
    await user.save();

    ok(res, { token, refreshToken, user: user.toJSON() }, '登录成功');
  } catch (error) {
    console.error('登录错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/auth/refresh
 * 用 refresh token 换取新的 access token（滑动续期：同时下发新的 refresh token）
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return fail(res, 401, '缺少 refresh token');
    }

    // 验证 refresh token（失败会抛出，由 catch 统一返回 401）
    const decoded = verifyRefreshToken(refreshToken);
    if (decoded.type !== 'refresh') {
      return fail(res, 401, 'token 类型错误');
    }

    // 确认用户仍存在
    const user = await User.findById(decoded.userId);
    if (!user) {
      return fail(res, 401, '用户不存在');
    }

    // 下发新的 access + refresh（滑动过期，活跃用户可长期免登录）
    const token = generateAccessToken({ userId: user._id });
    const newRefreshToken = generateRefreshToken({ userId: user._id });

    ok(res, { token, refreshToken: newRefreshToken }, '刷新成功');
  } catch (error) {
    // TokenExpiredError / JsonWebTokenError 等一律视为需要重新登录
    return fail(res, 401, 'refresh token 无效或已过期');
  }
});

module.exports = router;
