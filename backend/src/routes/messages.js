const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Friendship = require('../models/Friendship');
const { sendToUser } = require('../websocket');
const { ok, fail } = require('../utils/response');

// 与 WebSocket 通道一致的内容上限（见 CLAUDE.md 第 4.3 节）
const MAX_CONTENT_LENGTH = 10000;
const MAX_CONTENT_BLOCKS = 50;

// 各消息类型的会话预览文案（TEXT/RICH 用实际内容）
const TYPE_PREVIEW = { IMAGE: '[图片]', VIDEO: '[视频]', VOICE: '[语音]' };

/**
 * 消息内容合法性校验：返回错误文案，合法返回 null
 */
function validateMessageContent({ content, contentBlocks }) {
  if (typeof content !== 'string' || !content.trim()) return '消息内容不能为空';
  if (content.length > MAX_CONTENT_LENGTH) return '消息内容过长';
  if (contentBlocks !== undefined) {
    if (!Array.isArray(contentBlocks)) return 'contentBlocks 格式错误';
    if (contentBlocks.length > MAX_CONTENT_BLOCKS) return '富文本内容块过多';
    for (const block of contentBlocks) {
      if (block && typeof block.content === 'string' && block.content.length > MAX_CONTENT_LENGTH) {
        return '消息内容过长';
      }
    }
  }
  return null;
}

/**
 * 会话最后消息预览文案
 */
function previewFor(type, content, contentBlocks) {
  if (type === 'TEXT') return (content || '').slice(0, 200);
  if (type === 'RICH' && Array.isArray(contentBlocks) && contentBlocks.length) {
    return contentBlocks.map(b => (b.blockType === 'image' ? '[图片]' : b.content))
      .join(' ').replace(/\n/g, ' ').slice(0, 200);
  }
  return (TYPE_PREVIEW[type] || `[${type}]`).slice(0, 200);
}

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

    // 非法 ObjectId 直接 404，避免 CastError 落到 500
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return fail(res, 404, '会话不存在');
    }

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
    const { conversationId, receiverId, type = 'TEXT', content, mediaUrl = '', thumbnailUrl = '', contentBlocks = [], replyInfo = null, clientId = '', duration = 0 } = req.body;

    if (!conversationId) {
      return fail(res, 400, '会话 ID 为必填项');
    }
    if (receiverId && !mongoose.Types.ObjectId.isValid(receiverId)) {
      return fail(res, 400, 'ID 格式无效');
    }

    const contentError = validateMessageContent({ content, contentBlocks });
    if (contentError) {
      return fail(res, 400, contentError);
    }

    // 检查会话是否存在且用户有权限访问
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }

    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    const isGroup = conversation.type === 'GROUP';

    // 私聊：接收者必须是会话中的另一方，且好友关系有效
    if (!isGroup) {
      if (!receiverId) {
        return fail(res, 400, '接收者 ID 为必填项');
      }
      if (!conversation.participants.some(p => p.toString() === receiverId)) {
        return fail(res, 400, '接收者不在该会话中');
      }

      // 好友关系校验：删除好友后不可再向历史会话发消息（与 WebSocket 通道一致）
      const isFriend = await Friendship.exists({
        $or: [
          { requester: req.user._id, recipient: receiverId },
          { requester: receiverId, recipient: req.user._id }
        ],
        status: 'ACCEPTED'
      });
      if (!isFriend) {
        return fail(res, 403, '仅好友之间可以发送消息');
      }
    }

    // clientId 幂等：与 WebSocket 通道一致，重发命中已存在消息则直接回显
    if (clientId) {
      const existed = await Message.findOne({ sender: req.user._id, clientId });
      if (existed) {
        await existed.populate(['sender', 'receiver']);
        return ok(res, existed, '', 201);
      }
    }

    // 创建消息（群聊消息无单一接收者）
    const message = new Message({
      conversationId,
      sender: req.user._id,
      receiver: isGroup ? null : receiverId,
      type,
      content,
      mediaUrl,
      thumbnailUrl,
      contentBlocks,
      replyInfo,
      clientId,
      duration: Number(duration) || 0
    });

    await message.save();

    // 更新会话最后消息（预览文案，截断防撑大）
    conversation.lastMessage = previewFor(type, content, contentBlocks);
    conversation.lastMessageTime = message.createdAt;
    conversation.lastMessageType = type;

    // 增加除发送者外所有成员的未读数
    conversation.participants.forEach(p => {
      const pid = p.toString();
      if (pid === req.user._id.toString()) return;
      const unreadCount = conversation.unreadCounts.get(pid) || 0;
      conversation.unreadCounts.set(pid, unreadCount + 1);
    });

    // 有新消息则清除软隐藏，使会话重新出现在列表
    if (conversation.hiddenFor && conversation.hiddenFor.length) {
      conversation.hiddenFor = [];
    }

    await conversation.save();

    // 填充发送者和接收者信息
    await message.populate(['sender', 'receiver']);

    // 在线成员（除发送者）实时推送（与 WebSocket 发送通道行为一致）
    conversation.participants.forEach(p => {
      const pid = p.toString();
      if (pid === req.user._id.toString()) return;
      sendToUser(pid, 'NEW_MESSAGE', message);
    });

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '消息不存在');
    }

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '消息不存在');
    }

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
