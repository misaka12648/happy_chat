<template>
  <view class="chat-detail">
    <!-- 顶部导航栏 -->
    <view class="nav-bar">
      <view class="nav-back" @click="goBack">
        <uni-icons type="left" size="40rpx" color="var(--color-nav-icon)" />
      </view>
      <view class="nav-title-wrap" @click="isGroup && openGroupInfo()">
        <text class="nav-title">{{ otherNickname || '聊天' }}</text>
        <text class="nav-subtitle" v-if="peerTyping && !isGroup">对方正在输入…</text>
        <text class="nav-subtitle" v-else-if="isGroup">{{ memberCount }} 人 · 群信息</text>
        <text class="nav-subtitle" v-else-if="otherUsername">@{{ otherUsername }}</text>
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

          <view class="bubble-col" :class="{ 'bubble-col-self': msg.sender._id === currentUserId }">
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
              <!-- 语音消息：点击播放/暂停，宽度随时长 -->
              <view
                v-else-if="msg.type === 'VOICE'"
                class="voice-bubble"
                :class="{ 'voice-playing': playingId === msg._id }"
                :style="{ width: voiceWidth(msg.duration) }"
                @click.stop="togglePlayVoice(msg)"
              >
                <uni-icons
                  :type="playingId === msg._id ? 'sound-filled' : 'sound'"
                  size="36rpx"
                  :color="msg.sender._id === currentUserId ? '#FFFFFF' : '#FF6B6B'"
                />
                <text class="voice-duration">{{ msg.duration || 1 }}"</text>
                <view class="voice-wave">
                  <view class="voice-wave-bar" v-for="n in 4" :key="n"></view>
                </view>
              </view>
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

            <!-- 送达 / 已读回执（仅私聊中自己的消息，确认后显示；群聊无回执） -->
            <transition name="fade" :duration="{ enter: 200, leave: 200 }">
              <text
                v-if="!isGroup && msg.sender._id === currentUserId && msg.status !== 'sending' && msg.status !== 'failed'"
                class="msg-read-tag"
                :class="{ 'msg-read-tag--read': msg.read }"
              >{{ msg.read ? '已读' : '送达' }}</text>
            </transition>
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

    <!-- 回到底部 / 新消息提示 -->
    <transition name="pop" :duration="{ enter: 200, leave: 150 }">
      <view v-if="!isAtBottom" class="scroll-bottom-btn" @click="scrollToBottomManual">
        <text class="scroll-bottom-text">{{ newCount > 0 ? `↓ ${newCount} 条新消息` : '回到底部 ↓' }}</text>
      </view>
    </transition>

    <!-- 长按上下文菜单 -->
    <transition name="menu" :duration="{ enter: 180, leave: 150 }">
      <view v-if="contextMenuMsg" class="menu-overlay" @click="closeContextMenu">
        <view class="context-menu" :style="menuStyle" @click.stop>
          <view class="menu-item" @click="doReply(contextMenuMsg)">回复</view>
          <view class="menu-item" @click="doForward(contextMenuMsg)">转发</view>
          <view v-if="canRecall(contextMenuMsg)" class="menu-item danger" @click="doRecall(contextMenuMsg)">撤回</view>
        </view>
      </view>
    </transition>

    <!-- 转发弹窗：选择目标会话 -->
    <BaseModal
      v-model:visible="showForwardModal"
      title="转发给"
      width="600rpx"
      :show-cancel="false"
      confirm-text="取消"
      @confirm="showForwardModal = false"
    >
      <scroll-view scroll-y class="forward-list">
        <view
          v-for="c in forwardTargets"
          :key="c._id"
          class="forward-item"
          @click="confirmForward(c)"
        >
          <AppAvatar
            v-if="c.type === 'GROUP'"
            :background="getAvatarGradient({ nickname: c.name })"
            :text="(c.name || '群').charAt(0)"
            size="72rpx"
            radius="50%"
            font-size="28rpx"
            shadow="none"
          />
          <AppAvatar
            v-else
            :src="getMediaUrl(c.otherUser && c.otherUser.avatar)"
            :background="getAvatarGradient(c.otherUser || {})"
            :text="getAvatarText(c.otherUser || {})"
            size="72rpx"
            radius="50%"
            font-size="28rpx"
            shadow="none"
          />
          <text class="forward-name">{{ c.type === 'GROUP' ? (c.name || '群聊') : ((c.otherUser && (c.otherUser.remark || c.otherUser.nickname || c.otherUser.username)) || '') }}</text>
          <uni-icons type="forward" size="20" color="var(--color-icon-muted)" />
        </view>
        <view v-if="!forwardTargets.length" class="forward-empty">
          <text class="forward-empty-text">暂无其他会话</text>
        </view>
      </scroll-view>
    </BaseModal>

    <!-- 群信息弹窗 -->
    <BaseModal
      v-model:visible="showGroupModal"
      title="群信息"
      width="620rpx"
      confirm-text="完成"
      @confirm="showGroupModal = false"
    >
      <view class="gi-section" v-if="groupInfo.owner === currentUserId">
        <text class="gi-label">群名称</text>
        <input class="gi-name-input" v-model="groupNameDraft" maxlength="30" placeholder="群名称" placeholder-class="gi-placeholder" />
        <view class="gi-mini-btn" @click="saveGroupName"><text class="gi-mini-btn-text">保存群名</text></view>
      </view>
      <view class="gi-section">
        <text class="gi-label">成员（{{ groupInfo.members ? groupInfo.members.length : 0 }}）</text>
        <scroll-view scroll-y class="gi-members">
          <view v-for="m in (groupInfo.members || [])" :key="m._id" class="gi-member">
            <AppAvatar :src="getMediaUrl(m.avatar)" :text="getAvatarText(m)" :background="getAvatarGradient(m)" size="64rpx" radius="50%" font-size="24rpx" shadow="none" />
            <text class="gi-member-name">{{ m.nickname || m.username }}</text>
            <text v-if="m._id === groupInfo.owner" class="gi-owner-badge">群主</text>
          </view>
        </scroll-view>
      </view>
      <template #footer>
        <view class="gi-actions">
          <view v-if="groupInfo.owner === currentUserId" class="gi-btn gi-btn-danger" @click="disbandGroup">
            <text class="gi-btn-text gi-btn-text-danger">解散群聊</text>
          </view>
          <view v-else class="gi-btn gi-btn-danger" @click="quitGroup">
            <text class="gi-btn-text gi-btn-text-danger">退出群聊</text>
          </view>
          <view class="gi-btn gi-btn-primary" @click="showGroupModal = false">
            <text class="gi-btn-text">完成</text>
          </view>
        </view>
      </template>
    </BaseModal>

    <!-- 回复引用栏 -->
    <view v-if="replyToMsg" class="reply-bar">
      <view class="reply-bar-content">
        <text class="reply-bar-name">{{ replyToMsg.sender.nickname || replyToMsg.sender.username }}</text>
        <text class="reply-bar-text">{{ getReplyPreview(replyToMsg) }}</text>
      </view>
      <view class="reply-bar-close" @click="cancelReply">
        <uni-icons type="closeempty" size="32rpx" color="var(--color-icon-muted)" />
      </view>
    </view>

    <!-- 录音状态条 -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="isRecording" class="recording-bar">
      <view class="recording-indicator">
        <view class="recording-dot"></view>
        <text class="recording-time">{{ recordingSeconds }}s</text>
      </view>
      <text class="recording-hint">点击麦克风结束并发送</text>
      <view class="recording-cancel" @click="cancelRecording">
        <text class="recording-cancel-text">取消</text>
      </view>
    </view>
    </transition>

    <!-- 功能面板（H5：mousedown.prevent 保持编辑器焦点与光标） -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="showActionPanel" class="action-panel" @mousedown.prevent>
      <view class="action-panel-item" @click="pickFromAlbum">
        <view class="action-panel-icon"><uni-icons type="image" size="44rpx" color="#FF6B6B" /></view>
        <text class="action-panel-label">相册</text>
      </view>
      <view class="action-panel-item" @click="pickByCamera">
        <view class="action-panel-icon"><uni-icons type="camera-filled" size="44rpx" color="#A78BFA" /></view>
        <text class="action-panel-label">拍摄</text>
      </view>
      <view class="action-panel-item" @click="pickVideo">
        <view class="action-panel-icon"><uni-icons type="videocam-filled" size="44rpx" color="#34D399" /></view>
        <text class="action-panel-label">视频</text>
      </view>
      <view class="action-panel-item" @click="startVoiceRecord">
        <view class="action-panel-icon"><uni-icons type="mic-filled" size="44rpx" color="#FBBF24" /></view>
        <text class="action-panel-label">语音</text>
      </view>
      <template v-if="!isGroup">
        <view class="action-panel-item" @click="startCall('audio')">
          <view class="action-panel-icon"><uni-icons type="phone-filled" size="44rpx" color="#34D399" /></view>
          <text class="action-panel-label">语音通话</text>
        </view>
        <view class="action-panel-item" @click="startCall('video')">
          <view class="action-panel-icon"><uni-icons type="videocam-filled" size="44rpx" color="#38BDF8" /></view>
          <text class="action-panel-label">视频通话</text>
        </view>
      </template>
    </view>
    </transition>

    <!-- 表情面板（H5：mousedown.prevent 保持编辑器焦点与光标） -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="showEmojiPanel" class="emoji-panel" @mousedown.prevent>
        <text
          v-for="(e, i) in EMOJI_LIST"
          :key="i"
          class="emoji-item"
          @mousedown.prevent
          @click="insertEmoji(e)"
        >{{ e }}</text>
      </view>
    </transition>

    <!-- 输入栏 -->
    <view class="input-bar">
      <view class="action-btn" @click="toggleEmojiPanel">
        <text class="emoji-btn">😊</text>
      </view>
      <view class="input-wrapper" @click="showActionPanel = false">
        <view
          ref="editorRef"
          class="msg-editor"
          data-placeholder="输入消息…"
          @input="onEditorInput"
        ></view>
      </view>
      <!-- 有内容：发送按钮；无内容：功能面板入口（交叉过渡变形） -->
      <transition name="fade-swap" mode="out-in" :duration="{ enter: 150, leave: 150 }">
        <view
          v-if="hasEditorContent"
          key="send"
          class="send-btn send-btn-active"
          @click="sendMessage"
        >
          <text class="send-text">发送</text>
        </view>
        <view v-else key="plus" class="action-btn action-btn-plus" @click="toggleActionPanel">
          <uni-icons type="plus-filled" size="50rpx" color="#FF6B6B" />
        </view>
      </transition>
    </view>
  </view>

  <!-- 全局通话覆盖层 -->
  <CallOverlay />
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { upload, get, put, del, post } from '@/utils/request';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText, formatMessageTime } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import CallOverlay from '@/components/CallOverlay/CallOverlay.vue';
import { useCallStore } from '@/store/call';

const chatStore = useChatStore();
const userStore = useUserStore();
const callStore = useCallStore();

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

// 群聊状态：从路由参数与会话详情接口取得
const isGroup = ref(false);
const memberCount = ref(0);

// 对方正在输入提示（本地响应式，由全局总线驱动）
const peerTyping = ref(false);
let peerTypingTimer = null;
let lastTypingSentAt = 0;

const onPeerTypingEvent = (payload) => {
  if (!payload || payload.convId !== conversationId.value || payload.userId !== otherUserId.value) return;
  peerTyping.value = true;
  clearTimeout(peerTypingTimer);
  peerTypingTimer = setTimeout(() => { peerTyping.value = false; }, 2500);
};

// 转发弹窗
const showForwardModal = ref(false);
const forwardMsg = ref(null);
const forwardTargets = computed(() => chatStore.getConversations.filter(c => c._id !== conversationId.value));

// 群信息弹窗
const showGroupModal = ref(false);
const groupInfo = ref({});
const groupNameDraft = ref('');

// 语音状态
const isRecording = ref(false);
const recordingSeconds = ref(0);
const playingId = ref('');
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let currentAudio = null;

// 智能滚动：用户上翻时不强制拉底，用悬浮按钮提示新消息
const isAtBottom = ref(true);
const newCount = ref(0);

// 表情面板 / 功能面板：二者互斥，打开一个关闭另一个
const showEmojiPanel = ref(false);
const showActionPanel = ref(false);

const closePanels = () => {
  showEmojiPanel.value = false;
  showActionPanel.value = false;
};

const toggleEmojiPanel = () => {
  showActionPanel.value = false;
  showEmojiPanel.value = !showEmojiPanel.value;
};

const toggleActionPanel = () => {
  showEmojiPanel.value = false;
  showActionPanel.value = !showActionPanel.value;
};
const EMOJI_LIST = [
  '😀', '😄', '😁', '😅', '😂', '🤣', '😊', '😍', '😘', '😜', '🤔', '🤗',
  '😎', '🥳', '😭', '😢', '😡', '🤯', '😱', '🥺', '😴', '🤒', '🤡', '💩',
  '👻', '🙏', '👍', '👎', '👏', '💪', '🤝', '✌️', '🤟', '🤙', '👀', '💥',
  '✨', '🔥', '🎉', '🎂', '🎁', '❤️', '💔', '🌹', '🍺', '☕', '🍉', '⚡'
];

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
  if (replyInfo.type === 'VOICE') return '[语音]';
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
  isGroup.value = options.type === 'GROUP';

  // 群聊：拉取会话详情取成员数，标题用群名
  if (isGroup.value) {
    try {
      const res = await get(`/api/conversations/${conversationId.value}`, null, { silent: true });
      if (res.code === 200) {
        memberCount.value = res.data.memberCount || 0;
        otherNickname.value = res.data.name || otherNickname.value;
      }
    } catch (e) {
      console.error('获取群信息失败:', e);
    }
  }

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
  // WS 批量已读：不带 messageId，服务端将该会话发给自己的全部未读消息置为已读，
  // 并向对方广播 MESSAGE_READ(readAll)，供其把"送达"翻转为"已读"
  wsClient.markAsRead(undefined, conversationId.value);

  wsClient.on('NEW_MESSAGE', onNewMessage);
  wsClient.on('MESSAGE_SENT', onMessageSent);
  wsClient.on('RECONNECTED', onReconnected);
  wsClient.on('MESSAGE_RECALLED', onMessageRecalled);
  wsClient.on('MESSAGE_READ', onMessageRead);
  wsClient.on('TYPING', onPeerTyping);
  uni.$on('peer-typing', onPeerTypingEvent);
  startScrollProbe();

  // #ifdef H5
  nextTick(() => {
    const el = getEditorEl();
    if (el) {
      el.contentEditable = 'true';
      el.dataset.placeholder = '输入消息…';
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
  wsClient.off('MESSAGE_READ', onMessageRead);
  uni.$off('peer-typing', onPeerTypingEvent);
  stopScrollProbe();
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
  // 断连期间可能有新消息未上报已读，重连后补一次批量已读
  wsClient.markAsRead(undefined, conversationId.value);
};

const onNewMessage = (msg) => {
  if (msg.conversationId === conversationId.value) {
    messages.value.push(msg);
    if (isAtBottom.value) {
      scrollToBottom();
    } else {
      newCount.value += 1; // 用户正在上翻历史，不打断，交给悬浮按钮
    }
    chatStore.markConversationAsRead(conversationId.value);
    // 向对方上报已读（批量），驱动其气泡从"送达"翻转为"已读"
    wsClient.markAsRead(undefined, conversationId.value);
    checkMessageHeights();
  }
};

// 滚动位置追踪：距底部 60px 内视为"贴底"。
// 缺少有效位置的滚动事件（如 uni 内部触发的无 detail 事件）不参与判定，
// 否则会被误判为贴底，导致新消息提示按钮失效
// 滚动事件在 uni H5 scroll-view 上不可靠（原生滚动不一定转发到 Vue 处理器），
// 故用 500ms 轮询读取真实滚动位置判定是否贴底
let scrollProbeTimer = null;
const startScrollProbe = () => {
  // #ifdef H5
  scrollProbeTimer = setInterval(() => {
    const scroller = Array.from(document.querySelectorAll('.message-list, .message-list *'))
      .find(e => e.scrollHeight > e.clientHeight + 10);
    if (!scroller) {
      isAtBottom.value = true;
      return;
    }
    const dist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    isAtBottom.value = dist < 60;
    if (isAtBottom.value) newCount.value = 0;
  }, 500);
  // #endif
};
const stopScrollProbe = () => {
  if (scrollProbeTimer) {
    clearInterval(scrollProbeTimer);
    scrollProbeTimer = null;
  }
};

const scrollToBottomManual = () => {
  newCount.value = 0;
  // 乐观置位：scroll-into-view 到底后若未再触发 scroll 事件（节流丢末帧），
  // isAtBottom 会停留在 false 导致按钮不消失，这里手动点击时直接同步状态
  isAtBottom.value = true;
  scrollToBottom();
};

// 对方正在输入（仅私聊）：写入 store，2.5s 无续期自动清除
const onPeerTyping = (data) => {
  if (isGroup.value || data.userId !== otherUserId.value) return;
  // 经全局事件总线广播（跨页面实例可靠送达），本页 uni.$on 接收后点亮提示
  uni.$emit('peer-typing', { convId: data.conversationId, userId: data.userId });
};

// 收到对方已读回执：readAll 表示对方已读全部，将自己的消息统一置为已读
const onMessageRead = (data) => {
  if (data.conversationId !== conversationId.value) return;
  messages.value.forEach(m => {
    if (m.sender._id !== currentUserId.value) return;
    if (data.readAll || m._id === data.messageId) {
      m.read = true;
    }
  });
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

// 分页加载守卫：scrolltoupper 可能连续触发，加载中直接忽略，避免并发跳页
let loadingMore = false;
const loadMoreMessages = async () => {
  if (!hasMore.value || loadingMore) return;
  loadingMore = true;
  const targetPage = page.value + 1;
  try {
    page.value = targetPage;
    const result = await chatStore.fetchMessages(conversationId.value, targetPage);
    if (!result) {
      // 请求失败回滚游标，下次可重试同一页
      page.value = targetPage - 1;
      return;
    }
    messages.value = [...result.messages, ...messages.value];
    hasMore.value = result.pagination.page < result.pagination.pages;
    checkMessageHeights();
  } finally {
    loadingMore = false;
  }
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

// 从相册或拍摄选择图片
const chooseImage = (sourceType = ['album', 'camera']) => {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType,
    success: (res) => {
      sendImage(res.tempFilePaths[0]);
    }
  });
};

const pickFromAlbum = () => {
  closePanels();
  chooseImage(['album']);
};

const pickByCamera = () => {
  closePanels();
  chooseImage(['camera']);
};

const pickVideo = () => {
  closePanels();
  chooseVideo();
};

// 从功能面板发起语音录音（录音条接管输入区上方）
const startVoiceRecord = () => {
  closePanels();
  toggleRecording();
};

// 发起音视频通话（仅私聊）：对方资料优先取会话列表里的头像/昵称
const startCall = (media) => {
  closePanels();
  const conv = chatStore.getConversations.find(c => c._id === conversationId.value);
  const other = conv && conv.otherUser ? conv.otherUser : {};
  callStore.startCall(otherUserId.value, {
    nickname: other.remark || other.nickname || otherNickname.value,
    username: other.username || otherUsername.value,
    avatar: other.avatar || ''
  }, media);
};

// ========== 富文本编辑器（H5） ==========

// 获取编辑器 DOM 元素
const getEditorEl = () => {
  // #ifdef H5
  return editorRef.value?.$el || editorRef.value;
  // #endif
  return null;
};

// 编辑器内容变化时更新发送按钮状态；开始输入即收起功能面板（不影响表情面板）
const onEditorInput = () => {
  const el = getEditorEl();
  if (!el) return;
  hasEditorContent.value = el.textContent.trim() !== '' || el.querySelector('img');
  if (showActionPanel.value) showActionPanel.value = false;

  // 私聊输入时立即通知对方，并节流连续按键，避免每个字符都产生 WS 帧
  if (!isGroup.value && conversationId.value && otherUserId.value) {
    const now = Date.now();
    if (now - lastTypingSentAt >= 700) {
      wsClient.sendTyping(conversationId.value, otherUserId.value);
      lastTypingSentAt = now;
    }
  }
};

// ========== 表情面板 ==========
// 点击 emoji 插入编辑器光标处；无有效光标时落到内容末尾。
// execCommand('insertText') 会触发 input 事件，发送按钮状态随之更新
const insertEmoji = (emoji) => {
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand('insertText', false, emoji);
  onEditorInput();
  // #endif
};

// ========== 语音消息 ==========
// 点击麦克风开始/结束录音；结束后自动上传并发送 VOICE 消息
const toggleRecording = async () => {
  // #ifdef H5
  if (isRecording.value) {
    stopRecording(true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder = recorder;
    audioChunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    // 闭包内持有 recorder 引用：stop() 后外层 mediaRecorder 会被置空，回调不能依赖它
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        sendVoiceMessage(blob, recordingSeconds.value);
      }
    };
    recorder.start();
    isRecording.value = true;
    recordingSeconds.value = 0;
    recordTimer = setInterval(() => {
      recordingSeconds.value += 1;
      // 上限 60s 自动结束
      if (recordingSeconds.value >= 60) stopRecording(true);
    }, 1000);
  } catch (e) {
    console.error('录音失败:', e);
    uni.showToast({ title: '无法访问麦克风，请检查浏览器权限', icon: 'none' });
  }
  // #endif
};

// 结束录音；send=false 表示取消（丢弃录音）
const stopRecording = (send) => {
  // #ifdef H5
  if (!isRecording.value) return;
  isRecording.value = false;
  clearInterval(recordTimer);
  recordTimer = null;
  if (!mediaRecorder) return;
  if (!send) {
    // 取消：置空回调丢弃数据
    mediaRecorder.onstop = null;
    mediaRecorder.stream && mediaRecorder.stream.getTracks().forEach(t => t.stop());
    try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    mediaRecorder = null;
    uni.showToast({ title: '已取消', icon: 'none' });
    return;
  }
  if (recordingSeconds.value < 1) {
    mediaRecorder.onstop = null;
    mediaRecorder.stream && mediaRecorder.stream.getTracks().forEach(t => t.stop());
    try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    mediaRecorder = null;
    uni.showToast({ title: '说话时间太短', icon: 'none' });
    return;
  }
  try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
  mediaRecorder = null;
  // #endif
};

const cancelRecording = () => stopRecording(false);

// ========== 转发消息 ==========
const doForward = (msg) => {
  contextMenuMsg.value = null;
  forwardMsg.value = msg;
  showForwardModal.value = true;
};

// 转发即以同一内容向目标会话发送新消息（保留类型/媒体/时长/富文本，剥离回复引用与状态）
const confirmForward = async (target) => {
  const msg = forwardMsg.value;
  if (!msg || !target) return;
  showForwardModal.value = false;
  const isTargetGroup = target.type === 'GROUP';
  const receiverId = isTargetGroup ? '' : (target.otherUser && target.otherUser._id) || '';
  wsClient.sendMessage(
    target._id,
    receiverId,
    msg.type === 'VOICE' ? '[语音]' : msg.content,
    msg.type,
    msg.mediaUrl || '',
    msg.thumbnailUrl || '',
    msg.contentBlocks || [],
    null,
    genClientId(),
    msg.duration || 0
  );
  uni.showToast({ title: '已转发', icon: 'success' });
};

// ========== 群信息 ==========
const openGroupInfo = async () => {
  try {
    const res = await get(`/api/conversations/${conversationId.value}`, null, { silent: true });
    if (res.code === 200) {
      groupInfo.value = res.data;
      groupNameDraft.value = res.data.name || '';
      showGroupModal.value = true;
    }
  } catch (e) {
    console.error('获取群信息失败:', e);
  }
};

const saveGroupName = async () => {
  const name = groupNameDraft.value.trim();
  if (!name) {
    uni.showToast({ title: '群名称不能为空', icon: 'none' });
    return;
  }
  try {
    const res = await put(`/api/conversations/${conversationId.value}/name`, { name }, { silent: true });
    if (res.code === 200) {
      groupInfo.value.name = name;
      otherNickname.value = name;
      // 同步会话列表里的群名
      const conv = chatStore.getConversations.find(c => c._id === conversationId.value);
      if (conv) conv.name = name;
      uni.showToast({ title: '群名称已更新', icon: 'success' });
    }
  } catch (e) {
    console.error('保存群名失败:', e);
  }
};

const disbandGroup = async () => {
  showGroupModal.value = false;
  try {
    await del(`/api/conversations/${conversationId.value}/group`, null, { silent: true });
    uni.showToast({ title: '群聊已解散', icon: 'success' });
    await chatStore.fetchConversations({ force: true });
    goBack();
  } catch (e) {
    console.error('解散群聊失败:', e);
  }
};

const quitGroup = async () => {
  showGroupModal.value = false;
  try {
    await post(`/api/conversations/${conversationId.value}/quit`, null, { silent: true });
    uni.showToast({ title: '已退出群聊', icon: 'success' });
    await chatStore.fetchConversations({ force: true });
    goBack();
  } catch (e) {
    console.error('退出群聊失败:', e);
  }
};

// 上传录音并发送 VOICE 消息（复用回复引用与临时消息/ACK 机制）
const sendVoiceMessage = async (blob, seconds) => {
  const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;
  replyToMsg.value = null;
  uni.showLoading({ title: '发送中...' });
  try {
    const file = new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' });
    const tempUrl = URL.createObjectURL(file);
    const uploadRes = await upload('/api/upload', tempUrl);
    URL.revokeObjectURL(tempUrl);
    uni.hideLoading();
    if (uploadRes.code === 200) {
      const tempMsg = {
        _id: 'temp-voice-' + Date.now(),
        clientId: genClientId(),
        status: 'sending',
        conversationId: conversationId.value,
        sender: { _id: currentUserId.value },
        receiver: isGroup.value ? null : { _id: otherUserId.value },
        type: 'VOICE',
        mediaUrl: uploadRes.data.url,
        content: '[语音]',
        duration: Math.max(1, Math.round(seconds)),
        replyInfo,
        createdAt: new Date().toISOString()
      };
      messages.value.push(tempMsg);
      scrollToBottom();
      sendWithAck(tempMsg, (cid) => wsClient.sendMessage(
        conversationId.value,
        otherUserId.value,
        '[语音]',
        'VOICE',
        uploadRes.data.url,
        '',
        [],
        replyInfo,
        cid,
        tempMsg.duration
      ));
    }
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: e.message || '语音发送失败', icon: 'none' });
  }
};

// 播放/暂停语音（同时只播放一条）
const togglePlayVoice = (msg) => {
  // #ifdef H5
  if (playingId.value === msg._id) {
    currentAudio && currentAudio.pause();
    playingId.value = '';
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(getMediaUrl(msg.mediaUrl));
  audio.onended = () => { playingId.value = ''; };
  audio.onerror = () => {
    playingId.value = '';
    uni.showToast({ title: '播放失败', icon: 'none' });
  };
  currentAudio = audio;
  audio.play().catch(() => {
    playingId.value = '';
    uni.showToast({ title: '播放失败', icon: 'none' });
  });
  playingId.value = msg._id;
  // #endif
};

// 语音气泡宽度：最短 140rpx，最长 400rpx
const voiceWidth = (duration) => {
  return Math.min(140 + (duration || 1) * 12, 400) + 'rpx';
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
  closePanels();

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
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* 顶部导航栏（桌面宽屏下随容器收窄居中） */
.nav-bar {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  z-index: 100;
  display: flex;
  align-items: center;
  padding-top: 0;
  height: 88rpx;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

/* 导航栏底部渐隐分隔线 */
.nav-bar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1rpx;
  background: linear-gradient(90deg, transparent, var(--color-border) 18%, var(--color-border) 82%, transparent);
}

.nav-back {
  width: 88rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  transition: background 0.2s ease;
}

/* 按压反馈圈（双主题可见） */
.nav-back:active {
  background: var(--color-quote-bg);
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
  background: var(--color-time-badge);
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

/* 气泡列：包裹气泡与回执标签，保持气泡 60% 宽度约束 */
.bubble-col {
  max-width: 60%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.bubble-col-self {
  align-items: flex-end;
}

/* 消息气泡 */
.bubble {
  max-width: 100%;
  background: var(--color-bubble);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 22rpx 22rpx 22rpx 8rpx;
  padding: 20rpx 28rpx;
  position: relative;
  box-shadow: var(--shadow-card);
  border: 1rpx solid var(--glass-border);
}

/* 送达 / 已读回执标签 */
.msg-read-tag {
  font-size: 20rpx;
  color: var(--color-text-tertiary);
  margin-top: 6rpx;
  margin-right: 8rpx;
}

.msg-read-tag--read {
  color: var(--color-secondary);
}

.bubble-self {
  background: linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%);
  border: none;
  border-radius: 22rpx 22rpx 8rpx 22rpx;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 6rpx 18rpx rgba(255, 107, 107, 0.32);
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

/* ========== 过渡动画 ========== */
/* 面板/录音条：上滑淡入淡出 */
.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(30rpx);
}

/* 悬浮按钮：缩放弹出 */
.pop-enter-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* 长按菜单：遮罩淡入淡出 + 菜单缩放 */
.menu-enter-active {
  transition: opacity 0.18s ease;
}

.menu-leave-active {
  transition: opacity 0.15s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
}

.menu-enter-active .context-menu {
  animation: menuPop 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes menuPop {
  from { transform: scale(0.85); }
  to { transform: scale(1); }
}

/* 发送 ↔ ＋ 交叉变形 */
.fade-swap-enter-active,
.fade-swap-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-swap-enter-from,
.fade-swap-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

/* 通用淡入淡出（回执标签等） */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 新消息入场：轻微上浮淡入（v-for 插入时触发一次） */
.message-item {
  animation: msgIn 0.25s ease-out;
}

@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(14rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ========== 转发弹窗 ========== */
.forward-list {
  max-height: 460rpx;
}

.forward-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 14rpx 8rpx;
  border-radius: 16rpx;
}

.forward-item:active {
  background: var(--color-quote-bg);
}

.forward-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-empty {
  padding: 40rpx 0;
  text-align: center;
}

.forward-empty-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

/* ========== 群信息弹窗 ========== */
.gi-section {
  margin-bottom: 24rpx;
}

.gi-label {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  display: block;
  margin-bottom: 10rpx;
}

.gi-name-input {
  width: 100%;
  height: 76rpx;
  background: var(--color-input-bg);
  border-radius: 14rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  color: var(--color-text-primary);
}

.gi-placeholder {
  color: var(--color-text-tertiary);
}

.gi-mini-btn {
  margin-top: 12rpx;
  align-self: flex-start;
  display: inline-flex;
  padding: 10rpx 26rpx;
  background: var(--color-quote-bg);
  border-radius: 999rpx;
}

.gi-section {
  display: flex;
  flex-direction: column;
}

.gi-mini-btn-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary);
}

.gi-members {
  max-height: 360rpx;
}

.gi-member {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 10rpx 4rpx;
}

.gi-member-name {
  flex: 1;
  font-size: 27rpx;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gi-owner-badge {
  font-size: 20rpx;
  color: var(--color-secondary);
  background: rgba(167, 139, 250, 0.14);
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
}

.gi-actions {
  display: flex;
  gap: 24rpx;
}

.gi-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gi-btn:active {
  transform: scale(0.96);
}

.gi-btn-primary {
  background: var(--gradient-primary);
}

.gi-btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #FFFFFF;
}

.gi-btn-danger {
  background: var(--color-quote-bg);
}

.gi-btn-text-danger {
  color: var(--color-error);
}

/* 语音消息气泡 */
.voice-bubble {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 8rpx 4rpx;
  transition: transform 0.15s ease;
}

.voice-bubble:active {
  transform: scale(0.96);
}

.voice-duration {
  font-size: 26rpx;
  color: var(--color-text-primary);
  flex-shrink: 0;
}

.bubble-self .voice-duration {
  color: #FFFFFF;
}

.voice-wave {
  display: flex;
  align-items: center;
  gap: 4rpx;
  flex: 1;
}

.voice-wave-bar {
  width: 5rpx;
  border-radius: 4rpx;
  background: currentColor;
  opacity: 0.45;
  height: 24rpx;
}

.voice-wave-bar:nth-child(2) { height: 34rpx; }
.voice-wave-bar:nth-child(3) { height: 20rpx; }
.voice-wave-bar:nth-child(4) { height: 30rpx; }

.voice-playing .voice-wave-bar {
  animation: voiceWave 0.8s ease-in-out infinite;
}

.voice-playing .voice-wave-bar:nth-child(2) { animation-delay: 0.1s; }
.voice-playing .voice-wave-bar:nth-child(3) { animation-delay: 0.2s; }
.voice-playing .voice-wave-bar:nth-child(4) { animation-delay: 0.3s; }

@keyframes voiceWave {
  0%, 100% { transform: scaleY(0.5); opacity: 0.35; }
  50% { transform: scaleY(1.3); opacity: 0.9; }
}

/* 录音状态条 */
.recording-bar {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 16rpx 24rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
}

.recording-indicator {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.recording-dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: var(--color-error);
  animation: pulse 1s ease-in-out infinite;
}

.recording-time {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-primary);
}

.recording-hint {
  flex: 1;
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

.recording-cancel {
  padding: 10rpx 28rpx;
  background: var(--color-bg);
  border-radius: 999rpx;
}

.recording-cancel:active {
  transform: scale(0.95);
}

.recording-cancel-text {
  font-size: 24rpx;
  color: var(--color-text-secondary);
}

/* 录音中麦克风按钮高亮 */
.action-btn-recording {
  background: var(--color-error) !important;
  box-shadow: 0 4rpx 16rpx rgba(248, 113, 113, 0.4);
}

/* 回到底部悬浮按钮 */
.scroll-bottom-btn {
  position: absolute;
  right: 24rpx;
  bottom: 220rpx;
  z-index: 90;
  padding: 14rpx 28rpx;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1rpx solid var(--glass-border);
  border-radius: 999rpx;
  box-shadow: var(--shadow-md);
  animation: slideUp 0.25s ease-out;
}

.scroll-bottom-btn:active {
  transform: scale(0.95);
}

.scroll-bottom-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary);
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

/* 输入栏（底部安全区适配刘海屏） */
.input-bar {
  position: relative;
  display: flex;
  align-items: flex-end;
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: none;
  gap: 14rpx;
}

/* 输入栏顶部渐隐分隔线 */
.input-bar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1rpx;
  background: linear-gradient(90deg, transparent, var(--color-border) 18%, var(--color-border) 82%, transparent);
}

/* 表情面板：输入栏上方的玻璃拟态网格 */
.emoji-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  padding: 20rpx 24rpx;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
  max-height: 320rpx;
  overflow-y: auto;
}

.emoji-item {
  width: 96rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
  border-radius: 12rpx;
  transition: background 0.15s ease;
}

.emoji-item:active {
  background: var(--color-bg);
}

.emoji-btn {
  font-size: 34rpx;
  line-height: 1;
}

/* 功能面板：宫格入口 */
.action-panel {
  display: flex;
  gap: 30rpx;
  padding: 36rpx 40rpx;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
}

.action-panel-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.action-panel-item:active .action-panel-icon {
  transform: scale(0.92);
}

.action-panel-icon {
  width: 104rpx;
  height: 104rpx;
  border-radius: 28rpx;
  background: var(--color-input-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}

.action-panel-label {
  font-size: 22rpx;
  color: var(--color-text-secondary);
}

/* 功能面板入口按钮 */
.action-btn-plus {
  background: transparent;
}

.action-btn-plus:active {
  transform: scale(0.9);
}

.action-btn {
  width: 68rpx;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-input-bg);
  border-radius: 18rpx;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.action-btn:active {
  transform: scale(0.92);
}

.input-wrapper {
  flex: 1;
  min-height: 68rpx;
  max-height: 240rpx;
  overflow-y: auto;
  background: var(--color-input-bg);
  border-radius: 18rpx;
  padding: 0 20rpx;
}

.msg-editor {
  min-height: 68rpx;
  padding: 14rpx 0;
  box-sizing: border-box;
  font-size: 28rpx;
  color: var(--color-text-primary);
  line-height: 40rpx;
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
  height: 68rpx;
  padding: 0 30rpx;
  background: rgba(255, 107, 107, 0.35);
  border-radius: 18rpx;
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
  background: var(--color-quote-bg);
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
  background: var(--color-quote-bg);
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
