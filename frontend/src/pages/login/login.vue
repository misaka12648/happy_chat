<template>
  <view class="login-container">
    <!-- 背景装饰 -->
    <view class="bg-decoration">
      <view class="circle circle-1"></view>
      <view class="circle circle-2"></view>
      <view class="circle circle-3"></view>
    </view>

    <!-- Logo 区域 -->
    <view class="logo-section">
      <view class="logo-wrapper">
        <view class="logo">
          <text class="logo-text">H</text>
        </view>
      </view>
      <text class="app-name">HappyChat</text>
      <text class="app-slogan">与好友分享每一刻</text>
    </view>

    <!-- 登录表单 -->
    <view class="form-card">
      <view class="form-header">
        <text class="form-title">欢迎回来</text>
        <text class="form-subtitle">登录你的账号</text>
      </view>

      <FormInput
        v-model="username"
        icon="person"
        type="text"
        placeholder="用户名"
        @confirm="handleLogin"
      />

      <FormInput
        v-model="password"
        icon="locked"
        type="password"
        placeholder="密码"
        @confirm="handleLogin"
      />

      <view class="btn-login-wrap">
        <GradientButton
          block
          height="100rpx"
          letter-spacing="4rpx"
          text="登 录"
          :loading="loading"
          :disabled="loading"
          @click="handleLogin"
        />
      </view>

      <view class="register-link" @click="goRegister">
        <text class="link-text">还没有账号？</text>
        <text class="link-action">立即注册</text>
      </view>
    </view>

    <!-- 底部装饰 -->
    <view class="footer">
      <text class="footer-text">HappyChat © 2024</text>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useUserStore } from '@/store/user';
import FormInput from '@/components/FormInput/FormInput.vue';
import GradientButton from '@/components/GradientButton/GradientButton.vue';

const userStore = useUserStore();
const username = ref('');
const password = ref('');
const loading = ref(false);

// 记住上次登录的用户名（仅记住用户名，不含密码）
const REMEMBER_KEY = 'lastLoginUsername';
onMounted(() => {
  username.value = uni.getStorageSync(REMEMBER_KEY) || '';
});

const handleLogin = async () => {
  if (!username.value || !password.value) {
    uni.showToast({ title: '请填写用户名和密码', icon: 'none' });
    return;
  }
  loading.value = true;
  const result = await userStore.login(username.value, password.value);
  loading.value = false;
  if (result.success) {
    uni.setStorageSync(REMEMBER_KEY, username.value.trim());
    uni.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      uni.switchTab({ url: '/pages/chat/list' });
    }, 500);
  }
  // 登录失败提示（如”用户名或密码错误”）已由请求层统一处理
};

const goRegister = () => {
  uni.navigateTo({ url: '/pages/register/register' });
};
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  padding: 0 40rpx;
  padding-top: 20rpx;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 背景装饰圆 */
.bg-decoration {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.circle {
  position: absolute;
  border-radius: 50%;
  opacity: 0.15;
}

.circle-1 {
  width: 500rpx;
  height: 500rpx;
  background: var(--gradient-primary);
  top: -100rpx;
  right: -100rpx;
  animation: float 6s ease-in-out infinite;
}

.circle-2 {
  width: 400rpx;
  height: 400rpx;
  background: var(--color-secondary);
  bottom: 200rpx;
  left: -150rpx;
  animation: float 8s ease-in-out infinite;
}

.circle-3 {
  width: 300rpx;
  height: 300rpx;
  background: var(--color-primary);
  bottom: -50rpx;
  right: 100rpx;
  animation: float 7s ease-in-out infinite;
}

/* Logo 区域 */
.logo-section {
  margin-top: 180rpx;
  margin-bottom: 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}

.logo-wrapper {
  margin-bottom: 24rpx;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  background: var(--gradient-primary);
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12rpx 40rpx rgba(255, 107, 107, 0.3);
  animation: pulse 2s ease-in-out infinite;
}

.logo-text {
  font-size: 72rpx;
  font-weight: 700;
  color: #FFFFFF;
  text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.1);
}

.app-name {
  font-size: 48rpx;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 12rpx;
  letter-spacing: 2rpx;
}

.app-slogan {
  font-size: 28rpx;
  color: var(--color-text-secondary);
  letter-spacing: 1rpx;
}

/* 表单卡片 */
.form-card {
  width: 100%;
  background: var(--color-card);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 32rpx;
  padding: 48rpx 40rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.06);
  border: 1rpx solid var(--glass-border);
  position: relative;
  z-index: 1;
  animation: slideUp 0.6s ease-out;
}

.form-header {
  margin-bottom: 48rpx;
}

.form-title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--color-text-primary);
  display: block;
  margin-bottom: 12rpx;
}

.form-subtitle {
  font-size: 28rpx;
  color: var(--color-text-secondary);
}

/* 登录按钮 */
.btn-login-wrap {
  margin-top: 16rpx;
}

/* 注册链接 */
.register-link {
  margin-top: 36rpx;
  display: flex;
  justify-content: center;
  align-items: center;
}

.link-text {
  font-size: 28rpx;
  color: var(--color-text-secondary);
}

.link-action {
  font-size: 28rpx;
  color: var(--color-primary);
  font-weight: 600;
  margin-left: 8rpx;
}

/* 底部 */
.footer {
  margin-top: auto;
  margin-bottom: 60rpx;
  position: relative;
  z-index: 1;
}

.footer-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}
</style>