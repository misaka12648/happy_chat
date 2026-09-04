const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { ok, fail } = require('../utils/response');

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

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { username: { $regex: keyword, $options: 'i' } },
        { nickname: { $regex: keyword, $options: 'i' } }
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
    const { nickname, avatar } = req.body;
    
    if (nickname !== undefined) {
      req.user.nickname = nickname;
    }
    if (avatar !== undefined) {
      req.user.avatar = avatar;
    }
    
    await req.user.save();

    ok(res, req.user.toJSON(), '更新成功');
  } catch (error) {
    console.error('更新用户信息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/users/:id
 * 获取指定用户信息
 */
router.get('/:id', async (req, res) => {
  try {
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
