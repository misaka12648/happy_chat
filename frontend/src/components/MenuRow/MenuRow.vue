<template>
  <view class="menu-row" @click="$emit('click')">
    <view class="menu-icon-wrapper" :style="{ background: iconBg }">
      <uni-icons :type="icon" :size="iconSize" :color="iconColor" />
    </view>
    <text class="menu-text">{{ text }}</text>
    <!-- 右侧自定义区：开关/当前状态文本等（设置项状态直观可见） -->
    <slot name="right"></slot>
    <uni-icons v-if="showArrow" class="menu-arrow" type="forward" size="20" color="var(--color-icon-muted)" />
  </view>
</template>

<script setup>
defineProps({
  // uni-icons 图标类型（person / notification / locked / star / info）
  icon: { type: String, default: '' },
  // 图标颜色（贴合圆底主题色）
  iconColor: { type: String, default: '#FF6B6B' },
  // 图标圆底背景色
  iconBg: { type: String, default: 'rgba(255, 107, 107, 0.1)' },
  // 图标字号
  iconSize: { type: String, default: '36rpx' },
  // 菜单文本
  text: { type: String, default: '' },
  // 是否显示右侧箭头
  showArrow: { type: Boolean, default: true }
});

defineEmits(['click']);
</script>

<style scoped>
.menu-row {
  display: flex;
  align-items: center;
  padding: 28rpx 24rpx;
  transition: all 0.2s ease;
}

.menu-row:active {
  background: var(--color-bg);
}

.menu-icon-wrapper {
  width: 72rpx;
  height: 72rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
}

.menu-text {
  flex: 1;
  font-size: 30rpx;
  font-weight: 500;
  color: var(--color-text-primary);
}

.menu-arrow {
  margin-left: 8rpx;
}
</style>
