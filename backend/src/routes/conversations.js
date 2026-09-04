const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { ok, fail } = require('../utils/response');

/**
 * GET /api/conversations
 * 获取当前用户的会话列表
 */
router.get('/', async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
      // 排除当前用户已在列表中“删除”（软隐藏）的会话
      hiddenFor: { $ne: req.user._id }
    })
    .populate('participants', '-password')
    .sort({ lastMessageTime: -1 });

    // 批量获取每个会话的最后一条消息，生成准确的预览
    const conversationIds = conversations.map(c => c._id);
    const lastMessagesAgg = await Message.aggregate([
      { $match: { conversationId: { $in: conversationIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', lastMsg: { $first: '$$ROOT' } } }
    ]);

    const lastMsgMap = new Map();
    lastMessagesAgg.forEach(item => {
      lastMsgMap.set(item._id.toString(), item.lastMsg);
    });

    // 格式化会话列表，用实际最后一条消息生成预览
    const formattedConversations = conversations.map(conv => {
      const otherUser = conv.participants.find(
        p => p._id.toString() !== req.user._id.toString()
      );

      let lastMessage = conv.lastMessage;
      let lastMessageTime = conv.lastMessageTime;
      let lastMessageType = conv.lastMessageType;

      const lastMsg = lastMsgMap.get(conv._id.toString());
      if (lastMsg) {
        lastMessageTime = lastMsg.createdAt;
        lastMessageType = lastMsg.type;
        if (lastMsg.recalled) {
          lastMessage = '已撤回';
        } else if (lastMsg.type === 'RICH' && lastMsg.contentBlocks) {
          lastMessage = lastMsg.contentBlocks.map(b => {
            if (b.blockType === 'image') return '[图片]';
            return b.content;
          }).join(' ').replace(/\n/g, ' ').slice(0, 50);
        } else if (lastMsg.type === 'IMAGE') {
          lastMessage = '[图片]';
        } else if (lastMsg.type === 'VIDEO') {
          lastMessage = '[视频]';
        } else {
          lastMessage = lastMsg.content;
        }
      }

      return {
        _id: conv._id,
        otherUser: otherUser,
        lastMessage,
        lastMessageTime,
        lastMessageType,
        unreadCount: conv.unreadCounts.get(req.user._id.toString()) || 0
      };
    });

    ok(res, formattedConversations);
  } catch (error) {
    console.error('获取会话列表错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/conversations
 * 创建或获取会话
 */
router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return fail(res, 400, '用户 ID 为必填项');
    }

    // 查找现有会话
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, userId] }
    }).populate('participants', '-password');

    // 如果不存在，创建新会话
    if (!conversation) {
      conversation = new Conversation({
        participants: [req.user._id, userId],
        unreadCounts: new Map()
      });
      await conversation.save();
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', '-password');
    }

    const otherUser = conversation.participants.find(
      p => p._id.toString() !== req.user._id.toString()
    );

    ok(res, {
      _id: conversation._id,
      otherUser: otherUser,
      lastMessage: conversation.lastMessage,
      lastMessageTime: conversation.lastMessageTime,
      lastMessageType: conversation.lastMessageType,
      unreadCount: conversation.unreadCounts.get(req.user._id.toString()) || 0
    });
  } catch (error) {
    console.error('创建会话错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/conversations/:id/read
 * 标记会话为已读
 */
router.put('/:id/read', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }

    // 检查当前用户是否是会话参与者
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    // 重置未读数
    conversation.unreadCounts.set(req.user._id.toString(), 0);
    await conversation.save();

    ok(res, null, '已标记为已读');
  } catch (error) {
    console.error('标记已读错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * DELETE /api/conversations/:id
 * 从当前用户的会话列表中删除（软隐藏）：
 * 仅将当前用户加入 hiddenFor，不删除任何消息，也不影响对方；
 * 从通讯录重新进入时仍能拿到同一会话与历史消息，任一方再发消息时会话会重新出现。
 */
router.delete('/:id', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }

    // 检查当前用户是否是会话参与者
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    // 软隐藏：仅将自己加入 hiddenFor（幂等，重复删除不会重复写入）
    await Conversation.updateOne(
      { _id: conversation._id },
      { $addToSet: { hiddenFor: req.user._id } }
    );

    ok(res, null, '已删除');
  } catch (error) {
    console.error('删除会话错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
