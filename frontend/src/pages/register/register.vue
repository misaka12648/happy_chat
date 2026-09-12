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
        <uni-icons type="left" size="36rpx" color="var(--color-nav-icon)" />
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
        margin-bottom="8rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
        @blur="onUsernameBlur"
      />

      <!-- 用户名可用性实时提示（失焦时检查） -->
      <view v-if="usernameCheck.text" class="username-check">
        <text class="username-check-text" :class="usernameCheck.available ? 'username-check-ok' : 'username-check-bad'">{{ usernameCheck.text }}</text>
      </view>
      <view v-else class="username-check username-check-spacer"></view>

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

      <!-- 密码强度提示：长度 + 字符种类实时评估 -->
      <view v-if="password" class="pwd-strength">
        <view class="pwd-strength-bars">
          <view class="pwd-bar" :class="{ 'pwd-bar-on pwd-bar-weak': strength === 1 }"></view>
          <view class="pwd-bar" :class="{ 'pwd-bar-on pwd-bar-mid': strength === 2 }"></view>
          <view class="pwd-bar" :class="{ 'pwd-bar-on pwd-bar-strong': strength >= 3 }"></view>
        </view>
        <text class="pwd-strength-text" :class="'pwd-text-' + strength">{{ strengthLabel }}</text>
      </view>

      <FormInput
        v-model="confirmPassword"
        icon="locked"
        type="password"
        placeholder="确认密码"
        margin-bottom="24rpx"
        height="96rpx"
        icon-size="32rpx"
        font-size="28rpx"
        @confirm="handleRegister"
      />

      <!-- 两次密码不一致实时提示 -->
      <view v-if="confirmMismatch" class="pwd-mismatch">
        <text class="pwd-mismatch-text">两次输入的密码不一致</text>
      </view>

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
import { ref, computed } from 'vue';
import { useUserStore } from '@/store/user';
import { get } from '@/utils/request';
import FormInput from '@/components/FormInput/FormInput.vue';
import GradientButton from '@/components/GradientButton/GradientButton.vue';

const userStore = useUserStore();
const username = ref('');
const nickname = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);

// 密码强度：长度与字符种类综合评分（0 无 / 1 弱 / 2 中 / 3 强）
const strength = computed(() => {
  const p = password.value;
  if (!p) return 0;
  let s = 0;
  if (p.length >= 6) s++;
  if (p.length >= 10) s++;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) s++;
  if (/[^a-zA-Z0-9]/.test(p)) s++;
  return Math.min(3, s);
});

const strengthLabel = computed(() => ['太短', '弱', '中', '强'][strength.value] || '');

// 用户名可用性检查（失焦触发，查询后端注册名占用）
const usernameCheck = ref({ available: null, text: '' });
const checkUsername = async (v) => {
  const name = (v || '').trim();
  if (!name) {
    usernameCheck.value = { available: null, text: '' };
    return;
  }
  if (name.length < 3 || name.length > 20) {
    usernameCheck.value = { available: false, text: '用户名应为 3-20 个字符' };
    return;
  }
  try {
    const res = await get(`/api/auth/check-username`, { username: name });
    if (res.code === 200) {
      usernameCheck.value = res.data.available
        ? { available: true, text: '√ 该用户名可用' }
        : { available: false, text: res.data.reason || '该用户名不可用' };
    }
  } catch (e) {
    // 检查接口异常不打断注册流程
  }
};

const onUsernameBlur = () => {
  checkUsername(username.value);
};

// 确认密码实时一致性校验：仅当已填写且与首字段不一致时提示
const confirmMismatch = computed(() => {
  return confirmPassword.value.length > 0 && confirmPassword.value !== password.value;
});

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
    // 记住用户名：注册即登录，之后退出登录回登录页时自动回填
    uni.setStorageSync('lastLoginUsername', username.value.trim());
    uni.showToast({ title: '注册成功', icon: 'success' });
    setTimeout(() => {
      uni.switchTab({ url: '/pages/chat/list' });
    }, 500);
  }
  // 注册失败提示已由请求层统一处理
};

const goLogin = () => {
  // 直接打开注册页（如刷新/分享链接）时页面栈为空，navigateBack 无效，兜底跳登录页
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
  } else {
    uni.reLaunch({ url: '/pages/login/login' });
  }
};
</script>

<style scoped>
.register-container {
  min-height: 100vh;
  padding: 0 40rpx;
  padding-top: 20rpx;
  position: relative;
  overflow: hidden;
}

/* ========== 密码强度条 ========== */
.pwd-strength {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin: -8rpx 0 24rpx;
  padding: 0 12rpx;
}

.pwd-strength-bars {
  display: flex;
  gap: 8rpx;
  flex: 1;
}

.pwd-bar {
  height: 8rpx;
  flex: 1;
  border-radius: 4rpx;
  background: var(--color-toggle-off);
  transition: background 0.25s ease;
}

.pwd-bar-on.pwd-bar-weak { background: var(--color-error); }
.pwd-bar-on.pwd-bar-mid { background: var(--color-warning); }
.pwd-bar-on.pwd-bar-strong { background: var(--color-success); }

.pwd-strength-text {
  font-size: 22rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.pwd-text-1 { color: var(--color-error); }
.pwd-text-2 { color: var(--color-warning); }
.pwd-text-3 { color: var(--color-success); }

/* 两次密码不一致提示 */
.pwd-mismatch {
  margin: -8rpx 0 24rpx;
  padding: 0 12rpx;
}

.pwd-mismatch-text {
  font-size: 22rpx;
  color: var(--color-error);
}

/* 用户名可用性提示 */
.username-check {
  padding: 0 12rpx 12rpx;
  min-height: 32rpx;
}

.username-check-spacer {
  min-height: 20rpx;
}

.username-check-text {
  font-size: 22rpx;
}

.username-check-ok {
  color: var(--color-success);
}

.username-check-bad {
  color: var(--color-error);
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
  background: var(--color-card);
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