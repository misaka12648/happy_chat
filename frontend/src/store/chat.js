import { defineStore } from 'pinia';
import { get, post, put, del } from '@/utils/request';
import { useUserStore } from '@/store/user';

// 模块级并发守卫：多个入口（onMounted/onShow/WS）同时触发拉取时复用同一请求，
// 不放进 state，避免响应式包裹 Promise。
let conversationsInFlight = null;

// 会话排序：置顶优先，其余按最后消息时间倒序（与服务端列表排序规则一致）
const sortConversations = (list) => {
  list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
  });
};

export const useChatStore = defineStore('chat', {
  state: () => ({
    conversations: [],
    currentConversation: null,

    // 按会话缓存消息记录（含分页游标），避免每次进入详情页重新请求
    // 结构：{ [conversationId]: { messages: [], page: number, hasMore: boolean } }
    messageCache: {},
    lastFetched: 0,
    // 会话列表加载态：供页面派生"加载中/加载失败/空/有数据"三态
    conversationsLoading: false,
    // 最近一次拉取是否失败：无缓存时用于区分"加载失败(可重试)"与"确实为空"
    conversationsError: false
  }),

  getters: {
    getConversations: (state) => state.conversations,
    getCurrentConversation: (state) => state.currentConversation
  },

  actions: {
    /**
     * 获取会话列表（陈旧优先重新验证）
     * @param {Object} options
     * @param {boolean} options.force  强制刷新，绕过 TTL（如 WebSocket 重连后）
     * @param {number}  options.ttl    新鲜期（毫秒），期内且已有缓存则跳过网络请求
     */
    async fetchConversations({ force = false, ttl = 30000 } = {}) {
      const fresh = Date.now() - this.lastFetched < ttl;
      if (!force && fresh && this.conversations.length > 0) return; // 命中缓存，跳过网络
      if (conversationsInFlight) return conversationsInFlight; // 复用进行中的请求，避免并发重复拉取
      this.conversationsLoading = true;
      this.conversationsError = false;
      conversationsInFlight = (async () => {
        try {
          const res = await get('/api/conversations', null, { silent: true });
          if (res.code === 200) {
            this.conversations = res.data;
            sortConversations(this.conversations);
            this.lastFetched = Date.now();
          }
        } catch (error) {
          console.error('获取会话列表失败:', error);
          this.conversationsError = true;
        } finally {
          this.conversationsLoading = false;
          conversationsInFlight = null;
        }
      })();
      return conversationsInFlight;
    },

    /**
     * 创建或获取会话
     */
    async getOrCreateConversation(userId) {
      try {
        const res = await post('/api/conversations', { userId });
        if (res.code === 200) {
          this.currentConversation = res.data;
          return res.data;
        }
        return null;
      } catch (error) {
        console.error('获取会话失败:', error);
        return null;
      }
    },

    /**
     * 获取历史消息
     */
    async fetchMessages(conversationId, page = 1) {
      try {
        const res = await get(`/api/messages/${conversationId}`, { page, limit: 20 }, { silent: true });
        if (res.code === 200) {
          return res.data;
        }
        return null;
      } catch (error) {
        console.error('获取历史消息失败:', error);
        return null;
      }
    },

    /**
     * 读取某会话的消息缓存（含分页游标），无缓存返回 null
     */
    getCachedMessages(conversationId) {
      return this.messageCache[conversationId] || null;
    },

    /**
     * 写回某会话的消息缓存；仅缓存已确认的服务器消息，过滤本地临时消息（temp-*）
     */
    cacheMessages(conversationId, { messages = [], page = 1, hasMore = true } = {}) {
      if (!conversationId) return;
      const confirmed = messages.filter(m => m._id && !String(m._id).startsWith('temp-'));
      this.messageCache[conversationId] = { messages: confirmed, page, hasMore };
    },

    /**
     * 设置当前会话
     */
    setCurrentConversation(conversation) {
      this.currentConversation = conversation;
    },

    /**
     * 更新会话最后消息
     */
    updateConversationLastMessage(conversationId, message) {
      const index = this.conversations.findIndex(c => c._id === conversationId);
      if (index > -1) {
        // 撤回消息显示"已撤回"
        let lastMessage = message.content;
        if (message.recalled) {
          lastMessage = '已撤回';
        } else if (message.type === 'RICH' && message.contentBlocks) {
          lastMessage = message.contentBlocks.map(b => {
            if (b.blockType === 'image') return '[图片]';
            return b.content;
          }).join(' ').replace(/\n/g, ' ').slice(0, 50);
        }
        this.conversations[index].lastMessage = lastMessage;
        this.conversations[index].lastMessageTime = message.createdAt;
        this.conversations[index].lastMessageType = message.type;
        
        // 仅当消息由对方发来（非自己发送）且不在当前会话时，才增加未读数
        // 红点 = 对方发送且自己未读的消息数，自己发的消息不计未读
        const myId = useUserStore().getUserInfo?._id;
        const isIncoming = !!(message.sender && message.sender._id && message.sender._id !== myId);
        if (isIncoming && (!this.currentConversation || this.currentConversation._id !== conversationId)) {
          this.conversations[index].unreadCount = (this.conversations[index].unreadCount || 0) + 1;
        }

        // 重新排序：置顶优先，其余按时间倒序（替换原先的一律置顶 unshift）
        sortConversations(this.conversations);
      }
    },

    /**
     * 置顶 / 取消置顶（仅当前用户视角，服务端持久化）
     */
    async pinConversation(conversationId, pinned) {
      const res = await put(`/api/conversations/${conversationId}/pin`, { pinned }, { silent: true });
      if (res.code === 200) {
        const conv = this.conversations.find(c => c._id === conversationId);
        if (conv) conv.pinned = pinned;
        sortConversations(this.conversations);
      }
      return res;
    },

    /**
     * 开启 / 关闭免打扰（仅当前用户视角，服务端持久化）
     */
    async muteConversation(conversationId, muted) {
      const res = await put(`/api/conversations/${conversationId}/mute`, { muted }, { silent: true });
      if (res.code === 200) {
        const conv = this.conversations.find(c => c._id === conversationId);
        if (conv) conv.muted = muted;
      }
      return res;
    },

    /**
     * 标记会话已读
     */
    async markConversationAsRead(conversationId) {
      try {
        await put(`/api/conversations/${conversationId}/read`, null, { silent: true });
        // 更新本地未读数
        const index = this.conversations.findIndex(c => c._id === conversationId);
        if (index > -1) {
          this.conversations[index].unreadCount = 0;
        }
      } catch (error) {
        console.error('标记已读失败:', error);
      }
    },

    /**
     * 删除会话（软隐藏）：仅从当前用户列表移除，后端不删除消息。
     * 从通讯录重新进入仍可拿到同一会话与历史消息；任一方再发消息会重新出现。
     */
    async deleteConversation(conversationId) {
      await del(`/api/conversations/${conversationId}`, null, { silent: true });
      this.conversations = this.conversations.filter(c => c._id !== conversationId);
      if (this.currentConversation && this.currentConversation._id === conversationId) {
        this.currentConversation = null;
      }
    },

    /**
     * 标记"对方正在输入"（2.5s 无续期自动清除）
     */


    /**
     * 离开会话：缓存消息记录（含分页游标）并重置当前会话
     */
    leaveConversation(conversationId, snapshot = {}) {
      this.cacheMessages(conversationId, snapshot);
      this.currentConversation = null;
    }
  }
});
