<template>
  <view class="profile-page">
    <!-- 顶部渐变头部 -->
    <view class="profile-header">
      <view class="header-bg">
        <view class="circle circle-1"></view>
        <view class="circle circle-2"></view>
      </view>
      
      <view class="user-card">
        <view class="avatar-wrapper" @click="changeAvatar">
          <AppAvatar
            :src="getMediaUrl(userInfo.avatar)"
            background="rgba(255, 255, 255, 0.3)"
            :text="avatarText"
            size="160rpx"
            radius="50%"
            font-size="64rpx"
            shadow="none"
            border="4rpx solid rgba(255, 255, 255, 0.5)"
            :blur="true"
          />
          <view class="avatar-glow"></view>
        </view>
        <view class="user-meta">
          <view v-if="profileViewState === 'loading'" class="header-status">
            <view class="header-spinner"></view>
            <text class="header-status-text">加载中...</text>
          </view>
          <view v-else-if="profileViewState === 'error'" class="header-status">
            <text class="nickname">加载失败</text>
            <view class="header-retry" @click.stop="retryUserInfo">
              <text class="header-retry-text">点击重试</text>
            </view>
          </view>
          <template v-else>
            <text class="nickname">{{ userInfo.nickname || userInfo.username || '未登录' }}</text>
            <text class="username" v-if="userInfo.username">@{{ userInfo.username }}</text>
          </template>
        </view>
      </view>
    </view>

    <!-- 菜单区域 -->
    <view class="menu-section">
      <!-- 账号设置 -->
      <view class="menu-group">
        <text class="group-title">账号设置</text>
        <view class="menu-card">
          <MenuRow
            icon="person"
            icon-color="#FF6B6B"
            icon-bg="rgba(255, 107, 107, 0.1)"
            text="编辑资料"
            @click="editProfile"
          />
          
          <view class="menu-divider"></view>
          
          <MenuRow
            icon="notification"
            icon-color="#A78BFA"
            icon-bg="rgba(167, 139, 250, 0.1)"
            text="消息通知"
          />
          
          <view class="menu-divider"></view>
          
          <MenuRow
            icon="locked"
            icon-color="#34D399"
            icon-bg="rgba(52, 211, 153, 0.1)"
            text="隐私安全"
          />
        </view>
      </view>

      <!-- 其他设置 -->
      <view class="menu-group">
        <text class="group-title">其他</text>
        <view class="menu-card">
          <MenuRow
            icon="star"
            icon-color="#FBBF24"
            icon-bg="rgba(251, 191, 36, 0.1)"
            text="给我们评分"
          />
          
          <view class="menu-divider"></view>
          
          <MenuRow
            icon="info"
            icon-color="#38BDF8"
            icon-bg="rgba(56, 189, 248, 0.1)"
            text="关于 HappyChat"
          />
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="logout-section">
        <view class="logout-btn" @click="handleLogout">
          <text class="logout-text">退出登录</text>
        </view>
      </view>
    </view>

    <!-- 底部版本信息 -->
    <view class="footer">
      <text class="version">HappyChat v1.0.0</text>
    </view>

    <!-- 编辑资料弹窗 -->
    <BaseModal
      v-model:visible="showEditModal"
      title="编辑资料"
      confirm-text="保存"
      @confirm="confirmEdit"
    >
      <view class="edit-field">
        <text class="edit-label">昵称</text>
        <input 
          class="edit-input" 
          v-model="editNickname" 
          placeholder="请输入昵称" 
          placeholder-class="edit-input-placeholder"
          maxlength="20" 
          confirm-type="done"
          @confirm="confirmEdit"
        />
      </view>
    </BaseModal>

    <!-- 图片裁切弹窗 -->
    <BaseModal
      v-model:visible="showCropModal"
      title="裁切头像"
      width="640rpx"
      :mask-closable="false"
    >
      <view class="crop-container" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
        <image 
          class="crop-image" 
          :src="cropImageSrc" 
          :style="cropImageStyle"
          mode="scaleToFill"
          @load="onImageLoad"
        />
        <view class="crop-mask">
          <view class="crop-box"></view>
        </view>
      </view>
      <view class="crop-zoom">
        <text class="crop-zoom-icon">−</text>
        <slider 
          class="crop-zoom-slider" 
          :value="imageScale * 100" 
          :min="minSliderValue" 
          :max="300" 
          :step="5"
          activeColor="var(--color-primary)"
          @changing="onZoomChanging"
          @change="onZoomChange"
        />
        <text class="crop-zoom-icon">+</text>
      </view>
      <view class="crop-hint">
        <text class="crop-hint-text">拖动图片调整位置，滑动滑块缩放大小</text>
      </view>
      <template #footer>
        <view class="crop-actions">
          <view class="crop-btn crop-btn-cancel" @click="cancelCrop">
            <text class="crop-btn-text">取消</text>
          </view>
          <view class="crop-btn crop-btn-confirm" @click="confirmCrop">
            <text class="crop-btn-text">确定</text>
          </view>
        </view>
      </template>
    </BaseModal>

    <!-- 退出登录确认弹窗 -->
    <BaseModal
      v-model:visible="showLogoutModal"
      title="退出登录"
      content="确定要退出当前账号吗？"
      confirm-text="退出"
      @confirm="confirmLogout"
    />
  </view>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';
import { upload } from '@/utils/request';
import { getMediaUrl, getAvatarText } from '@/utils/format';
import BaseModal from '@/components/BaseModal/BaseModal.vue';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import MenuRow from '@/components/MenuRow/MenuRow.vue';

const userStore = useUserStore();
const userInfo = ref({});

// 编辑资料弹窗状态
const showEditModal = ref(false);
const editNickname = ref('');

// 退出登录确认弹窗状态
const showLogoutModal = ref(false);

// 裁切相关状态
const showCropModal = ref(false);
const cropImageSrc = ref('');
const cropFilePath = ref('');
const imageScale = ref(1);
const imageX = ref(0);
const imageY = ref(0);
const startDistance = ref(0);
const startScale = ref(1);
const startX = ref(0);
const startY = ref(0);
const lastX = ref(0);
const lastY = ref(0);
const imageWidth = ref(0);
const imageHeight = ref(0);
// 容器与裁切框的真实渲染像素、图片 cover 容器后的显示基准尺寸
const containerPx = ref(0);
const cropBoxPx = ref(0);
const coverW = ref(0);
const coverH = ref(0);

const cropImageStyle = computed(() => ({
  width: coverW.value + 'px',
  height: coverH.value + 'px',
  left: '50%',
  top: '50%',
  transform: `translate(-50%, -50%) translate(${imageX.value}px, ${imageY.value}px) scale(${imageScale.value})`,
  transition: isDragging.value ? 'none' : 'transform 0.2s ease'
}));
const isDragging = ref(false);

const avatarText = computed(() => getAvatarText(userInfo.value));

// 三态视图：有缓存用户信息则展示（SWR）；无缓存时按 loading → error 优先判定
const profileViewState = computed(() => {
  const hasData = !!(userInfo.value && userInfo.value.username);
  if (hasData) return 'ready';
  if (userStore.userInfoError) return 'error';
  if (userStore.userInfoLoading || userStore.lastFetched === 0) return 'loading';
  return 'ready';
});

// 重试：强制绕过 TTL 重新拉取
const retryUserInfo = async () => {
  const r = await userStore.fetchUserInfo({ force: true });
  if (r.success) userInfo.value = r.data;
};

onMounted(async () => {
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  userInfo.value = userStore.getUserInfo || {};
  const result = await userStore.fetchUserInfo();
  if (result.success) {
    userInfo.value = result.data;
  }
});

// 切回本页时刷新用户信息（TTL 已在 store 去抖）
onShow(async () => {
  if (!userStore.isLoggedIn) return;
  const result = await userStore.fetchUserInfo();
  if (result.success) {
    userInfo.value = result.data;
  }
});

const editProfile = () => {
  editNickname.value = userInfo.value.nickname || '';
  showEditModal.value = true;
};

const confirmEdit = async () => {
  const nickname = editNickname.value.trim();
  if (!nickname) {
    uni.showToast({ title: '昵称不能为空', icon: 'none' });
    return;
  }
  showEditModal.value = false;
  const result = await userStore.updateUserInfo({ nickname });
  if (result.success) {
    userInfo.value = result.data;
    uni.showToast({ title: '修改成功', icon: 'success' });
  }
};

const handleLogout = () => {
  showLogoutModal.value = true;
};

const confirmLogout = () => {
  showLogoutModal.value = false;
  userStore.logout();
};

const changeAvatar = () => {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const filePath = res.tempFilePaths[0];
      cropFilePath.value = filePath;
      cropImageSrc.value = filePath;
      imageScale.value = 1;
      imageX.value = 0;
      imageY.value = 0;
      showCropModal.value = true;
    }
  });
};

const onImageLoad = (e) => {
  imageWidth.value = e.detail.width;
  imageHeight.value = e.detail.height;
  // #ifdef H5
  nextTick(() => {
    const container = document.querySelector('.crop-container');
    const circle = document.querySelector('.crop-box');
    if (container) containerPx.value = container.offsetWidth;
    if (circle) cropBoxPx.value = circle.offsetWidth;
    computeCoverSize();
    // 初始缩放 = 刚好覆盖裁切框（框内无黑边，框外允许留黑）
    imageScale.value = getMinScale();
    imageX.value = 0;
    imageY.value = 0;
    clampTranslate();
  });
  // #endif
};

// 计算图片以 object-fit:cover 铺满容器时的显示尺寸（真实 px，scale=1 基准）
const computeCoverSize = () => {
  const c = containerPx.value;
  if (!c || !imageWidth.value || !imageHeight.value) return;
  const ratio = imageWidth.value / imageHeight.value;
  if (ratio > 1) {
    coverH.value = c;
    coverW.value = c * ratio;
  } else {
    coverW.value = c;
    coverH.value = c / ratio;
  }
};

// 最小缩放基准：图片短边刚好覆盖裁切框边长（cover 容器时短边=containerPx）
const getMinScale = () => {
  if (!containerPx.value || !cropBoxPx.value) return 1;
  return cropBoxPx.value / containerPx.value;
};

// 滑块最小值（与 minScale 同步）
const minSliderValue = computed(() => Math.round(getMinScale() * 100));

// 约束拖动范围，保证裁切框区域始终被图片覆盖（无黑边）
const clampTranslate = () => {
  if (!coverW.value || !coverH.value || !cropBoxPx.value) return;
  const halfW = (coverW.value * imageScale.value) / 2;
  const halfH = (coverH.value * imageScale.value) / 2;
  const maxTx = Math.max(0, halfW - cropBoxPx.value / 2);
  const maxTy = Math.max(0, halfH - cropBoxPx.value / 2);
  imageX.value = Math.min(Math.max(imageX.value, -maxTx), maxTx);
  imageY.value = Math.min(Math.max(imageY.value, -maxTy), maxTy);
};

const getDistance = (touches) => {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

const onTouchStart = (e) => {
  if (e.touches.length === 2) {
    startDistance.value = getDistance(e.touches);
    startScale.value = imageScale.value;
  } else if (e.touches.length === 1) {
    isDragging.value = true;
    startX.value = e.touches[0].clientX;
    startY.value = e.touches[0].clientY;
    lastX.value = imageX.value;
    lastY.value = imageY.value;
  }
};

const onTouchMove = (e) => {
  if (e.touches.length === 2) {
    const distance = getDistance(e.touches);
    const scale = (distance / startDistance.value) * startScale.value;
    imageScale.value = Math.min(Math.max(scale, getMinScale()), 3);
    clampTranslate();
  } else if (e.touches.length === 1 && isDragging.value) {
    const deltaX = e.touches[0].clientX - startX.value;
    const deltaY = e.touches[0].clientY - startY.value;
    imageX.value = lastX.value + deltaX;
    imageY.value = lastY.value + deltaY;
    clampTranslate();
  }
};

const onTouchEnd = () => {
  isDragging.value = false;
};

// 鼠标滚轮缩放（原生事件，确保 deltaY 可靠）
const handleWheel = (e) => {
  e.preventDefault();
  // deltaY > 0 向下滚动缩小，< 0 向上滚动放大
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  const newScale = Math.min(Math.max(imageScale.value + delta, getMinScale()), 3);
  imageScale.value = Math.round(newScale * 100) / 100;
  clampTranslate();
};

// 监听弹窗开关，绑定/解绑原生滚轮事件
watch(showCropModal, (val) => {
  // #ifdef H5
  nextTick(() => {
    const el = document.querySelector('.crop-container');
    if (val && el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
    } else if (el) {
      el.removeEventListener('wheel', handleWheel);
    }
  });
  // #endif
});

// 滑块缩放（实时）
const onZoomChanging = (e) => {
  const scale = Math.max(e.detail.value / 100, getMinScale());
  imageScale.value = scale;
  clampTranslate();
};

// 滑块缩放（松手时）
const onZoomChange = (e) => {
  const scale = Math.max(e.detail.value / 100, getMinScale());
  imageScale.value = Math.round(scale * 100) / 100;
  clampTranslate();
};

const cancelCrop = () => {
  showCropModal.value = false;
};

const confirmCrop = async () => {
  showCropModal.value = false;
  uni.showLoading({ title: '上传中...' });
  try {
    // 使用 canvas 裁切图片
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 300;
    canvas.width = size;
    canvas.height = size;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = cropImageSrc.value;

    await new Promise((resolve) => {
      img.onload = resolve;
    });

    // 与预览严格一致的坐标换算：
    // 图片显示尺寸 = cover 基准尺寸 × scale，中心在容器中心 + (imageX, imageY)
    const scale = imageScale.value;
    const displayW = coverW.value * scale;
    const displayH = coverH.value * scale;
    // 裁切框中心在“图片显示坐标系”（以图片显示左上为原点）的位置
    const figCenterX = displayW / 2 - imageX.value;
    const figCenterY = displayH / 2 - imageY.value;
    // 显示坐标 → 原图像素的比例
    const ratio = img.width / displayW;
    const srcSize = cropBoxPx.value * ratio;
    const srcX = (figCenterX - cropBoxPx.value / 2) * ratio;
    const srcY = (figCenterY - cropBoxPx.value / 2) * ratio;

    // 填充背景（正常约束下不会用到，作为兜底）
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);

    // 从原图取裁切框对应的方形区域，绘制到 300×300 正方形输出
    // （输出正方形底图，各页面通过 CSS border-radius 呈现圆形/圆角方形）
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, size, size);

    // 转换为 blob 并上传
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });

    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    const tempUrl = URL.createObjectURL(file);

    // 上传裁切后的图片
    const uploadRes = await upload('/api/upload', tempUrl);
    if (uploadRes.code === 200) {
      const result = await userStore.updateUserInfo({ avatar: uploadRes.data.url });
      if (result.success) {
        userInfo.value = result.data;
        uni.showToast({ title: '头像更新成功', icon: 'success' });
      }
    }
    URL.revokeObjectURL(tempUrl);
  } catch (e) {
    console.error('裁切上传失败:', e);
    uni.showToast({ title: e.message || '上传失败', icon: 'none' });
  } finally {
    uni.hideLoading();
  }
};
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: var(--color-bg);
}

/* 头部渐变 */
.profile-header {
  position: relative;
  padding: 40rpx 40rpx 60rpx;
  overflow: hidden;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--gradient-primary);
  z-index: 0;
}

.circle {
  position: absolute;
  border-radius: 50%;
  opacity: 0.15;
}

.circle-1 {
  width: 300rpx;
  height: 300rpx;
  background: #FFFFFF;
  top: -50rpx;
  right: -50rpx;
}

.circle-2 {
  width: 200rpx;
  height: 200rpx;
  background: #FFFFFF;
  bottom: -30rpx;
  left: 50rpx;
}

/* 用户卡片 */
.user-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar-wrapper {
  position: relative;
  margin-bottom: 24rpx;
}

.avatar-glow {
  position: absolute;
  top: -10rpx;
  left: -10rpx;
  right: -10rpx;
  bottom: -10rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  animation: pulse 3s ease-in-out infinite;
}

.user-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nickname {
  font-size: 36rpx;
  font-weight: 700;
  color: #FFFFFF;
  margin-bottom: 8rpx;
  text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.1);
}

.username {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.8);
}

/* 头部加载/失败态（白色主题，适配渐变背景） */
.header-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.header-spinner {
  width: 48rpx;
  height: 48rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.4);
  border-top-color: #FFFFFF;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.header-status-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.85);
}

.header-retry {
  margin-top: 8rpx;
  padding: 8rpx 28rpx;
  background: rgba(255, 255, 255, 0.25);
  border: 1rpx solid rgba(255, 255, 255, 0.5);
  border-radius: 999rpx;
}

.header-retry:active {
  transform: scale(0.95);
}

.header-retry-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #FFFFFF;
}

/* 菜单区域 */
.menu-section {
  padding: 30rpx;
  margin-top: -20rpx;
  position: relative;
  z-index: 2;
}

.menu-group {
  margin-bottom: 30rpx;
}

.group-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-left: 16rpx;
  margin-bottom: 16rpx;
  display: block;
}

.menu-card {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 24rpx;
  overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.6);
}

.menu-divider {
  height: 1rpx;
  background: var(--color-border);
  margin-left: 116rpx;
}

/* 退出登录 */
.logout-section {
  margin-top: 10rpx;
}

.logout-btn {
  width: 100%;
  height: 96rpx;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.6);
  transition: all 0.2s ease;
}

.logout-btn:active {
  background: rgba(255, 107, 107, 0.1);
}

.logout-text {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-error);
}

/* 底部 */
.footer {
  padding: 40rpx 0;
  display: flex;
  justify-content: center;
}

.version {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

/* 编辑资料弹窗内容（外壳由 BaseModal 提供） */
.edit-field {
  display: flex;
  flex-direction: column;
}

.edit-label {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 16rpx;
}

.edit-input {
  width: 100%;
  height: 88rpx;
  background: var(--color-bg);
  border-radius: 20rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  font-size: 30rpx;
  color: var(--color-text-primary);
  border: 2rpx solid transparent;
  transition: all 0.2s ease;
}

.edit-input:focus {
  border-color: var(--color-primary);
  background: #FFFFFF;
}

.edit-input-placeholder {
  color: var(--color-text-tertiary);
}

/* 裁切弹窗样式 */
/* 裁切弹窗内容（外壳由 BaseModal 提供） */
.crop-container {
  width: 560rpx;
  height: 560rpx;
  position: relative;
  overflow: hidden;
  background: #1a1a1a;
  border-radius: 16rpx;
  touch-action: none;
}

.crop-image {
  position: absolute;
  transform-origin: center center;
}

.crop-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.crop-box {
  width: 400rpx;
  height: 400rpx;
  border-radius: 24rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 0 0 9999rpx rgba(0, 0, 0, 0.5);
}

.crop-zoom {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 24rpx;
  padding: 0 8rpx;
}

.crop-zoom-icon {
  font-size: 36rpx;
  color: var(--color-text-secondary);
  font-weight: 600;
  width: 40rpx;
  text-align: center;
}

.crop-zoom-slider {
  flex: 1;
  margin: 0;
}

.crop-hint {
  text-align: center;
  margin-top: 16rpx;
}

.crop-hint-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

.crop-actions {
  display: flex;
  gap: 24rpx;
  padding: 8rpx 40rpx 40rpx;
}

.crop-btn {
  flex: 1;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crop-btn-cancel {
  background: var(--color-bg);
}

.crop-btn-confirm {
  background: var(--gradient-primary);
}

.crop-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.crop-btn-confirm .crop-btn-text {
  color: #FFFFFF;
}
</style>
