const express = require('express');
const router = express.Router();
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { sendToUser } = require('../websocket');
const { ok, fail } = require('../utils/response');

/**
 * POST /api/friends/request
 * 发送好友请求
 */
router.post('/request', async (req, res) => {
  try {
    const { recipientId } = req.body;
    const requesterId = req.user._id;

    if (!recipientId) {
      return fail(res, 400, '接收者 ID 为必填项');
    }

    if (requesterId.toString() === recipientId) {
      return fail(res, 400, '不能添加自己为好友');
    }

    // 检查接收者是否存在
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return fail(res, 404, '用户不存在');
    }

    // 检查是否已经是好友或已有请求
    const existing = await Friendship.findOne({
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') {
        return fail(res, 400, '你们已经是好友了');
      }
      return fail(res, 400, '好友请求已存在');
    }

    const friendship = new Friendship({
      requester: requesterId,
      recipient: recipientId,
      status: 'PENDING'
    });

    await friendship.save();

    // 通过 WebSocket 通知接收者
    const requester = await User.findById(requesterId).select('-password');
    sendToUser(recipientId, 'FRIEND_REQUEST', {
      requestId: friendship._id,
      requester: requester
    });

    ok(res, friendship, '好友请求已发送', 201);
  } catch (error) {
    console.error('发送好友请求错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/friends/accept
 * 接受好友请求
 */
router.post('/accept', async (req, res) => {
  try {
    const { friendshipId } = req.body;
    const userId = req.user._id;

    const friendship = await Friendship.findById(friendshipId);
    
    if (!friendship) {
      return fail(res, 404, '好友请求不存在');
    }

    if (friendship.recipient.toString() !== userId.toString()) {
      return fail(res, 403, '你无权接受此请求');
    }

    if (friendship.status !== 'PENDING') {
      return fail(res, 400, '该请求已被处理');
    }

    friendship.status = 'ACCEPTED';
    await friendship.save();

    // 通过 WebSocket 通知发送者
    const accepter = await User.findById(userId).select('-password');
    sendToUser(friendship.requester, 'FRIEND_ACCEPTED', {
      friendshipId: friendship._id,
      accepter: accepter
    });

    ok(res, friendship, '已接受好友请求');
  } catch (error) {
    console.error('接受好友请求错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/friends/requests
 * 获取收到的好友请求列表
 */
router.get('/requests', async (req, res) => {
  try {
    const requests = await Friendship.find({
      recipient: req.user._id,
      status: 'PENDING'
    }).populate('requester', '-password');

    ok(res, requests);
  } catch (error) {
    console.error('获取好友请求列表错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/friends
 * 获取好友列表
 */
router.get('/', async (req, res) => {
  try {
    const friendships = await Friendship.find({
      $or: [
        { requester: req.user._id, status: 'ACCEPTED' },
        { recipient: req.user._id, status: 'ACCEPTED' }
      ]
    }).populate(['requester', 'recipient']);

    const friends = friendships.map(f => {
      const friendId = f.requester._id.toString() === req.user._id.toString() 
        ? f.recipient 
        : f.requester;
      return friendId;
    });

    ok(res, friends);
  } catch (error) {
    console.error('获取好友列表错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
