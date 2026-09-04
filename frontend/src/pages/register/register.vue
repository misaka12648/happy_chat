<template>
  <view class="register-container">
    <!-- 背景装饰 -->
    <view class="bg-decoration">
      <view class="circle circle-1"></view>
      <view class="circle circle-2"></view>
    </view>

    <!-- 头部 -->
    <view class="header">
      <view class="back-btn" @click="goLogin">
        <uni-icons type="left" size="36rpx" color="#1A1A2E" />
      </view>
      <text class="header-title">创建账号</text>
      <view class="header-placeholder"></view>
    </view>

    <!-- 注册表单 -->
    <view class="form-card">
      <view class="form-header">
        <text class="form-title">加入 HappyChat</text>
        <text class="form-subtitle">开始你的聊天之旅</text>
      </view>

      <FormInput
        v-model="username"
        icon="person"
        type="text"
        placeholder="用户名 (3-20个字符)"
        margin-bottom="24rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
      />

      <FormInput
        v-model="nickname"
        icon="star"
        type="text"
        placeholder="昵称 (选填)"
        margin-bottom="24rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
      />

      <FormInput
        v-model="password"
        icon="locked"
        type="password"
        placeholder="密码 (至少6位)"
        margin-bottom="24rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
      />

      <FormInput
        v-model="confirmPassword"
        icon="locked"
        type="password"
        placeholder="确认密码"
        margin-bottom="24rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
      />

      <view class="btn-register-wrap">
        <GradientButton
          block
          height="96rpx"
          letter-spacing="4rpx"
          text="注 册"
          :loading="loading"
          :disabled="loading"
          @click="handleRegister"
        />
      </view>

      <view class="login-link" @click="goLogin">
        <text class="link-text">已有账号？</text>
        <text class="link-action">返回登录</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { useUserStore } from '@/store/user';
import FormInput from '@/components/FormInput/FormInput.vue';
import GradientButton from '@/components/GradientButton/GradientButton.vue';

const userStore = useUserStore();
const username = ref('');
const nickname = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);

const handleRegister = async () => {
  if (!username.value || !password.value) {
    uni.showToast({ title: '请填写用户名和密码', icon: 'none' });
    return;
  }
  if (username.value.length < 3 || username.value.length > 20) {
    uni.showToast({ title: '用户名长度应为3-20个字符', icon: 'none' });
    return;
  }
  if (password.value.length < 6) {
    uni.showToast({ title: '密码长度应不少于6位', icon: 'none' });
    return;
  }
  if (password.value !== confirmPassword.value) {
    uni.showToast({ title: '两次密码输入不一致', icon: 'none' });
    return;
  }

  loading.value = true;
  const result = await userStore.register(username.value, password.value, nickname.value);
  loading.value = false;
  if (result.success) {
    uni.showToast({ title: '注册成功', icon: 'success' });
    setTimeout(() => {
      uni.switchTab({ url: '/pages/chat/list' });
    }, 500);
  }
  // 注册失败提示已由请求层统一处理
};

const goLogin = () => {
  uni.navigateBack();
};
</script>

<style scoped>
.register-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #FAF9F7 0%, #F5F3F0 100%);
  padding: 0 40rpx;
  padding-top: 20rpx;
  position: relative;
  overflow: hidden;
}

/* 背景装饰 */
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
  opacity: 0.12;
}

.circle-1 {
  width: 400rpx;
  height: 400rpx;
  background: var(--color-secondary);
  top: -100rpx;
  left: -100rpx;
  animation: float 7s ease-in-out infinite;
}

.circle-2 {
  width: 350rpx;
  height: 350rpx;
  background: var(--color-primary);
  bottom: 100rpx;
  right: -80rpx;
  animation: float 9s ease-in-out infinite;
}

/* 头部 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 60rpx;
  margin-bottom: 40rpx;
  position: relative;
  z-index: 1;
}

.back-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 20rpx;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.header-title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.header-placeholder {
  width: 72rpx;
}

/* 表单卡片 */
.form-card {
  width: 100%;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 32rpx;
  padding: 48rpx 40rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.06);
  border: 1rpx solid rgba(255, 255, 255, 0.8);
  position: relative;
  z-index: 1;
  animation: slideUp 0.6s ease-out;
}

.form-header {
  margin-bottom: 40rpx;
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

/* 注册按钮 */
.btn-register-wrap {
  margin-top: 16rpx;
}

/* 登录链接 */
.login-link {
  margin-top: 32rpx;
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
</style>