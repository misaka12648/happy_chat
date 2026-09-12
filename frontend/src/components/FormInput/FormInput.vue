<template>
  <view class="input-group" :style="{ marginBottom }">
    <view class="input-wrapper" :class="{ focused }" :style="{ height }">
      <uni-icons class="input-icon" :type="icon" :size="iconSize" :color="iconColor" />
      <input
        ref="inputRef"
        class="input"
        :style="{ fontSize }"
        :type="inputType"
        :value="modelValue"
        :placeholder="placeholder"
        placeholder-class="placeholder"
        @input="onInput"
        @focus="focused = true"
        @blur="onBlur"
        @confirm="$emit('confirm')"
      />
      <!-- 密码框右侧明文切换：输错时可见，减少盲打挫败 -->
      <view v-if="type === 'password'" class="eye-btn" @click="toggleVisible">
        <uni-icons :type="visible ? 'eye-slash' : 'eye'" size="20" color="var(--color-icon-muted)" />
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';

const props = defineProps({
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

const emit = defineEmits(['update:modelValue', 'confirm', 'blur']);
const focused = ref(false);
const visible = ref(false);
const inputRef = ref(null);

const inputType = computed(() => (props.type === 'password' && !visible.value ? 'password' : 'text'));

const onInput = (e) => {
  emit('update:modelValue', e.detail.value);
};

const onBlur = (e) => {
  focused.value = false;
  emit('blur', e);
};

// 切换明文/密文：type 变化会让原生 input 失焦，切完把焦点与光标放回末尾
const toggleVisible = () => {
  visible.value = !visible.value;
  nextTick(() => {
    const root = inputRef.value && inputRef.value.$el ? inputRef.value.$el : inputRef.value;
    const input = root && (root.tagName === 'INPUT' ? root : root.querySelector('input'));
    if (!input) return;
    input.focus();
    const len = String(input.value || '').length;
    try { input.setSelectionRange(len, len); } catch (e) { /* 部分类型不支持 */ }
  });
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
  background: var(--color-card-solid);
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

.eye-btn {
  padding: 12rpx;
  margin-right: -12rpx;
}

.eye-btn:active {
  opacity: 0.6;
}
</style>
