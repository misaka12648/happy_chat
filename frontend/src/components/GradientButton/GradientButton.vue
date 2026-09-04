<template>
  <button
    class="gradient-btn"
    :class="[`gradient-btn--${variant}`, { 'gradient-btn--block': block }]"
    :style="btnStyle"
    :loading="loading"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <text class="gradient-btn__text" :style="{ fontSize, letterSpacing }">
      <slot>{{ text }}</slot>
    </text>
  </button>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  // primary=珊瑚渐变 / success=绿色
  variant: { type: String, default: 'primary' },
  // 撑满宽度（login/register 大按钮）
  block: { type: Boolean, default: false },
  text: { type: String, default: '' },
  // 尺寸/形状（pill 用 padding，block 用 height）
  height: { type: String, default: '' },
  padding: { type: String, default: '' },
  radius: { type: String, default: '20rpx' },
  fontSize: { type: String, default: '32rpx' },
  letterSpacing: { type: String, default: '0' },
  // 阴影（留空则按 variant 取默认）
  shadow: { type: String, default: '' },
  // :active 缩放系数（大按钮 0.98 / 小 pill 0.95）
  activeScale: { type: Number, default: 0.98 },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
});

defineEmits(['click']);

const btnStyle = computed(() => {
  const shadow = props.shadow !== ''
    ? props.shadow
    : (props.variant === 'success' ? 'none' : '0 8rpx 24rpx rgba(255, 107, 107, 0.3)');
  return {
    width: props.block ? '100%' : undefined,
    height: props.height || undefined,
    padding: props.padding || undefined,
    borderRadius: props.radius,
    boxShadow: shadow,
    '--gb-active-scale': String(props.activeScale)
  };
});
</script>

<style scoped>
.gradient-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  line-height: 1;
  transition: all 0.3s ease;
}

.gradient-btn::after {
  border: none;
}

.gradient-btn--primary {
  background: var(--gradient-primary);
}

.gradient-btn--success {
  background: var(--color-success);
}

.gradient-btn--block {
  width: 100%;
}

.gradient-btn:active {
  transform: scale(var(--gb-active-scale, 0.98));
}

.gradient-btn[disabled] {
  opacity: 0.7;
}

.gradient-btn__text {
  font-weight: 600;
  color: #FFFFFF;
}
</style>
