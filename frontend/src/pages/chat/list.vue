<template>
  <view class="chat-list">
    <!-- 顶部标题栏：主题快捷切换（免进设置一步切换明暗） -->
    <view class="list-header">
      <text class="list-title">消息</text>
      <view class="theme-toggle" aria-label="切换深色模式" @click="onToggleTheme">
        <text class="theme-toggle-icon">{{ isDarkTheme ? '☀️' : '🌙' }}</text>
      </view>
    </view>

    <!-- 搜索栏 -->
    <SearchBar v-model="searchKeyword" placeholder="搜索聊天记录" />

    <!-- 全局消息搜索结果（有搜索词时置于最上方，不受会话过滤空态影响） -->
    <view v-if="searchKeyword && msgResults.length" class="conversation-list msg-search-section">
      <view class="msg-search-header">
        <text class="msg-search-title">相关消息</text>
      </view>
      <view
        v-for="r in msgResults"
        :key="r._id"
        class="msg-search-item"
        @click="openSearchResult(r)"
      >
        <text class="msg-search-conv">{{ searchConvLabel(r) }}</text>
        <view class="msg-search-content">
          <template v-for="(seg, si) in highlightGlobal(r.content)" :key="si">
            <text v-if="seg.hit" class="msg-search-hit">{{ seg.text }}</text>
            <text v-else>{{ seg.text }}</text>
          </template>
        </view>
        <text class="msg-search-time">{{ formatListTime(r.createdAt) }}</text>
      </view>
    </view>

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

    <!-- 空态：搜索无结果与真空态文案区分 -->
    <StateView
      v-else-if="filteredConversations.length === 0"
      state="empty"
      :icon="searchKeyword ? '🔍' : '💬'"
      :title="searchKeyword ? '未找到相关会话' : '暂无聊天记录'"
      :subtitle="searchKeyword ? '换个关键词，或看看上方相关消息' : '去通讯录找朋友聊天吧'"
    />

    <!-- 会话列表 -->
    <view v-else class="conversation-list">
      <uni-swipe-action>
        <view
          v-for="(conv, index) in shownConversations"
          :key="conv._id"
          class="conv-shadow"
          :class="{ 'conv-pinned': conv.pinned }"
          :style="{ animationDelay: index * 0.05 + 's' }"
        >
          <uni-swipe-action-item class="conv-swipe-item">
            <view
              class="conversation-item"
              @click="openChat(conv)"
              @contextmenu.prevent="openConvMenu($event, conv)"
              @longpress="openConvMenu($event, conv)"
            >
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
                  <uni-icons v-if="conv.pinned" class="pin-flag" type="flag-filled" size="13" color="var(--color-secondary)" />
                  <text class="time">{{ formatListTime(conv.lastMessageTime) }}</text>
                </view>
                <view class="conversation-footer">
                  <!-- 有未发送草稿时红字提示（微信式），优先于最后一条消息预览 -->
                  <text v-if="draftPreview(conv)" class="last-message last-message-draft">[草稿] {{ draftPreview(conv) }}</text>
                  <!-- 群聊 @ 我：红字 [@我] 前缀 -->
                  <text v-else-if="mentionedMeLast(conv)" class="last-message last-message-draft">[@我] {{ getLastMessagePreview(conv) }}</text>
                  <!-- 有未读时最后一条预览加粗，扫一眼即可定位未读会话 -->
                  <text v-else class="last-message" :class="{ 'last-message-unread': conv.unreadCount > 0 }">{{ getLastMessagePreview(conv) }}</text>
                  <!-- 未读徽标：@我的免打扰会话也保持红标（灰色圆点仅用于普通免打扰） -->
                  <view v-if="conv.unreadCount > 0 && (!conv.muted || mentionedMeLast(conv))" class="unread-badge">
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

  <!-- 会话右键/长按快捷菜单（桌面右键与移动长按等效于左滑操作） -->
  <view v-if="convMenu.visible" class="conv-menu-mask" @click="closeConvMenu" @contextmenu.prevent="closeConvMenu">
    <view class="conv-menu" :style="{ left: convMenu.x + 'px', top: convMenu.y + 'px' }" @click.stop>
      <view class="conv-menu-item" @click="menuTogglePin">
        <text class="conv-menu-item-text">{{ convMenu.conv && convMenu.conv.pinned ? '取消置顶' : '置顶' }}</text>
      </view>
      <view v-if="convMenu.conv && convMenu.conv.unreadCount > 0" class="conv-menu-item" @click="menuMarkRead">
        <text class="conv-menu-item-text">标记已读</text>
      </view>
      <view class="conv-menu-item" @click="menuToggleMute">
        <text class="conv-menu-item-text">{{ convMenu.conv && convMenu.conv.muted ? '取消免打扰' : '免打扰' }}</text>
      </view>
      <view class="conv-menu-item" @click="menuDelete">
        <text class="conv-menu-item-text conv-menu-item-text-danger">删除</text>
      </view>
      <view class="conv-menu-item" @click="menuClearHistory">
        <text class="conv-menu-item-text">清空记录</text>
      </view>
    </view>
  </view>

  <!-- 清空聊天记录确认弹窗 -->
  <BaseModal
    v-model:visible="showClearModal"
    title="清空聊天记录"
    :content="`将清除你视角下与「${clearTargetName}」的聊天记录，对方不受影响。确定清空吗？`"
    confirm-text="清空"
    @confirm="confirmClearHistory"
  />

  <!-- 全局通话覆盖层（状态由 call store 驱动，同一时刻仅一个实例可见） -->
  <CallOverlay />
</template>

<script setup>
import CallOverlay from '@/components/CallOverlay/CallOverlay.vue';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import wsClient from '@/utils/socket';
import { toggleTheme, resolveTheme, getThemeMode } from '@/utils/theme';
import { navigateToConversation } from '@/utils/notify';
import { get } from '@/utils/request';
import { getMediaUrl, getAvatarGradient, getAvatarText, formatListTime } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import SearchBar from '@/components/SearchBar/SearchBar.vue';
import StateView from '@/components/StateView/StateView.vue';
import BaseModal from '@/components/BaseModal/BaseModal.vue';

const chatStore = useChatStore();
const userStore = useUserStore();
const conversations = ref([]);
const searchKeyword = ref('');

// 主题快捷切换：按钮图标随当前生效主题变化（明→🌙，暗→☀️）
const isDarkTheme = ref(resolveTheme(getThemeMode()) === 'dark');
const onThemeChanged = (mode) => {
  isDarkTheme.value = resolveTheme(mode) === 'dark';
};
const onToggleTheme = () => {
  const next = toggleTheme();
  uni.showToast({ title: next === 'dark' ? '已切换至深色模式' : '已切换至浅色模式', icon: 'none' });
};

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
// store 中的会话会被原地修改（未读数增减/列表重排），deep watch 覆盖全部路径；
// WS 事件（群解散/成员退群）会整体替换 store 数组，此处同步列表本地引用
watch(() => chatStore.getConversations, () => {
  conversations.value = chatStore.getConversations;
  updateTabBarBadge();
}, { deep: true });

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

// 草稿预览的重估信号：从详情页返回（onShow）时自增，驱动列表重新读取本地草稿
const draftTick = ref(0);

// 列表渲染入口：依赖 draftTick，保证离开会话后 [草稿] 标识立即出现/消失
const shownConversations = computed(() => {
  draftTick.value; // eslint-disable-line no-unused-expressions
  return filteredConversations.value;
});

// 会话草稿摘要（详情页存于本地存储 draft_<convId>）；无草稿返回 ''
const draftPreview = (conv) => {
  // #ifdef H5
  draftTick.value; // 建立响应依赖：tick 变化时重新读取
  const draft = uni.getStorageSync('draft_' + conv._id);
  if (!draft) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = draft;
  const text = (tmp.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return text;
  // #endif
  return '';
};

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

  // 主题可能在设置页被更改：同步快捷按钮图标
  uni.$on('theme-changed', onThemeChanged);

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

  // 被拉入新群聊：强刷会话列表使其出现（全局横幅提醒由 notify.js 统一处理）
  wsClient.on('GROUP_ADDED', () => {
    loadConversations({ force: true });
  });
});

onUnmounted(() => {
  uni.$off('theme-changed', onThemeChanged);
});

// 每次页面显示时刷新会话列表（从详情页返回时），并重估草稿预览
onShow(async () => {
  draftTick.value += 1;
  if (userStore.isLoggedIn) {
    await loadConversations();
  }
});

// 下拉刷新：强制绕过 TTL 重新拉取会话列表
onPullDownRefresh(async () => {
  await loadConversations({ force: true });
  uni.stopPullDownRefresh();
});

const loadConversations = async ({ force = false } = {}) => {
  await chatStore.fetchConversations({ force });
  conversations.value = chatStore.getConversations;
  updateTabBarBadge();
};

// 重试：强制绕过 TTL 重新拉取
const retryConversations = () => loadConversations({ force: true });

// 群聊最后一条消息是否 @ 了我（按内容包含我的昵称/用户名判断）
const mentionedMeLast = (conv) => {
  const u = userStore.getUserInfo || {};
  const my = [u.nickname, u.username].filter(Boolean);
  return conv.type === 'GROUP' && my.some(n => conv.lastMessage && conv.lastMessage.includes('@' + n));
};

// ========== 全局消息搜索（跨会话，输入防抖 400ms） ==========
const msgResults = ref([]);
const msgSearching = ref(false);
let msgSearchTimer = null;

watch(searchKeyword, (kw) => {
  clearTimeout(msgSearchTimer);
  const q = kw.trim();
  if (!q) {
    msgResults.value = [];
    msgSearching.value = false;
    return;
  }
  msgSearching.value = true;
  msgSearchTimer = setTimeout(async () => {
    try {
      const res = await get('/api/messages/search/global', { keyword: q, limit: 20 });
      if (res.code === 200 && kw.trim() === searchKeyword.value.trim()) {
        msgResults.value = res.data.messages;
      }
    } catch (e) {
      console.error('全局消息搜索失败:', e);
    } finally {
      msgSearching.value = false;
    }
  }, 400);
});

const searchConvLabel = (r) => {
  const u = r.sender || {};
  const senderName = u.nickname || u.username || '';
  return r.conversationType === 'GROUP' ? `${r.conversationName} · ${senderName}` : senderName;
};

// 全局搜索结果的关键词高亮分段
const highlightGlobal = (content) => {
  const kw = searchKeyword.value.trim();
  if (!kw || !content) return [{ hit: false, text: content || '' }];
  const lower = content.toLowerCase();
  const k = kw.toLowerCase();
  const segs = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(k, i);
    if (idx === -1) {
      segs.push({ hit: false, text: content.slice(i) });
      break;
    }
    if (idx > i) segs.push({ hit: false, text: content.slice(i, idx) });
    segs.push({ hit: true, text: content.slice(idx, idx + kw.length) });
    i = idx + kw.length;
  }
  return segs;
};

const openSearchResult = (r) => {
  searchKeyword.value = '';
  msgResults.value = [];
  // 携带消息 ID：详情页加载后直接定位到该条消息
  const peer = r.otherUser || {};
  const targetParams = r.conversationType === 'GROUP'
    ? `&type=GROUP&name=${encodeURIComponent(r.conversationName || '群聊')}`
    : `&userId=${encodeURIComponent(peer._id || '')}&nickname=${encodeURIComponent(peer.nickname || peer.username || '')}&username=${encodeURIComponent(peer.username || '')}`;
  uni.navigateTo({
    url: `/pages/chat/detail?conversationId=${r.conversationId}${targetParams}&locateMsg=${r._id}`,
    fail: () => uni.switchTab({ url: '/pages/chat/list' })
  });
};

const getLastMessagePreview = (conv) => {
  if (!conv.lastMessage) return '';
  let preview = conv.lastMessage;
  if (conv.lastMessageType === 'IMAGE') preview = '[图片]';
  else if (conv.lastMessageType === 'VIDEO') preview = '[视频]';
  else if (conv.lastMessageType === 'VOICE') preview = '[语音]';
  // 群聊预览带发送者名（微信式），一眼看清是谁说的
  if (conv.type === 'GROUP' && conv.lastMessageSenderName) {
    preview = `${conv.lastMessageSenderName}: ${preview}`;
  }
  return preview;
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

// ========== 会话右键/长按快捷菜单 ==========
const convMenu = ref({ visible: false, x: 0, y: 0, conv: null });

const openConvMenu = (e, conv) => {
  // #ifdef H5
  const touch = e.touches && e.touches[0];
  const x = (touch && touch.clientX) || e.clientX || 0;
  const y = (touch && touch.clientY) || e.clientY || 0;
  convMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(x, window.innerWidth - 150)),
    y: Math.max(8, Math.min(y, window.innerHeight - 150)),
    conv
  };
  // #endif
};

const closeConvMenu = () => {
  convMenu.value.visible = false;
};

const menuTogglePin = async () => {
  const c = convMenu.value.conv;
  closeConvMenu();
  if (c) await onTogglePin(c);
};

const menuToggleMute = async () => {
  const c = convMenu.value.conv;
  closeConvMenu();
  if (c) await onToggleMute(c);
};

// 标记已读（右键菜单快捷操作，仅在有未读时显示）
const menuMarkRead = async () => {
  const c = convMenu.value.conv;
  closeConvMenu();
  if (!c || !(c.unreadCount > 0)) return;
  try {
    await chatStore.markConversationAsRead(c._id);
    conversations.value = chatStore.getConversations;
  } catch (err) {
    console.error('标记已读失败:', err);
  }
};

const menuDelete = async () => {
  const c = convMenu.value.conv;
  closeConvMenu();
  if (c) await onDelete(c);
};

// ========== 清空聊天记录 ==========
const showClearModal = ref(false);
const clearTarget = ref(null);
const clearTargetName = computed(() => {
  const c = clearTarget.value;
  if (!c) return '';
  return c.type === 'GROUP' ? (c.name || '群聊') : displayName(c);
});

const menuClearHistory = () => {
  clearTarget.value = convMenu.value.conv;
  closeConvMenu();
  showClearModal.value = true;
};

const confirmClearHistory = async () => {
  const c = clearTarget.value;
  showClearModal.value = false;
  if (!c) return;
  try {
    await chatStore.clearConversationHistory(c._id);
    uni.showToast({ title: '聊天记录已清空', icon: 'success' });
  } catch (err) {
    console.error('清空聊天记录失败:', err);
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

/* 顶部标题栏 */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 32rpx 8rpx;
}

.list-title {
  font-size: 40rpx;
  font-weight: 700;
  color: var(--color-text-primary);
}

/* 主题快捷切换：玻璃圆钮，日/月图标随生效主题切换 */
.theme-toggle {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-card);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1rpx solid var(--glass-border);
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s ease;
}

.theme-toggle:active {
  transform: scale(0.92);
}

.theme-toggle-icon {
  font-size: 34rpx;
  line-height: 1;
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

/* 置顶小旗标 */
.pin-flag {
  margin-right: 8rpx;
  flex-shrink: 0;
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

/* 未发送草稿：红字提示，一眼与普通消息预览区分 */
.last-message-draft {
  color: var(--color-error);
}

/* 有未读会话的最后一条预览加粗 */
.last-message-unread {
  font-weight: 600;
  color: var(--color-text-primary);
}

/* ========== 全局消息搜索结果 ========== */
.msg-search-section {
  margin-bottom: 16rpx;
}

.msg-search-header {
  padding: 8rpx 8rpx 12rpx;
}

.msg-search-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.msg-search-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 8rpx;
  background: var(--color-card);
  border: 1rpx solid var(--glass-border);
  border-radius: 16rpx;
}

.msg-search-item:active {
  transform: scale(0.98);
}

.msg-search-conv {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary);
  flex-shrink: 0;
  max-width: 200rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-search-content {
  flex: 1;
  font-size: 26rpx;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-search-hit {
  color: var(--color-primary);
  font-weight: 700;
}

.msg-search-time {
  font-size: 20rpx;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

/* ========== 会话右键/长按快捷菜单 ========== */
.conv-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 998;
}

.conv-menu {
  position: fixed;
  background: rgba(50, 50, 52, 0.96);
  border-radius: 16rpx;
  padding: 8rpx 0;
  min-width: 200rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.2);
}

.conv-menu-item {
  padding: 20rpx 36rpx;
}

.conv-menu-item:active {
  background: rgba(255, 255, 255, 0.08);
}

.conv-menu-item-text {
  font-size: 28rpx;
  color: #FFFFFF;
}

.conv-menu-item-text-danger {
  color: var(--color-error);
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
