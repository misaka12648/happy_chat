const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
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
    enum: ['TEXT', 'IMAGE', 'VIDEO'],
    default: 'TEXT'
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
  }]
}, {
  timestamps: true
});

// 确保两个参与者之间只有一条会话记录（不使用唯一索引，由应用层保证）
conversationSchema.index({ participants: 1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
