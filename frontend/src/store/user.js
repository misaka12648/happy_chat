import { defineStore } from 'pinia';
import { post, get, put } from '@/utils/request';
import { encodePassword } from '@/utils/crypto';
import wsClient from '@/utils/socket';
import { registerNotificationHandler, resetTitleBadge } from '@/utils/notify';
import { registerConnectStatus } from '@/utils/connect-status';
import { useCallStore } from '@/store/call';
import { useChatStore } from '@/store/chat';
import { useContactsStore } from '@/store/contacts';

// 模块级并发守卫：App.vue 启动与 profile 页同时拉取用户信息时复用同一请求，
// 不放进 state，避免响应式包裹 Promise。
let userInfoInFlight = null;

export const useUserStore = defineStore('user', {
  state: () => ({
    token: uni.getStorageSync('token') || '',
    refreshToken: uni.getStorageSync('refreshToken') || '',
    userInfo: JSON.parse(uni.getStorageSync('userInfo') || 'null'),
    isLoggedIn: !!uni.getStorageSync('token'),
    // 用户信息拉取时间戳（TTL 去抖）与三态
    lastFetched: 0,
    userInfoLoading: false,
    userInfoError: false
  }),

  getters: {
    getToken: (state) => state.token,
    getUserInfo: (state) => state.userInfo,
    getIsLoggedIn: (state) => state.isLoggedIn
  },

  actions: {
    /**
     * 设置 token
     */
    setToken(token) {
      this.token = token;
      this.isLoggedIn = true;
      uni.setStorageSync('token', token);
    },

    /**
     * 设置 refresh token
     */
    setRefreshToken(refreshToken) {
      this.refreshToken = refreshToken || '';
      if (refreshToken) {
        uni.setStorageSync('refreshToken', refreshToken);
      } else {
        uni.removeStorageSync('refreshToken');
      }
    },

    /**
     * 设置用户信息
     */
    setUserInfo(userInfo) {
      this.userInfo = userInfo;
      uni.setStorageSync('userInfo', JSON.stringify(userInfo));
    },

    /**
     * 用户登录
     */
    async login(username, password) {
      try {
        const res = await post('/api/auth/login', { username, password: encodePassword(password) });
        if (res.code === 200) {
          this.setToken(res.data.token);
          this.setRefreshToken(res.data.refreshToken);
          this.setUserInfo(res.data.user);
          // Connect WebSocket
          wsClient.connect();
          // 登录后注册全局桌面通知与通话信令处理器（启动时注册的已随 disconnect 清空）
          registerNotificationHandler();
          registerConnectStatus();

          useCallStore().registerCallHandlers();
          return { success: true, data: res.data };
        }
        return { success: false, message: res.msg };
      } catch (error) {
        return { success: false, message: error.message || '登录失败' };
      }
    },

    /**
     * 用户注册
     */
    async register(username, password, nickname) {
      try {
        const res = await post('/api/auth/register', { username, password: encodePassword(password), nickname });
        if (res.code === 201) {
          this.setToken(res.data.token);
          this.setRefreshToken(res.data.refreshToken);
          this.setUserInfo(res.data.user);
          // 注册成功后立即进入与登录一致的实时会话状态，避免首条消息因 WS 未连接而失败
          wsClient.connect();
          registerNotificationHandler();
          registerConnectStatus();

          useCallStore().registerCallHandlers();
          return { success: true, data: res.data };
        }
        return { success: false, message: res.msg };
      } catch (error) {
        return { success: false, message: error.message || '注册失败' };
      }
    },

    /**
     * 修改密码（需验证旧密码；成功后当前 token 仍有效，无需重新登录）
     */
    async changePassword(oldPassword, newPassword) {
      try {
        const res = await put('/api/users/me/password', {
          oldPassword: encodePassword(oldPassword),
          newPassword: encodePassword(newPassword)
        });
        if (res.code === 200) {
          return { success: true };
        }
        return { success: false, message: res.msg };
      } catch (error) {
        return { success: false, message: error.message || '修改失败' };
      }
    },

    /**
     * 获取当前用户信息（陈旧优先重新验证 + TTL）
     * @param {Object} options
     * @param {boolean} options.force 强制刷新，绕过 TTL
     * @param {number}  options.ttl   新鲜期（毫秒），期内且已有缓存则跳过网络请求
     */
    async fetchUserInfo({ force = false, ttl = 30000 } = {}) {
      const fresh = Date.now() - this.lastFetched < ttl;
      if (!force && fresh && this.userInfo) {
        return { success: true, data: this.userInfo }; // 命中缓存
      }
      if (userInfoInFlight) return userInfoInFlight; // 复用进行中的请求
      this.userInfoLoading = true;
      this.userInfoError = false;
      userInfoInFlight = (async () => {
        try {
          const res = await get('/api/users/me', null, { silent: true });
          if (res.code === 200) {
            this.setUserInfo(res.data);
            this.lastFetched = Date.now();
            return { success: true, data: res.data };
          }
          this.userInfoError = true;
          return { success: false, message: res.msg };
        } catch (error) {
          this.userInfoError = true;
          return { success: false, message: error.message || '获取用户信息失败' };
        } finally {
          this.userInfoLoading = false;
          userInfoInFlight = null;
        }
      })();
      return userInfoInFlight;
    },

    /**
     * 更新用户信息
     */
    async updateUserInfo(data) {
      try {
        const res = await put('/api/users/me', data);
        if (res.code === 200) {
          this.setUserInfo(res.data);
          return { success: true, data: res.data };
        }
        return { success: false, message: res.msg };
      } catch (error) {
        return { success: false, message: error.message || '更新失败' };
      }
    },

    /**
     * 退出登录
     * 顺序：先断开 WebSocket（避免登出后仍收推送的"幽灵连接"），
     * 再重置业务 store（避免切换账号后残留上一账号的会话/好友数据），
     * 最后清空本 store 与本地存储并跳转登录页。
     */
    logout() {
      wsClient.disconnect();

      // 重置标题/favicon（登出前可能带未读角标）
      resetTitleBadge();

      // disconnect 会清空所有 WS 处理器，业务 store 一并归零
      useChatStore().$reset();
      useContactsStore().$reset();

      // 清理聊天草稿：草稿按会话存，换账号登录不能看到前任的草稿（隐私）
      try {
        const info = uni.getStorageInfoSync();
        info.keys.filter(k => k.startsWith('draft_')).forEach(k => uni.removeStorageSync(k));
      } catch (e) { /* ignore */ }

      this.token = '';
      this.refreshToken = '';
      this.userInfo = null;
      this.isLoggedIn = false;
      this.lastFetched = 0;
      uni.removeStorageSync('token');
      uni.removeStorageSync('refreshToken');
      uni.removeStorageSync('userInfo');
      uni.reLaunch({ url: '/pages/login/login' });
    }
  }
});
