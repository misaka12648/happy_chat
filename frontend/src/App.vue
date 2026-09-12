<script>
import { useUserStore } from '@/store/user';
import wsClient from '@/utils/socket';
import { BASE_URL } from '@/utils/request';
import { registerNotificationHandler } from '@/utils/notify';
import { registerConnectStatus } from '@/utils/connect-status';
import { initTheme } from '@/utils/theme';
import { useCallStore } from '@/store/call';
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

    // 初始化主题（已保存优先，否则跟随系统），TabBar 配色随之切换
    initTheme();

    // #ifdef H5
    // 滚动条自动隐藏：捕获阶段的 scroll 监听给滚动容器加 .is-scrolling，
    // 停止滚动 800ms 后移除（配合全局 CSS 实现滚动时显现、静止后隐藏）
    document.addEventListener('scroll', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      t.classList.add('is-scrolling');
      clearTimeout(t.__scrollHideTimer);
      t.__scrollHideTimer = setTimeout(() => t.classList.remove('is-scrolling'), 800);
    }, true);
    // #endif

    const userStore = useUserStore();
    if (userStore.isLoggedIn) {
      // Connect WebSocket on app launch
      wsClient.connect();
      // Fetch latest user info
      userStore.fetchUserInfo();
      // 全局桌面通知（wsClient.disconnect 会清空处理器，登录后由 store 再注册，二者不会叠加）
      registerNotificationHandler();
      // 连接状态条：断线可见、重连有反馈（注册时序同上）
      registerConnectStatus();
      // 通话信令处理器（与通知同样的注册时序约定）
      useCallStore().registerCallHandlers();
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

  /* 桌面宽屏时容器两侧露出的页面背景 */
  --color-page-side: #ECEAE6;
  /* 输入类控件（输入框/按钮）底色，暗色下与面板底拉开层次 */
  --color-input-bg: #FAF9F7;
  /* 图标语义色：导航强图标 / 弱化图标 */
  --color-nav-icon: #1A1A2E;
  --color-icon-muted: #9CA3AF;
  /* 开关关闭态轨道底色（ToggleSwitch） */
  --color-toggle-off: rgba(0, 0, 0, 0.14);

  /* 玻璃拟态层级令牌：全站半透明白底统一由这些变量控制，深色模式整体换深色底 */
  --color-nav: rgba(255, 255, 255, 0.95);          /* 顶栏/输入栏/搜索栏 */
  --color-bubble: rgba(255, 255, 255, 0.9);        /* 对方消息气泡 */
  --color-modal: rgba(255, 255, 255, 0.98);        /* 弹窗面板 */
  --glass-border: rgba(255, 255, 255, 0.6);        /* 玻璃卡片描边 */
  --color-bg-gradient: linear-gradient(135deg, #FAF9F7 0%, #F5F3F0 100%);  /* 登录/注册底 */
  --color-time-badge: rgba(0, 0, 0, 0.05);         /* 聊天时间分隔徽章 */
  --color-quote-bg: rgba(0, 0, 0, 0.04);           /* 回复引用块底色 */
  
  /* Gradients */
  --gradient-primary: linear-gradient(135deg, #FF6B6B 0%, #A78BFA 100%);
  --gradient-warm: linear-gradient(135deg, #FF6B6B 0%, #FFB88C 100%);
  --gradient-cool: linear-gradient(135deg, #A78BFA 0%, #818CF8 100%);
  
  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
  --shadow-primary: 0 4px 16px rgba(255, 107, 107, 0.3);
  /* 高级卡片阴影：贴地 + 环境 双层 */
  --shadow-card: 0 1px 2px rgba(31, 38, 135, 0.04), 0 10rpx 30rpx rgba(31, 38, 135, 0.07);
  
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

/* ========== 深色模式（Warm Mist Night）========== */
/* 在 :root 基础上整体覆盖中性色与玻璃层级；品牌色/渐变保持不变 */
html.dark {
  --color-bg: #14141C;
  /* 卡片比页面底亮一档并加强描边，保证浮起感与可读性 */
  --color-card: rgba(46, 46, 62, 0.92);
  --color-card-solid: #2A2A38;
  --color-text-primary: #F2F2F7;
  --color-text-secondary: #A8A8BA;
  --color-text-tertiary: #8A8A9C;
  --color-border: rgba(255, 255, 255, 0.1);

  --color-nav: rgba(30, 30, 43, 0.95);
  --color-bubble: rgba(56, 56, 72, 0.92);
  --color-modal: #2A2A38;
  --glass-border: rgba(255, 255, 255, 0.12);
  --color-bg-gradient: linear-gradient(135deg, #1A1A24 0%, #14141C 100%);
  --color-time-badge: rgba(255, 255, 255, 0.1);
  --color-quote-bg: rgba(255, 255, 255, 0.07);
  --color-toast-mask: rgba(0, 0, 0, 0.4);
  --color-page-side: #0B0B12;
  --color-input-bg: rgba(255, 255, 255, 0.08);
  --color-nav-icon: #F2F2F7;
  --color-icon-muted: #8A8A9C;
  --color-toggle-off: rgba(255, 255, 255, 0.18);

  /* 阴影在深色底上收敛 */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.45);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.2), 0 10rpx 30rpx rgba(0, 0, 0, 0.25);
}

page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  color: var(--color-text-primary);
  background: transparent;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 全局背景：底色 + 品牌色双光斑氛围层（fixed，不随滚动），内容浮于其上 */
body {
  background: var(--color-bg);
}

body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  filter: blur(90px);
  z-index: -1;
  pointer-events: none;
}

body::before {
  width: 56vw;
  height: 56vw;
  min-width: 420px;
  min-height: 420px;
  top: -18vw;
  right: -12vw;
  background: radial-gradient(circle at 30% 30%, rgba(255, 107, 107, 0.16), transparent 65%);
}

body::after {
  width: 50vw;
  height: 50vw;
  min-width: 380px;
  min-height: 380px;
  bottom: -16vw;
  left: -14vw;
  background: radial-gradient(circle at 60% 60%, rgba(167, 139, 250, 0.14), transparent 65%);
}

html.dark body::before {
  background: radial-gradient(circle at 30% 30%, rgba(255, 107, 107, 0.1), transparent 65%);
}

html.dark body::after {
  background: radial-gradient(circle at 60% 60%, rgba(167, 139, 250, 0.1), transparent 65%);
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
  background: var(--color-toast-mask, rgba(255, 255, 255, 0.35)) !important;
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

/* ========== 统一滚动条：细圆角、无箭头，滚动时显现、停止后淡出 ========== */
/* 文档级滚动条空间恒定预留（轨道透明不可见）：切 Tab 时有无溢出的页面宽度一致，杜绝布局跳动 */
html {
  scrollbar-gutter: stable;
}

/* 内部滚动容器尝试 overlay 模式：滚动条悬浮于内容上，不占内容宽（不支持时回退 auto） */
.uni-scroll-view,
.emoji-panel {
  overflow-y: overlay;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

/* 去掉 Windows 风格的上下箭头按钮 */
::-webkit-scrollbar-button {
  display: none;
}

::-webkit-scrollbar-track {
  background: transparent;
}

/* 默认不可见；滚动进行中浮现品牌渐变胶囊（透明内边距收边，视觉 4px 圆条） */
::-webkit-scrollbar-thumb {
  background-color: transparent;
  background-image: none;
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 999px;
  transition: background-color 0.3s ease;
}

.is-scrolling::-webkit-scrollbar-thumb {
  background-color: rgba(120, 116, 140, 0.28);
  background-image: linear-gradient(180deg, rgba(255, 107, 107, 0.5), rgba(167, 139, 250, 0.5));
}

html.dark .is-scrolling::-webkit-scrollbar-thumb {
  background-color: rgba(210, 208, 228, 0.22);
  background-image: linear-gradient(180deg, rgba(255, 107, 107, 0.45), rgba(167, 139, 250, 0.45));
}

/* Firefox：单色近似，默认透明 */
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

.is-scrolling {
  scrollbar-color: rgba(140, 130, 180, 0.45) transparent;
}

html.dark .is-scrolling {
  scrollbar-color: rgba(190, 185, 215, 0.4) transparent;
}

/* 暗色下原生 Toast / ActionSheet 深色化（否则白底刺眼） */
html.dark uni-toast .uni-toast {
  background: rgba(58, 58, 72, 0.98) !important;
}

html.dark uni-toast .uni-toast__content {
  color: #F2F2F7 !important;
}

html.dark .uni-actionsheet {
  background: rgba(42, 42, 56, 0.98) !important;
}

html.dark .uni-actionsheet__cell,
html.dark .uni-actionsheet-cell {
  color: #F2F2F7 !important;
  background: transparent !important;
}

html.dark .uni-actionsheet__cell--default,
html.dark .uni-actionsheet-cell--default {
  color: var(--color-error) !important;
}

/* 主题切换时的全局颜色过渡（切换瞬间由 theme.js 加类，450ms 后移除） */
html.theme-transition *,
html.theme-transition *::before,
html.theme-transition *::after {
  transition: background-color 0.35s ease, color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease !important;
}

/* ========== 桌面宽屏响应式：应用收窄为手机宽度居中 ========== */
@media (min-width: 768px) {
  body {
    background: var(--color-page-side);
  }

  uni-app {
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.16);
    overflow-x: hidden;
  }

  html.dark uni-app {
    box-shadow: 0 0 48px rgba(0, 0, 0, 0.55);
  }

  /* 底部 TabBar 跟随容器宽度并居中（uni 自带 left/right:0 定位，用 margin auto 居中） */
  uni-tabbar,
  uni-tabbar .uni-tabbar {
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
  }
}

/* 深色下 TabBar 配色：CSS 强覆盖，比 setTabBarStyle 的运行时时序更可靠 */
html.dark uni-tabbar .uni-tabbar {
  background: rgba(30, 30, 43, 0.98) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

html.dark uni-tabbar .uni-tabbar__label {
  color: #6E6E80 !important;
}
</style>
