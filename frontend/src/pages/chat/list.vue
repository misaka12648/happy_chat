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
          :class="{ 'conv-pinned': conv.pinned }"
          :style="{ animationDelay: index * 0.05 + 's' }"
        >
          <uni-swipe-action-item class="conv-swipe-item">
            <view class="conversation-item" @click="openChat(conv)">
              <!-- 群聊：群名首字渐变头像；私聊：对方头像 + 在线绿点 -->
              <view class="conv-avatar-wrap">
                <AppAvatar
                  v-if="conv.type === 'GROUP'"
                  class="conv-avatar"
                  :background="getAvatarGradient({ nickname: conv.name })"
                  :text="(conv.name || '群').charAt(0)"
                />
                <AppAvatar
                  v-else
                  class="conv-avatar"
                  :src="getMediaUrl(conv.otherUser.avatar)"
                  :background="getAvatarGradient(conv.otherUser)"
                  :text="getAvatarText(conv.otherUser)"
                />
                <view v-if="conv.type !== 'GROUP' && conv.otherUser.online" class="online-dot"></view>
              </view>
              <view class="conversation-content">
                <view class="conversation-header">
                  <text class="nickname">{{ displayName(conv) }}</text>
                  <text class="time">{{ formatListTime(conv.lastMessageTime) }}</text>
                </view>
                <view class="conversation-footer">
                  <text class="last-message">{{ getLastMessagePreview(conv) }}</text>
                  <!-- 免打扰：未读红点退化为灰色圆点 -->
                  <view v-if="conv.unreadCount > 0 && !conv.muted" class="unread-badge">
                    <text class="unread-text">{{ conv.unreadCount > 99 ? '99+' : conv.unreadCount }}</text>
                  </view>
                  <view v-else-if="conv.unreadCount > 0 && conv.muted" class="unread-dot-muted"></view>
                </view>
              </view>
            </view>
            <template #right>
              <view class="swipe-action-right">
                <view class="swipe-btn swipe-pin" :class="{ 'swipe-btn--off': conv.pinned }" @click.stop="onTogglePin(conv)">
                  <text class="swipe-btn-text">{{ conv.pinned ? '取消置顶' : '置顶' }}</text>
                </view>
                <view class="swipe-btn swipe-mute" :class="{ 'swipe-btn--off': conv.muted }" @click.stop="onToggleMute(conv)">
                  <text class="swipe-btn-text">{{ conv.muted ? '取消免打扰' : '免打扰' }}</text>
                </view>
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

  <!-- 全局通话覆盖层（状态由 call store 驱动，同一时刻仅一个实例可见） -->
  <CallOverlay />
</template>

<script setup>
import CallOverlay from '@/components/CallOverlay/CallOverlay.vue';
import { ref, computed, onMounted, watch } from 'vue';
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

// TabBar 未读徽标：免打扰会话不计入；99+ 封顶；无未读时移除徽标。
// H5 下同步更新浏览器标签页标题。
const updateTabBarBadge = () => {
  const total = chatStore.getConversations
    .filter(c => !c.muted)
    .reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  if (total > 0) {
    uni.setTabBarBadge({ index: 0, text: total > 99 ? '99+' : String(total), fail: () => {} });
  } else {
    uni.removeTabBarBadge({ index: 0, fail: () => {} });
  }
  // #ifdef H5
  document.title = total > 0 ? `(${total}) HappyChat` : 'HappyChat';
  // #endif
};
// store 中的会话会被原地修改（未读数增减/列表重排），deep watch 覆盖全部路径
watch(() => chatStore.getConversations, updateTabBarBadge, { deep: true });

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
    const name = displayName(conv).toLowerCase();
    const message = (conv.lastMessage || '').toLowerCase();
    return name.includes(keyword) || message.includes(keyword);
  });
});

// 会话显示名：群聊用群名，私聊备注优先
const displayName = (conv) => {
  if (conv.type === 'GROUP') return conv.name || '群聊';
  const u = conv.otherUser || {};
  return u.remark || u.nickname || u.username || '';
};

// 打开会话：私聊传对方信息，群聊传群名
const openChat = (conv) => {
  if (conv.type === 'GROUP') {
    uni.navigateTo({
      url: `/pages/chat/detail?conversationId=${conv._id}&type=GROUP&name=${encodeURIComponent(conv.name || '群聊')}`
    });
    return;
  }
  uni.navigateTo({
    url: `/pages/chat/detail?conversationId=${conv._id}&userId=${conv.otherUser._id}&nickname=${encodeURIComponent(displayName(conv))}&username=${encodeURIComponent(conv.otherUser.username || '')}`
  });
};

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

  // 被拉入新群聊：强刷会话列表使其出现
  wsClient.on('GROUP_ADDED', () => {
    uni.showToast({ title: '你被邀请加入了新的群聊', icon: 'none' });
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
  updateTabBarBadge();
};

// 重试：强制绕过 TTL 重新拉取
const retryConversations = () => loadConversations({ force: true });

const getLastMessagePreview = (conv) => {
  if (!conv.lastMessage) return '';
  if (conv.lastMessageType === 'IMAGE') return '[图片]';
  if (conv.lastMessageType === 'VIDEO') return '[视频]';
  return conv.lastMessage;
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

// 置顶 / 取消置顶（失败提示由请求层统一处理）
const onTogglePin = async (conv) => {
  const target = !conv.pinned;
  try {
    await chatStore.pinConversation(conv._id, target);
    conversations.value = chatStore.getConversations;
    uni.showToast({ title: target ? '已置顶' : '已取消置顶', icon: 'none' });
  } catch (err) {
    console.error('置顶操作失败:', err);
  }
};

// 开启 / 关闭免打扰
const onToggleMute = async (conv) => {
  const target = !conv.muted;
  try {
    await chatStore.muteConversation(conv._id, target);
    conversations.value = chatStore.getConversations;
    uni.showToast({ title: target ? '已开启免打扰' : '已关闭免打扰', icon: 'none' });
  } catch (err) {
    console.error('免打扰操作失败:', err);
  }
};
</script>

<style scoped>
.chat-list {
  min-height: 100vh;
}

/* 会话列表 */
.conversation-list {
  padding: 16rpx 24rpx;
}

/* 外层：只承载入场动画与四角圆润的阴影（不裁剪，阴影不受内层右侧直角影响） */
.conv-shadow {
  border-radius: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-card);
  animation: fadeIn 0.5s ease-out forwards;
  opacity: 0;
}

/* 内层裁剪层：左圆右直——删除面板的右上/右下始终为直角，随左滑实时从右侧滑入 */
.conv-swipe-item {
  border-radius: 28rpx 0 0 28rpx;
  overflow: hidden;
}

/* 置顶会话：左侧品牌紫标识条 */
.conv-pinned .conversation-item {
  border-left: 8rpx solid var(--color-secondary);
}

.conversation-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 28rpx 24rpx;
  background: var(--color-card);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 28rpx;
  border: 1rpx solid var(--glass-border);
  /* 展开时卡片右侧圆角与自身阴影落入间隙，形成深度；未展开时被外层裁剪不可见 */
  box-shadow: 0 2rpx 14rpx rgba(0, 0, 0, 0.05);
}

.conversation-item:active {
  background: var(--color-nav);
}

/* 右侧动作区：与卡片之间留出间隙（padding-left），间隙露出页面底色 */
.swipe-action-right {
  display: flex;
  align-items: stretch;
  height: 100%;
  padding-left: 16rpx;
  box-sizing: border-box;
}

/* 置顶 / 免打扰 / 删除通用胶囊 */
.swipe-btn {
  width: 100rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8rpx;
  transition: transform 0.15s ease;
}

.swipe-btn:active {
  transform: scale(0.94);
}

.swipe-btn-text {
  color: #FFFFFF;
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  text-align: center;
  line-height: 1.4;
}

/* 置顶：品牌辅色紫；已置顶态转中性灰 */
.swipe-pin {
  border-radius: 24rpx 0 0 24rpx;
  background: linear-gradient(135deg, #A78BFA, #818CF8);
  box-shadow: 0 6rpx 18rpx rgba(167, 139, 250, 0.35);
}

.swipe-pin.swipe-btn--off {
  background: #9CA3AF;
  box-shadow: none;
}

/* 免打扰：琥珀警示色；已开启态转中性灰 */
.swipe-mute {
  background: linear-gradient(135deg, #FBBF24, #F59E0B);
  box-shadow: 0 6rpx 18rpx rgba(251, 191, 36, 0.3);
}

.swipe-mute.swipe-btn--off {
  background: #9CA3AF;
  box-shadow: none;
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

/* 头像容器（承载在线绿点） */
.conv-avatar-wrap {
  position: relative;
  margin-right: 24rpx;
  flex-shrink: 0;
}

.conv-avatar {
  display: block;
}

/* 在线状态小绿点（私聊） */
.online-dot {
  position: absolute;
  right: -2rpx;
  bottom: -2rpx;
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background: var(--color-success);
  border: 4rpx solid #FFFFFF;
  box-shadow: 0 0 8rpx rgba(52, 211, 153, 0.6);
}

html.dark .online-dot {
  border-color: #23232E;
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
  border: 2rpx solid rgba(255, 255, 255, 0.85);
  border-radius: 20rpx;
  padding: 0 14rpx;
  min-width: 36rpx;
  height: 36rpx;
  box-sizing: border-box;
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

/* 免打扰会话的未读：灰色小圆点，不闪烁 */
.unread-dot-muted {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  margin-left: 16rpx;
  flex-shrink: 0;
}
</style>
