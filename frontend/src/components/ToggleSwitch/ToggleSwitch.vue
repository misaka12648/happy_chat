<template>
  <view
    class="toggle-switch"
    :class="{ 'toggle-switch--on': checked, 'toggle-switch--disabled': disabled }"
    @click.stop="onClick"
  >
    <view class="toggle-thumb"></view>
  </view>
</template>

<script setup>
// 自绘开关：配色走设计令牌，开关状态即"当前是否生效"的直观反馈
const props = defineProps({
  // 是否处于开启态
  checked: { type: Boolean, default: false },
  // 禁用态（如浏览器不支持通知）
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:checked', 'change']);

const onClick = () => {
  if (props.disabled) return;
  emit('update:checked', !props.checked);
  emit('change', !props.checked);
};
</script>

<style scoped>
.toggle-switch {
  width: 92rpx;
  height: 52rpx;
  border-radius: 999rpx;
  background: var(--color-toggle-off);
  padding: 4rpx;
  box-sizing: border-box;
  flex-shrink: 0;
  transition: background 0.25s ease;
}

.toggle-switch--on {
  background: var(--gradient-primary);
  box-shadow: 0 2rpx 8rpx rgba(255, 107, 107, 0.35);
}

.toggle-switch--disabled {
  opacity: 0.4;
}

.toggle-thumb {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: #FFFFFF;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.2);
  transition: transform 0.25s ease;
}

.toggle-switch--on .toggle-thumb {
  transform: translateX(40rpx);
}
</style>
