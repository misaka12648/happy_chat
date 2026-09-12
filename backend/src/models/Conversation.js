const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // 会话类型：P2P 双人私聊（默认）/ GROUP 群聊
  type: {
    type: String,
    enum: ['P2P', 'GROUP'],
    default: 'P2P'
  },
  // 群名称（仅群聊）
  name: {
    type: String,
    default: '',
    trim: true,
    maxlength: 30
  },
  // 群主（仅群聊）
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  lastMessageType: {
    type: String,
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'RICH', 'VOICE'],
    default: 'TEXT'
  },
  // 群聊列表预览用：最后一条消息的发送者展示名（昵称/用户名）
  lastMessageSenderName: {
    type: String,
    default: ''
  },
  // 清空聊天记录：按用户记录清空时间点，拉取消息时过滤该时间之前的历史（仅自己视角）
  clearedAt: {
    type: Map,
    of: Date,
    default: new Map()
  },
  // 群公告（仅群聊，群主可改，≤200 字，路由层校验）
  announcement: {
    type: String,
    default: ''
  },
  unreadCounts: {
    type: Map,
    of: Number,
    default: new Map()
  },
  // 按用户软隐藏：用户在会话列表中“删除”会话时，仅将自己加入此列表；
  // 消息与会话本身均保留，任一方发送新消息时清空，会话重新出现在列表
  hiddenFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // 按用户置顶：置顶会话在列表中排在最前（仍按时间排序于置顶组内）
  pinnedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // 按用户免打扰：静音会话不计入 TabBar 未读徽标、不弹桌面通知（会话内红点仍显示）
  mutedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// 确保两个参与者之间只有一条会话记录（不使用唯一索引，由应用层保证）
conversationSchema.index({ participants: 1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
