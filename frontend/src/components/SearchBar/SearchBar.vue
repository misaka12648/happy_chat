<template>
  <view class="search-bar-outer">
    <view class="search-bar-inner">
      <view class="search-input-wrapper" :style="{ height: inputHeight }">
        <uni-icons class="search-icon" type="search" size="28rpx" color="#9CA3AF" />
        <input
          class="search-input"
          type="text"
          :value="modelValue"
          :placeholder="placeholder"
          placeholder-class="search-placeholder"
          @input="onInput"
          @confirm="onSearch"
        />
      </view>
      <view
        v-if="showButton"
        class="search-btn"
        :style="{ height: inputHeight }"
        @click="onSearch"
      >
        <text class="search-btn-text">{{ buttonText }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  // 是否展示右侧搜索按钮（contacts 用）
  showButton: { type: Boolean, default: false },
  buttonText: { type: String, default: '搜索' },
  // 输入框高度（list 76rpx / contacts 80rpx）
  inputHeight: { type: String, default: '76rpx' }
});

const emit = defineEmits(['update:modelValue', 'search']);

const onInput = (e) => {
  emit('update:modelValue', e.detail.value);
};

const onSearch = () => {
  emit('search', props.modelValue);
};
</script>

<style scoped>
.search-bar-outer {
  padding: 20rpx 30rpx;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.search-bar-inner {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.search-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border-radius: 20rpx;
  padding: 0 24rpx;
}

.search-icon {
  margin-right: 16rpx;
}

.search-input {
  flex: 1;
  height: 100%;
  font-size: 28rpx;
  color: var(--color-text-primary);
}

.search-placeholder {
  color: var(--color-text-tertiary);
}

.search-btn {
  padding: 0 32rpx;
  background: var(--gradient-primary);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(255, 107, 107, 0.2);
}

.search-btn:active {
  transform: scale(0.95);
}

.search-btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #FFFFFF;
}
</style>
