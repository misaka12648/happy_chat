import { defineStore } from 'pinia';
import { get } from '@/utils/request';

// 模块级并发守卫：onMounted/onShow/重试同时触发时复用同一请求，
// 不放进 state，避免响应式包裹 Promise。
let contactsInFlight = null;

export const useContactsStore = defineStore('contacts', {
  state: () => ({
    friends: [],
    pendingRequests: [],
    lastFetched: 0,
    // 好友列表加载态：供页面派生"加载中/加载失败/空/有数据"三态
    friendsLoading: false,
    // 最近一次拉取是否失败：无缓存时用于区分"加载失败(可重试)"与"确实无好友"
    friendsError: false
  }),

  getters: {
    getFriends: (state) => state.friends,
    getPendingRequests: (state) => state.pendingRequests
  },

  actions: {
    // 私有：拉取好友列表（失败时自然抛出，交由上层判定 error）
    async _loadFriends() {
      const res = await get('/api/friends', null, { silent: true });
      if (res.code === 200) {
        this.friends = res.data;
      }
    },

    // 私有：拉取好友请求（失败时自然抛出）
    async _loadRequests() {
      const res = await get('/api/friends/requests', null, { silent: true });
      if (res.code === 200) {
        this.pendingRequests = res.data;
      }
    },

    /**
     * 拉取通讯录（好友 + 好友请求，陈旧优先重新验证）
     * @param {Object} options
     * @param {boolean} options.force 强制刷新，绕过 TTL
     * @param {number}  options.ttl   新鲜期（毫秒），期内且已有缓存则跳过网络请求
     */
    async fetchContacts({ force = false, ttl = 30000 } = {}) {
      const fresh = Date.now() - this.lastFetched < ttl;
      if (!force && fresh && this.friends.length > 0) return; // 命中缓存，跳过网络
      if (contactsInFlight) return contactsInFlight; // 复用进行中的请求，避免并发重复拉取
      this.friendsLoading = true;
      this.friendsError = false;
      contactsInFlight = (async () => {
        // 好友与请求互不阻塞：一方失败不影响另一方展示
        const results = await Promise.allSettled([
          this._loadFriends(),
          this._loadRequests()
        ]);
        if (results[0].status === 'rejected') {
          // 好友列表加载失败 → 标记 error（无缓存时区分"加载失败"与"确实无好友"）
          console.error('加载好友失败:', results[0].reason);
          this.friendsError = true;
        } else {
          this.lastFetched = Date.now();
        }
        if (results[1].status === 'rejected') {
          console.error('加载好友请求失败:', results[1].reason);
        }
        this.friendsLoading = false;
        contactsInFlight = null;
      })();
      return contactsInFlight;
    },

    // WS：好友请求已通过 → 轻量刷新好友列表（吞错，不影响页面态）
    async refreshFriends() {
      try {
        await this._loadFriends();
      } catch (e) {
        console.error('刷新好友失败:', e);
      }
    },

    // WS：收到新的好友申请 → 轻量刷新请求列表（吞错）
    async refreshRequests() {
      try {
        await this._loadRequests();
      } catch (e) {
        console.error('刷新好友请求失败:', e);
      }
    },

    // WS：好友在线状态变化 → 就地更新
    setFriendOnline(userId, online) {
      const idx = this.friends.findIndex(f => f._id === userId);
      if (idx !== -1) {
        this.friends[idx].online = online;
      }
    }
  }
});
