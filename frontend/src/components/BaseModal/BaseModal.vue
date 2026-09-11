<template>
  <transition name="base-modal" :duration="{ enter: 250, leave: 200 }">
    <view v-if="visible" class="base-modal-mask" :style="{ zIndex }" @click="onMaskClick">
      <view class="base-modal" :style="{ width }" @click.stop>
      <!-- 头部：优先使用 header 插槽，否则渲染 title -->
      <view v-if="hasHeaderSlot || title" class="base-modal-header">
        <slot name="header">
          <text class="base-modal-title">{{ title }}</text>
        </slot>
      </view>

      <!-- 主体：默认插槽，否则渲染 content 文本 -->
      <view class="base-modal-body">
        <slot>
          <text v-if="content" class="base-modal-content">{{ content }}</text>
        </slot>
      </view>

        <!-- 底部：优先使用 footer 插槽，否则渲染标准按钮 -->
        <slot name="footer">
          <view class="base-modal-footer">
            <view
              v-if="showCancel"
              class="base-modal-btn base-modal-btn-cancel"
              @click="onCancel"
            >
              <text class="base-modal-btn-text">{{ cancelText }}</text>
            </view>
            <view
              class="base-modal-btn base-modal-btn-confirm"
              @click="onConfirm"
            >
              <text class="base-modal-btn-text base-modal-btn-text-confirm">{{ confirmText }}</text>
            </view>
          </view>
        </slot>
      </view>
    </view>
  </transition>
</template>

<script setup>
import { useSlots } from 'vue';

const props = defineProps({
  // 是否显示（配合 v-model:visible 使用）
  visible: { type: Boolean, default: false },
  // 标题（有 header 插槽时可省略）
  title: { type: String, default: '' },
  // 纯文本内容（有默认插槽时可省略）
  content: { type: String, default: '' },
  // 是否显示取消按钮
  showCancel: { type: Boolean, default: true },
  cancelText: { type: String, default: '取消' },
  confirmText: { type: String, default: '确定' },
  // 点击遮罩是否关闭
  maskClosable: { type: Boolean, default: true },
  // 弹窗宽度
  width: { type: String, default: '600rpx' },
  zIndex: { type: Number, default: 9999 }
});

const emit = defineEmits(['update:visible', 'confirm', 'cancel']);
const slots = useSlots();
const hasHeaderSlot = !!slots.header;

const close = () => emit('update:visible', false);

const onMaskClick = () => {
  if (props.maskClosable) {
    emit('cancel');
    close();
  }
};

const onCancel = () => {
  emit('cancel');
  close();
};

// 确认不自动关闭，交由父组件按需校验后再关闭（v-model:visible）
const onConfirm = () => {
  emit('confirm');
};
</script>

<style scoped>
.base-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(26, 26, 46, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.base-modal {
  background: var(--color-modal);
  border-radius: 32rpx;
  overflow: hidden;
  box-shadow: 0 20rpx 60rpx rgba(0, 0, 0, 0.2);
  animation: modalIn 0.25s ease;
}

/* 进出场过渡：遮罩淡入淡出，弹窗缩放进出场 */
.base-modal-enter-active {
  transition: opacity 0.25s ease;
}

.base-modal-leave-active {
  transition: opacity 0.2s ease;
}

.base-modal-enter-from,
.base-modal-leave-to {
  opacity: 0;
}

.base-modal-enter-active .base-modal {
  animation: modalIn 0.25s ease;
}

.base-modal-leave-active .base-modal {
  animation: modalOut 0.2s ease forwards;
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modalOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.92);
  }
}

.base-modal-header {
  padding: 40rpx 32rpx 24rpx;
  text-align: center;
}

.base-modal-title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--color-text-primary);
}

.base-modal-body {
  padding: 8rpx 40rpx 24rpx;
}

.base-modal-content {
  display: block;
  font-size: 28rpx;
  color: var(--color-text-secondary);
  line-height: 1.6;
  text-align: center;
}

.base-modal-footer {
  display: flex;
  gap: 24rpx;
  padding: 16rpx 40rpx 40rpx;
}

.base-modal-btn {
  flex: 1;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.base-modal-btn-cancel {
  background: var(--color-bg);
}

.base-modal-btn-confirm {
  background: var(--gradient-primary);
  box-shadow: 0 8rpx 20rpx rgba(255, 107, 107, 0.25);
}

.base-modal-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.base-modal-btn-text-confirm {
  color: #FFFFFF;
}
</style>
