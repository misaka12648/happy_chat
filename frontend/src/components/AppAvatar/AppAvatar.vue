<template>
  <view class="app-avatar" :style="avatarStyle">
    <image v-if="src && !imgError" class="app-avatar__img" :src="src" mode="aspectFill" @error="onImgError" />
    <text v-else class="app-avatar__text" :style="{ fontSize }">{{ text }}</text>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  // 头像图片地址（调用方需自行 getMediaUrl 处理）
  src: { type: String, default: '' },
  // 无图时的底色（渐变或纯色 rgba）
  background: { type: String, default: 'linear-gradient(135deg, #FF6B6B, #FFB88C)' },
  // 无图时的占位文字
  text: { type: String, default: '?' },
  // 尺寸（如 100rpx）
  size: { type: String, default: '100rpx' },
  // 圆角（如 28rpx / 50%）
  radius: { type: String, default: '28rpx' },
  // 占位文字字号
  fontSize: { type: String, default: '40rpx' },
  // 阴影
  shadow: { type: String, default: '0 4rpx 16rpx rgba(0, 0, 0, 0.1)' },
  // 边框
  border: { type: String, default: 'none' },
  // 是否毛玻璃（profile 无图占位用）
  blur: { type: Boolean, default: false }
});

// 图片加载失败时回退到渐变底 + 占位字，避免裂图露白
const imgError = ref(false);
const onImgError = () => { imgError.value = true; };
watch(() => props.src, () => { imgError.value = false; });

const avatarStyle = computed(() => ({
  width: props.size,
  height: props.size,
  borderRadius: props.radius,
  background: props.src && !imgError.value ? 'transparent' : props.background,
  boxShadow: props.shadow,
  border: props.border,
  backdropFilter: props.blur ? 'blur(20px)' : undefined,
  '-webkit-backdrop-filter': props.blur ? 'blur(20px)' : undefined
}));
</script>

<style scoped>
.app-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.app-avatar__img {
  width: 100%;
  height: 100%;
}

.app-avatar__text {
  color: #FFFFFF;
  font-weight: 700;
  text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.1);
}
</style>
