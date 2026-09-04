<template>
  <view class="input-group" :style="{ marginBottom }">
    <view class="input-wrapper" :class="{ focused }" :style="{ height }">
      <uni-icons class="input-icon" :type="icon" :size="iconSize" :color="iconColor" />
      <input
        class="input"
        :style="{ fontSize }"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        placeholder-class="placeholder"
        @input="onInput"
        @focus="focused = true"
        @blur="focused = false"
        @confirm="$emit('confirm')"
      />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  modelValue: { type: String, default: '' },
  // uni-icons 图标类型（如 person / locked / star）
  icon: { type: String, default: '' },
  // input 原生类型（text / password ...）
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  // 外层间距 / 输入框高度 / 图标字号 / 文本字号（login 与 register 略有差异）
  marginBottom: { type: String, default: '28rpx' },
  height: { type: String, default: '100rpx' },
  iconSize: { type: String, default: '36rpx' },
  fontSize: { type: String, default: '30rpx' },
  iconColor: { type: String, default: '#9CA3AF' }
});

const emit = defineEmits(['update:modelValue', 'confirm']);
const focused = ref(false);

const onInput = (e) => {
  emit('update:modelValue', e.detail.value);
};
</script>

<style scoped>
.input-group {
  margin-bottom: 28rpx;
}

.input-wrapper {
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border-radius: 20rpx;
  padding: 0 28rpx;
  border: 2rpx solid transparent;
  transition: all 0.3s ease;
}

.input-wrapper.focused {
  background: #FFFFFF;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4rpx rgba(255, 107, 107, 0.1);
}

.input-icon {
  margin-right: 20rpx;
}

.input {
  flex: 1;
  height: 100%;
  color: var(--color-text-primary);
}

.placeholder {
  color: var(--color-text-tertiary);
}
</style>
