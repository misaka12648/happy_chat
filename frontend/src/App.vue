<script>
import { useUserStore } from '@/store/user';
import wsClient from '@/utils/socket';
import { BASE_URL } from '@/utils/request';
import BaseModal from '@/components/BaseModal/BaseModal.vue';

export default {
  components: { BaseModal },
  data() {
    return {
      showUpdateModal: false
    }
  },
  onLaunch: function () {
    console.log('App Launch');
    
    const userStore = useUserStore();
    if (userStore.isLoggedIn) {
      // Connect WebSocket on app launch
      wsClient.connect();
      // Fetch latest user info
      userStore.fetchUserInfo();
    }

    // 启动版本检测
    this.checkVersion();
    this.versionTimer = setInterval(() => {
      this.checkVersion();
    }, 5 * 60 * 1000); // 每5分钟检查一次
  },
  onShow: function () {
    console.log('App Show');
  },
  onHide: function () {
    console.log('App Hide');
  },
  methods: {
    async checkVersion() {
      try {
        const res = await new Promise((resolve, reject) => {
          uni.request({
            url: `${BASE_URL}/api/version`,
            method: 'GET',
            success: (res) => resolve(res.data),
            fail: (err) => reject(err)
          });
        });

        // /api/version 采用统一 { code, msg, data } 格式，版本号在 data.version
        const version = res.data && res.data.version;
        if (version) {
          const localVersion = uni.getStorageSync('app_version');
          if (localVersion && localVersion !== version) {
            this.showUpdateModal = true;
          }
          uni.setStorageSync('app_version', version);
        }
      } catch (e) {
        console.error('版本检查失败:', e);
      }
    },
    handleRefresh() {
      this.showUpdateModal = false;
      uni.clearStorageSync();
      // 添加时间戳强制刷新，避免缓存
      const url = new URL(window.location.href);
      url.searchParams.set('_t', Date.now());
      window.location.href = url.toString();
    }
  }
}
</script>

<template>
  <view>
    <!-- 版本更新弹窗 -->
    <BaseModal
      v-model:visible="showUpdateModal"
      :show-cancel="false"
      confirm-text="立即刷新"
      :mask-closable="false"
      @confirm="handleRefresh"
    >
      <template #header>
        <view class="update-icon-wrapper">
          <text class="update-icon">✨</text>
        </view>
        <text class="update-title">发现新版本</text>
      </template>
      <text class="update-content">HappyChat 已更新，刷新页面即可体验最新功能</text>
    </BaseModal>
  </view>
</template>

<style>
/* ========== Warm Mist Design System ========== */
:root {
  /* Primary Colors */
  --color-primary: #FF6B6B;
  --color-primary-light: #FF8E8E;
  --color-primary-dark: #E85555;
  
  /* Secondary Colors */
  --color-secondary: #A78BFA;
  --color-secondary-light: #C4B5FD;
  
  /* Accent Colors */
  --color-success: #34D399;
  --color-warning: #FBBF24;
  --color-error: #F87171;
  
  /* Neutral Colors */
  --color-bg: #FAF9F7;
  --color-card: rgba(255, 255, 255, 0.85);
  --color-card-solid: #FFFFFF;
  --color-text-primary: #1A1A2E;
  --color-text-secondary: #6B7280;
  --color-text-tertiary: #9CA3AF;
  --color-border: rgba(0, 0, 0, 0.06);
  
  /* Gradients */
  --gradient-primary: linear-gradient(135deg, #FF6B6B 0%, #A78BFA 100%);
  --gradient-warm: linear-gradient(135deg, #FF6B6B 0%, #FFB88C 100%);
  --gradient-cool: linear-gradient(135deg, #A78BFA 0%, #818CF8 100%);
  
  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
  --shadow-primary: 0 4px 16px rgba(255, 107, 107, 0.3);
  
  /* Border Radius */
  --radius-sm: 8rpx;
  --radius-md: 16rpx;
  --radius-lg: 24rpx;
  --radius-xl: 32rpx;
  --radius-full: 9999rpx;
  
  /* Blur */
  --blur-sm: blur(10px);
  --blur-md: blur(20px);
  --blur-lg: blur(40px);
  
  /* Avatar Gradients */
  --avatar-1: linear-gradient(135deg, #FF6B6B, #FFB88C);
  --avatar-2: linear-gradient(135deg, #A78BFA, #818CF8);
  --avatar-3: linear-gradient(135deg, #34D399, #6EE7B7);
  --avatar-4: linear-gradient(135deg, #FBBF24, #F59E0B);
  --avatar-5: linear-gradient(135deg, #F472B6, #EC4899);
  --avatar-6: linear-gradient(135deg, #38BDF8, #0EA5E9);
}

page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  color: var(--color-text-primary);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

view {
  box-sizing: border-box;
}

button {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: inherit;
}

button::after {
  border: none;
}

/* Glass Morphism Utility */
.glass {
  background: var(--color-card);
  backdrop-filter: var(--blur-md);
  -webkit-backdrop-filter: var(--blur-md);
  border: 1rpx solid var(--color-border);
}

/* Text Utilities */
.text-primary {
  color: var(--color-primary);
}

.text-gradient {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Animation Keyframes */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20rpx); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(40rpx); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10rpx); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* 版本更新弹窗内容（外壳由 BaseModal 提供） */
.update-icon-wrapper {
  width: 120rpx;
  height: 120rpx;
  background: linear-gradient(135deg, rgba(255, 107, 107, 0.1), rgba(167, 139, 250, 0.1));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24rpx;
}

.update-icon {
  font-size: 56rpx;
}

.update-title {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--color-text-primary);
}

.update-content {
  font-size: 28rpx;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.6;
  display: block;
}

/* ========== 全局请求 Loading（重绘原生 uni.showLoading 为珊瑚色 spinner） ========== */
/* uni-app H5 下 App.vue 的 <template> 不渲染，无法用自定义组件做全局 loading，
   故保留可靠的原生 uni.showLoading，并在此用全局样式覆盖为与整体 UI 一致的珊瑚色圈。
   用 :has(.uni-loading) 限定只作用于 loading，避免影响错误 toast 的样式。 */
uni-toast:has(.uni-loading) .uni-mask {
  background: rgba(255, 255, 255, 0.35) !important;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* 去掉卡片外观，只保留居中的珊瑚色 spinner + 文案，与列表页 .loading-state 统一 */
uni-toast:has(.uni-loading) .uni-toast {
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}

/* 隐藏原生灰色 SVG spinner，改用珊瑚色边框旋转圈（与 list.vue .loading-spinner 一致） */
uni-toast .uni-toast__icon.uni-loading {
  background: none !important;
  width: 60rpx !important;
  height: 60rpx !important;
  border: 4rpx solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  margin-bottom: 24rpx !important;
  animation: global-loading-spin 1s linear infinite !important;
}

@keyframes global-loading-spin {
  to { transform: rotate(360deg); }
}

uni-toast:has(.uni-loading) .uni-toast__content {
  color: var(--color-text-secondary) !important;
  font-size: 28rpx !important;
}
</style>
