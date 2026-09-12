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
const MAX_BLOCK_TEXT_LENGTH = 5000;

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
      if (block && typeof block.content === 'string' && block.content.length > MAX_BLOCK_TEXT_LENGTH) {
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

    // "清空聊天记录"语义：仅隐藏该用户清空时间点之前的消息（对方视角不受影响）
    const clearedAt = conversation.clearedAt && conversation.clearedAt.get(req.user._id.toString());
    const query = { conversationId };
    if (clearedAt) {
      query.createdAt = { $gt: clearedAt };
    }
    // 本地删除的消息（hiddenFor 含自己）同样不可见
    query.hiddenFor = { $ne: req.user._id };

    // 获取消息总数
    const total = await Message.countDocuments(query);

    // 获取分页消息
    const messages = await Message.find(query)
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
 * GET /api/messages/search/global?keyword=&limit=
 * 跨会话消息搜索：仅搜索我参与的全部会话，按时间倒序。
 * 注意：必须注册在 '/:conversationId/search' 之前，否则 'search' 会被当作会话 ID。
 */
router.get('/search/global', async (req, res) => {
  try {
    const { keyword = '', limit = 20 } = req.query;
    const kw = String(keyword || '').trim();
    if (!kw) return fail(res, 400, '请输入搜索关键词');
    if (kw.length > 100) return fail(res, 400, '搜索关键词过长');

    const convs = await Conversation.find({ participants: req.user._id })
      .select('_id type name participants clearedAt')
      .populate('participants', 'username nickname avatar');
    const convIds = convs.map(c => c._id);
    if (!convIds.length) return ok(res, { messages: [] });

    // 清空记录是用户视角语义：每个会话只能搜索该用户清空时间点之后的消息。
    const myId = req.user._id.toString();
    const visibleScopes = convs.map(c => {
      const cutoff = c.clearedAt && c.clearedAt.get(myId);
      return cutoff
        ? { conversationId: c._id, createdAt: { $gt: cutoff } }
        : { conversationId: c._id };
    });

    // 用户输入拼正则必须先转义（CLAUDE.md 第 4.3 节）
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const messages = await Message.find({
      $and: [
        { $or: visibleScopes },
        {
          $or: [
            { type: 'TEXT', content: { $regex: escaped, $options: 'i' } },
            { type: 'RICH', contentBlocks: { $elemMatch: { blockType: 'text', content: { $regex: escaped, $options: 'i' } } } }
          ]
        }
      ],
      recalled: { $ne: true },
      hiddenFor: { $ne: req.user._id }
    })
      .populate('sender', 'nickname username avatar')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 20, 50));

    const convMap = new Map(convs.map(c => [c._id.toString(), c]));
    ok(res, {
      messages: messages.map(m => {
        const c = convMap.get(m.conversationId.toString());
        const peer = c && c.type === 'P2P'
          ? c.participants.find(p => p._id.toString() !== myId)
          : null;
        return {
          _id: m._id,
          conversationId: m.conversationId,
          conversationType: c ? c.type : 'P2P',
          conversationName: c && c.type === 'GROUP' ? c.name : '',
          otherUser: peer ? {
            _id: peer._id,
            username: peer.username,
            nickname: peer.nickname,
            avatar: peer.avatar
          } : null,
          sender: m.sender,
          content: m.type === 'RICH'
            ? (m.contentBlocks || []).filter(b => b.blockType === 'text').map(b => b.content).join(' ')
            : m.content,
          createdAt: m.createdAt
        };
      })
    });
  } catch (error) {
    console.error('全局消息搜索错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/messages/:conversationId/search?keyword=&limit=
 * 会话内消息搜索：TEXT 内容与 RICH 文本块模糊匹配，按时间倒序返回
 */
router.get('/:conversationId/search', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { keyword = '', limit = 30 } = req.query;

    // 非法 ObjectId 直接 404，避免 CastError 落到 500
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return fail(res, 404, '会话不存在');
    }
    const kw = String(keyword).trim();
    if (!kw) return fail(res, 400, '请输入搜索关键词');
    if (kw.length > 100) return fail(res, 400, '搜索关键词过长');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    // 用户输入拼正则必须先转义（CLAUDE.md 第 4.3 节）
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = {
      conversationId,
      recalled: { $ne: true },
      hiddenFor: { $ne: req.user._id },
      $or: [
        { type: 'TEXT', content: { $regex: escaped, $options: 'i' } },
        { type: 'RICH', contentBlocks: { $elemMatch: { blockType: 'text', content: { $regex: escaped, $options: 'i' } } } }
      ]
    };
    const clearedAt = conversation.clearedAt && conversation.clearedAt.get(req.user._id.toString());
    if (clearedAt) query.createdAt = { $gt: clearedAt };

    const messages = await Message.find(query)
      .populate('sender', '-password')
      .populate('receiver', '-password')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 30, 50));

    ok(res, { messages });
  } catch (error) {
    console.error('消息搜索错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * DELETE /api/messages/conversation/:conversationId
 * 清空聊天记录（仅自己视角）：记录清空时间点，拉取时过滤该时间之前的消息；同时清零自己的未读。
 * 用两段路径与单条消息删除 DELETE /:id 消歧。
 */
router.delete('/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权操作此会话');
    }
    if (!conversation.clearedAt) {
      conversation.clearedAt = new Map();
    }
    conversation.clearedAt.set(req.user._id.toString(), new Date());
    conversation.unreadCounts.set(req.user._id.toString(), 0);
    conversation.markModified('clearedAt');
    conversation.markModified('unreadCounts');
    await conversation.save();
    ok(res, null, '聊天记录已清空');
  } catch (error) {
    console.error('清空聊天记录错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * DELETE /api/messages/:id
 * 删除消息（仅自己视角：加入 hiddenFor，对方不受影响；服务端保留原消息）
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, 404, '消息不存在');
    }
    const message = await Message.findById(id);
    if (!message) {
      return fail(res, 404, '消息不存在');
    }
    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权操作此消息');
    }
    await Message.updateOne({ _id: id }, { $addToSet: { hiddenFor: req.user._id } });
    ok(res, null, '消息已删除');
  } catch (error) {
    console.error('删除消息错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/messages/:id/reactions { emoji }
 * 切换表情回应：已回应同一表情则取消，否则添加；结果实时广播给会话成员
 */
router.put('/:id/reactions', async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, 404, '消息不存在');
    }
    if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > 8) {
      return fail(res, 400, '表情格式错误');
    }
    const message = await Message.findById(id);
    if (!message) {
      return fail(res, 404, '消息不存在');
    }
    const conversation = await Conversation.findById(message.conversationId);
    if (!conversation || !conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权操作此消息');
    }
    if (message.recalled) {
      return fail(res, 400, '消息已撤回');
    }

    const reactions = message.reactions || [];
    const mine = req.user._id.toString();
    const entry = reactions.find(r => r.emoji === emoji);
    if (entry && entry.users.some(u => u.toString() === mine)) {
      // 已回应：取消
      entry.users = entry.users.filter(u => u.toString() !== mine);
      if (!entry.users.length) {
        reactions.splice(reactions.indexOf(entry), 1);
      }
    } else if (entry) {
      entry.users.push(req.user._id);
    } else {
      reactions.push({ emoji, users: [req.user._id] });
    }
    message.reactions = reactions;
    message.markModified('reactions');
    await message.save();

    const payload = { messageId: id, conversationId: message.conversationId, reactions, userId: mine };
    // 实时广播给会话全体成员（含自己，驱动多端同步）
    conversation.participants.forEach(p => {
      sendToUser(p.toString(), 'MESSAGE_REACTION', payload);
    });
    ok(res, { reactions });
  } catch (error) {
    console.error('表情回应错误:', error);
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
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return fail(res, 404, '会话不存在');
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
    conversation.lastMessageSenderName = (req.user && (req.user.nickname || req.user.username)) || '';

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
