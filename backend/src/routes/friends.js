const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
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
    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return fail(res, 400, '接收者 ID 无效');
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

    if (!friendshipId || !mongoose.Types.ObjectId.isValid(friendshipId)) {
      return fail(res, 400, '好友请求 ID 无效');
    }

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
 * 获取好友列表（附带我对该好友的备注 remark）
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
      const isRequester = f.requester._id.toString() === req.user._id.toString();
      const friendDoc = isRequester ? f.recipient : f.requester;
      const obj = typeof friendDoc.toJSON === 'function' ? friendDoc.toJSON() : friendDoc;
      obj.remark = (f.remarks && f.remarks.get(req.user._id.toString())) || '';
      return obj;
    });

    ok(res, friends);
  } catch (error) {
    console.error('获取好友列表错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/friends/:friendId/remark
 * 设置/清除好友备注（仅影响自己的显示，对方不受影响；空串=清除备注）
 */
router.put('/:friendId/remark', async (req, res) => {
  try {
    const { friendId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(friendId)) {
      return fail(res, 404, '好友不存在');
    }

    const remark = typeof req.body.remark === 'string' ? req.body.remark.trim() : '';
    if (remark.length > 20) {
      return fail(res, 400, '备注不能超过 20 个字符');
    }

    const friendship = await Friendship.findOne({
      $or: [
        { requester: req.user._id, recipient: friendId },
        { requester: friendId, recipient: req.user._id }
      ],
      status: 'ACCEPTED'
    });
    if (!friendship) {
      return fail(res, 404, '好友关系不存在');
    }

    const key = `remarks.${req.user._id.toString()}`;
    await Friendship.updateOne({ _id: friendship._id }, { $set: { [key]: remark } });

    ok(res, { remark }, '备注已保存');
  } catch (error) {
    console.error('设置好友备注错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * DELETE /api/friends/:friendId
 * 删除好友（:friendId 为对方的用户 ID）：
 * - 删除好友关系记录；
 * - 仅将自己加入双方会话的 hiddenFor（对方列表与历史消息均不受影响）；
 * - 通过 WebSocket 通知对方（FRIEND_REMOVED）。
 */
router.delete('/:friendId', async (req, res) => {
  try {
    const { friendId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(friendId)) {
      return fail(res, 404, '好友关系不存在');
    }
    if (friendId === req.user._id.toString()) {
      return fail(res, 400, '不能删除自己');
    }

    const friendship = await Friendship.findOne({
      $or: [
        { requester: req.user._id, recipient: friendId },
        { requester: friendId, recipient: req.user._id }
      ]
    });

    if (!friendship) {
      return fail(res, 404, '好友关系不存在');
    }

    await friendship.deleteOne();

    // 将自己加入会话软隐藏列表：好友删除后会话从自己的列表消失（消息保留，重新添加好友后可从通讯录再进）
    const conversation = await Conversation.findOne({
      type: 'P2P',
      participants: { $all: [req.user._id, friendId] }
    });
    if (conversation) {
      await Conversation.updateOne(
        { _id: conversation._id },
        { $addToSet: { hiddenFor: req.user._id } }
      );
    }

    // 通知对方（在线时）
    sendToUser(friendId, 'FRIEND_REMOVED', { friendId: req.user._id.toString() });

    ok(res, null, '已删除好友');
  } catch (error) {
    console.error('删除好友错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
