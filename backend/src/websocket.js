const WebSocket = require('ws');
const { verifyToken } = require('./utils/jwt');
const User = require('./models/User');
const Message = require('./models/Message');
const Conversation = require('./models/Conversation');
const Friendship = require('./models/Friendship');

// 在线用户映射: userId -> WebSocket
const onlineUsers = new Map();

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
      
      // 添加到在线用户列表
      onlineUsers.set(ws.userId, ws);
      
      // 更新用户在线状态
      user.online = true;
      await user.save();

      console.log(`用户 ${user.username} 已连接`);

      // 发送连接成功消息
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        data: { userId: ws.userId }
      }));

      // 通知所有好友该用户上线
      broadcastOnlineStatus(ws.userId, true);

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
          // 从在线用户列表中移除
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

    default:
      ws.send(JSON.stringify({
        type: 'ERROR',
        data: { message: '未知的消息类型' }
      }));
  }
}

/**
 * 处理发送消息
 */
async function handleSendMessage(ws, data) {
  const { conversationId, receiverId, content, messageType = 'TEXT', mediaUrl = '', thumbnailUrl = '', contentBlocks = [], replyInfo = null, clientId = '' } = data;

  if (!conversationId || !receiverId || !content) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '缺少必要参数' }
    }));
    return;
  }

  // 检查会话是否存在
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: '会话不存在' }
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

  // 创建消息
  const message = new Message({
    conversationId,
    sender: ws.userId,
    receiver: receiverId,
    type: messageType,
    content,
    mediaUrl,
    thumbnailUrl,
    contentBlocks,
    replyInfo,
    clientId
  });

  await message.save();

  // 更新会话最后消息
  conversation.lastMessage = messageType === 'TEXT' ? content : `[${messageType}]`;
  conversation.lastMessageTime = message.createdAt;
  conversation.lastMessageType = messageType;
  
  // 增加接收者的未读数
  const unreadCount = conversation.unreadCounts.get(receiverId) || 0;
  conversation.unreadCounts.set(receiverId, unreadCount + 1);

  // 有新消息则清除双方的软隐藏，使会话在双方列表中重新出现
  if (conversation.hiddenFor && conversation.hiddenFor.length) {
    conversation.hiddenFor = [];
  }

  await conversation.save();

  // 填充发送者信息
  await message.populate('sender', '-password');

  // 发送确认给发送者
  ws.send(JSON.stringify({
    type: 'MESSAGE_SENT',
    data: message
  }));

  // 如果接收者在线，实时推送消息
  const receiverWs = onlineUsers.get(receiverId);
  if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
    receiverWs.send(JSON.stringify({
      type: 'NEW_MESSAGE',
      data: message
    }));
  }
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

  // 通知发送者
  ws.send(JSON.stringify({
    type: 'MESSAGE_RECALLED',
    data: recallData
  }));

  // 通知接收者
  const receiverWs = onlineUsers.get(message.receiver.toString());
  if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
    receiverWs.send(JSON.stringify({
      type: 'MESSAGE_RECALLED',
      data: recallData
    }));
  }
}

/**
 * 处理正在输入状态
 */
async function handleTyping(ws, data) {
  const { conversationId, receiverId } = data;

  // 如果接收者在线，发送输入状态
  const receiverWs = onlineUsers.get(receiverId);
  if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
    receiverWs.send(JSON.stringify({
      type: 'TYPING',
      data: {
        conversationId,
        userId: ws.userId
      }
    }));
  }
}

/**
 * 处理消息已读
 */
async function handleReadMessage(ws, data) {
  const { messageId, conversationId } = data;

  // 标记消息为已读
  const message = await Message.findById(messageId);
  if (message && message.receiver.toString() === ws.userId) {
    message.read = true;
    await message.save();
  }

  // 重置会话未读数
  const conversation = await Conversation.findById(conversationId);
  if (conversation) {
    conversation.unreadCounts.set(ws.userId, 0);
    await conversation.save();
  }

  // 通知发送者消息已读
  if (message) {
    const senderWs = onlineUsers.get(message.sender.toString());
    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
      senderWs.send(JSON.stringify({
        type: 'MESSAGE_READ',
        data: { messageId, conversationId }
      }));
    }
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

    // 通知每个在线的好友
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
  return onlineUsers.has(userId);
}

/**
 * 向指定用户发送消息
 */
function sendToUser(userId, type, data) {
  const ws = onlineUsers.get(userId.toString());
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
    return true;
  }
  return false;
}

module.exports = {
  setupWebSocket,
  getOnlineUserCount,
  isUserOnline,
  sendToUser
};
