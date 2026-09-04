<template>
  <view class="chat-list">
    <!-- 搜索栏 -->
    <SearchBar v-model="searchKeyword" placeholder="搜索聊天记录" />

    <!-- 加载状态 -->
    <StateView v-if="viewState === 'loading'" state="loading" />

    <!-- 加载失败 -->
    <StateView
      v-else-if="viewState === 'error'"
      state="error"
      icon="😞"
      title="加载失败"
      subtitle="请检查网络后重试"
      icon-bg="rgba(248, 113, 113, 0.1)"
      @retry="retryConversations"
    />

    <!-- 空状态 -->
    <StateView
      v-else-if="filteredConversations.length === 0"
      state="empty"
      icon="💬"
      title="暂无聊天记录"
      subtitle="去通讯录找朋友聊天吧"
    />

    <!-- 会话列表 -->
    <view v-else class="conversation-list">
      <uni-swipe-action>
        <view
          v-for="(conv, index) in filteredConversations"
          :key="conv._id"
          class="conv-shadow"
          :style="{ animationDelay: index * 0.05 + 's' }"
        >
          <uni-swipe-action-item class="conv-swipe-item">
            <view class="conversation-item" @click="openChat(conv)">
              <AppAvatar
                class="conv-avatar"
                :src="getMediaUrl(conv.otherUser.avatar)"
                :background="getAvatarGradient(conv.otherUser)"
                :text="getAvatarText(conv.otherUser)"
              />
              <view class="conversation-content">
                <view class="conversation-header">
                  <text class="nickname">{{ conv.otherUser.nickname || conv.otherUser.username }}</text>
                  <text class="time">{{ formatListTime(conv.lastMessageTime) }}</text>
                </view>
                <view class="conversation-footer">
                  <text class="last-message">{{ getLastMessagePreview(conv) }}</text>
                  <view v-if="conv.unreadCount > 0" class="unread-badge">
                    <text class="unread-text">{{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}</text>
                  </view>
                </view>
              </view>
            </view>
            <template #right>
              <view class="swipe-action-right">
                <view class="swipe-delete" @click.stop="onDelete(conv)">
                  <text class="swipe-delete-text">删除</text>
                </view>
              </view>
            </template>
          </uni-swipe-action-item>
        </view>
      </uni-swipe-action>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText, formatListTime } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import SearchBar from '@/components/SearchBar/SearchBar.vue';
import StateView from '@/components/StateView/StateView.vue';

const chatStore = useChatStore();
const userStore = useUserStore();
const conversations = ref([]);
const searchKeyword = ref('');

// 三态视图：有数据(含陈旧)永远展示（SWR）；无数据时按 loading → error 优先判定；
// lastFetched===0（从未拉取）视为 loading，消除首屏到 onMounted 之间的空态闪现。
const viewState = computed(() => {
  if (chatStore.getConversations.length > 0) return 'ready';
  if (chatStore.conversationsError) return 'error';
  if (chatStore.conversationsLoading || chatStore.lastFetched === 0) return 'loading';
  return 'ready';
});

const filteredConversations = computed(() => {
  if (!searchKeyword.value) return conversations.value;
  const keyword = searchKeyword.value.toLowerCase();
  return conversations.value.filter(conv => {
    const name = (conv.otherUser.nickname || conv.otherUser.username || '').toLowerCase();
    const message = (conv.lastMessage || '').toLowerCase();
    return name.includes(keyword) || message.includes(keyword);
  });
});

onMounted(async () => {
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  await loadConversations();

  // 监听会话更新（新消息到达）
  wsClient.on('NEW_MESSAGE', (msg) => {
    // 若会话不在本地列表（已被删除/隐藏后对方又发来消息），强制拉取使其重新出现
    const exists = chatStore.getConversations.some(c => c._id === msg.conversationId);
    if (!exists) {
      loadConversations({ force: true });
      return;
    }
    chatStore.updateConversationLastMessage(msg.conversationId, msg);
    conversations.value = chatStore.getConversations;
  });

  // 监听消息发送确认
  wsClient.on('MESSAGE_SENT', (msg) => {
    chatStore.updateConversationLastMessage(msg.conversationId, msg);
    conversations.value = chatStore.getConversations;
  });

  // WebSocket 重连后强制补拉断连期间错过的会话更新（绕过 TTL）
  wsClient.on('RECONNECTED', () => {
    loadConversations({ force: true });
  });
});

// 每次页面显示时刷新会话列表（从详情页返回时）
onShow(async () => {
  if (userStore.isLoggedIn) {
    await loadConversations();
  }
});

const loadConversations = async ({ force = false } = {}) => {
  await chatStore.fetchConversations({ force });
  conversations.value = chatStore.getConversations;
};

// 重试：强制绕过 TTL 重新拉取
const retryConversations = () => loadConversations({ force: true });

const getLastMessagePreview = (conv) => {
  if (!conv.lastMessage) return '';
  if (conv.lastMessageType === 'IMAGE') return '[图片]';
  if (conv.lastMessageType === 'VIDEO') return '[视频]';
  return conv.lastMessage;
};

const openChat = (conv) => {
  uni.navigateTo({
    url: `/pages/chat/detail?conversationId=${conv._id}&userId=${conv.otherUser._id}&nickname=${encodeURIComponent(conv.otherUser.nickname || conv.otherUser.username)}&username=${encodeURIComponent(conv.otherUser.username || '')}`
  });
};

// 删除会话（后端软隐藏，消息不删）
const onDelete = async (conv) => {
  try {
    await chatStore.deleteConversation(conv._id);
    conversations.value = chatStore.getConversations;
  } catch (err) {
    console.error('删除会话失败:', err);
  }
};
</script>

<style scoped>
.chat-list {
  min-height: 100vh;
  background: var(--color-bg);
}

/* 会话列表 */
.conversation-list {
  padding: 16rpx 24rpx;
}

/* 外层：只承载入场动画与四角圆润的阴影（不裁剪，阴影不受内层右侧直角影响） */
.conv-shadow {
  border-radius: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  animation: fadeIn 0.5s ease-out forwards;
  opacity: 0;
}

/* 内层裁剪层：左圆右直——删除面板的右上/右下始终为直角，随左滑实时从右侧滑入 */
.conv-swipe-item {
  border-radius: 24rpx 0 0 24rpx;
  overflow: hidden;
}

.conversation-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 28rpx 24rpx;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 24rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.6);
  /* 展开时卡片右侧圆角与自身阴影落入间隙，形成深度；未展开时被外层裁剪不可见 */
  box-shadow: 0 2rpx 14rpx rgba(0, 0, 0, 0.05);
}

.conversation-item:active {
  background: rgba(255, 255, 255, 0.95);
}

/* 右侧动作区：与卡片之间留出间隙（padding-left），间隙露出页面底色 */
.swipe-action-right {
  display: flex;
  align-items: stretch;
  height: 100%;
  padding-left: 16rpx;
  box-sizing: border-box;
}

/* 删除胶囊：左侧圆角面向卡片间隙，右侧直角贴合行边缘（不像在卡片里） */
.swipe-delete {
  width: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #FF8B8B 0%, #FF6B6B 100%);
  box-shadow: 0 6rpx 18rpx rgba(255, 107, 107, 0.35);
  transition: transform 0.15s ease;
}

.swipe-delete:active {
  transform: scale(0.94);
}

.swipe-delete-text {
  color: #FFFFFF;
  font-size: 28rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
}

/* 头像 */
.conv-avatar {
  margin-right: 24rpx;
}

/* 会话内容 */
.conversation-content {
  flex: 1;
  overflow: hidden;
}

.conversation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}

.nickname {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  margin-left: 16rpx;
  flex-shrink: 0;
}

.conversation-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.last-message {
  font-size: 26rpx;
  color: var(--color-text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 未读徽章 */
.unread-badge {
  background: var(--color-primary);
  border-radius: 20rpx;
  padding: 0 16rpx;
  min-width: 36rpx;
  height: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 16rpx;
  animation: pulse 2s ease-in-out infinite;
}

.unread-text {
  color: #FFFFFF;
  font-size: 20rpx;
  font-weight: 600;
}
</style>
