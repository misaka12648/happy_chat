const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { sendToUser } = require('../websocket');
const { ok, fail } = require('../utils/response');

// 群成员上限
const MAX_GROUP_MEMBERS = 50;

/**
 * GET /api/conversations
 * 获取当前用户的会话列表（私聊含对方备注；群聊含群名与成员摘要）
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

    // 我对每位好友的备注映射（key = 好友 userId）
    const myId = req.user._id.toString();
    const conversationIds = conversations.map(c => c._id);
    const lastMessageScopes = conversations.map(conv => {
      const scope = { conversationId: conv._id, hiddenFor: { $ne: req.user._id } };
      const clearedAt = conv.clearedAt && conv.clearedAt.get(myId);
      if (clearedAt) scope.createdAt = { $gt: clearedAt };
      return scope;
    });
    const lastMessagesAgg = conversationIds.length
      ? await Message.aggregate([
        { $match: { $or: lastMessageScopes } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$conversationId', lastMsg: { $first: '$$ROOT' } } }
      ])
      : [];

    const lastMsgMap = new Map();
    lastMessagesAgg.forEach(item => {
      lastMsgMap.set(item._id.toString(), item.lastMsg);
    });

    // 我对每位好友的备注映射（key = 好友 userId）
    const friendships = await Friendship.find({
      $or: [
        { requester: req.user._id, status: 'ACCEPTED' },
        { recipient: req.user._id, status: 'ACCEPTED' }
      ]
    }).select('requester recipient remarks');
    const remarkMap = new Map();
    friendships.forEach(f => {
      const other = f.requester._id.toString() === myId ? f.recipient._id.toString() : f.requester._id.toString();
      remarkMap.set(other, (f.remarks && f.remarks.get(myId)) || '');
    });

    // 格式化会话列表，用实际最后一条消息生成预览
    const formattedConversations = conversations.map(conv => {
      const clearedAt = conv.clearedAt && conv.clearedAt.get(myId);
      const lastMsg = lastMsgMap.get(conv._id.toString());
      const base = {
        _id: conv._id,
        type: conv.type,
        lastMessage: clearedAt || !lastMsg ? '' : conv.lastMessage,
        lastMessageTime: clearedAt || conv.lastMessageTime,
        lastMessageType: conv.lastMessageType,
        lastMessageSenderName: conv.lastMessageSenderName || '',
        unreadCount: conv.unreadCounts.get(myId) || 0,
        // 当前用户视角的置顶/免打扰状态
        pinned: conv.pinnedFor.some(p => p.toString() === myId),
        muted: conv.mutedFor.some(p => p.toString() === myId)
      };

      if (conv.type === 'GROUP') {
        return {
          ...base,
          name: conv.name,
          owner: conv.owner,
          members: conv.participants.map(p => ({
            _id: p._id,
            username: p.username,
            nickname: p.nickname,
            avatar: p.avatar,
            online: p.online
          })),
          memberCount: conv.participants.length
        };
      }

      const otherUser = conv.participants.find(
        p => p._id.toString() !== myId
      );
      // 转为普通对象再注入备注（直接挂在 mongoose 文档上的自定义属性会被 toJSON 丢弃）
      const other = otherUser ? otherUser.toObject() : null;
      if (other) {
        other.remark = remarkMap.get(other._id.toString()) || '';
      }

      let lastMessage = base.lastMessage;
      let lastMessageTime = base.lastMessageTime;
      let lastMessageType = base.lastMessageType;

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
        } else if (lastMsg.type === 'VOICE') {
          lastMessage = '[语音]';
        } else {
          lastMessage = lastMsg.content;
        }
      }

      return {
        ...base,
        otherUser: other,
        lastMessage,
        lastMessageTime,
        lastMessageType
      };
    });

    // 置顶会话排最前，其余按最后消息时间倒序
    formattedConversations.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
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
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return fail(res, 400, '用户 ID 无效');
    }
    if (userId === req.user._id.toString()) {
      return fail(res, 400, '不能与自己创建会话');
    }

    // 查找现有会话（历史会话保持可用，即使好友关系已解除）；仅匹配私聊，避免误命中包含双方成员的群
    let conversation = await Conversation.findOne({
      type: 'P2P',
      participants: { $all: [req.user._id, userId] }
    }).populate('participants', '-password');

    // 如果不存在，校验好友关系后创建新会话（防止陌生人骚扰）
    if (!conversation) {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        return fail(res, 404, '用户不存在');
      }

      const isFriend = await Friendship.exists({
        $or: [
          { requester: req.user._id, recipient: userId },
          { requester: userId, recipient: req.user._id }
        ],
        status: 'ACCEPTED'
      });
      if (!isFriend) {
        return fail(res, 403, '仅好友之间可以发起聊天');
      }

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }

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

/**
 * PUT /api/conversations/:id/pin
 * 置顶 / 取消置顶（仅当前用户视角）
 */
router.put('/:id/pin', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    const on = !!req.body.pinned;
    const update = on
      ? { $addToSet: { pinnedFor: req.user._id } }
      : { $pull: { pinnedFor: req.user._id } };
    await Conversation.updateOne({ _id: conversation._id }, update);

    ok(res, { pinned: on }, on ? '已置顶' : '已取消置顶');
  } catch (error) {
    console.error('置顶会话错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/conversations/:id/mute
 * 开启 / 关闭免打扰（仅当前用户视角）
 */
router.put('/:id/mute', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (!conversation.participants.includes(req.user._id)) {
      return fail(res, 403, '你无权访问此会话');
    }

    const on = !!req.body.muted;
    const update = on
      ? { $addToSet: { mutedFor: req.user._id } }
      : { $pull: { mutedFor: req.user._id } };
    await Conversation.updateOne({ _id: conversation._id }, update);

    ok(res, { muted: on }, on ? '已开启免打扰' : '已关闭免打扰');
  } catch (error) {
    console.error('免打扰设置错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * GET /api/conversations/:id
 * 获取单个会话详情（私聊返回对方信息；群聊返回群名与成员列表）
 */
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id)
      .populate('participants', '-password');
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (!conversation.participants.some(p => p._id.toString() === req.user._id.toString())) {
      return fail(res, 403, '你无权访问此会话');
    }

    if (conversation.type === 'GROUP') {
      return ok(res, {
        _id: conversation._id,
        type: 'GROUP',
        name: conversation.name,
        owner: conversation.owner,
        announcement: conversation.announcement || '',
        members: conversation.participants.map(p => ({
          _id: p._id,
          username: p.username,
          nickname: p.nickname,
          avatar: p.avatar,
          bio: p.bio,
          online: p.online
        })),
        memberCount: conversation.participants.length
      });
    }

    const otherUser = conversation.participants.find(p => p._id.toString() !== req.user._id.toString());
    ok(res, {
      _id: conversation._id,
      type: 'P2P',
      otherUser
    });
  } catch (error) {
    console.error('获取会话详情错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/conversations/group
 * 创建群聊：创建者 + 至少 1 位好友（成员须为创建者的好友），上限 50 人
 */
router.post('/group', async (req, res) => {
  try {
    const { name, memberIds } = req.body;

    const groupName = typeof name === 'string' ? name.trim() : '';
    if (!groupName) {
      return fail(res, 400, '请填写群名称');
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return fail(res, 400, '请至少选择 1 位群成员');
    }
    if (new Set(memberIds).size !== memberIds.length) {
      return fail(res, 400, '群成员不能重复');
    }
    if (memberIds.length + 1 > MAX_GROUP_MEMBERS) {
      return fail(res, 400, `群成员最多 ${MAX_GROUP_MEMBERS} 人`);
    }
    if (memberIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
      return fail(res, 400, '成员 ID 无效');
    }
    if (memberIds.some(id => id === req.user._id.toString())) {
      return fail(res, 400, '无需添加自己为成员');
    }

    // 全部成员必须是真实存在且为创建者好友的用户
    const members = await User.find({ _id: { $in: memberIds } }).select('_id');
    if (members.length !== memberIds.length) {
      return fail(res, 404, '部分成员不存在');
    }
    for (const memberId of memberIds) {
      const isFriend = await Friendship.exists({
        $or: [
          { requester: req.user._id, recipient: memberId },
          { requester: memberId, recipient: req.user._id }
        ],
        status: 'ACCEPTED'
      });
      if (!isFriend) {
        return fail(res, 403, '仅能邀请自己的好友入群');
      }
    }

    const conversation = await Conversation.create({
      type: 'GROUP',
      name: groupName,
      owner: req.user._id,
      participants: [req.user._id, ...memberIds],
      unreadCounts: new Map()
    });
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', '-password');

    // 通知被拉入的成员（在线时），与邀请入群路由保持一致
    memberIds.forEach(mid => {
      sendToUser(mid, 'GROUP_ADDED', { conversationId: conversation._id, name: conversation.name });
    });

    ok(res, {
      _id: populated._id,
      type: 'GROUP',
      name: populated.name,
      owner: populated.owner,
      members: populated.participants.map(p => ({
        _id: p._id,
        username: p.username,
        nickname: p.nickname,
        avatar: p.avatar,
        online: p.online
      })),
      memberCount: populated.participants.length
    }, '群聊创建成功', 201);
  } catch (error) {
    console.error('创建群聊错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/conversations/:id/announcement
 * 设置群公告（仅群主，≤200 字，空串清除）
 */
router.put('/:id/announcement', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (conversation.type !== 'GROUP') {
      return fail(res, 400, '仅群聊可以设置公告');
    }
    if (conversation.owner.toString() !== req.user._id.toString()) {
      return fail(res, 403, '仅群主可以设置群公告');
    }
    if (typeof req.body.announcement !== 'string') {
      return fail(res, 400, '公告内容格式错误');
    }
    const announcement = req.body.announcement.trim();
    if (announcement.length > 200) {
      return fail(res, 400, '群公告最多 200 字');
    }
    conversation.announcement = announcement;
    await conversation.save();

    // 实时推送给其他成员（在线时）：浏览该群的公告条即时更新，未浏览的弹提示
    conversation.participants.forEach(p => {
      if (p.toString() !== req.user._id.toString()) {
        sendToUser(p.toString(), 'GROUP_ANNOUNCEMENT', {
          conversationId: conversation._id,
          announcement,
          name: conversation.name
        });
      }
    });

    ok(res, { announcement });
  } catch (error) {
    console.error('设置群公告错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/conversations/:id/name
 * 修改群名称（仅群主）
 */
router.put('/:id/name', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (conversation.type !== 'GROUP') {
      return fail(res, 400, '仅群聊可以修改群名称');
    }
    if (conversation.owner.toString() !== req.user._id.toString()) {
      return fail(res, 403, '仅群主可以修改群名称');
    }
    const groupName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!groupName) {
      return fail(res, 400, '群名称不能为空');
    }
    conversation.name = groupName;
    await conversation.save();

    ok(res, { name: conversation.name }, '群名称已更新');
  } catch (error) {
    console.error('修改群名称错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * PUT /api/conversations/:id/members
 * 邀请新成员入群（仅群主；被邀请者须为群主好友）
 */
router.put('/:id/members', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (conversation.type !== 'GROUP') {
      return fail(res, 400, '仅群聊可以添加成员');
    }
    if (conversation.owner.toString() !== req.user._id.toString()) {
      return fail(res, 403, '仅群主可以添加成员');
    }

    const { memberIds } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return fail(res, 400, '请选择要邀请的成员');
    }
    if (new Set(memberIds).size !== memberIds.length) {
      return fail(res, 400, '群成员不能重复');
    }
    if (conversation.participants.length + memberIds.length > MAX_GROUP_MEMBERS) {
      return fail(res, 400, `群成员最多 ${MAX_GROUP_MEMBERS} 人`);
    }
    for (const memberId of memberIds) {
      if (!mongoose.Types.ObjectId.isValid(memberId)) {
        return fail(res, 400, '成员 ID 无效');
      }
      if (conversation.participants.some(p => p.toString() === memberId)) {
        return fail(res, 400, '该用户已在群内');
      }
      const isFriend = await Friendship.exists({
        $or: [
          { requester: req.user._id, recipient: memberId },
          { requester: memberId, recipient: req.user._id }
        ],
        status: 'ACCEPTED'
      });
      if (!isFriend) {
        return fail(res, 403, '仅能邀请自己的好友入群');
      }
    }

    conversation.participants.push(...memberIds);
    await conversation.save();
    const populated = await Conversation.findById(conversation._id)
      .populate('participants', '-password');

    // 通知新成员（在线时）
    memberIds.forEach(mid => {
      sendToUser(mid, 'GROUP_ADDED', { conversationId: conversation._id, name: conversation.name });
    });

    ok(res, {
      _id: populated._id,
      members: populated.participants.map(p => ({
        _id: p._id,
        username: p.username,
        nickname: p.nickname,
        avatar: p.avatar,
        online: p.online
      })),
      memberCount: populated.participants.length
    }, '已添加成员');
  } catch (error) {
    console.error('添加群成员错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * POST /api/conversations/:id/quit
 * 退出群聊（群主不可退出，需先解散）；退出后清除该成员的未读/置顶/免打扰/软隐藏记录
 */
router.post('/:id/quit', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (conversation.type !== 'GROUP') {
      return fail(res, 400, '仅群聊可以退出');
    }
    if (conversation.owner.toString() === req.user._id.toString()) {
      return fail(res, 400, '群主不能退出群聊，可选择解散群聊');
    }
    if (!conversation.participants.some(p => p.toString() === req.user._id.toString())) {
      return fail(res, 403, '你不是该群成员');
    }

    const quitter = await User.findById(req.user._id).select('nickname username');
    const remaining = conversation.participants.filter(p => p.toString() !== req.user._id.toString());
    conversation.participants.pull(req.user._id);
    conversation.unreadCounts.delete(req.user._id.toString());
    conversation.clearedAt.delete(req.user._id.toString());
    conversation.pinnedFor.pull(req.user._id);
    conversation.mutedFor.pull(req.user._id);
    conversation.hiddenFor.pull(req.user._id);
    await conversation.save();

    // 通知剩余成员有人退群（在线时），前端刷新成员与列表
    remaining.forEach(mid => {
      sendToUser(mid.toString(), 'GROUP_MEMBER_LEFT', {
        conversationId: conversation._id,
        name: conversation.name,
        nickname: quitter ? (quitter.nickname || quitter.username) : '有成员'
      });
    });

    ok(res, null, '已退出群聊');
  } catch (error) {
    console.error('退出群聊错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

/**
 * DELETE /api/conversations/:id/group
 * 解散群聊（仅群主）：删除会话与群内全部消息
 */
router.delete('/:id/group', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 404, '会话不存在');
    }
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return fail(res, 404, '会话不存在');
    }
    if (conversation.type !== 'GROUP') {
      return fail(res, 400, '仅群聊可以解散');
    }
    if (conversation.owner.toString() !== req.user._id.toString()) {
      return fail(res, 403, '仅群主可以解散群聊');
    }

    // 通知除群主外的全部成员群已解散（在线时），前端移除会话并退出详情页
    conversation.participants.forEach(p => {
      if (p.toString() !== req.user._id.toString()) {
        sendToUser(p.toString(), 'GROUP_DISBANDED', { conversationId: conversation._id, name: conversation.name });
      }
    });

    await Message.deleteMany({ conversationId: conversation._id });
    await conversation.deleteOne();

    ok(res, null, '群聊已解散');
  } catch (error) {
    console.error('解散群聊错误:', error);
    fail(res, 500, '服务器内部错误');
  }
});

module.exports = router;
