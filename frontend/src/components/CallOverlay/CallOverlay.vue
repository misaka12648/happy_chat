<template>
  <view v-if="call.isActive" class="call-overlay">
    <!-- 视频通话：远端全屏 + 本地小窗（容器内容由 JS 挂载原生 video，避免 uni-video 控制条） -->
    <view v-if="call.isVideo" class="call-video"></view>
    <view v-if="call.isVideo && call.localStream" class="call-video-local"></view>

    <!-- 语音通话 / 无远端画面时：对方头像 -->
    <view v-if="!call.isVideo || !call.remoteStream" class="call-audio-face">
      <AppAvatar
        :src="getMediaUrl((contactsStore.friends.find(x => x._id === call.peerId) || call.peerInfo).avatar)"
        :background="getAvatarGradient(call.peerInfo.nickname ? call.peerInfo : { nickname: peerName })"
        :text="getAvatarText(call.peerInfo.nickname ? call.peerInfo : { nickname: peerName })"
        size="200rpx"
        radius="50%"
        font-size="80rpx"
        :blur="true"
      />
    </view>

    <view class="call-info">
      <text class="call-name">{{ peerName }}</text>
      <text class="call-state">{{ stateText }}</text>
    </view>

    <!-- 按钮区：振铃态（来电=接听/拒绝；去电=取消）与通话态（静音/摄像头/挂断） -->
    <view class="call-actions">
      <template v-if="call.status === 'incoming'">
        <view class="call-btn call-btn-danger" @click="call.rejectCall()">
          <uni-icons type="closeempty" size="52rpx" color="#FFFFFF" />
          <text class="call-btn-label">拒绝</text>
        </view>
        <view class="call-btn call-btn-ok" @click="call.acceptCall()">
          <uni-icons type="phone-filled" size="52rpx" color="#FFFFFF" />
          <text class="call-btn-label">接听</text>
        </view>
      </template>
      <template v-else-if="call.status === 'outgoing'">
        <view class="call-btn call-btn-danger" @click="call.hangup()">
          <uni-icons type="closeempty" size="52rpx" color="#FFFFFF" />
          <text class="call-btn-label">取消</text>
        </view>
      </template>
      <template v-else>
        <view class="call-btn" :class="{ 'call-btn-off': call.muted }" @click="call.toggleMute()">
          <uni-icons :type="call.muted ? 'micoff-filled' : 'mic-filled'" size="48rpx" color="#FFFFFF" />
          <text class="call-btn-label">{{ call.muted ? '已静音' : '静音' }}</text>
        </view>
        <view v-if="call.isVideo" class="call-btn" :class="{ 'call-btn-off': call.cameraOff }" @click="call.toggleCamera()">
          <uni-icons type="videocam-filled" size="48rpx" color="#FFFFFF" />
          <text class="call-btn-label">{{ call.cameraOff ? '开启' : '摄像头' }}</text>
        </view>
        <view class="call-btn call-btn-danger" @click="call.hangup()">
          <uni-icons type="phone-filled" size="48rpx" color="#FFFFFF" style="transform: rotate(135deg);" />
          <text class="call-btn-label">挂断</text>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useCallStore } from '@/store/call';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import { getMediaUrl, getAvatarGradient, getAvatarText } from '@/utils/format';

import { useContactsStore } from '@/store/contacts';

const call = useCallStore();
const contactsStore = useContactsStore();

// 来电者显示名：通讯录拉取完成后能自动刷新（peerInfo 只是来电瞬间快照）
const peerName = computed(() => {
  void contactsStore.friends.length;
  const f = contactsStore.friends.find(x => x._id === call.peerId);
  if (f) return f.remark || f.nickname || f.username;
  return call.peerInfo.nickname || call.peerInfo.username || '好友';
});

// 将媒体流挂到容器内的原生 video 元素（uni-video 不支持 srcObject，直接操作 DOM）
const mountStream = (containerSel, stream) => {
  // #ifdef H5
  const box = document.querySelector(containerSel);
  if (!box) return;
  let v = box.querySelector('video');
  if (!v) {
    v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = containerSel.includes('local');
    box.appendChild(v);
  }
  if (v.srcObject !== stream) v.srcObject = stream;
  v.play && v.play().catch(() => {});
  // #endif
};

watch(
  () => [call.remoteStream, call.localStream, call.status],
  () => {
    if (call.remoteStream) mountStream('.call-video', call.remoteStream);
    if (call.isVideo && call.localStream) mountStream('.call-video-local', call.localStream);
  },
  { flush: 'post' }
);

// 通话时长每秒刷新（startedAt 变化由 store 维护，这里用 ticker 驱动文案重算）
const tick = ref(0);
const ticker = setInterval(() => { tick.value++; }, 1000);
onUnmounted(() => clearInterval(ticker));

const stateText = computed(() => {
  void tick.value; // 依赖每秒 tick，驱动已接通时的时长刷新
  if (call.status === 'incoming') return call.isVideo ? '邀请你视频通话' : '邀请你语音通话';
  if (call.status === 'outgoing') return '等待对方接听…';
  if (call.status === 'connected') {
    if (call.connState === 'connected') {
      const sec = Math.floor((Date.now() - call.startedAt) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    }
    return '正在连接…';
  }
  return '';
});
</script>

<style scoped>
.call-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: callIn 0.25s ease-out;
}

@keyframes callIn {
  from { opacity: 0; transform: scale(1.04); }
  to { opacity: 1; transform: scale(1); }
}

.call-video,
.call-video video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000000;
}

.call-video-local,
.call-video-local video {
  position: absolute;
  right: 24rpx;
  top: 120rpx;
  width: 220rpx;
  height: 300rpx;
  border-radius: 24rpx;
  object-fit: cover;
  background: #000000;
  border: 2rpx solid rgba(255, 255, 255, 0.4);
  z-index: 2;
}

.call-audio-face {
  margin-top: 220rpx;
  position: relative;
  z-index: 1;
}

.call-info {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 40rpx;
}

.call-name {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--color-text-primary);
}

.call-state {
  font-size: 28rpx;
  color: var(--color-text-secondary);
  margin-top: 12rpx;
}

.call-actions {
  position: absolute;
  bottom: calc(120rpx + env(safe-area-inset-bottom));
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 90rpx;
  z-index: 3;
}

.call-btn {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: rgba(134, 134, 156, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  transition: transform 0.15s ease;
}

.call-btn:active {
  transform: scale(0.92);
}

.call-btn-label {
  font-size: 20rpx;
  color: #FFFFFF;
}

.call-btn-danger {
  background: linear-gradient(135deg, #FF6B6B, #E85555);
  box-shadow: 0 8rpx 24rpx rgba(255, 107, 107, 0.4);
}

.call-btn-ok {
  background: linear-gradient(135deg, #34D399, #10B981);
  box-shadow: 0 8rpx 24rpx rgba(52, 211, 153, 0.4);
}

.call-btn-off {
  background: rgba(30, 30, 42, 0.7);
  opacity: 0.9;
}
</style>
