import { defineStore } from 'pinia';
import { post, get, put } from '@/utils/request';
import wsClient from '@/utils/socket';

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
        // 密码编码：base64 + 反转 + 前缀
        const encodedPassword = 'HC_' + btoa(password).split('').reverse().join('');
        const res = await post('/api/auth/login', { username, password: encodedPassword });
        if (res.code === 200) {
          this.setToken(res.data.token);
          this.setRefreshToken(res.data.refreshToken);
          this.setUserInfo(res.data.user);
          // Connect WebSocket
          wsClient.connect();
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
        // 密码编码：base64 + 反转 + 前缀
        const encodedPassword = 'HC_' + btoa(password).split('').reverse().join('');
        const res = await post('/api/auth/register', { username, password: encodedPassword, nickname });
        if (res.code === 201) {
          this.setToken(res.data.token);
          this.setRefreshToken(res.data.refreshToken);
          this.setUserInfo(res.data.user);
          return { success: true, data: res.data };
        }
        return { success: false, message: res.msg };
      } catch (error) {
        return { success: false, message: error.message || '注册失败' };
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
     */
    logout() {
      this.token = '';
      this.refreshToken = '';
      this.userInfo = null;
      this.isLoggedIn = false;
      uni.removeStorageSync('token');
      uni.removeStorageSync('refreshToken');
      uni.removeStorageSync('userInfo');
      uni.reLaunch({ url: '/pages/login/login' });
    }
  }
});
