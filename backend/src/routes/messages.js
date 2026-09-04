const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { ok, fail } = require('../utils/response');

/**
 * GET /api/messages/:conversationId
 * 获取会话的历史消息（分页）
 */
router.get('/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // 检查会话是否存在且用户有权限访问
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }

    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    // 获取消息总数
    const total = await Message.countDocuments({ conversationId });

    // 获取分页消息
    const messages = await Message.find({ conversationId })
      .populate('sender', '-password')
      .populate('receiver', '-password')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    ok(res, {
      messages: messages.reverse(), // 按时间正序返回
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('获取历史消息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/messages
 * 发送消息（通过 HTTP，主要用作备用，WebSocket 是主要发送方式）
 */
router.post('/', async (req, res) => {
  try {
    const { conversationId, receiverId, type = 'TEXT', content, mediaUrl = '', contentBlocks = [] } = req.body;

    if (!conversationId || !receiverId || !content) {
      return fail(res, 400, '会话 ID、接收者 ID 和内容为必填项');
    }

    // 检查会话是否存在且用户有权限访问
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }

    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    // 创建消息
    const message = new Message({
      conversationId,
      sender: req.user._id,
      receiver: receiverId,
      type,
      content,
      mediaUrl,
      contentBlocks
    });

    await message.save();

    // 更新会话最后消息
    conversation.lastMessage = type === 'TEXT' ? content : `[${type}]`;
    conversation.lastMessageTime = message.createdAt;
    conversation.lastMessageType = type;
    
    // 增加接收者的未读数
    const unreadCount = conversation.unreadCounts.get(receiverId.toString()) || 0;
    conversation.unreadCounts.set(receiverId.toString(), unreadCount + 1);

    // 有新消息则清除双方的软隐藏，使会话重新出现在列表
    if (conversation.hiddenFor && conversation.hiddenFor.length) {
      conversation.hiddenFor = [];
    }

    await conversation.save();

    // 填充发送者和接收者信息
    await message.populate(['sender', 'receiver']);

    ok(res, message, '', 201);
  } catch (error) {
    console.error('发送消息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/messages/:id/read
 * 标记消息为已读
 */
router.put('/:id/read', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    
    if (!message) {
      return fail(res, 404, '消息不存在');
    }

    if (message.receiver.toString() !== req.user._id.toString()) {
      return fail(res, 403, '你无权标记此消息为已读');
    }

    message.read = true;
    await message.save();

    ok(res, null, '已标记为已读');
  } catch (error) {
    console.error('标记消息已读错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/messages/:id/recall
 * 撤回消息（HTTP 备用方案，WebSocket 是主要方式）
 */
router.put('/:id/recall', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return fail(res, 404, '消息不存在');
    }

    // 验证只能撤回自己的消息
    if (message.sender.toString() !== req.user._id.toString()) {
      return fail(res, 403, '只能撤回自己的消息');
    }

    // 验证发送后5分钟内
    const elapsed = Date.now() - new Date(message.createdAt).getTime();
    if (elapsed > 5 * 60 * 1000) {
      return fail(res, 400, '消息已超过5分钟，无法撤回');
    }

    // 标记为已撤回（数据库保留原始内容可追溯）
    message.recalled = true;
    message.recalledAt = new Date();
    await message.save();

    ok(res, message);
  } catch (error) {
    console.error('撤回消息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
