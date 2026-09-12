const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // 群聊消息无单一接收者，仅私聊必填
    default: null
  },
  type: {
    type: String,
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'RICH', 'VOICE'],
    default: 'TEXT'
  },
  content: {
    type: String,
    required: true
  },
  // 语音时长（秒，仅 VOICE 消息使用）
  duration: {
    type: Number,
    default: 0
  },
  mediaUrl: {
    type: String,
    default: ''
  },
  thumbnailUrl: {
    type: String,
    default: ''
  },
  // 客户端生成的幂等标识：重发时后端据此去重，避免产生重复消息
  clientId: {
    type: String,
    default: ''
  },
  // 富文本消息内容块（type 为 RICH 时使用）
  contentBlocks: {
    type: [{
      blockType: { type: String, enum: ['text', 'image'] },
      content: { type: String, default: '' },
      url: { type: String, default: '' },
      thumbnailUrl: { type: String, default: '' }
    }],
    default: []
  },
  read: {
    type: Boolean,
    default: false
  },
  // 撤回标记
  recalled: {
    type: Boolean,
    default: false
  },
  recalledAt: {
    type: Date,
    default: null
  },
  // 回复引用快照（存储被回复消息的副本，即使原消息被撤回也能展示）
  replyInfo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, default: '' },
    type: { type: String, default: 'TEXT' },
    content: { type: String, default: '' },
    contentBlocks: {
      type: [{
        blockType: { type: String, enum: ['text', 'image'] },
        content: { type: String, default: '' },
        url: { type: String, default: '' },
        thumbnailUrl: { type: String, default: '' }
      }],
      default: []
    },
    mediaUrl: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' }
  },
  // 本地删除：按用户隐藏该消息（仅自己视角，对方不受影响）
  hiddenFor: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: []
  },
  // 表情回应：[{ emoji, users }]，同一表情同一用户仅一条记录（切换即加/删）
  reactions: {
    type: [{
      emoji: { type: String, required: true },
      users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }],
    default: []
  }
}, {
  timestamps: true
});

// 索引优化查询
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, receiver: 1 });
// clientId 幂等：仅索引有 clientId 的文档，避免历史空值冲突
messageSchema.index(
  { sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $gt: '' } } }
);

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
