const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { decodeTransportPassword } = require('../utils/password');
const { ok, fail } = require('../utils/response');

// 转义正则特殊字符，防止用户输入注入 $regex（性能攻击/语法错误）
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/users/search
 * 搜索用户（按用户名或昵称）
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || keyword.trim().length === 0) {
      return ok(res, []);
    }

    const pattern = escapeRegex(keyword.trim());
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { username: { $regex: pattern, $options: 'i' } },
        { nickname: { $regex: pattern, $options: 'i' } }
      ]
    }).select('-password').limit(20);

    ok(res, users);
  } catch (error) {
    console.error('搜索用户错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/users/me
 * 获取当前用户信息
 */
router.get('/me', (req, res) => {
  ok(res, req.user.toJSON());
});

/**
 * PUT /api/users/me
 * 更新当前用户信息
 */
router.put('/me', async (req, res) => {
  try {
    const { nickname, avatar, bio } = req.body;

    if (nickname !== undefined) {
      req.user.nickname = nickname;
    }
    if (avatar !== undefined) {
      req.user.avatar = avatar;
    }
    if (bio !== undefined) {
      // 签名：字符串且不超过 50 字（模型层 maxlength 兜底，这里提前给出明确错误）
      if (typeof bio !== 'string') {
        return fail(res, 400, '签名格式错误');
      }
      if (bio.trim().length > 50) {
        return fail(res, 400, '签名不能超过 50 个字符');
      }
      req.user.bio = bio.trim();
    }

    await req.user.save();

    ok(res, req.user.toJSON(), '更新成功');
  } catch (error) {
    console.error('更新用户信息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/users/me/password
 * 修改密码（需验证旧密码）
 */
router.put('/me/password', async (req, res) => {
  try {
    const oldPassword = decodeTransportPassword(req.body.oldPassword);
    const newPassword = decodeTransportPassword(req.body.newPassword);

    if (!oldPassword || !newPassword) {
      return fail(res, 400, '密码格式错误');
    }
    if (newPassword.length < 6) {
      return fail(res, 400, '新密码长度应不少于 6 个字符');
    }
    // bcrypt 只处理前 72 字节，超长部分会被截断，这里直接限制上限
    if (newPassword.length > 64) {
      return fail(res, 400, '新密码长度应不超过 64 个字符');
    }

    const isMatch = await req.user.comparePassword(oldPassword);
    if (!isMatch) {
      return fail(res, 400, '旧密码错误');
    }

    // 赋值即可，pre-save 钩子负责 bcrypt 加密
    req.user.password = newPassword;
    await req.user.save();

    ok(res, null, '密码修改成功');
  } catch (error) {
    console.error('修改密码错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/users/:id
 * 获取指定用户信息
 */
router.get('/:id', async (req, res) => {
  try {
    // 非法 ObjectId 直接 404，避免 CastError 落到 500
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '用户不存在');
    }

    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return fail(res, 404, '用户不存在');
    }

    ok(res, user);
  } catch (error) {
    console.error('获取用户信息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
