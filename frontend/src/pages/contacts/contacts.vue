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

    <!-- 发起群聊入口 -->
    <view class="section group-entry" @click="openGroupModal">
      <view class="group-entry-row">
        <view class="group-entry-icon">
          <uni-icons type="staff-filled" size="44rpx" color="#FFFFFF" />
        </view>
        <view class="group-entry-meta">
          <text class="group-entry-title">发起群聊</text>
          <text class="group-entry-sub">和多位好友一起畅聊</text>
        </view>
        <uni-icons type="right" size="20" color="var(--color-icon-muted)" />
      </view>
    </view>

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
              <text class="request-time">请求添加你为好友 · {{ relativeShort(req.createdAt) }}</text>
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
        <!-- 按拼音首字母分组，微信式字母吸顶标题 + 右侧索引条 -->
        <view
          v-for="group in groupedFriends"
          :key="group.letter"
          :id="'friend-group-' + group.letter"
          class="friend-group"
        >
          <view class="group-letter-badge">
            <text class="group-letter-text">{{ group.letter }}</text>
          </view>
          <view
            v-for="friend in group.items"
            :key="friend._id"
            class="friend-item"
            @click="openFriendCard(friend)"
            @longpress="onFriendLongPress(friend)"
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
                <text class="friend-name">{{ friend.remark || friend.nickname || friend.username }}</text>
                <view class="friend-status-wrap">
                  <view class="status-dot" :class="{ online: friend.online }"></view>
                  <text class="friend-status">{{ lastSeenText(friend) }}</text>
                </view>
              </view>
            </view>
            <uni-icons type="forward" size="20" color="var(--color-icon-muted)" />
          </view>
        </view>
      </view>
    </view>

    <!-- 右侧字母索引条（好友较多时展示，点击跳组） -->
    <view v-if="groupedFriends.length > 1" class="letter-index">
      <text
        v-for="g in groupedFriends"
        :key="'idx-' + g.letter"
        class="letter-index-item"
        @click="scrollToGroup(g.letter)"
      >{{ g.letter }}</text>
    </view>

    <!-- 删除好友确认弹窗 -->
    <BaseModal
      v-model:visible="showDeleteModal"
      title="删除好友"
      :content="deleteConfirmText"
      confirm-text="删除"
      @confirm="confirmDeleteFriend"
    />

    <!-- 好友资料卡片 -->
    <BaseModal
      v-model:visible="showCardModal"
      width="600rpx"
      :show-cancel="false"
      confirm-text="关闭"
      @confirm="showCardModal = false"
    >
      <template #header>
        <view class="card-head">
          <AppAvatar
            :src="getMediaUrl(cardFriend.avatar)"
            :background="getAvatarGradient(cardFriend)"
            :text="getAvatarText(cardFriend)"
            size="140rpx"
            radius="50%"
            font-size="56rpx"
            shadow="0 8rpx 24rpx rgba(0, 0, 0, 0.15)"
          />
          <text class="card-name">{{ cardFriend.remark || cardFriend.nickname || cardFriend.username }}</text>
          <text class="card-handle" v-if="cardFriend.username">@{{ cardFriend.username }}</text>
          <view class="card-status-wrap">
            <view class="card-status-dot" :class="{ online: cardFriend.online }"></view>
            <text class="card-status-text">{{ cardFriend.online ? '在线' : '离线' }}</text>
          </view>
        </view>
      </template>
      <view class="card-body">
        <view class="card-field" v-if="cardFriend.bio">
          <text class="card-field-label">个性签名</text>
          <text class="card-field-value">{{ cardFriend.bio }}</text>
        </view>
        <view class="card-field">
          <text class="card-field-label">备注名</text>
          <input
            class="card-remark-input"
            v-model="remarkInput"
            placeholder="设置备注名"
            placeholder-class="card-remark-placeholder"
            maxlength="20"
          />
        </view>
        <view class="card-save" @click="saveRemark">
          <text class="card-save-text">保存备注</text>
        </view>
      </view>
      <template #footer>
        <view class="card-actions">
          <view class="card-btn card-btn-chat" @click="cardStartChat">
            <text class="card-btn-text">发消息</text>
          </view>
          <view class="card-btn card-btn-danger" @click="cardDeleteFriend">
            <text class="card-btn-text card-btn-text-danger">删除好友</text>
          </view>
        </view>
      </template>
    </BaseModal>

    <!-- 发起群聊弹窗 -->
    <BaseModal
      v-model:visible="showGroupModal"
      title="发起群聊"
      width="640rpx"
      confirm-text="创建"
      @confirm="createGroup"
    >
      <view class="group-name-wrap">
        <input
          class="group-name-input"
          v-model="groupName"
          placeholder="群名称（必填）"
          placeholder-class="group-name-placeholder"
          maxlength="30"
        />
      </view>
      <view class="group-hint">
        <text class="group-hint-text">选择群成员（已选 {{ selectedIds.length }} 人）</text>
      </view>
      <scroll-view scroll-y class="group-member-list">
        <view
          v-for="f in friends"
          :key="f._id"
          class="group-member-item"
          @click="toggleMember(f._id)"
        >
          <AppAvatar
            :src="getMediaUrl(f.avatar)"
            :background="getAvatarGradient(f)"
            :text="getAvatarText(f)"
            size="72rpx"
            radius="50%"
            font-size="28rpx"
            shadow="none"
          />
          <text class="group-member-name">{{ f.remark || f.nickname || f.username }}</text>
          <view class="check-circle" :class="{ checked: selectedIds.includes(f._id) }">
            <uni-icons v-if="selectedIds.includes(f._id)" type="checkmarkempty" size="24rpx" color="#FFFFFF" />
          </view>
        </view>
        <StateView v-if="friendsViewState === 'empty'" state="empty" size="sm" icon="👥" title="暂无好友" subtitle="先去添加好友吧" />
      </scroll-view>
    </BaseModal>
  </view>

  <!-- 全局通话覆盖层 -->
  <CallOverlay />
</template>

<script setup>
import CallOverlay from '@/components/CallOverlay/CallOverlay.vue';
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { get, post, put, del } from '@/utils/request';
import { useUserStore } from '@/store/user';
import { useContactsStore } from '@/store/contacts';
import { useChatStore } from '@/store/chat';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import SearchBar from '@/components/SearchBar/SearchBar.vue';
import StateView from '@/components/StateView/StateView.vue';
import GradientButton from '@/components/GradientButton/GradientButton.vue';
import BaseModal from '@/components/BaseModal/BaseModal.vue';

const userStore = useUserStore();
const contactsStore = useContactsStore();
const chatStore = useChatStore();
const searchKeyword = ref('');
const searchResults = ref([]);
// 好友与好友请求已迁入 Pinia（contactsStore），统一缓存 + TTL + 三态
const friends = computed(() => contactsStore.friends);
const pendingRequests = computed(() => contactsStore.pendingRequests);

// ========== 好友拼音分组（微信通讯录式） ==========
// 中文按拼音排序（Intl.Collator）；注意部分 ICU 实现把汉字整体排在拉丁字母之前，
// 因此不能用汉字与"A/B/C"直接比较，改用"汉字锚点"：每个字母取一个代表汉字，
// 汉字只与锚点汉字比较（拼音序可靠），从 Z 往回找第一个不大于它的锚点即其字母。
const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !'IUV'.includes(l)); // 拼音音节无 I/U/V 开头

const ANCHOR = { A: '啊', B: '巴', C: '擦', D: '搭', E: '鹅', F: '发', G: '嘎', H: '哈', J: '击', K: '喀', L: '拉', M: '妈', N: '拿', O: '哦', P: '趴', Q: '七', R: '然', S: '撒', T: '塌', W: '挖', X: '西', Y: '压', Z: '匝' };

const displayNameOf = (f) => f.remark || f.nickname || f.username || '';

const letterOf = (name) => {
  const ch = (name || '').trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (!ch) return '#';
  const reversed = [...LETTERS].reverse();
  for (const letter of reversed) {
    if (PINYIN_COLLATOR.compare(ch, ANCHOR[letter]) >= 0) return letter;
  }
  return '#';
};

const groupedFriends = computed(() => {
  const map = new Map();
  friends.value.forEach(f => {
    const letter = letterOf(displayNameOf(f));
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter).push(f);
  });
  return Array.from(map.entries())
    .map(([letter, items]) => ({
      letter,
      items: items.sort((a, b) => PINYIN_COLLATOR.compare(displayNameOf(a), displayNameOf(b)))
    }))
    .sort((a, b) => {
      const oa = a.letter === '#' ? 1000 : a.letter.charCodeAt(0);
      const ob = b.letter === '#' ? 1000 : b.letter.charCodeAt(0);
      return oa - ob;
    });
});

// 点击索引条跳到对应分组（H5 原生平滑滚动）
const scrollToGroup = (letter) => {
  // #ifdef H5
  const el = document.getElementById('friend-group-' + letter);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // #endif
};

// 好友在线状态文案：离线时展示最后在线的相对时间
const lastSeenText = (f) => {
  if (f.online) return '在线';
  if (!f.lastSeen) return '离线';
  const diff = Date.now() - new Date(f.lastSeen).getTime();
  if (diff < 60000) return '最后在线 刚刚';
  if (diff < 3600000) return '最后在线 ' + Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return '最后在线 ' + Math.floor(diff / 3600000) + '小时前';
  return '最后在线 ' + Math.floor(diff / 86400000) + '天前';
};

// 相对时间短格式（好友请求等时间标注用）
const relativeShort = (time) => {
  if (!time) return '';
  const diff = Date.now() - new Date(time).getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
};

// 删除好友确认弹窗状态
const showDeleteModal = ref(false);
const pendingDeleteFriend = ref(null);

// 发起群聊弹窗状态
const showGroupModal = ref(false);
const groupName = ref('');
const selectedIds = ref([]);

// 好友资料卡片状态
const showCardModal = ref(false);
const cardFriend = ref({});
const remarkInput = ref('');
const deleteConfirmText = computed(() => {
  const name = pendingDeleteFriend.value
    ? (pendingDeleteFriend.value.nickname || pendingDeleteFriend.value.username || '该用户')
    : '该用户';
  return `确定删除好友「${name}」吗？删除后需要重新添加才能继续聊天。`;
});

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

  // 监听被好友删除：先取昵称用于提示，再刷新列表使其消失
  wsClient.on('FRIEND_REMOVED', (data) => {
    const removed = contactsStore.friends.find(f => f._id === data.friendId);
    const name = removed ? (removed.nickname || removed.username || '') : '';
    uni.showToast({ title: name ? `「${name}」已将你删除` : '有好友将你删除', icon: 'none' });
    contactsStore.refreshFriends();
    // 会话被服务端软隐藏，静默强刷会话列表保持一致
    chatStore.fetchConversations({ force: true });
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
      const name = friend.remark || friend.nickname || friend.username;
      uni.navigateTo({
        url: `/pages/chat/detail?conversationId=${res.data._id}&userId=${friend._id}&nickname=${encodeURIComponent(name)}&username=${encodeURIComponent(friend.username || '')}`
      });
    }
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('打开聊天失败:', e);
  }
};

// ========== 删除好友（长按好友项） ==========
const onFriendLongPress = (friend) => {
  uni.showActionSheet({
    itemList: ['发送消息', '删除好友'],
    success: (res) => {
      if (res.tapIndex === 0) {
        startChat(friend);
      } else if (res.tapIndex === 1) {
        pendingDeleteFriend.value = friend;
        showDeleteModal.value = true;
      }
    }
  });
};

const confirmDeleteFriend = async () => {
  const friend = pendingDeleteFriend.value;
  if (!friend) return;
  showDeleteModal.value = false;
  pendingDeleteFriend.value = null;
  try {
    await del(`/api/friends/${friend._id}`, null, { silent: true });
    uni.showToast({ title: '已删除好友', icon: 'success' });
    // 强刷通讯录；被删会话已由服务端软隐藏，静默强刷会话列表保持一致
    await contactsStore.fetchContacts({ force: true });
    chatStore.fetchConversations({ force: true });
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('删除好友失败:', e);
  }
};

// ========== 发起群聊 ==========
const openGroupModal = () => {
  groupName.value = '';
  selectedIds.value = [];
  showGroupModal.value = true;
};

const toggleMember = (id) => {
  const i = selectedIds.value.indexOf(id);
  if (i > -1) selectedIds.value.splice(i, 1);
  else selectedIds.value.push(id);
};

const createGroup = async () => {
  if (!groupName.value.trim()) {
    uni.showToast({ title: '请填写群名称', icon: 'none' });
    return;
  }
  if (!selectedIds.value.length) {
    uni.showToast({ title: '请选择群成员', icon: 'none' });
    return;
  }
  try {
    const res = await post('/api/conversations/group', {
      name: groupName.value.trim(),
      memberIds: selectedIds.value
    });
    if (res.code === 201) {
      showGroupModal.value = false;
      uni.showToast({ title: '群聊创建成功', icon: 'success' });
      const conv = res.data;
      setTimeout(() => {
        uni.navigateTo({
          url: `/pages/chat/detail?conversationId=${conv._id}&type=GROUP&name=${encodeURIComponent(conv.name)}`
        });
      }, 500);
    }
  } catch (e) {
    // 失败提示已由请求层统一处理
    console.error('创建群聊失败:', e);
  }
};

// ========== 好友资料卡片 ==========
const openFriendCard = (friend) => {
  cardFriend.value = friend;
  remarkInput.value = friend.remark || '';
  showCardModal.value = true;
};

const saveRemark = async () => {
  const remark = remarkInput.value.trim();
  try {
    const res = await put(`/api/friends/${cardFriend.value._id}/remark`, { remark }, { silent: true });
    if (res.code === 200) {
      contactsStore.setRemark(cardFriend.value._id, remark);
      uni.showToast({ title: '备注已保存', icon: 'success' });
    }
  } catch (e) {
    console.error('保存备注失败:', e);
  }
};

// 从资料卡发消息：关闭卡片后按备注优先的名称进入会话
const cardStartChat = () => {
  const f = cardFriend.value;
  showCardModal.value = false;
  startChat(f);
};

// 从资料卡删除好友：关闭卡片后走统一确认弹窗
const cardDeleteFriend = () => {
  const f = cardFriend.value;
  showCardModal.value = false;
  pendingDeleteFriend.value = f;
  showDeleteModal.value = true;
};
</script>

<style scoped>
.contacts-page {
  min-height: 100vh;
}

/* 区块 */
.section {
  margin-top: 20rpx;
  background: var(--color-card);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 28rpx;
  margin-left: 24rpx;
  margin-right: 24rpx;
  padding: 28rpx;
  box-shadow: var(--shadow-card);
  border: 1rpx solid var(--glass-border);
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

/* 发起群聊入口 */
.group-entry {
  margin-top: 20rpx;
}

.group-entry-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.group-entry-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 24rpx;
  background: var(--gradient-cool);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 16rpx rgba(129, 140, 248, 0.3);
  flex-shrink: 0;
}

.group-entry-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.group-entry-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.group-entry-sub {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  margin-top: 4rpx;
}

/* 好友资料卡片 */
.card-head {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.card-name {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-top: 20rpx;
}

.card-handle {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  margin-top: 4rpx;
}

.card-status-wrap {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 12rpx;
}

.card-status-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.card-status-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 8rpx rgba(52, 211, 153, 0.5);
}

.card-status-text {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.card-body {
  display: flex;
  flex-direction: column;
}

.card-field {
  display: flex;
  flex-direction: column;
}

.card-field-label {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  margin-bottom: 8rpx;
}

.card-field-value {
  font-size: 28rpx;
  color: var(--color-text-primary);
  background: var(--color-bg);
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  line-height: 1.5;
}

.card-remark-input {
  height: 76rpx;
  background: var(--color-bg);
  border-radius: 16rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: var(--color-text-primary);
  border: 2rpx solid transparent;
  transition: all 0.2s ease;
}

.card-remark-input:focus {
  border-color: var(--color-primary);
  background: var(--color-card-solid);
}

.card-remark-placeholder {
  color: var(--color-text-tertiary);
}

.card-save {
  margin-top: 16rpx;
  align-self: flex-end;
  padding: 10rpx 28rpx;
  background: var(--color-bg);
  border-radius: 999rpx;
}

.card-save:active {
  transform: scale(0.95);
}

.card-save-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary);
}

.card-actions {
  display: flex;
  gap: 24rpx;
}

.card-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-btn-chat {
  background: var(--gradient-primary);
  box-shadow: 0 6rpx 18rpx rgba(255, 107, 107, 0.3);
}

.card-btn-chat:active {
  transform: scale(0.96);
}

.card-btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #FFFFFF;
}

.card-btn-danger {
  background: var(--color-bg);
}

.card-btn-danger:active {
  transform: scale(0.96);
}

.card-btn-text-danger {
  color: var(--color-error);
}

/* 发起群聊弹窗 */
.group-name-wrap {
  margin-bottom: 20rpx;
}

.group-name-input {
  width: 100%;
  height: 84rpx;
  background: var(--color-bg);
  border-radius: 16rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  color: var(--color-text-primary);
  border: 2rpx solid transparent;
  transition: all 0.2s ease;
}

.group-name-input:focus {
  border-color: var(--color-primary);
  background: var(--color-card-solid);
}

.group-name-placeholder {
  color: var(--color-text-tertiary);
}

.group-hint {
  margin-bottom: 12rpx;
}

.group-hint-text {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.group-member-list {
  max-height: 420rpx;
}

.group-member-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 14rpx 8rpx;
  border-radius: 16rpx;
}

.group-member-item:active {
  background: var(--color-bg);
}

.group-member-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-circle {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 3rpx solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.check-circle.checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

/* 好友列表 */
.friend-list {
  display: flex;
  flex-direction: column;
}

/* 字母分组容器 */
.friend-group {
  display: flex;
  flex-direction: column;
}

/* 分组字母徽章：滚动时吸顶 */
.group-letter-badge {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-quote-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 8rpx 20rpx;
  border-radius: 10rpx;
  margin-bottom: 4rpx;
}

.group-letter-text {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--color-text-secondary);
  letter-spacing: 2rpx;
}

/* 右侧字母索引条：垂直居中悬浮，点击跳组 */
.letter-index {
  position: fixed;
  right: 6rpx;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 10rpx 6rpx;
  background: var(--color-nav);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 999rpx;
  border: 1rpx solid var(--glass-border);
  box-shadow: var(--shadow-sm);
  z-index: 50;
}

.letter-index-item {
  font-size: 20rpx;
  font-weight: 700;
  color: var(--color-text-tertiary);
  padding: 2rpx 8rpx;
  line-height: 1.4;
}

.letter-index-item:active {
  color: var(--color-primary);
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
