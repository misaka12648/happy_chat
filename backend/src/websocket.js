const WebSocket = require('ws');
const { verifyToken } = require('./utils/jwt');
const User = require('./models/User');
const Message = require('./models/Message');
const Conversation = require('./models/Conversation');
const Friendship = require('./models/Friendship');

// 在线用户映射: userId -> Set<WebSocket>（支持同一用户多标签页/多设备同时在线）
const onlineUsers = new Map();

// 与 HTTP 通道一致的内容上限（见 CLAUDE.md 第 4.3 节）
const MAX_CONTENT_LENGTH = 10000;
const MAX_CONTENT_BLOCKS = 50;
const MAX_BLOCK_TEXT_LENGTH = 5000;

/**
 * 设置 WebSocket 服务器
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    path: '/ws'
  });

  wss.on('connection', async (ws, req) => {
    try {
      // 从 URL 参数获取 token
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, '未提供 token');
        return;
      }

      // 验证 token
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId);

      if (!user) {
        ws.close(4001, '用户不存在');
        return;
      }

      // 保存连接信息
      ws.userId = user._id.toString();
      ws.user = user;

      // 加入在线用户列表（多端连接共用一个 Set）
      let sockets = onlineUsers.get(ws.userId);
      const isFirstConnection = !sockets || sockets.size === 0;
      if (!sockets) {
        sockets = new Set();
        onlineUsers.set(ws.userId, sockets);
      }
      sockets.add(ws);

      // 首个连接上线时才更新状态并广播；后续连接（多端）无需重复广播
      if (isFirstConnection) {
        user.online = true;
        await user.save();
      }

      console.log(`用户 ${user.username} 已连接（当前 ${sockets.size} 个连接）`);

      // 发送连接成功消息
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        data: { userId: ws.userId }
      }));

      // 首个连接上线时通知所有好友
      if (isFirstConnection) {
        broadcastOnlineStatus(ws.userId, true);
      }

      // 处理消息
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await handleMessage(ws, message);
        } catch (error) {
          console.error('处理消息错误:', error);
          ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: '消息处理失败' }
          }));
        }
      });

      // 处理连接关闭
      ws.on('close', async () => {
        try {
          const sockets = onlineUsers.get(ws.userId);
          if (!sockets) return;

          sockets.delete(ws);
          // 仅当该用户的全部连接都断开时才标记离线并广播
          if (sockets.size > 0) {
            console.log(`用户 ${user.username} 断开一个连接（剩余 ${sockets.size} 个）`);
            return;
          }
          onlineUsers.delete(ws.userId);

          // 更新用户离线状态
          user.online = false;
          user.lastSeen = new Date();
          await user.save();

          // 通知所有好友该用户离线
          broadcastOnlineStatus(ws.userId, false);

          console.log(`用户 ${user.username} 已断开连接`);
        } catch (error) {
          console.error('处理连接关闭错误:', error);
        }
      });

      // 心跳检测
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });


    } catch (error) {
      console.error('WebSocket 连接错误:', error);
      ws.close(4001, '连接失败');
    }
  });

  // 心跳检测定时器
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log('WebSocket 服务器已启动');
}

/**
 * 处理接收到的消息
 */
async function handleMessage(ws, message) {
  const { type, data } = message;

  switch (type) {
    case 'SEND_MESSAGE':
      await handleSendMessage(ws, data);
      break;

    case 'HEARTBEAT':
      // 前端应用层心跳，无需处理（连接层已有 ws.ping/pong 检测）
      break;

    case 'TYPING':
      await handleTyping(ws, data);
      break;

    case 'READ_MESSAGE':
      await handleReadMessage(ws, data);
      break;

    case 'RECALL_MESSAGE':
      await handleRecallMessage(ws, data);
      break;

    case 'CALL_INVITE':
    case 'CALL_ACCEPT':
    case 'CALL_REJECT':
    case 'CALL_CANCEL':
    case 'CALL_HANGUP':
    case 'CALL_SDP':
    case 'CALL_ICE':
      handleCallSignal(ws, message.type, data);
      break;

    default:
      ws.send(JSON.stringify({
        type: 'ERROR',
        data: { message: '未知的消息类型' }
      }));
  }
}

/**
 * 校验发送者对会话的访问权
 * - P2P：发送者必须是参与者，且接收者是会话中的另一方
 * - GROUP：发送者必须是参与者（群内无需指定接收者）
 * @returns {boolean} 合法返回 true；非法时已向发送者回送 ERROR
 */
function validateConversationAccess(conversation, ws, receiverId) {
  const isParticipant = conversation.participants.some(p => p.toString() === ws.userId);
  if (!isParticipant) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '你无权访问此会话' }
    }));
    return false;
  }
  if (conversation.type === 'GROUP') {
    return true;
  }
  const isReceiverValid = receiverId && receiverId !== ws.userId
    && conversation.participants.some(p => p.toString() === receiverId);
  if (!isReceiverValid) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '接收者不在该会话中' }
    }));
    return false;
  }
  return true;
}

// 各消息类型的会话预览文案（TEXT/RICH 用实际内容）
const TYPE_PREVIEW = { IMAGE: '[图片]', VIDEO: '[视频]', VOICE: '[语音]' };

/**
 * 处理音视频通话信令：仅做合法性校验与转发，不解析信令内容。
 * 支持：CALL_INVITE / CALL_ACCEPT / CALL_REJECT / CALL_CANCEL / CALL_HANGUP / CALL_SDP / CALL_ICE
 * 约束：双方必须在线且为好友；仅私聊（群聊暂不支持通话）。
 */
const CALL_SIGNAL_TYPES = new Set([
  'CALL_INVITE', 'CALL_ACCEPT', 'CALL_REJECT', 'CALL_CANCEL', 'CALL_HANGUP', 'CALL_SDP', 'CALL_ICE'
]);

const CALL_STATE_KEY = new Set(['callId', 'media', 'sdp', 'candidate']);

async function handleCallSignal(ws, type, data) {
  const d = data || {};
  const peerId = typeof d.to === 'string' ? d.to : '';
  if (!peerId || peerId === ws.userId) {
    ws.send(JSON.stringify({ type: 'ERROR', data: { message: '通话信令缺少有效接收者' } }));
    return;
  }

  // 信令只透传白名单字段，避免客户端塞入任意负载
  const payload = {};
  for (const key of CALL_STATE_KEY) {
    if (d[key] !== undefined) payload[key] = d[key];
  }
  if (type === 'CALL_INVITE' && !payload.callId) {
    ws.send(JSON.stringify({ type: 'ERROR', data: { message: '缺少 callId' } }));
    return;
  }

  // 必须是好友（通话是私聊行为）
  const isFriend = await Friendship.exists({
    $or: [
      { requester: ws.userId, recipient: peerId },
      { requester: peerId, recipient: ws.userId }
    ],
    status: 'ACCEPTED'
  });
  if (!isFriend) {
    ws.send(JSON.stringify({ type: 'ERROR', data: { message: '仅好友之间可以发起通话' } }));
    return;
  }

  // 对方不在线
  if (!sendToUser(peerId, type, { ...payload, from: ws.userId })) {
    // 对方离线：仅对 INVITE 回送占线/无应答提示，其余（挂断等）静默丢弃
    if (type === 'CALL_INVITE') {
      ws.send(JSON.stringify({ type: 'CALL_UNAVAILABLE', data: { callId: payload.callId, to: peerId } }));
    }
    return;
  }
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
 * 校验消息内容合法性
 * @returns {string|null} 错误文案；合法返回 null
 */
function validateMessageContent({ content, contentBlocks }) {
  if (typeof content !== 'string' || !content.trim()) return '消息内容不能为空';
  if (content.length > MAX_CONTENT_LENGTH) return '消息内容过长';
  if (contentBlocks !== undefined) {
    if (!Array.isArray(contentBlocks)) return '富文本内容块过多';
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
 * 处理发送消息（P2P 与 GROUP 共用）
 */
async function handleSendMessage(ws, data) {
  const { conversationId, receiverId, content, messageType = 'TEXT', mediaUrl = '', thumbnailUrl = '', contentBlocks = [], replyInfo = null, clientId = '', duration = 0 } = data;

  if (!conversationId) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '缺少必要参数' }
    }));
    return;
  }

  // 检查会话是否存在，且发送者有访问权
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '会话不存在' }
    }));
    return;
  }
  const group = conversation.type === 'GROUP';
  if (!validateConversationAccess(conversation, ws, receiverId)) {
    return;
  }

  // 好友关系校验（仅私聊）：删除好友后不可再向历史会话发消息（防止被删方把会话重新顶回对方列表）
  if (!group) {
    const isFriend = await Friendship.exists({
      $or: [
        { requester: ws.userId, recipient: receiverId },
        { requester: receiverId, recipient: ws.userId }
      ],
      status: 'ACCEPTED'
    });
    if (!isFriend) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        data: { message: '仅好友之间可以发送消息' }
      }));
      return;
    }
  }

  const contentError = validateMessageContent({ content, contentBlocks });
  if (contentError) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: contentError }
    }));
    return;
  }

  // clientId 幂等：重发命中已存在消息则直接回显，不重复入库/不重复计未读
  if (clientId) {
    const existed = await Message.findOne({ sender: ws.userId, clientId });
    if (existed) {
      await existed.populate('sender', '-password');
      ws.send(JSON.stringify({
        type: 'MESSAGE_SENT',
        data: existed
      }));
      return;
    }
  }

  // 创建消息（群聊消息无单一接收者）
  const message = new Message({
    conversationId,
    sender: ws.userId,
    receiver: group ? null : receiverId,
    type: messageType,
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
  conversation.lastMessage = previewFor(messageType, content, contentBlocks);
  conversation.lastMessageTime = message.createdAt;
  conversation.lastMessageType = messageType;
  // 群聊列表预览显示发送者名
  conversation.lastMessageSenderName = (ws.user && (ws.user.nickname || ws.user.username)) || '';

  // 增加除发送者外所有成员的未读数
  conversation.participants.forEach(p => {
    const pid = p.toString();
    if (pid === ws.userId) return;
    const unreadCount = conversation.unreadCounts.get(pid) || 0;
    conversation.unreadCounts.set(pid, unreadCount + 1);
  });

  // 有新消息则清除软隐藏，使会话在各成员列表中重新出现
  if (conversation.hiddenFor && conversation.hiddenFor.length) {
    conversation.hiddenFor = [];
  }

  await conversation.save();

  // 填充发送者信息
  await message.populate('sender', '-password');

  // 发送确认给发送者（该连接）
  ws.send(JSON.stringify({
    type: 'MESSAGE_SENT',
    data: message
  }));

  // 向其他全部在线成员实时推送（私聊即对方，群聊即其余成员）
  conversation.participants.forEach(p => {
    const pid = p.toString();
    if (pid === ws.userId) return;
    sendToUser(pid, 'NEW_MESSAGE', message);
  });
}

/**
 * 处理消息撤回
 */
async function handleRecallMessage(ws, data) {
  const { messageId, conversationId } = data;

  const message = await Message.findById(messageId);
  if (!message) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '消息不存在' }
    }));
    return;
  }

  // 验证只能撤回自己的消息
  if (message.sender.toString() !== ws.userId) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '只能撤回自己的消息' }
    }));
    return;
  }

  // 验证发送者仍是会话成员
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.participants.some(p => p.toString() === ws.userId)) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '你无权访问此会话' }
    }));
    return;
  }
  if (message.conversationId.toString() !== conversation._id.toString()) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '消息不属于此会话' }
    }));
    return;
  }

  // 验证发送后5分钟内
  const elapsed = Date.now() - new Date(message.createdAt).getTime();
  if (elapsed > 5 * 60 * 1000) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '消息已超过5分钟，无法撤回' }
    }));
    return;
  }

  // 标记为已撤回（数据库保留原始内容可追溯）
  message.recalled = true;
  message.recalledAt = new Date();
  await message.save();

  // 查询发送者昵称
  const sender = await User.findById(ws.userId);
  const senderName = sender.nickname || sender.username;

  const recallData = {
    messageId,
    conversationId,
    recalled: true,
    recalledAt: message.recalledAt,
    senderName
  };

  // 通知会话内全部成员（含发送者的其他设备）
  conversation.participants.forEach(p => {
    sendToUser(p.toString(), 'MESSAGE_RECALLED', recallData);
  });
}

/**
 * 处理正在输入状态
 * 私聊推给对方；群聊转发给除发送者外的全部成员
 */
async function handleTyping(ws, data) {
  const { conversationId, receiverId } = data;

  if (!conversationId) {
    return;
  }

  const conversation = await Conversation.findById(conversationId).select('participants type');
  if (!conversation || !conversation.participants.some(p => p.toString() === ws.userId)) {
    return;
  }

  conversation.participants.forEach(p => {
    const pid = p.toString();
    if (pid === ws.userId) return;
    // 私聊仅推给对方；群聊若显式指定 receiverId 则只推给该成员（保持兼容），否则全员
    if (conversation.type !== 'GROUP' && pid !== receiverId) return;
    if (conversation.type === 'GROUP' && receiverId && pid !== receiverId) return;
    sendToUser(pid, 'TYPING', {
      conversationId,
      userId: ws.userId
    });
  });
}

/**
 * 处理消息已读
 * 两种形态：
 * - { messageId, conversationId }：单条回执（兼容旧客户端）
 * - { conversationId }：批量已读——将该会话中发给当前用户的全部未读消息标记已读
 * 群聊不产生已读回执（与主流 IM 一致），仅清零自己的未读数
 */
async function handleReadMessage(ws, data) {
  const { messageId, conversationId } = data;

  // 会话必须存在且当前用户是参与者
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.participants.some(p => p.toString() === ws.userId)) {
    return;
  }

  // 批量已读：标记全部未读、清零会话未读数，并通知对方（readAll 让对方把所有自己发的消息置为已读）
  if (!messageId) {
    if (conversation.type === 'GROUP') {
      conversation.unreadCounts.set(ws.userId, 0);
      await conversation.save();
      return;
    }
    const result = await Message.updateMany(
      { conversationId, receiver: ws.userId, read: false },
      { $set: { read: true } }
    );
    conversation.unreadCounts.set(ws.userId, 0);
    await conversation.save();
    if (result.modifiedCount > 0) {
      const otherId = conversation.participants.find(p => p.toString() !== ws.userId);
      sendToUser(otherId, 'MESSAGE_READ', { conversationId, readAll: true });
    }
    return;
  }

  // 单条已读（仅接收者本人可标记；群聊消息无接收者概念，直接跳过）
  const message = await Message.findById(messageId);
  if (!message) {
    return;
  }
  if (message.conversationId.toString() !== conversation._id.toString()) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '消息不属于此会话' }
    }));
    return;
  }
  if (message.receiver && message.receiver.toString() === ws.userId) {
    message.read = true;
    await message.save();
  }

  // 重置会话未读数
  conversation.unreadCounts.set(ws.userId, 0);
  await conversation.save();

  // 通知发送者消息已读
  if (message) {
    sendToUser(message.sender.toString(), 'MESSAGE_READ', { messageId, conversationId });
  }
}

/**
 * 广播用户在线状态
 */
async function broadcastOnlineStatus(userId, isOnline) {
  try {
    // 查询该用户的所有好友
    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: 'ACCEPTED' },
        { recipient: userId, status: 'ACCEPTED' }
      ]
    });

    // 提取好友 ID
    const friendIds = friendships.map(f =>
      f.requester.toString() === userId.toString() ? f.recipient.toString() : f.requester.toString()
    );

    // 通知每个在线的好友（含其所有连接）
    for (const friendId of friendIds) {
      sendToUser(friendId, 'ONLINE_STATUS', {
        userId: userId,
        online: isOnline
      });
    }
  } catch (error) {
    console.error('广播在线状态失败:', error);
  }
}

/**
 * 获取在线用户数
 */
function getOnlineUserCount() {
  return onlineUsers.size;
}

/**
 * 检查用户是否在线
 */
function isUserOnline(userId) {
  const sockets = onlineUsers.get(userId.toString());
  return !!sockets && sockets.size > 0;
}

/**
 * 向指定用户的所有在线连接发送消息
 * @returns {boolean} 至少送达一个连接返回 true
 */
function sendToUser(userId, type, data) {
  const key = userId.toString();
  const sockets = onlineUsers.get(key);
  if (!sockets || sockets.size === 0) return false;

  const payload = JSON.stringify({ type, data });
  let delivered = false;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      delivered = true;
    }
  }
  return delivered;
}

module.exports = {
  setupWebSocket,
  getOnlineUserCount,
  isUserOnline,
  sendToUser
};
