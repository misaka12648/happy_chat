<template>
  <view class="chat-detail">
    <!-- 顶部导航栏 -->
    <view class="nav-bar">
      <view class="nav-back" @click="goBack">
        <uni-icons type="left" size="40rpx" color="#1A1A2E" />
      </view>
      <view class="nav-title-wrap">
        <text class="nav-title">{{ otherNickname || '聊天' }}</text>
        <text class="nav-subtitle" v-if="otherUsername">@{{ otherUsername }}</text>
      </view>
      <view class="nav-placeholder"></view>
    </view>

    <!-- 消息列表 -->
    <scroll-view
      class="message-list"
      scroll-y
      :scroll-into-view="scrollToView"
      @scrolltoupper="loadMoreMessages"
    >
      <view v-if="hasMore" class="load-more">
        <text class="load-more-text" @click="loadMoreMessages">加载更多</text>
      </view>
      
      <view
        v-for="(msg, index) in messages"
        :key="msg._id"
        :id="'msg-' + msg._id"
        class="message-item"
        :class="{ 'message-self': msg.sender._id === currentUserId }"
      >
        <!-- 时间分隔 -->
        <view v-if="showTimeDivider(index)" class="time-divider">
          <view class="time-badge">
            <text class="time-text">{{ formatMessageTime(msg.createdAt) }}</text>
          </view>
        </view>

        <!-- 撤回消息提示 -->
        <view v-if="msg.recalled" class="recall-notice">
          <text class="recall-text">{{ getRecallText(msg) }}</text>
          <text v-if="canEditRecalled(msg)" class="recall-edit" @click="doEditRecalled(msg)">编辑</text>
        </view>

        <!-- 消息行：头像两侧，气泡靠头像 -->
        <view v-else class="message-row">
          <AppAvatar
            :src="msgAvatarUrl(msg)"
            :background="msg.sender._id === currentUserId ? selfAvatarGradient : getAvatarGradient(msg.sender)"
            :text="msg.sender._id === currentUserId ? selfAvatarText : getAvatarText(msg.sender)"
            size="72rpx"
            radius="20rpx"
            font-size="28rpx"
            shadow="0 4rpx 12rpx rgba(0, 0, 0, 0.1)"
          />

          <view class="bubble" :class="{ 'bubble-self': msg.sender._id === currentUserId }" @longpress="onLongPress($event, msg)">
            <!-- 回复引用块 -->
            <view v-if="msg.replyInfo && msg.replyInfo.messageId" class="reply-quote" @click="scrollToMessage(msg.replyInfo.messageId)">
              <uni-icons type="undo" size="24rpx" :color="msg.sender._id === currentUserId ? 'rgba(255, 255, 255, 0.6)' : '#9CA3AF'" />
              <view class="reply-content">
                <text class="reply-sender">{{ msg.replyInfo.senderName }}</text>
                <text class="reply-preview">{{ getReplyPreview(msg.replyInfo) }}</text>
              </view>
            </view>

            <!-- 消息内容（可折叠） -->
            <view class="bubble-content" :class="{ 'bubble-collapsed': isCollapsed(msg._id) }">
              <text v-if="msg.type === 'TEXT'" class="bubble-text">{{ msg.content }}</text>
              <image
                v-else-if="msg.type === 'IMAGE'"
                class="bubble-image"
                :src="getMediaUrl(msg.thumbnailUrl || msg.mediaUrl)"
                mode="widthFix"
                @click="previewImage(msg.mediaUrl)"
              />
              <video
                v-else-if="msg.type === 'VIDEO'"
                class="bubble-video"
                :src="getMediaUrl(msg.mediaUrl)"
                controls
              />
              <!-- 富文本消息：图片+文字混合，链接可点击跳转 -->
              <view v-else-if="msg.type === 'RICH'" class="bubble-rich">
                <template v-for="(block, blockIdx) in (msg.contentBlocks || [])" :key="blockIdx">
                  <view v-if="block.blockType === 'text'" class="rich-text-block">
                    <template v-for="(part, partIdx) in parseTextWithLinks(block.content)" :key="partIdx">
                      <text v-if="part.type === 'text'" class="bubble-text">{{ part.content }}</text>
                      <text v-else class="bubble-link" @click="openLink(part.content)">{{ part.content }}</text>
                    </template>
                  </view>
                  <image
                    v-else-if="block.blockType === 'image'"
                    class="bubble-image"
                    :src="getMediaUrl(block.thumbnailUrl || block.url)"
                    mode="widthFix"
                    @click="previewImage(block.url)"
                  />
                </template>
              </view>
            </view>

            <!-- 折叠/展开按钮 -->
            <text v-if="isCollapsible(msg._id)" class="collapse-toggle" @click="toggleCollapse(msg._id)">
              {{ isCollapsed(msg._id) ? '展开' : '折叠' }}
            </text>
          </view>

          <!-- 发送状态：失败可点重发 / 发送中 spinner（仅自己的消息） -->
          <view
            v-if="msg.sender._id === currentUserId && msg.status === 'failed'"
            class="msg-status msg-status-failed"
            @click="resendMessage(msg)"
          >
            <text class="msg-status-icon">!</text>
          </view>
          <view
            v-else-if="msg.sender._id === currentUserId && msg.status === 'sending'"
            class="msg-status msg-status-sending"
          >
            <view class="msg-status-spinner"></view>
          </view>
        </view>
      </view>
      <view id="msg-bottom" class="msg-bottom"></view>
    </scroll-view>

    <!-- 长按上下文菜单 -->
    <view v-if="contextMenuMsg" class="menu-overlay" @click="closeContextMenu">
      <view class="context-menu" :style="menuStyle" @click.stop>
        <view class="menu-item" @click="doReply(contextMenuMsg)">回复</view>
        <view v-if="canRecall(contextMenuMsg)" class="menu-item danger" @click="doRecall(contextMenuMsg)">撤回</view>
      </view>
    </view>

    <!-- 回复引用栏 -->
    <view v-if="replyToMsg" class="reply-bar">
      <view class="reply-bar-content">
        <text class="reply-bar-name">{{ replyToMsg.sender.nickname || replyToMsg.sender.username }}</text>
        <text class="reply-bar-text">{{ getReplyPreview(replyToMsg) }}</text>
      </view>
      <view class="reply-bar-close" @click="cancelReply">
        <uni-icons type="closeempty" size="32rpx" color="#9CA3AF" />
      </view>
    </view>

    <!-- 输入栏 -->
    <view class="input-bar">
      <view class="input-actions">
        <view class="action-btn" @click="chooseImage">
          <uni-icons type="camera" size="44rpx" color="#6B7280" />
        </view>
        <view class="action-btn" @click="chooseVideo">
          <uni-icons type="videocam" size="44rpx" color="#6B7280" />
        </view>
      </view>
      <view class="input-wrapper">
        <view
          ref="editorRef"
          class="msg-editor"
          @input="onEditorInput"
        ></view>
      </view>
      <view 
        class="send-btn" 
        :class="{ 'send-btn-active': hasEditorContent }"
        @click="sendMessage"
      >
        <text class="send-text">发送</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { upload } from '@/utils/request';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText, formatMessageTime } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';

const chatStore = useChatStore();
const userStore = useUserStore();

const conversationId = ref('');
const otherUserId = ref('');
const otherNickname = ref('');
const otherUsername = ref('');
const currentUserId = ref('');
const messages = ref([]);
const editorRef = ref(null);
const hasEditorContent = ref(false); // 编辑器是否有内容（控制发送按钮激活）
const scrollToView = ref('');
const hasMore = ref(true);
const page = ref(1);
const selfAvatarText = ref('?');
const selfAvatarGradient = ref('linear-gradient(135deg, #FF6B6B, #FFB88C)');
const contextMenuMsg = ref(null);
const contextMenuPos = ref({ x: 0, y: 0 });
const replyToMsg = ref(null);
const collapsibleMsgs = ref(new Set());
const collapsedMsgs = ref(new Set());
const msgListHeight = ref(0);

// 菜单定位样式
const menuStyle = computed(() => ({
  left: contextMenuPos.value.x + 'px',
  top: contextMenuPos.value.y + 'px'
}));

// 消息头像地址：自己优先取本地用户信息（实时消息 sender 可能未 populate），对方取 sender.avatar
const msgAvatarUrl = (msg) => {
  const avatar = msg.sender._id === currentUserId.value
    ? (userStore.getUserInfo?.avatar || msg.sender.avatar)
    : msg.sender.avatar;
  return avatar ? getMediaUrl(avatar) : '';
};

const previewImage = (url) => {
  uni.previewImage({
    urls: [getMediaUrl(url)]
  });
};

// 解析文本中的 URL 链接，返回 [{type: 'text'|'link', content}] 数组
const parseTextWithLinks = (text) => {
  if (!text) return [{ type: 'text', content: '' }];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'link', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
};

// 打开链接（H5 新窗口打开，非 H5 复制到剪贴板）
const openLink = (url) => {
  // #ifdef H5
  window.open(url, '_blank');
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: url,
    success: () => {
      uni.showToast({ title: '链接已复制', icon: 'none' });
    }
  });
  // #endif
};

const goBack = () => {
  // 固定跳回消息列表页，避免 navigateBack 页面栈不确定导致返回失效
  uni.switchTab({ url: '/pages/chat/list' });
};

// ========== 长按菜单/撤回/回复/折叠 ==========

// 标志位：菜单刚打开时忽略遮罩层点击，防止松手触发的 click 关闭菜单
let menuJustOpened = false;

// 长按消息弹出上下文菜单
const onLongPress = (e, msg) => {
  // #ifdef H5
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  const x = touch?.clientX || e.detail?.x || 0;
  const y = touch?.clientY || e.detail?.y || 0;
  const menuW = 80;
  const menuH = msg.sender._id === currentUserId.value && canRecall(msg) ? 100 : 50;
  const posX = Math.min(x - menuW / 2, window.innerWidth - menuW - 10);
  const posY = Math.min(y - menuH - 10, window.innerHeight - menuH - 10);
  contextMenuPos.value = { x: Math.max(10, posX), y: Math.max(10, posY) };
  contextMenuMsg.value = msg;
  menuJustOpened = true;
  setTimeout(() => { menuJustOpened = false; }, 300);
  // #endif
};

// 关闭上下文菜单（忽略菜单刚打开后 300ms 内的点击）
const closeContextMenu = () => {
  if (menuJustOpened) return;
  contextMenuMsg.value = null;
};

// 是否可以撤回（自己的消息 + 5分钟内 + 未撤回）
const canRecall = (msg) => {
  if (!msg || msg.sender._id !== currentUserId.value || msg.recalled) return false;
  return Date.now() - new Date(msg.createdAt).getTime() < 5 * 60 * 1000;
};

// 执行撤回
const doRecall = (msg) => {
  contextMenuMsg.value = null;
  wsClient.recallMessage(msg._id, conversationId.value, otherUserId.value);
};

// 执行回复
const doReply = (msg) => {
  contextMenuMsg.value = null;
  replyToMsg.value = msg;
  // #ifdef H5
  const el = getEditorEl();
  if (el) el.focus();
  // #endif
};

// 取消回复
const cancelReply = () => {
  replyToMsg.value = null;
};

// 是否可以编辑撤回的消息（自己发送 + 已撤回 + 撤回后5分钟内 + TEXT或RICH类型）
const canEditRecalled = (msg) => {
  if (!msg || !msg.recalled || msg.sender._id !== currentUserId.value) return false;
  if (!msg.recalledAt) return false;
  if (msg.type !== 'TEXT' && msg.type !== 'RICH') return false;
  return Date.now() - new Date(msg.recalledAt).getTime() < 5 * 60 * 1000;
};

// 编辑撤回的消息：将原始内容回显到编辑器
const doEditRecalled = (msg) => {
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  el.innerHTML = '';
  if (msg.type === 'TEXT') {
    el.textContent = msg.content;
  } else if (msg.type === 'RICH' && msg.contentBlocks) {
    msg.contentBlocks.forEach(block => {
      if (block.blockType === 'text') {
        el.appendChild(document.createTextNode(block.content));
      } else if (block.blockType === 'image') {
        const img = document.createElement('img');
        const imgUrl = getMediaUrl(block.thumbnailUrl || block.url);
        img.src = imgUrl;
        img.className = 'editor-img';
        img.dataset.url = imgUrl;
        img.dataset.uploaded = 'true';
        el.appendChild(img);
        el.appendChild(document.createElement('br'));
      }
    });
  }
  hasEditorContent.value = true;
  el.focus();
  // #endif
};

// 收到撤回通知
const onMessageRecalled = (data) => {
  if (data.conversationId === conversationId.value) {
    const msg = messages.value.find(m => m._id === data.messageId);
    if (msg) {
      msg.recalled = true;
      msg.recalledAt = data.recalledAt;
      msg.sender = { ...msg.sender, nickname: data.senderName, username: data.senderName };
      checkMessageHeights();
    }
  }
};

// 滚动到指定消息（H5端：如消息未加载则自动翻页加载）
const scrollToMessage = async (msgId) => {
  if (!msgId) return;
  // #ifdef H5
  // 消息已在列表中，直接滚动
  if (messages.value.find(m => m._id === msgId)) {
    doScrollToMessageDom(msgId);
    return;
  }
  // 消息不在当前列表，加载更多页直到找到
  if (!hasMore.value) {
    uni.showToast({ title: '消息不存在', icon: 'none' });
    return;
  }
  uni.showLoading({ title: '正在定位消息…' });
  let found = false;
  while (hasMore.value && !found) {
    page.value++;
    const result = await chatStore.fetchMessages(conversationId.value, page.value);
    if (result) {
      messages.value = [...result.messages, ...messages.value];
      hasMore.value = result.pagination.page < result.pagination.pages;
      if (messages.value.find(m => m._id === msgId)) {
        found = true;
      }
    } else {
      break;
    }
  }
  uni.hideLoading();
  if (found) {
    doScrollToMessageDom(msgId, 200);
  } else {
    uni.showToast({ title: '消息不存在', icon: 'none' });
  }
  // #endif
  // #ifndef H5
  scrollToView.value = '';
  nextTick(() => {
    scrollToView.value = 'msg-' + msgId;
  });
  // #endif
};

// H5端 DOM 滚动 + 高亮（高亮在滚动停止后执行）
let scrollEndTimer = null;
const doScrollToMessageDom = (msgId, delay = 0) => {
  const fn = () => {
    const el = document.getElementById('msg-' + msgId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 监听滚动容器，滚动停止后再高亮
    const container = document.querySelector('.message-list .uni-scroll-view') || document.querySelector('.message-list');
    if (!container) return;
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    const onScroll = () => {
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        container.removeEventListener('scroll', onScroll);
        el.classList.add('msg-highlight');
        setTimeout(() => el.classList.remove('msg-highlight'), 1500);
      }, 150);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    // 兜底：如果 smooth 动画未触发 scroll 事件，2秒后强制高亮
    setTimeout(() => {
      container.removeEventListener('scroll', onScroll);
      if (!el.classList.contains('msg-highlight')) {
        el.classList.add('msg-highlight');
        setTimeout(() => el.classList.remove('msg-highlight'), 1500);
      }
    }, 2000);
  };
  if (delay > 0) {
    setTimeout(fn, delay);
  } else {
    nextTick(fn);
  }
};

// 获取回复预览文本
const getReplyPreview = (replyInfo) => {
  if (!replyInfo) return '';
  if (replyInfo.type === 'IMAGE') return '[图片]';
  if (replyInfo.type === 'VIDEO') return '[视频]';
  if (replyInfo.type === 'RICH' && replyInfo.contentBlocks) {
    return replyInfo.contentBlocks.map(b => {
      if (b.blockType === 'image') return '[图片]';
      return b.content;
    }).join(' ').replace(/\n/g, ' ').slice(0, 50);
  }
  return replyInfo.content || '';
};

// 获取撤回提示文本
const getRecallText = (msg) => {
  const name = msg.sender.nickname || msg.sender.username || '用户';
  return name + '撤回了一条消息';
};

// 构建回复引用快照
const buildReplyInfo = (msg) => {
  return {
    messageId: msg._id,
    senderName: msg.sender.nickname || msg.sender.username || '',
    type: msg.type,
    content: msg.content || '',
    contentBlocks: msg.contentBlocks || [],
    mediaUrl: msg.mediaUrl || '',
    thumbnailUrl: msg.thumbnailUrl || ''
  };
};

// 检查消息高度，超出的标记为可折叠
const checkMessageHeights = () => {
  // #ifdef H5
  nextTick(() => {
    if (!msgListHeight.value) {
      const list = document.querySelector('.message-list');
      if (list) msgListHeight.value = list.clientHeight;
    }
    const maxH = msgListHeight.value * 0.8;
    if (maxH <= 0) return;
    // 设置 CSS 变量供折叠样式使用
    document.documentElement.style.setProperty('--msg-max-h', maxH + 'px');
    messages.value.forEach(msg => {
      if (msg.recalled) return;
      const el = document.getElementById('msg-' + msg._id);
      if (!el) return;
      const content = el.querySelector('.bubble-content');
      if (!content) return;
      if (content.scrollHeight > maxH) {
        collapsibleMsgs.value.add(msg._id);
        collapsedMsgs.value.add(msg._id);
      }
    });
  });
  // #endif
};

// 切换折叠状态
const toggleCollapse = (msgId) => {
  const newSet = new Set(collapsedMsgs.value);
  if (newSet.has(msgId)) {
    newSet.delete(msgId);
  } else {
    newSet.add(msgId);
  }
  collapsedMsgs.value = newSet;
};

// 是否可折叠
const isCollapsible = (id) => collapsibleMsgs.value.has(id);

// 是否已折叠
const isCollapsed = (id) => collapsedMsgs.value.has(id);

onMounted(async () => {
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  const options = currentPage.$page?.options || currentPage.options || {};

  conversationId.value = options.conversationId;
  otherUserId.value = options.userId;
  otherNickname.value = decodeURIComponent(options.nickname || '');
  otherUsername.value = decodeURIComponent(options.username || '');

  const userInfo = userStore.getUserInfo;
  currentUserId.value = userInfo?._id || '';
  selfAvatarText.value = (userInfo?.nickname || userInfo?.username || '?').charAt(0).toUpperCase();

  uni.setNavigationBarTitle({ title: otherNickname.value });

  // 缓存优先：有缓存则立即渲染（秒开、无加载等待），再后台静默校验补齐离开期间的新消息
  const cached = chatStore.getCachedMessages(conversationId.value);
  if (cached && cached.messages.length) {
    messages.value = [...cached.messages];
    page.value = cached.page;
    hasMore.value = cached.hasMore;
    nextTick(() => {
      scrollToBottom();
      checkMessageHeights();
    });
    revalidateMessages();
  } else {
    await loadMessages(true);
  }
  await chatStore.markConversationAsRead(conversationId.value);

  wsClient.on('NEW_MESSAGE', onNewMessage);
  wsClient.on('MESSAGE_SENT', onMessageSent);
  wsClient.on('RECONNECTED', onReconnected);
  wsClient.on('MESSAGE_RECALLED', onMessageRecalled);

  // #ifdef H5
  nextTick(() => {
    const el = getEditorEl();
    if (el) {
      el.contentEditable = 'true';
      el.dataset.placeholder = '输入消息，可粘贴图片…';
      el.addEventListener('paste', handleEditorPaste);
      el.addEventListener('keydown', handleEditorKeyDown);
    }
  });
  // #endif

  // #ifdef H5
  nextTick(() => {
    const list = document.querySelector('.message-list');
    if (list) msgListHeight.value = list.clientHeight;
  });
  // #endif
});

onUnmounted(() => {
  wsClient.off('NEW_MESSAGE', onNewMessage);
  wsClient.off('MESSAGE_SENT', onMessageSent);
  wsClient.off('RECONNECTED', onReconnected);
  wsClient.off('MESSAGE_RECALLED', onMessageRecalled);
  // 清理所有待确认的 ACK 超时，防止卸载后回调操作已销毁的状态
  pendingTimers.forEach(t => clearTimeout(t));
  pendingTimers.clear();
  // 缓存本会话消息记录（含分页游标），下次进入可秒开、无需重新请求
  chatStore.leaveConversation(conversationId.value, {
    messages: messages.value,
    page: page.value,
    hasMore: hasMore.value
  });
  // #ifdef H5
  const el = getEditorEl();
  if (el) {
    el.removeEventListener('paste', handleEditorPaste);
    el.removeEventListener('keydown', handleEditorKeyDown);
    // 清理编辑器内未发送的图片 object URL
    el.querySelectorAll('img.editor-img').forEach(img => {
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    });
  }
  // #endif
});

// WebSocket 重连后补拉断连期间错过的消息
const onReconnected = async () => {
  if (!conversationId.value) return;
  // loadMessages(true) 会清空 messages，先快照未完成的本地消息，重载后回填并自动重发
  const pending = messages.value.filter(m => m.status === 'sending' || m.status === 'failed');
  await loadMessages(true);
  pending.forEach(m => {
    // 若断连期间其实已入库，服务器历史已含该消息（同 clientId），跳过避免重复
    if (m.clientId && messages.value.some(x => x.clientId && x.clientId === m.clientId)) return;
    messages.value.push(m);
    m.status = 'failed';
    resendMessage(m);
  });
};

const onNewMessage = (msg) => {
  if (msg.conversationId === conversationId.value) {
    messages.value.push(msg);
    scrollToBottom();
    chatStore.markConversationAsRead(conversationId.value);
    checkMessageHeights();
  }
};

const onMessageSent = (msg) => {
  if (msg.conversationId === conversationId.value) {
    // 收到确认，清除对应 ACK 超时
    if (msg.clientId && pendingTimers.has(msg.clientId)) {
      clearTimeout(pendingTimers.get(msg.clientId));
      pendingTimers.delete(msg.clientId);
    }
    // 优先用 clientId 精确匹配临时消息；后端未升级时兜底沿用 content 匹配
    let tempIndex = msg.clientId
      ? messages.value.findIndex(m => m.clientId && m.clientId === msg.clientId)
      : -1;
    if (tempIndex === -1) {
      if (msg.type === 'RICH') {
        tempIndex = messages.value.findIndex(m =>
          m._id.startsWith('temp-rich-') &&
          m.sender._id === msg.sender._id
        );
      } else {
        tempIndex = messages.value.findIndex(m =>
          m._id.startsWith('temp-') &&
          m.content === msg.content &&
          m.sender._id === msg.sender._id
        );
      }
    }
    if (tempIndex !== -1) {
      messages.value.splice(tempIndex, 1, msg);
    } else {
      const exists = messages.value.find(m => m._id === msg._id);
      if (!exists) {
        messages.value.push(msg);
      }
    }
    scrollToBottom();
    checkMessageHeights();
  }
};

const loadMessages = async (isFirst = false) => {
  if (isFirst) {
    page.value = 1;
    messages.value = [];
  }
  // 非首次加载：记录加载前的第一条消息 ID，加载后滚回该位置
  const firstMsgId = (!isFirst && messages.value.length > 0) ? messages.value[0]._id : null;
  const result = await chatStore.fetchMessages(conversationId.value, page.value);
  if (result) {
    if (isFirst) {
      messages.value = result.messages;
    } else {
      messages.value = [...result.messages, ...messages.value];
    }
    hasMore.value = result.pagination.page < result.pagination.pages;
    if (isFirst) {
      scrollToBottom();
    } else if (firstMsgId) {
      // 用 scroll-into-view 滚回加载前的第一条消息
      scrollToView.value = '';
      nextTick(() => {
        setTimeout(() => {
          scrollToView.value = 'msg-' + firstMsgId;
        }, 50);
      });
    }
    checkMessageHeights();
  }
};

// 后台静默校验：拉取最新一页并合并离开期间新增/变更的消息（不清空视图，避免闪烁）
const revalidateMessages = async () => {
  const result = await chatStore.fetchMessages(conversationId.value, 1);
  if (!result) return;
  const fresh = result.messages || [];
  if (!fresh.length) return;
  const freshIds = new Set(fresh.map(m => m._id));
  const hasOverlap = messages.value.some(m => freshIds.has(m._id));
  if (!hasOverlap) {
    // 离开期间新增消息过多、与缓存无重叠：以最新一页为准，保留本地未发送的临时消息
    const localPending = messages.value.filter(m => m.status === 'sending' || m.status === 'failed');
    messages.value = [...fresh, ...localPending];
    page.value = 1;
    hasMore.value = result.pagination.page < result.pagination.pages;
    nextTick(() => { scrollToBottom(); checkMessageHeights(); });
    return;
  }
  let appended = false;
  fresh.forEach(fm => {
    const idx = messages.value.findIndex(m => m._id === fm._id);
    if (idx > -1) {
      messages.value.splice(idx, 1, fm); // 同步撤回/编辑等状态变更
    } else {
      messages.value.push(fm); // 离开期间新增的消息
      appended = true;
    }
  });
  if (appended) {
    scrollToBottom();
    checkMessageHeights();
  }
};

const loadMoreMessages = () => {
  if (!hasMore.value) return;
  page.value++;
  loadMessages(false);
};

// ========== 消息发送可靠性：状态机 + ACK 超时 + 重发 ==========
// 待确认消息的 ACK 超时计时器：clientId -> timeoutId
const pendingTimers = new Map();
const genClientId = () => 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

// 启动 ACK 超时：10s 内未收到 MESSAGE_SENT 确认则标记为失败
const startAck = (clientId) => {
  const t = setTimeout(() => {
    const m = messages.value.find(x => x.clientId === clientId);
    if (m && m.status === 'sending') m.status = 'failed';
    pendingTimers.delete(clientId);
  }, 10000);
  pendingTimers.set(clientId, t);
};

// 发送并跟踪确认：未连接立即失败，已发出则启动 ACK 超时（重发复用同一 msg，不重复 push）
const sendWithAck = (msg, send) => {
  msg.status = 'sending';
  if (!send(msg.clientId)) {
    msg.status = 'failed';
    return;
  }
  startAck(msg.clientId);
};

// 重发失败消息：复用原 msg（含 clientId），后端据 clientId 幂等去重
const resendMessage = (msg) => {
  if (!msg || msg.status !== 'failed') return;
  const replyInfo = msg.replyInfo || null;
  if (msg.type === 'IMAGE') {
    sendWithAck(msg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, msg.content, 'IMAGE', msg.mediaUrl, msg.thumbnailUrl || '', [], replyInfo, cid));
  } else if (msg.type === 'VIDEO') {
    sendWithAck(msg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, msg.content, 'VIDEO', msg.mediaUrl, '', [], replyInfo, cid));
  } else if (msg.type === 'RICH') {
    sendWithAck(msg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, '[富文本]', 'RICH', '', '', msg.contentBlocks || [], replyInfo, cid));
  } else {
    sendWithAck(msg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, msg.content, 'TEXT', '', '', [], replyInfo, cid));
  }
};

const sendTextMessage = (content, replyInfo = null) => {
  if (!content || !content.trim()) return;
  content = content.trim();

  // 创建临时消息即时显示
  const tempMsg = {
    _id: 'temp-' + Date.now(),
    clientId: genClientId(),
    status: 'sending',
    conversationId: conversationId.value,
    sender: { _id: currentUserId.value },
    receiver: { _id: otherUserId.value },
    type: 'TEXT',
    content,
    replyInfo,
    createdAt: new Date().toISOString()
  };
  messages.value.push(tempMsg);
  scrollToBottom();

  // 发送消息（服务器确认后 onMessageSent 会替换临时消息；未连接/超时则标记失败可重发）
  sendWithAck(tempMsg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, content, 'TEXT', '', '', [], replyInfo, cid));
};

// 发送图片（上传 + WebSocket 发送 + 临时消息），相册选图与粘贴复用
const sendImage = async (filePath) => {
  const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;
  replyToMsg.value = null;
  uni.showLoading({ title: '上传中...' });
  try {
    const uploadRes = await upload('/api/upload', filePath);
    uni.hideLoading();
    if (uploadRes.code === 200) {
      const tempMsg = {
        _id: 'temp-img-' + Date.now(),
        clientId: genClientId(),
        status: 'sending',
        conversationId: conversationId.value,
        sender: { _id: currentUserId.value },
        type: 'IMAGE',
        mediaUrl: uploadRes.data.url,
        thumbnailUrl: uploadRes.data.thumbnailUrl,
        content: '[图片]',
        replyInfo,
        createdAt: new Date().toISOString()
      };
      messages.value.push(tempMsg);
      scrollToBottom();
      sendWithAck(tempMsg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, '[图片]', 'IMAGE', uploadRes.data.url, uploadRes.data.thumbnailUrl, [], replyInfo, cid));
    }
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: e.message || '上传失败', icon: 'none' });
  }
};

const chooseImage = () => {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: (res) => {
      sendImage(res.tempFilePaths[0]);
    }
  });
};

// ========== 富文本编辑器（H5） ==========

// 获取编辑器 DOM 元素
const getEditorEl = () => {
  // #ifdef H5
  return editorRef.value?.$el || editorRef.value;
  // #endif
  return null;
};

// 编辑器内容变化时更新发送按钮状态
const onEditorInput = () => {
  const el = getEditorEl();
  if (!el) return;
  hasEditorContent.value = el.textContent.trim() !== '' || el.querySelector('img');
};

// 粘贴处理：图片插入编辑器，纯文本不拦截
const handleEditorPaste = (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        const url = URL.createObjectURL(file);
        insertImageToEditor(url);
      }
      return;
    }
  }
};

// 在光标位置插入图片
const insertImageToEditor = (url) => {
  const el = getEditorEl();
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.deleteContents();

  const img = document.createElement('img');
  img.src = url;
  img.className = 'editor-img';
  img.dataset.url = url;
  range.insertNode(img);

  // 图片后插入换行，光标移到换行后
  const br = document.createElement('br');
  range.setStartAfter(img);
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }

  hasEditorContent.value = true;
};

// 键盘事件：Enter 发送，Ctrl+Enter / Shift+Enter 换行
const handleEditorKeyDown = (e) => {
  if (e.key === 'Enter') {
    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      // 直接插入 <br>，避免 execCommand 在不同浏览器产生 <div><br></div> 导致双倍换行
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      onEditorInput();
    } else {
      e.preventDefault();
      sendMessage();
    }
  }
};

// 提取编辑器内容：返回有序内容块数组（保留文字和图片的顺序）
const getEditorContent = () => {
  const el = getEditorEl();
  if (!el) return { blocks: [], hasContent: false };

  const blocks = [];

  const walk = (node) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) {
        const text = child.textContent;
        if (text) blocks.push({ blockType: 'text', content: text });
      } else if (child.nodeName === 'IMG') {
        blocks.push({ blockType: 'image', url: child.dataset.url || child.src, uploaded: child.dataset.uploaded === 'true' });
      } else if (child.nodeName === 'BR') {
        blocks.push({ blockType: 'text', content: '\n' });
      } else if (child.nodeName === 'DIV') {
        // div 是块级元素，前面有内容时先加换行（不在 div 后加，避免 div 内 br 产生多余换行）
        if (blocks.length > 0) {
          const last = blocks[blocks.length - 1];
          if (!(last.blockType === 'text' && last.content === '\n')) {
            blocks.push({ blockType: 'text', content: '\n' });
          }
        }
        walk(child);
      } else {
        walk(child);
      }
    });
  };
  walk(el);

  // 合并连续文本块
  const merged = [];
  for (const block of blocks) {
    if (block.blockType === 'text' && merged.length > 0 && merged[merged.length - 1].blockType === 'text') {
      merged[merged.length - 1].content += block.content;
    } else {
      merged.push({ ...block });
    }
  }

  // 合并连续换行为单个换行（避免 div+br 产生多余空行）
  for (const block of merged) {
    if (block.blockType === 'text') {
      block.content = block.content.replace(/\n{2,}/g, '\n');
    }
  }

  // 去除每个文本块首尾换行，过滤空文本块
  const filtered = merged
    .map(b => b.blockType === 'text' ? { ...b, content: b.content.replace(/^\n+/, '').replace(/\n+$/, '') } : b)
    .filter(b => !(b.blockType === 'text' && !b.content.trim()));

  return { blocks: filtered, hasContent: filtered.length > 0 };
};

// 统一发送入口：图片和文字合并为一条消息发送
const sendMessage = async () => {
  const { blocks, hasContent } = getEditorContent();
  if (!hasContent) return;

  // 构建回复引用快照（在清空编辑器前）
  const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;

  // 清空编辑器
  const el = getEditorEl();
  if (el) el.innerHTML = '';
  hasEditorContent.value = false;

  // 清空回复状态
  replyToMsg.value = null;

  const hasImage = blocks.some(b => b.blockType === 'image');

  if (!hasImage) {
    // 纯文本，用 TEXT 类型发送
    const text = blocks.map(b => b.content).join('\n');
    sendTextMessage(text, replyInfo);
    return;
  }

  // 富文本：上传所有图片，合并为一条 RICH 消息
  uni.showLoading({ title: '发送中...' });
  try {
    const contentBlocks = [];
    for (const block of blocks) {
      if (block.blockType === 'image') {
        if (block.uploaded) {
          // 已上传的图片（编辑撤回消息时），直接使用 URL
          contentBlocks.push({
            blockType: 'image',
            url: block.url,
            thumbnailUrl: block.url
          });
        } else {
          const uploadRes = await upload('/api/upload', block.url);
          if (uploadRes.code === 200) {
            contentBlocks.push({
              blockType: 'image',
              url: uploadRes.data.url,
              thumbnailUrl: uploadRes.data.thumbnailUrl
            });
          }
          URL.revokeObjectURL(block.url);
        }
      } else {
        contentBlocks.push({ blockType: 'text', content: block.content });
      }
    }
    uni.hideLoading();

    // 创建临时消息即时显示
    const tempMsg = {
      _id: 'temp-rich-' + Date.now(),
      clientId: genClientId(),
      status: 'sending',
      conversationId: conversationId.value,
      sender: { _id: currentUserId.value },
      receiver: { _id: otherUserId.value },
      type: 'RICH',
      content: '[富文本]',
      contentBlocks,
      replyInfo,
      createdAt: new Date().toISOString()
    };
    messages.value.push(tempMsg);
    scrollToBottom();

    // 发送 RICH 消息（未连接/超时则标记失败可重发）
    sendWithAck(tempMsg, (cid) => wsClient.sendMessage(
      conversationId.value,
      otherUserId.value,
      '[富文本]',
      'RICH', '', '',
      contentBlocks,
      replyInfo,
      cid
    ));
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: e.message || '发送失败', icon: 'none' });
  }
};

const chooseVideo = () => {
  uni.chooseVideo({
    count: 1,
    compressed: true,
    success: async (res) => {
      const filePath = res.tempFilePath;
      uni.showLoading({ title: '上传中...' });
      try {
        const uploadRes = await upload('/api/upload', filePath);
        uni.hideLoading();
        if (uploadRes.code === 200) {
          const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;
          replyToMsg.value = null;
          const tempMsg = {
            _id: 'temp-vid-' + Date.now(),
            clientId: genClientId(),
            status: 'sending',
            conversationId: conversationId.value,
            sender: { _id: currentUserId.value },
            type: 'VIDEO',
            mediaUrl: uploadRes.data.url,
            content: '[视频]',
            replyInfo,
            createdAt: new Date().toISOString()
          };
          messages.value.push(tempMsg);
          scrollToBottom();
          sendWithAck(tempMsg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, '[视频]', 'VIDEO', uploadRes.data.url, '', [], replyInfo, cid));
        }
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: e.message || '上传失败', icon: 'none' });
      }
    }
  });
};

const showTimeDivider = (index) => {
  if (index === 0) return true;
  const prev = new Date(messages.value[index - 1].createdAt);
  const curr = new Date(messages.value[index].createdAt);
  return curr - prev > 300000;
};

const scrollToBottom = () => {
  nextTick(() => {
    scrollToView.value = '';
    setTimeout(() => {
      scrollToView.value = 'msg-bottom';
    }, 100);
  });
};
</script>

<style scoped>
.chat-detail {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}

/* 顶部导航栏 */
.nav-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  padding-top: 0;
  height: 88rpx;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1rpx solid var(--color-border);
}

.nav-back {
  width: 88rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-title-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.nav-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-primary);
  max-width: 400rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-subtitle {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  margin-top: 2rpx;
}

.nav-placeholder {
  width: 88rpx;
  flex-shrink: 0;
}

/* 消息列表 */
.message-list {
  flex: 1;
  padding: 20rpx 24rpx 0;
  padding-top: 108rpx;
  overflow-x: hidden;
  overflow-y: auto;
  box-sizing: border-box;
}

.load-more {
  text-align: center;
  padding: 24rpx 0;
}

.load-more-text {
  font-size: 26rpx;
  color: var(--color-primary);
  padding: 12rpx 32rpx;
  background: rgba(255, 107, 107, 0.1);
  border-radius: 20rpx;
}

/* 时间分隔 */
.time-divider {
  display: flex;
  justify-content: center;
  padding: 24rpx 0;
}

.time-badge {
  background: rgba(0, 0, 0, 0.05);
  padding: 8rpx 24rpx;
  border-radius: 16rpx;
}

.time-text {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

/* 消息项 */
.message-item {
  margin-bottom: 28rpx;
  width: 100%;
}

/* 最后一条消息去掉 margin-bottom，间隙由 .msg-bottom 高度精确控制 */
.message-item:nth-last-child(2) {
  margin-bottom: 0;
}

/* 底部占位：最后一条消息与输入框之间的间隙 */
.msg-bottom {
  height: 24rpx;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  width: 100%;
}

.message-self .message-row {
  flex-direction: row-reverse;
}

/* 发送状态指示（自己的消息，row-reverse 下位于气泡左侧） */
.msg-status {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
}

.msg-status-failed {
  background: var(--color-primary);
  border-radius: 50%;
  box-shadow: 0 2rpx 8rpx rgba(255, 107, 107, 0.4);
}

.msg-status-icon {
  color: #FFFFFF;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 1;
}

.msg-status-spinner {
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: msg-status-spin 1s linear infinite;
}

@keyframes msg-status-spin {
  to { transform: rotate(360deg); }
}

/* 消息气泡 */
.bubble {
  max-width: 60%;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 20rpx;
  padding: 20rpx 28rpx;
  position: relative;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.6);
}

.bubble-self {
  background: linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%);
  border: none;
}

.bubble-text {
  font-size: 30rpx;
  color: var(--color-text-primary);
  word-break: break-all;
  line-height: 1.6;
  white-space: pre-wrap;
}

.bubble-self .bubble-text {
  color: #FFFFFF;
}

.bubble-image {
  max-width: 100%;
  border-radius: 12rpx;
  display: block;
}

.bubble-video {
  width: 400rpx;
  max-width: 100%;
  height: 240rpx;
  border-radius: 12rpx;
}

/* 富文本消息 */
.bubble-rich {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.bubble-link {
  color: #3B82F6;
  text-decoration: underline;
  font-size: 30rpx;
  word-break: break-all;
  line-height: 1.6;
  white-space: pre-wrap;
}

.bubble-self .bubble-link {
  color: #E0F2FE;
}

/* 输入栏 */
.input-bar {
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
  gap: 16rpx;
  padding-bottom: 20rpx;
}

.input-actions {
  display: flex;
  gap: 12rpx;
}

.action-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border-radius: 20rpx;
  transition: all 0.2s ease;
}

.action-btn:active {
  transform: scale(0.95);
  background: var(--color-bg-grey);
}

.input-wrapper {
  flex: 1;
  min-height: 76rpx;
  max-height: 240rpx;
  overflow-y: auto;
  background: var(--color-bg);
  border-radius: 20rpx;
  padding: 0 24rpx;
}

.msg-editor {
  min-height: 76rpx;
  font-size: 28rpx;
  color: var(--color-text-primary);
  line-height: 76rpx;
  outline: none;
  word-break: break-all;
}

/* contenteditable placeholder */
.msg-editor:empty:before {
  content: attr(data-placeholder);
  color: var(--color-text-tertiary);
}

/* 编辑器内粘贴的图片 */
.editor-img {
  max-width: 200rpx;
  max-height: 200rpx;
  border-radius: 12rpx;
  display: block;
  margin: 8rpx 0;
}

/* 发送按钮 */
.send-btn {
  height: 76rpx;
  padding: 0 32rpx;
  background: var(--color-text-tertiary);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.send-btn-active {
  background: var(--gradient-primary);
  box-shadow: 0 4rpx 16rpx rgba(255, 107, 107, 0.3);
}

.send-btn-active:active {
  transform: scale(0.95);
}

.send-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #FFFFFF;
}

/* ========== 长按上下文菜单 ========== */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.01);
}

.context-menu {
  position: fixed;
  background: rgba(50, 50, 52, 0.96);
  border-radius: 16rpx;
  padding: 8rpx 0;
  min-width: 160rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.2);
}

.menu-item {
  padding: 20rpx 32rpx;
  font-size: 28rpx;
  color: #FFFFFF;
  text-align: center;
}

.menu-item:active {
  background: rgba(255, 255, 255, 0.1);
}

.menu-item.danger {
  color: #FF3B30;
}

/* ========== 撤回提示 ========== */
.recall-notice {
  text-align: center;
  padding: 12rpx 0;
  width: 100%;
}

.recall-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

.recall-edit {
  font-size: 24rpx;
  color: var(--color-primary);
  margin-left: 16rpx;
}

/* ========== 回复引用栏（输入框上方） ========== */
.reply-bar {
  display: flex;
  align-items: center;
  padding: 12rpx 24rpx;
  background: rgba(0, 0, 0, 0.03);
  border-top: 1rpx solid var(--color-border);
}

.reply-bar-content {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.reply-bar-name {
  font-size: 24rpx;
  color: var(--color-primary);
  font-weight: 600;
}

.reply-bar-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  margin-left: 12rpx;
}

.reply-bar-close {
  padding: 8rpx 16rpx;
  color: var(--color-text-tertiary);
  font-size: 32rpx;
}

/* ========== 消息内回复引用块 ========== */
.reply-quote {
  display: flex;
  gap: 8rpx;
  padding: 12rpx 16rpx;
  margin-bottom: 8rpx;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 12rpx;
  border-left: 6rpx solid var(--color-text-tertiary);
}

.bubble-self .reply-quote {
  background: rgba(255, 255, 255, 0.15);
  border-left-color: rgba(255, 255, 255, 0.4);
}

.reply-content {
  flex: 1;
  overflow: hidden;
}

.reply-sender {
  font-size: 24rpx;
  color: var(--color-primary);
  font-weight: 600;
  display: block;
}

.bubble-self .reply-sender {
  color: #E0F2FE;
}

.reply-preview {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  display: block;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bubble-self .reply-preview {
  color: rgba(255, 255, 255, 0.7);
}

/* ========== 消息折叠 ========== */
.bubble-content {
  overflow: hidden;
}

.bubble-collapsed {
  max-height: var(--msg-max-h, 50vh);
  overflow: hidden;
}

.collapse-toggle {
  font-size: 24rpx;
  color: var(--color-primary);
  text-align: center;
  padding: 8rpx 0 0;
  display: block;
}

.bubble-self .collapse-toggle {
  color: #E0F2FE;
}

.msg-highlight {
  animation: msgHighlight 1.5s ease-out;
}

@keyframes msgHighlight {
  0% { background-color: rgba(255, 214, 102, 0.4); }
  100% { background-color: transparent; }
}
</style>
