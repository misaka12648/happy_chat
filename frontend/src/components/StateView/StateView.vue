<template>
  <view class="state-view" :class="size === 'sm' ? 'sv--sm' : 'sv--lg'">
    <!-- 加载中 -->
    <template v-if="state === 'loading'">
      <view class="sv-spinner"></view>
      <text class="sv-loading-text">{{ title || '加载中...' }}</text>
    </template>

    <!-- 加载失败 / 空态 -->
    <template v-else>
      <view class="sv-icon-wrapper" :style="{ background: iconBg }">
        <text class="sv-icon">{{ icon }}</text>
      </view>
      <text class="sv-title">{{ title }}</text>
      <text class="sv-subtitle" :class="{ 'sv-subtitle--gap': state === 'error' }">{{ subtitle }}</text>
      <view v-if="state === 'error'" class="sv-retry" @click="$emit('retry')">
        <text class="sv-retry-text">{{ retryText }}</text>
      </view>
    </template>
  </view>
</template>

<script setup>
defineProps({
  // loading | error | empty
  state: { type: String, default: 'loading' },
  // error/empty 的表情图标（大号插画，保留 emoji）
  icon: { type: String, default: '' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  // lg=整页(list) / sm=卡片内(contacts)
  size: { type: String, default: 'lg' },
  // 图标圆底背景色（error 用红、empty 视场景用珊瑚/紫）
  iconBg: { type: String, default: 'rgba(255, 107, 107, 0.1)' },
  retryText: { type: String, default: '重新加载' }
});

defineEmits(['retry']);
</script>

<style scoped>
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.sv--lg { padding: 200rpx 0; }
.sv--sm { padding: 60rpx 0; }

/* 加载中 spinner（两种尺寸一致） */
.sv-spinner {
  width: 60rpx;
  height: 60rpx;
  border: 4rpx solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: sv-spin 1s linear infinite;
  margin-bottom: 24rpx;
}

@keyframes sv-spin {
  to { transform: rotate(360deg); }
}

.sv-loading-text {
  font-size: 28rpx;
  color: var(--color-text-secondary);
}

/* 图标圆底 */
.sv-icon-wrapper {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sv--lg .sv-icon-wrapper {
  width: 160rpx;
  height: 160rpx;
  margin-bottom: 32rpx;
}

.sv--sm .sv-icon-wrapper {
  width: 120rpx;
  height: 120rpx;
  margin-bottom: 24rpx;
}

.sv--lg .sv-icon { font-size: 80rpx; }
.sv--sm .sv-icon { font-size: 60rpx; }

/* 标题 */
.sv-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.sv--lg .sv-title { font-size: 32rpx; margin-bottom: 12rpx; }
.sv--sm .sv-title { font-size: 28rpx; margin-bottom: 8rpx; }

/* 副标题 */
.sv-subtitle { color: var(--color-text-secondary); }
.sv--lg .sv-subtitle { font-size: 28rpx; }
.sv--sm .sv-subtitle { font-size: 24rpx; }
.sv--lg .sv-subtitle--gap { margin-bottom: 32rpx; }
.sv--sm .sv-subtitle--gap { margin-bottom: 24rpx; }

/* 重试按钮 */
.sv-retry {
  background: var(--gradient-primary);
}

.sv-retry:active { transform: scale(0.95); }

.sv--lg .sv-retry {
  padding: 16rpx 48rpx;
  border-radius: 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(255, 107, 107, 0.2);
}

.sv--sm .sv-retry {
  padding: 14rpx 40rpx;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 12rpx rgba(255, 107, 107, 0.2);
}

.sv-retry-text {
  font-weight: 600;
  color: #FFFFFF;
}

.sv--lg .sv-retry-text { font-size: 28rpx; }
.sv--sm .sv-retry-text { font-size: 26rpx; }
</style>
