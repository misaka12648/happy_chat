<template>
  <view class="contacts-page">
    <!-- 搜索栏 -->
    <SearchBar
      v-model="searchKeyword"
      placeholder="搜索用户"
      show-button
      input-height="80rpx"
      @search="searchUsers"
    />

    <!-- 好友请求通知 -->
    <view v-if="pendingRequests.length > 0" class="section">
      <view class="section-header">
        <text class="section-title">好友请求</text>
        <uni-badge :text="pendingRequests.length" type="error" :custom-style="{ backgroundColor: '#FF6B6B', border: 'none' }" />
      </view>
      <view class="request-list">
        <view v-for="req in pendingRequests" :key="req._id" class="request-item">
          <view class="request-info">
            <AppAvatar
              :src="getMediaUrl(req.requester.avatar)"
              :background="getAvatarGradient(req.requester)"
              :text="getAvatarText(req.requester)"
              size="88rpx"
              radius="24rpx"
              font-size="32rpx"
              shadow="0 4rpx 12rpx rgba(0, 0, 0, 0.1)"
            />
            <view class="request-meta">
              <text class="request-name">{{ req.requester.nickname || req.requester.username }}</text>
              <text class="request-time">请求添加你为好友</text>
            </view>
          </view>
          <GradientButton
            variant="success"
            text="接受"
            padding="12rpx 28rpx"
            radius="12rpx"
            font-size="24rpx"
            :active-scale="0.95"
            @click="acceptRequest(req._id)"
          />
        </view>
      </view>
    </view>

    <!-- 搜索结果 -->
    <view v-if="searchResults.length > 0" class="section">
      <view class="section-header">
        <text class="section-title">搜索结果</text>
      </view>
      <view class="user-list">
        <view v-for="user in searchResults" :key="user._id" class="user-item">
          <view class="user-info">
            <AppAvatar
              :src="getMediaUrl(user.avatar)"
              :background="getAvatarGradient(user)"
              :text="getAvatarText(user)"
              size="88rpx"
              radius="24rpx"
              font-size="32rpx"
              shadow="0 4rpx 12rpx rgba(0, 0, 0, 0.1)"
            />
            <view class="user-meta">
              <text class="user-name">{{ user.nickname || user.username }}</text>
              <text class="user-handle">@{{ user.username }}</text>
            </view>
          </view>
          <GradientButton
            variant="primary"
            text="添加"
            padding="12rpx 28rpx"
            radius="12rpx"
            font-size="24rpx"
            shadow="0 4rpx 12rpx rgba(255, 107, 107, 0.2)"
            :active-scale="0.95"
            @click="sendFriendRequest(user._id)"
          />
        </view>
      </view>
    </view>

    <!-- 好友列表 -->
    <view class="section">
      <view class="section-header">
        <text class="section-title">我的好友</text>
        <text class="section-count">{{ friends.length }} 位</text>
      </view>
      
      <!-- 首次加载中：接口未返回前展示通用 loading，避免误显“暂无好友” -->
      <StateView v-if="friendsViewState === 'loading'" state="loading" size="sm" />

      <!-- 加载失败：区分于“确实无好友”，提供重试 -->
      <StateView
        v-else-if="friendsViewState === 'error'"
        state="error"
        size="sm"
        icon="😞"
        title="加载失败"
        subtitle="请检查网络后重试"
        icon-bg="rgba(248, 113, 113, 0.1)"
        @retry="retryContacts"
      />

      <StateView
        v-else-if="friends.length === 0"
        state="empty"
        size="sm"
        icon="👥"
        title="暂无好友"
        subtitle="搜索添加新朋友吧"
        icon-bg="rgba(167, 139, 250, 0.1)"
      />
      
      <view v-else class="friend-list">
        <view 
          v-for="friend in friends" 
          :key="friend._id" 
          class="friend-item"
          @click="startChat(friend)"
        >
          <view class="friend-info">
            <AppAvatar
              :src="getMediaUrl(friend.avatar)"
              :background="getAvatarGradient(friend)"
              :text="getAvatarText(friend)"
              size="88rpx"
              radius="24rpx"
              font-size="32rpx"
              shadow="0 4rpx 12rpx rgba(0, 0, 0, 0.1)"
            />
            <view class="friend-meta">
              <text class="friend-name">{{ friend.nickname || friend.username }}</text>
              <view class="friend-status-wrap">
                <view class="status-dot" :class="{ online: friend.online }"></view>
                <text class="friend-status">{{ friend.online ? '在线' : '离线' }}</text>
              </view>
            </view>
          </view>
          <uni-icons type="forward" size="20" color="#9CA3AF" />
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { get, post } from '@/utils/request';
import { useUserStore } from '@/store/user';
import { useContactsStore } from '@/store/contacts';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import SearchBar from '@/components/SearchBar/SearchBar.vue';
import StateView from '@/components/StateView/StateView.vue';
import GradientButton from '@/components/GradientButton/GradientButton.vue';

const userStore = useUserStore();
const contactsStore = useContactsStore();
const searchKeyword = ref('');
const searchResults = ref([]);
// 好友与好友请求已迁入 Pinia（contactsStore），统一缓存 + TTL + 三态
const friends = computed(() => contactsStore.friends);
const pendingRequests = computed(() => contactsStore.pendingRequests);

// 三态视图：有数据(含陈旧)永远展示（SWR）；无数据时按 loading → error 优先判定；
// lastFetched===0（从未拉取）视为 loading，消除首屏到 onMounted 之间的空态闪现。
const friendsViewState = computed(() => {
  if (contactsStore.friends.length > 0) return 'ready';
  if (contactsStore.friendsError) return 'error';
  if (contactsStore.friendsLoading || contactsStore.lastFetched === 0) return 'loading';
  return 'ready';
});

// 重试：强制绕过 TTL 重新拉取
const retryContacts = () => contactsStore.fetchContacts({ force: true });

onMounted(() => {
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  contactsStore.fetchContacts();

  // 监听好友申请通知
  wsClient.on('FRIEND_REQUEST', (data) => {
    uni.showToast({ title: '收到新的好友申请', icon: 'none' });
    contactsStore.refreshRequests(); // 刷新好友请求列表
  });

  // 监听好友接受通知
  wsClient.on('FRIEND_ACCEPTED', (data) => {
    uni.showToast({ title: '好友请求已通过', icon: 'success' });
    contactsStore.refreshFriends(); // 刷新好友列表
  });

  // 监听好友在线状态变化
  wsClient.on('ONLINE_STATUS', (data) => {
    const { userId, online } = data;
    contactsStore.setFriendOnline(userId, online);
  });
});

// 每次页面显示时刷新数据（TTL 去抖已下沉到 store）
onShow(() => {
  if (!userStore.isLoggedIn) return;
  contactsStore.fetchContacts();
});

const searchUsers = async () => {
  if (!searchKeyword.value.trim()) return;
  try {
    const res = await get('/api/users/search', { keyword: searchKeyword.value });
    if (res.code === 200) {
      searchResults.value = res.data;
    }
  } catch (e) {
    // 错误提示已由请求层统一处理
    console.error('搜索失败:', e);
  }
};

const sendFriendRequest = async (userId) => {
  try {
    const res = await post('/api/friends/request', { recipientId: userId });
    if (res.code === 201) {
      uni.showToast({ title: '请求已发送', icon: 'success' });
      searchResults.value = searchResults.value.filter(u => u._id !== userId);
    }
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('发送好友请求失败:', e);
  }
};

const acceptRequest = async (friendshipId) => {
  try {
    const res = await post('/api/friends/accept', { friendshipId });
    if (res.code === 200) {
      uni.showToast({ title: '已接受', icon: 'success' });
      await contactsStore.fetchContacts({ force: true });
    }
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('接受好友请求失败:', e);
  }
};

const startChat = async (friend) => {
  try {
    const res = await post('/api/conversations', { userId: friend._id });
    if (res.code === 200) {
      uni.navigateTo({
        url: `/pages/chat/detail?conversationId=${res.data._id}&userId=${friend._id}&nickname=${encodeURIComponent(friend.nickname || friend.username)}&username=${encodeURIComponent(friend.username || '')}`
      });
    }
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('打开聊天失败:', e);
  }
};
</script>

<style scoped>
.contacts-page {
  min-height: 100vh;
  background: var(--color-bg);
}

/* 区块 */
.section {
  margin-top: 20rpx;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 24rpx;
  margin-left: 24rpx;
  margin-right: 24rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.6);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.section-count {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

/* 请求列表 */
.request-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.request-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx;
  background: var(--color-bg);
  border-radius: 16rpx;
}

.request-info {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.request-meta {
  display: flex;
  flex-direction: column;
}

.request-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.request-time {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  margin-top: 4rpx;
}

/* 用户列表 */
.user-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.user-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx;
  background: var(--color-bg);
  border-radius: 16rpx;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.user-meta {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.user-handle {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  margin-top: 4rpx;
}

/* 好友列表 */
.friend-list {
  display: flex;
  flex-direction: column;
}

.friend-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 16rpx;
  border-bottom: 1rpx solid var(--color-border);
  transition: all 0.2s ease;
}

.friend-item:last-child {
  border-bottom: none;
}

.friend-item:active {
  background: var(--color-bg);
  border-radius: 12rpx;
}

.friend-info {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.friend-meta {
  display: flex;
  flex-direction: column;
}

.friend-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.friend-status-wrap {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 6rpx;
}

.status-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.status-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 8rpx rgba(52, 211, 153, 0.5);
}

.friend-status {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}
</style>
