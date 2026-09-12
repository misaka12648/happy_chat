<template>
  <view class="chat-detail">
    <!-- 顶部导航栏 -->
    <view class="nav-bar">
      <view class="nav-back" aria-label="返回" @click="goBack">
        <uni-icons type="left" size="40rpx" color="var(--color-nav-icon)" />
      </view>
      <view class="nav-title-wrap" @click="isGroup && openGroupInfo()">
        <text class="nav-title">{{ otherNickname || '聊天' }}</text>
        <text class="nav-subtitle" v-if="peerTyping && !isGroup">对方正在输入…</text>
        <text class="nav-subtitle" v-else-if="isGroup">{{ memberCount }} 人 · 群信息</text>
        <text class="nav-subtitle nav-subtitle-online" v-else-if="otherOnline">● 在线</text>
        <text class="nav-subtitle" v-else-if="otherUsername">@{{ otherUsername }}</text>
      </view>
      <view class="nav-search-btn" aria-label="搜索聊天记录" @click="toggleSearch">
        <uni-icons type="search" size="40rpx" color="var(--color-nav-icon)" />
      </view>
    </view>

    <!-- 会话内消息搜索面板 -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="showSearch" class="search-panel">
        <view class="search-panel-input">
          <uni-icons type="search" size="20" color="var(--color-icon-muted)" />
          <input
            v-model="searchKeyword"
            class="search-panel-input-field"
            placeholder="搜索聊天记录"
            placeholder-class="search-panel-placeholder"
            confirm-type="search"
            @confirm="doSearch"
          />
          <view v-if="searchKeyword" class="search-panel-clear" @click="clearSearch">
            <uni-icons type="clear" size="18" color="var(--color-icon-muted)" />
          </view>
          <view class="search-panel-go" @click="doSearch">
            <text class="search-panel-go-text">搜索</text>
          </view>
        </view>
        <scroll-view scroll-y class="search-results">
          <view v-if="searching" class="search-state">
            <text class="search-state-text">搜索中…</text>
          </view>
          <view v-else-if="searched && !searchResults.length" class="search-state">
            <text class="search-state-text">未找到相关消息</text>
          </view>
          <view
            v-for="r in searchResults"
            :key="r._id"
            class="search-result-item"
            @click="jumpToMessage(r)"
          >
            <view class="search-result-head">
              <text class="search-result-name">{{ r.sender && (r.sender.nickname || r.sender.username) || '' }}</text>
              <text class="search-result-time">{{ formatMessageTime(r.createdAt) }}</text>
            </view>
            <view class="search-result-content">
              <template v-for="(seg, i) in highlightSegments(r)" :key="i">
                <text v-if="seg.hit" class="search-result-hit">{{ seg.text }}</text>
                <text v-else class="search-result-text">{{ seg.text }}</text>
              </template>
            </view>
          </view>
        </scroll-view>
      </view>
    </transition>

    <!-- 消息列表 -->
    <scroll-view
      class="message-list"
      scroll-y
      :scroll-into-view="scrollToView"
      @scrolltoupper="loadMoreMessages"
    >
      <!-- 群公告条（随内容滚动，点击展开查看群信息） -->
      <view v-if="isGroup && groupAnnouncement" class="announcement-bar" @click="openGroupInfo()">
        <uni-icons type="sound-filled" size="14" color="var(--color-primary)" />
        <text class="announcement-bar-text">{{ groupAnnouncement }}</text>
      </view>
      <!-- 消息加载失败：重试入口 -->
      <view v-if="msgLoadFailed && !messages.length" class="msg-load-error">
        <text class="msg-load-error-text">😢 消息加载失败</text>
        <view class="msg-load-retry" @click="retryLoad">
          <text class="msg-load-retry-text">点击重试</text>
        </view>
      </view>
      <!-- 空会话：快捷打招呼 -->
      <view v-if="!messages.length && !msgLoadFailed" class="empty-chat">
        <text class="empty-chat-emoji">👋</text>
        <text class="empty-chat-text">和 {{ isGroup ? '群友们' : (otherNickname || '对方') }} 打个招呼吧</text>
        <view class="empty-chat-chips">
          <view v-for="g in GREETINGS" :key="g" class="empty-chat-chip" @click="quickSend(g)">
            <text class="empty-chat-chip-text">{{ g }}</text>
          </view>
        </view>
      </view>
      <view v-if="hasMore" class="load-more">
        <text class="load-more-text" @click="loadMoreMessages">加载更多</text>
      </view>
      
      <view
        v-for="(msg, index) in messages"
        :key="msg._id"
        :id="'msg-' + msg._id"
        class="message-item"
        :class="{ 'message-self': msg.sender._id === currentUserId, 'message-selecting': multiSelectMode }"
        @click.capture="onSelectCaptureClick(msg, $event)"
      >
        <!-- 多选模式：外沿选择圈 -->
        <view
          v-if="multiSelectMode && !msg.recalled"
          class="select-check"
          :class="{ 'select-check--self': msg.sender._id === currentUserId, 'select-check--on': selectedMsgIds.has(msg._id) }"
        >
          <uni-icons v-if="selectedMsgIds.has(msg._id)" type="checkmarkempty" size="14" color="#FFFFFF" />
        </view>
        <!-- 时间分隔（桌面悬浮显示完整日期时间） -->
        <view v-if="showTimeDivider(index)" class="time-divider">
          <view class="time-badge" :title="fullTime(msg.createdAt)">
            <text class="time-text">{{ formatMessageTime(msg.createdAt) }}</text>
          </view>
        </view>

        <!-- "以下为新消息"分隔线：进入会话时的第一条未读消息前 -->
        <view v-if="msg._id === firstUnreadId && !msg.recalled" class="unread-divider">
          <text class="unread-divider-text">以下为新消息</text>
        </view>

        <!-- 撤回消息提示 -->
        <view v-if="msg.recalled" class="recall-notice">
          <text class="recall-text">{{ getRecallText(msg) }}</text>
          <text v-if="canEditRecalled(msg)" class="recall-edit" @click="doEditRecalled(msg)">编辑</text>
        </view>

        <!-- 消息行：头像两侧，气泡靠头像；群聊点他人头像快捷 @ -->
        <view v-else class="message-row">
          <view
            class="msg-avatar-btn"
            :class="{ 'msg-avatar-btn--plain': msg.sender._id === currentUserId }"
            @click.stop="onAvatarClick(msg)"
          >
            <AppAvatar
              :src="msgAvatarUrl(msg)"
              :background="msg.sender._id === currentUserId ? selfAvatarGradient : getAvatarGradient(msg.sender)"
              :text="msg.sender._id === currentUserId ? selfAvatarText : getAvatarText(msg.sender)"
              size="72rpx"
              radius="20rpx"
              font-size="28rpx"
              shadow="0 4rpx 12rpx rgba(0, 0, 0, 0.1)"
            />
          </view>

          <view class="bubble-col" :class="{ 'bubble-col-self': msg.sender._id === currentUserId }">
            <!-- 群聊：他人消息气泡上方显示发送者昵称 -->
            <text v-if="isGroup && msg.sender._id !== currentUserId" class="group-sender-name">{{ msg.sender.nickname || msg.sender.username }}</text>
            <view class="bubble" :class="{ 'bubble-self': msg.sender._id === currentUserId }" :title="fullTime(msg.createdAt)" @longpress="onLongPress($event, msg)">
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
              <text v-if="msg.type === 'TEXT'" class="bubble-text"><template v-for="(seg, si) in mentionTextSegments(msg.content)" :key="si"><text v-if="seg.hit" class="bubble-mention">{{ seg.text }}</text><text v-else>{{ seg.text }}</text></template></text>
              <!-- 图片消息：上传中本地预览 + 进度遮罩；加载失败可点击重试 -->
              <view v-else-if="msg.type === 'IMAGE'" class="bubble-image-wrap">
                <image
                  v-if="!failedImageIds.has(msg._id)"
                  :key="imgRetryTick + '-' + msg._id"
                  class="bubble-image"
                  :src="getMediaUrl(msg.thumbnailUrl || msg.mediaUrl)"
                  mode="widthFix"
                  @click="onImageBubbleClick(msg)"
                  @error="onImageError(msg)"
                />
                <view v-else class="image-load-failed" @click="retryImage(msg)">
                  <uni-icons type="refresh" size="20" color="var(--color-icon-muted)" />
                  <text class="image-load-failed-text">加载失败 点击重试</text>
                </view>
                <view v-if="msg.uploading" class="image-uploading">
                  <view class="image-uploading-spinner"></view>
                  <text class="image-uploading-text">{{ msg.uploadProgress || 0 }}%</text>
                </view>
              </view>
              <!-- 视频消息：上传中本地预览 + 进度遮罩；播放时暂停语音避免双声 -->
              <view v-else-if="msg.type === 'VIDEO'" class="bubble-image-wrap">
                <video
                  class="bubble-video"
                  :src="getMediaUrl(msg.mediaUrl)"
                  controls
                  @play="pauseVoiceForVideo"
                />
                <view v-if="msg.uploading" class="image-uploading">
                  <view class="image-uploading-spinner"></view>
                  <text class="image-uploading-text">{{ msg.uploadProgress || 0 }}%</text>
                </view>
              </view>
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
                <text class="voice-duration">{{ playingId === msg._id && voiceRemaining > 0 ? voiceRemaining + '"' : (msg.duration || 1) + '"' }}</text>
                <view class="voice-wave">
                  <view class="voice-wave-bar" v-for="n in 4" :key="n"></view>
                </view>
                <!-- 播放进度填充线 -->
                <view v-if="playingId === msg._id && voiceTotal > 0" class="voice-progress">
                  <view class="voice-progress-fill" :style="{ width: voiceProgress + '%' }"></view>
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
            v-else-if="msg.sender._id === currentUserId && msg.status === 'sending' && !msg.uploading"
            class="msg-status msg-status-sending"
          >
            <view class="msg-status-spinner"></view>
          </view>
          <!-- 桌面悬停工具栏（绝对定位悬于气泡外侧；触屏设备隐藏） -->
          <view
            v-if="!multiSelectMode && !msg.recalled"
            class="bubble-quickbar"
            :class="{ 'bubble-quickbar--self': msg.sender._id === currentUserId }"
            @click.stop
          >
            <text class="quickbar-btn" title="回应" @click.stop="quickReact(msg)">😊</text>
            <text class="quickbar-btn" title="回复" @click.stop="doReply(msg)">↩︎</text>
            <text class="quickbar-btn" title="更多操作" @click.stop="quickMore(msg, $event)">⋯</text>
          </view>
          <!-- 表情回应 chips（点击切换自己的回应，悬浮显示谁回应了） -->
          <view v-if="msg.reactions && msg.reactions.length" class="reaction-row">
            <view
              v-for="r in sortedReactions(msg)"
              :key="r.emoji"
              class="reaction-chip"
              :class="{ 'reaction-chip--mine': (r.users || []).includes(currentUserId) }"
              :title="reactionTitle(r)"
              @click.stop="toggleReaction(msg, r.emoji)"
            >
              <text class="reaction-chip-emoji">{{ r.emoji }}</text>
              <text class="reaction-chip-count">{{ (r.users || []).length }}</text>
            </view>
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
          <view v-if="!contextMenuMsg.recalled" class="reaction-strip">
            <text
              v-for="e in REACTION_EMOJIS"
              :key="e"
              class="reaction-strip-emoji"
              @click="doReact(contextMenuMsg, e)"
            >{{ e }}</text>
          </view>
          <view class="reaction-strip-divider"></view>
          <template v-if="menuMode === 'full'">
            <view v-if="canCopy(contextMenuMsg)" class="menu-item" @click="doCopy(contextMenuMsg)">复制</view>
            <view class="menu-item" @click="doReply(contextMenuMsg)">回复</view>
            <view class="menu-item" @click="doForward(contextMenuMsg)">转发</view>
            <view class="menu-item" @click="enterMultiSelect(contextMenuMsg)">多选</view>
            <view class="menu-item danger" @click="menuHide(contextMenuMsg)">删除</view>
            <view v-if="canRecall(contextMenuMsg)" class="menu-item danger" @click="doRecall(contextMenuMsg)">撤回</view>
          </template>
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

    <!-- 删除消息确认弹窗（仅自己视角） -->
    <BaseModal
      v-model:visible="hideModalVisible"
      title="删除消息"
      :content="hideCount > 1 ? `将删除选中的 ${hideCount} 条消息，仅对你可见的记录被移除，对方不受影响。确定删除吗？` : '将删除该消息，仅对你可见的记录被移除，对方不受影响。确定删除吗？'"
      confirm-text="删除"
      @confirm="confirmHide"
    />

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
        <text class="gi-label">群公告</text>
        <textarea
          v-if="groupInfo.owner === currentUserId"
          v-model="announcementDraft"
          class="gi-announcement-input"
          maxlength="200"
          placeholder="还没有公告，写一个吧"
          placeholder-class="gi-placeholder"
          auto-height
        />
        <view v-if="groupInfo.owner === currentUserId" class="gi-announcement-foot">
          <text class="gi-announcement-count" :class="{ 'gi-announcement-count-limit': announcementDraft.length >= 200 }">{{ announcementDraft.length }}/200</text>
          <view class="gi-mini-btn" @click="saveAnnouncement">
            <text class="gi-mini-btn-text">保存公告</text>
          </view>
        </view>
        <text v-else class="gi-announcement-text">{{ groupInfo.announcement || '暂无公告' }}</text>
      </view>
      <view class="gi-section">
        <text class="gi-label">成员（{{ groupInfo.members ? groupInfo.members.length : 0 }}）</text>
        <scroll-view scroll-y class="gi-members">
          <view
            v-for="m in (groupInfo.members || [])"
            :key="m._id"
            class="gi-member"
            @click="mentionFromModal(m)"
          >
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

    <!-- 录音状态条：计时 + 实时音量波形 + 取消/结束按钮（结束不依赖已收起的功能面板） -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="isRecording" class="recording-bar">
      <view class="recording-indicator">
        <view class="recording-dot"></view>
        <text class="recording-time">{{ recordingSeconds }}s</text>
      </view>
      <view class="recording-wave">
        <view
          v-for="(h, i) in recordingWave"
          :key="i"
          class="recording-wave-bar"
          :style="{ height: h + '%' }"
        ></view>
      </view>
      <view class="recording-cancel" aria-label="取消录音" @click="cancelRecording">
        <text class="recording-cancel-text">取消</text>
      </view>
      <view class="recording-send" aria-label="结束并发送" @click="stopRecording(true)">
        <uni-icons type="checkmarkempty" size="16" color="#FFFFFF" />
        <text class="recording-send-text">结束并发送</text>
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

    <!-- @提及成员选择面板（群聊输入 @ 时出现） -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="showMentionPicker && mentionCandidates.length" class="mention-picker">
        <view class="mention-picker-title">
          <text class="mention-picker-title-text">选择提醒的人</text>
        </view>
        <view
          v-for="(m, idx) in mentionCandidates"
          :key="m._id"
          class="mention-item"
          :class="{ 'mention-item--active': idx === mentionActiveIndex }"
          @mousedown.prevent
          @click="pickMention(m)"
        >
          <AppAvatar
            :src="getMediaUrl(m.avatar)"
            :background="getAvatarGradient(m)"
            :text="getAvatarText(m)"
            size="56rpx"
            radius="50%"
            font-size="22rpx"
            shadow="none"
          />
          <text class="mention-item-name">{{ m.remark || m.nickname || m.username }}</text>
          <text class="mention-item-username">@{{ m.username }}</text>
        </view>
      </view>
    </transition>

    <!-- 表情面板（H5：mousedown.prevent 保持编辑器焦点与光标） -->
    <transition name="fade-up" :duration="{ enter: 220, leave: 220 }">
      <view v-if="showEmojiPanel" class="emoji-panel" @mousedown.prevent>
        <template v-if="recentEmojis.length">
          <view class="emoji-section">
            <text class="emoji-section-label">最近使用</text>
            <view class="emoji-grid">
              <text
                v-for="(e, i) in recentEmojis"
                :key="'recent-' + i"
                class="emoji-item"
                @mousedown.prevent
                @click="insertEmoji(e)"
              >{{ e }}</text>
            </view>
          </view>
          <view class="emoji-section">
            <text class="emoji-section-label">全部表情</text>
            <view class="emoji-grid">
              <text
                v-for="(e, i) in EMOJI_LIST"
                :key="'all-' + i"
                class="emoji-item"
                @mousedown.prevent
                @click="insertEmoji(e)"
              >{{ e }}</text>
            </view>
          </view>
        </template>
        <template v-else>
          <text
            v-for="(e, i) in EMOJI_LIST"
            :key="i"
            class="emoji-item"
            @mousedown.prevent
            @click="insertEmoji(e)"
          >{{ e }}</text>
        </template>
      </view>
    </transition>

    <!-- 多选操作底栏（替换输入栏） -->
    <view v-if="multiSelectMode" class="multiselect-bar">
      <view class="ms-btn" @click="exitMultiSelect">
        <text class="ms-btn-text">取消</text>
      </view>
      <text class="ms-count">已选 {{ selectedMsgIds.size }} 条</text>
      <view class="ms-btn" @click="selectAllVisible">
        <text class="ms-btn-text">全选</text>
      </view>
      <view class="ms-btn ms-btn-danger" @click="menuHideBatch">
        <text class="ms-btn-text ms-btn-text-danger">删除</text>
      </view>
      <view class="ms-btn ms-btn-primary" :class="{ 'ms-btn--disabled': selectedMsgIds.size === 0 }" @click="forwardSelected">
        <text class="ms-btn-text ms-btn-text-primary">转发</text>
      </view>
    </view>

    <!-- 输入栏 -->
    <view v-else class="input-bar">
      <view class="action-btn" aria-label="表情" @click="toggleEmojiPanel">
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
          aria-label="发送"
          @click="sendMessage"
        >
          <text class="send-text">发送</text>
        </view>
        <view v-else key="plus" class="action-btn action-btn-plus" aria-label="更多功能" @click="toggleActionPanel">
          <uni-icons type="plus-filled" size="50rpx" color="#FF6B6B" />
        </view>
      </transition>
    </view>
  </view>

  <!-- 全局通话覆盖层 -->
  <CallOverlay />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { upload, get, put, del, post } from '@/utils/request';
import wsClient from '@/utils/socket';
import { getMediaUrl, getAvatarGradient, getAvatarText, formatMessageTime } from '@/utils/format';
import AppAvatar from '@/components/AppAvatar/AppAvatar.vue';
import CallOverlay from '@/components/CallOverlay/CallOverlay.vue';
import { useCallStore } from '@/store/call';
import { useContactsStore } from '@/store/contacts';

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
// 群成员列表（@提及选择用）
const groupMembers = ref([]);

// ========== 群聊 @提及 ==========
// 输入 @ 后缀时弹出成员选择面板，随输入过滤；选中后替换为 @名字+空格
const showMentionPicker = ref(false);
const mentionFilter = ref('');
const MENTION_TAIL_RE = /@([^\s@]*)$/;

const updateMentionPicker = () => {
  // #ifdef H5
  if (!isGroup.value) { showMentionPicker.value = false; return; }
  const el = getEditorEl();
  const m = el ? el.textContent.match(MENTION_TAIL_RE) : null;
  showMentionPicker.value = !!m;
  mentionFilter.value = m ? m[1] : '';
  mentionActiveIndex.value = 0; // 过滤词变化时复位键盘选中项
  // #endif
};

// 键盘 ↑↓ 高亮的候选下标
const mentionActiveIndex = ref(0);

const mentionCandidates = computed(() => {
  const kw = mentionFilter.value.toLowerCase();
  const me = userStore.getUserInfo?._id;
  return groupMembers.value
    .filter(m => m._id !== me)
    .filter(m => {
      if (!kw) return true;
      const nick = (m.nickname || '').toLowerCase();
      const uname = (m.username || '').toLowerCase();
      return nick.includes(kw) || uname.includes(kw);
    })
    .slice(0, 8);
});

const pickMention = (member) => {
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  const name = member.remark || member.nickname || member.username || '';
  // 从后往前找包含 @过滤词 尾巴的文本节点（光标后可能存在空的兄弟文本节点，不能只看最后一个）
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let replaced = false;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (MENTION_TAIL_RE.test(nodes[i].nodeValue)) {
      nodes[i].nodeValue = nodes[i].nodeValue.replace(MENTION_TAIL_RE, '@' + name + ' ');
      replaced = true;
      break;
    }
  }
  if (!replaced) el.appendChild(document.createTextNode('@' + name + ' '));
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  showMentionPicker.value = false;
  onEditorInput();
  // #endif
};

// 消息文本的 @提及分段：@开头片段高亮渲染（发送与接收双方一致）
// 边界保护：@ 前不能是字母/数字/./@（排除邮箱 alice@example.com 被误判为提及）
const mentionTextSegments = (content) => {
  if (!content) return [{ hit: false, text: '' }];
  const segs = [];
  const re = /@[^\s@]{1,30}/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    const prev = m.index > 0 ? content[m.index - 1] : '';
    if (prev && /[\w.@]/.test(prev)) continue;
    if (m.index > lastIdx) segs.push({ hit: false, text: content.slice(lastIdx, m.index) });
    segs.push({ hit: true, text: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) segs.push({ hit: false, text: content.slice(lastIdx) });
  return segs.length ? segs : [{ hit: false, text: content }];
};

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

// ========== 多选消息与批量转发 ==========
const multiSelectMode = ref(false);
const selectedMsgIds = ref(new Set());

const enterMultiSelect = (msg) => {
  contextMenuMsg.value = null;
  closePanels();
  multiSelectMode.value = true;
  selectedMsgIds.value = new Set(msg && !msg.recalled ? [msg._id] : []);
};

const exitMultiSelect = () => {
  multiSelectMode.value = false;
  selectedMsgIds.value = new Set();
};

const toggleSelectMsg = (msg) => {
  if (msg.recalled) return;
  const next = new Set(selectedMsgIds.value);
  if (next.has(msg._id)) next.delete(msg._id);
  else next.add(msg._id);
  selectedMsgIds.value = next;
};

// 多选模式下拦截消息行的所有点击（捕获阶段），转为切换选中
const onSelectCaptureClick = (msg, e) => {
  if (!multiSelectMode.value) return;
  e.stopPropagation();
  e.preventDefault();
  toggleSelectMsg(msg);
};

const selectAllVisible = () => {
  const next = new Set(selectedMsgIds.value);
  messages.value.forEach(m => { if (!m.recalled) next.add(m._id); });
  selectedMsgIds.value = next;
};

const forwardSelected = () => {
  if (selectedMsgIds.value.size === 0) return;
  forwardMsg.value = null; // 多选模式标记：确认转发时走批量分支
  ensureForwardTargets();
  showForwardModal.value = true;
};

// ========== 删除消息（仅自己视角：服务端 hiddenFor + 本地移除） ==========
const hideModalVisible = ref(false);
const hideIds = ref([]);

const hideCount = computed(() => hideIds.value.length);

// 长按菜单单条删除
const menuHide = (msg) => {
  contextMenuMsg.value = null;
  if (!msg || msg.recalled) return;
  hideIds.value = [msg._id];
  hideModalVisible.value = true;
};

// 多选批量删除
const menuHideBatch = () => {
  if (selectedMsgIds.value.size === 0) return;
  hideIds.value = [...selectedMsgIds.value];
  hideModalVisible.value = true;
};

const confirmHide = async () => {
  hideModalVisible.value = false;
  const ids = hideIds.value.filter(id => !String(id).startsWith('temp-'));
  const failedIds = [];
  for (const id of ids) {
    try {
      await del(`/api/messages/${id}`, null, { silent: true });
    } catch (e) {
      failedIds.push(id);
      console.error('删除消息失败:', e);
    }
  }
  const removedIds = ids.filter(id => !failedIds.includes(id));
  // 只有服务端确认成功的消息才从本地移除，避免失败后产生假状态
  messages.value = messages.value.filter(m => !removedIds.includes(m._id));
  chatStore.removeMessageLocal(conversationId.value, removedIds);
  if (multiSelectMode.value) exitMultiSelect();
  if (failedIds.length) {
    uni.showToast({ title: removedIds.length ? '部分消息删除失败' : '删除失败，请稍后重试', icon: 'none' });
  } else if (removedIds.length) {
    uni.showToast({ title: removedIds.length > 1 ? `已删除 ${removedIds.length} 条消息` : '已删除', icon: 'none' });
  }
};

// 群信息弹窗
const showGroupModal = ref(false);
const groupInfo = ref({});
const groupNameDraft = ref('');
// 群公告：群主可编辑（弹窗内），成员在消息列表顶部公告条看到
const announcementDraft = ref('');
const groupAnnouncement = ref('');

// 语音状态
const isRecording = ref(false);
const recordingSeconds = ref(0);
const playingId = ref('');
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let currentAudio = null;

// 录音实时音量波形：AnalyserNode 取电平驱动 5 根条的高度（录音中的可见反馈）
const recordingWave = ref([30, 60, 40, 80, 50]);
let analyserCtx = null;
let waveTimer = null;

const startWave = (stream) => {
  // #ifdef H5
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    analyserCtx = new Ctx();
    if (analyserCtx.state === 'suspended') analyserCtx.resume().catch(() => {});
    const source = analyserCtx.createMediaStreamSource(stream);
    const analyser = analyserCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    waveTimer = setInterval(() => {
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      // 平均电平映射到 20~90% 高度；各条叠加相位错开的浮动，避免同步抖动
      const level = Math.min(90, Math.max(20, (sum / buf.length / 255) * 120 + 18));
      recordingWave.value = recordingWave.value.map((_, i) => {
        const jitter = Math.sin(Date.now() / 130 + i * 1.7) * 12;
        return Math.min(100, Math.max(14, Math.round(level + jitter)));
      });
    }, 120);
  } catch (e) { /* 波形失败不影响录音 */ }
  // #endif
};

const stopWave = () => {
  // #ifdef H5
  clearInterval(waveTimer);
  waveTimer = null;
  if (analyserCtx) {
    analyserCtx.close().catch(() => {});
    analyserCtx = null;
  }
  recordingWave.value = [30, 60, 40, 80, 50];
  // #endif
};

// 智能滚动：用户上翻时不强制拉底，用悬浮按钮提示新消息
const isAtBottom = ref(true);
const newCount = ref(0);

// "以下为新消息"分隔线：进入会话时第一条未读消息（标记已读前取样，离开会话即失效）
const firstUnreadId = ref('');

// 对方在线状态（私聊顶栏展示；初始取会话列表缓存，实时由 ONLINE_STATUS 驱动）
const otherOnline = ref(false);

const onOnlineStatus = (data) => {
  if (data && data.userId === otherUserId.value) {
    otherOnline.value = !!data.online;
  }
};

// 群公告实时更新（群主保存后其他成员经 WS 事件总线同步公告条/弹窗）
const onGroupAnnouncementEvent = (data) => {
  if (!data || data.conversationId !== conversationId.value) return;
  groupAnnouncement.value = data.announcement || '';
  if (groupInfo.value && groupInfo.value._id === conversationId.value) {
    groupInfo.value.announcement = data.announcement || '';
  }
};

// 成员退群：正在浏览该群时刷新成员列表/人数（弹窗开着也实时）
const onGroupMemberLeft = (data) => {
  if (!data || data.conversationId !== conversationId.value) return;
  openGroupInfo();
};

// ========== 表情回应 ==========
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// 长按菜单表情条：直接切换回应
const doReact = (msg, emoji) => {
  contextMenuMsg.value = null;
  toggleReaction(msg, emoji);
};

// 切换回应（HTTP 幂等切换；自己与其他端经 WS 广播同步）
const toggleReaction = async (msg, emoji) => {
  try {
    const res = await put(`/api/messages/${msg._id}/reactions`, { emoji });
    if (res.code === 200) {
      msg.reactions = res.data.reactions;
    }
  } catch (e) {
    console.error('表情回应失败:', e);
  }
};

// 其他成员/其他端的回应变更：按消息 ID 就地更新
const onMessageReaction = (data) => {
  if (!data || data.conversationId !== conversationId.value) return;
  const idx = messages.value.findIndex(m => m._id === data.messageId);
  if (idx > -1) {
    messages.value[idx].reactions = data.reactions;
  }
};

// 回应者名字解析：我 → 群成员 → 会话对方 → 通讯录好友，逐级兜底
const reactionUserName = (uid) => {
  if (uid === currentUserId.value) {
    const u = userStore.getUserInfo || {};
    return u.nickname || u.username || '我';
  }
  const gm = groupMembers.value.find(m => m._id === uid);
  if (gm) return gm.remark || gm.nickname || gm.username;
  const conv = chatStore.getConversations.find(c => c._id === conversationId.value);
  const ou = conv && conv.otherUser;
  if (ou && ou._id === uid) return ou.remark || ou.nickname || ou.username;
  const fr = useContactsStore().friends.find(f => f._id === uid);
  if (fr) return fr.remark || fr.nickname || fr.username;
  return '';
};

const reactionTitle = (r) => (r.users || []).map(reactionUserName).filter(Boolean).join('、');

// 展示排序：人数多的回应靠前
const sortedReactions = (msg) => [...(msg.reactions || [])].sort((a, b) => (b.users || []).length - (a.users || []).length);

// ========== 会话内消息搜索 ==========
const showSearch = ref(false);
const searchKeyword = ref('');
const searchResults = ref([]);
const searching = ref(false);
const searched = ref(false);

const toggleSearch = () => {
  showSearch.value = !showSearch.value;
  if (showSearch.value) {
    // #ifdef H5
    nextTick(() => {
      const input = document.querySelector('.search-panel-input-field');
      if (input) input.focus();
    });
    // #endif
  }
};

const clearSearch = () => {
  searchKeyword.value = '';
  searchResults.value = [];
  searched.value = false;
};

// 搜索结果的展示内容：TEXT 用 content，RICH 拼接文本块
const searchSnippetSource = (msg) => {
  if (msg.type === 'RICH' && Array.isArray(msg.contentBlocks)) {
    return msg.contentBlocks.filter(b => b.blockType === 'text').map(b => b.content).join(' ');
  }
  return msg.content || '';
};

// 关键词高亮分段：命中片段标记 hit，供模板区分渲染
const highlightSegments = (msg) => {
  const src = searchSnippetSource(msg);
  const kw = searchKeyword.value.trim();
  if (!kw) return [{ hit: false, text: src }];
  const lower = src.toLowerCase();
  const k = kw.toLowerCase();
  const segs = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(k, i);
    if (idx === -1) {
      segs.push({ hit: false, text: src.slice(i) });
      break;
    }
    if (idx > i) segs.push({ hit: false, text: src.slice(i, idx) });
    segs.push({ hit: true, text: src.slice(idx, idx + kw.length) });
    i = idx + kw.length;
  }
  return segs;
};

const doSearch = async () => {
  const kw = searchKeyword.value.trim();
  if (!kw || searching.value) return;
  searching.value = true;
  searched.value = true;
  try {
    const res = await get(`/api/messages/${conversationId.value}/search`, { keyword: kw, limit: 30 });
    if (res.code === 200) {
      searchResults.value = res.data.messages;
    }
  } catch (e) {
    console.error('消息搜索失败:', e);
  } finally {
    searching.value = false;
  }
};

// 点击结果：关闭面板并定位；消息未加载时 scrollToMessage 内部会自动翻页查找
const jumpToMessage = async (msg) => {
  showSearch.value = false;
  await scrollToMessage(msg._id);
};

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

// 最近使用的表情：面板顶部优先展示（本地持久化，最多 8 个）
const RECENT_EMOJI_KEY = 'emojiRecent';
const recentEmojis = ref([]);
try {
  recentEmojis.value = JSON.parse(uni.getStorageSync(RECENT_EMOJI_KEY) || '[]');
} catch (e) { recentEmojis.value = []; }

const trackRecentEmoji = (emoji) => {
  const next = [emoji, ...recentEmojis.value.filter(e => e !== emoji)].slice(0, 8);
  recentEmojis.value = next;
  uni.setStorageSync(RECENT_EMOJI_KEY, JSON.stringify(next));
};

// ========== 会话草稿：离开保存、进入恢复、清空/发送后自动清除 ==========
const draftKey = computed(() => 'draft_' + conversationId.value);

// 编辑器是否为空：无文本且无图片
const isEditorEmpty = (el) => !el.textContent.trim() && !el.querySelector('img.editor-img');

const saveDraft = () => {
  // #ifdef H5
  if (!conversationId.value) return;
  const el = getEditorEl();
  if (!el) return;
  if (isEditorEmpty(el)) {
    uni.removeStorageSync(draftKey.value);
  } else {
    uni.setStorageSync(draftKey.value, el.innerHTML);
  }
  // #endif
};

const restoreDraft = () => {
  // #ifdef H5
  const draft = conversationId.value && uni.getStorageSync(draftKey.value);
  if (!draft) return;
  const el = getEditorEl();
  if (!el) return;
  el.innerHTML = draft;
  onEditorInput();
  // #endif
};

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
  // #ifdef H5
  // 会话相册式预览：收集本会话全部图片，可左右滑动连看，定位到所点图片
  const target = getMediaUrl(url);
  const urls = messages.value
    .filter(m => m.type === 'IMAGE' && !m.recalled && m.mediaUrl)
    .map(m => getMediaUrl(m.mediaUrl));
  const list = urls.includes(target) ? urls : [target, ...urls];
  uni.previewImage({ urls: list, current: target });
  // #endif
};

// 群聊点击他人头像：向输入框插入 @昵称（快捷提及）
const onAvatarClick = (msg) => {
  if (!isGroup.value || msg.recalled || msg.sender._id === currentUserId.value) return;
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, '@' + (msg.sender.nickname || msg.sender.username || '') + ' ');
  onEditorInput();
  // #endif
};

// 视频开始播放时暂停正在播放的语音（避免两路声音叠加）
const pauseVoiceForVideo = () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  playingId.value = '';
  voiceRemaining.value = 0;
  voiceTotal.value = 0;
};

// 图片气泡点击：上传中忽略，完成后进入相册预览
const onImageBubbleClick = (msg) => {
  if (msg.uploading || !msg.mediaUrl) return;
  previewImage(msg.mediaUrl);
};

// 图片加载失败：占位提示 + 点击重试（重试通过换 key 强制重建 image 节点）
const failedImageIds = ref(new Set());
const imgRetryTick = ref(0);

const onImageError = (msg) => {
  if (msg.uploading || !msg._id || String(msg._id).startsWith('temp-')) return;
  const next = new Set(failedImageIds.value);
  next.add(msg._id);
  failedImageIds.value = next;
};

const retryImage = (msg) => {
  const next = new Set(failedImageIds.value);
  next.delete(msg._id);
  failedImageIds.value = next;
  imgRetryTick.value++;
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

// 打开链接（H5 新窗口打开，noopener 断开与页面的关联防标签劫持；非 H5 复制到剪贴板）
const openLink = (url) => {
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer');
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
// 菜单模式：full 全功能菜单 / react 仅表情回应条（桌面悬停工具栏用）
const menuMode = ref('full');

// 在指定区域附近打开上下文菜单
const openMenuAt = (msg, rect, mode = 'full') => {
  menuMode.value = mode;
  const menuW = mode === 'react' ? 300 : 80;
  // 菜单项：复制(可选) + 回复 + 转发 + 多选 + 删除 + 撤回(可选)
  const itemCount = 4 + (canCopy(msg) ? 1 : 0) + (canRecall(msg) ? 1 : 0);
  const menuH = mode === 'react' ? 110 : itemCount * 50;
  const posX = Math.min(rect.left + rect.width / 2 - menuW / 2, window.innerWidth - menuW - 10);
  let posY = rect.top - menuH - 10;
  if (posY < 10) posY = Math.min(rect.bottom + 10, window.innerHeight - menuH - 10);
  contextMenuPos.value = { x: Math.max(10, posX), y: Math.max(10, posY) };
  contextMenuMsg.value = msg;
  menuJustOpened = true;
  setTimeout(() => { menuJustOpened = false; }, 300);
};

const onLongPress = (e, msg) => {
  // #ifdef H5
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  const x = touch?.clientX || e.detail?.x || 0;
  const y = touch?.clientY || e.detail?.y || 0;
  openMenuAt(msg, { left: x - 40, top: y - 20, width: 80, height: 40 }, 'full');
  // #endif
};

// 悬停工具栏：😊 仅回应条 / ⋯ 全功能菜单
const quickReact = (msg) => {
  const row = document.getElementById('msg-' + msg._id);
  if (!row) return;
  openMenuAt(msg, row.getBoundingClientRect(), 'react');
};

const quickMore = (msg, e) => {
  openMenuAt(msg, { left: e.clientX - 40, top: e.clientY - 15, width: 40, height: 30 }, 'full');
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

// 是否可以复制：文本类消息（TEXT 内容 / RICH 文本块拼接）
const canCopy = (msg) => {
  if (!msg || msg.recalled) return false;
  if (msg.type === 'TEXT') return !!msg.content;
  if (msg.type === 'RICH' && Array.isArray(msg.contentBlocks)) {
    return msg.contentBlocks.some(b => b.blockType === 'text' && b.content);
  }
  return false;
};

// 复制文本到剪贴板
const doCopy = async (msg) => {
  contextMenuMsg.value = null;
  // #ifdef H5
  const text = msg.type === 'RICH' && Array.isArray(msg.contentBlocks)
    ? msg.contentBlocks.filter(b => b.blockType === 'text').map(b => b.content).join('\n')
    : (msg.content || '');
  try {
    await navigator.clipboard.writeText(text);
    uni.showToast({ title: '已复制', icon: 'none' });
  } catch (e) {
    // 剪贴板 API 被拒绝时降级：选区 + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      uni.showToast({ title: '已复制', icon: 'none' });
    } catch (e2) {
      uni.showToast({ title: '复制失败', icon: 'none' });
    }
    ta.remove();
  }
  // #endif
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
  // 光标置于末尾并滚到底部，用户直接续写
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  scrollToBottom();
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
  // 深链刷新/通知直达会话时列表页可能未挂载，store 会话列表为空——
  // 反应者名字、转发目标、跳转等都依赖它，这里确保已加载（SWR 静默）
  chatStore.fetchConversations();

  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  const options = currentPage.$page?.options || currentPage.options || {};

  conversationId.value = options.conversationId;
  otherUserId.value = options.userId;
  otherNickname.value = decodeURIComponent(options.nickname || '');
  otherUsername.value = decodeURIComponent(options.username || '');
  isGroup.value = options.type === 'GROUP';
  // 全局通知/未读逻辑需要知道当前正在浏览的会话
  chatStore.setCurrentConversation({ _id: conversationId.value });

  // 群聊：拉取会话详情取成员数与成员列表（@提及选择用），标题用群名
  if (isGroup.value) {
    try {
      const res = await get(`/api/conversations/${conversationId.value}`, null, { silent: true });
      if (res.code === 200) {
        memberCount.value = res.data.memberCount || 0;
        groupMembers.value = res.data.members || [];
        otherNickname.value = res.data.name || otherNickname.value;
        groupAnnouncement.value = res.data.announcement || '';
      }
    } catch (e) {
      console.error('获取群信息失败:', e);
    }
  }

  const userInfo = userStore.getUserInfo;
  currentUserId.value = userInfo?._id || '';
  selfAvatarText.value = (userInfo?.nickname || userInfo?.username || '?').charAt(0).toUpperCase();

  // 对方在线状态初始值：取会话列表缓存（随后由 ONLINE_STATUS 实时校正）
  const cachedConv = chatStore.getConversations.find(c => c._id === conversationId.value);
  otherOnline.value = !!(cachedConv && cachedConv.otherUser && cachedConv.otherUser.online);

  uni.setNavigationBarTitle({ title: otherNickname.value });

  // 缓存优先：有缓存则立即渲染（秒开、无加载等待），再后台静默校验补齐离开期间的新消息
  const cached = chatStore.getCachedMessages(conversationId.value);
  if (cached && cached.messages.length) {
    messages.value = [...cached.messages];
    page.value = cached.page;
    hasMore.value = cached.hasMore;
    // 已读标记前取样"新消息"分隔线（缓存里的 read 标志是离开会话时的状态）
    const firstUnread = messages.value.find(m => !m.recalled && m.sender && m.sender._id !== currentUserId.value && !m.read);
    firstUnreadId.value = firstUnread ? firstUnread._id : '';
    nextTick(() => {
      // 有未读时定位到第一条未读（配合分隔线），否则贴底
      if (firstUnreadId.value) {
        scrollToMessage(firstUnreadId.value);
      } else {
        scrollToBottom();
      }
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
  wsClient.on('ONLINE_STATUS', onOnlineStatus);
  wsClient.on('MESSAGE_REACTION', onMessageReaction);
  uni.$on('peer-typing', onPeerTypingEvent);
  uni.$on('group-announcement', onGroupAnnouncementEvent);
  uni.$on('group-member-left', onGroupMemberLeft);
  startScrollProbe();

  // 搜索结果/外部链接携带 locateMsg：加载完成后直接定位到该消息
  if (options.locateMsg) {
    const locateId = options.locateMsg;
    nextTick(() => scrollToMessage(locateId));
  }

  // #ifdef H5
  nextTick(() => {
    const el = getEditorEl();
    if (el) {
      el.contentEditable = 'true';
      el.dataset.placeholder = '输入消息…';
      el.addEventListener('paste', handleEditorPaste);
      el.addEventListener('keydown', handleEditorKeyDown);
    }
    document.addEventListener('keydown', onDocKeyDown);
    // 恢复上次离开时未发送的草稿
    restoreDraft();
  });
  // #endif

  // #ifdef H5
  nextTick(() => {
    const list = document.querySelector('.message-list');
    if (list) msgListHeight.value = list.clientHeight;
  });
  // #endif
});

// 卸载前保存草稿（此时 DOM 仍在；清空或发送后为空即自动清除）
onBeforeUnmount(() => {
  saveDraft();
});

onUnmounted(() => {
  wsClient.off('NEW_MESSAGE', onNewMessage);
  wsClient.off('MESSAGE_SENT', onMessageSent);
  wsClient.off('RECONNECTED', onReconnected);
  wsClient.off('MESSAGE_RECALLED', onMessageRecalled);
  wsClient.off('MESSAGE_READ', onMessageRead);
  wsClient.off('TYPING', onPeerTyping);
  wsClient.off('ONLINE_STATUS', onOnlineStatus);
  wsClient.off('MESSAGE_REACTION', onMessageReaction);
  uni.$off('peer-typing', onPeerTypingEvent);
  uni.$off('group-announcement', onGroupAnnouncementEvent);
  uni.$off('group-member-left', onGroupMemberLeft);
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
  document.removeEventListener('keydown', onDocKeyDown);
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
  }  // 非首次加载：记录加载前的第一条消息 ID，加载后滚回该位置
  const firstMsgId = (!isFirst && messages.value.length > 0) ? messages.value[0]._id : null;
  const result = await chatStore.fetchMessages(conversationId.value, page.value);
  if (result) {
    msgLoadFailed.value = false;
    if (isFirst) {
      messages.value = result.messages;
      // 已读标记前取样：第一条对方发来且未读的消息，作为"新消息"分隔线
      const firstUnread = result.messages.find(m => !m.recalled && m.sender && m.sender._id !== currentUserId.value && !m.read);
      firstUnreadId.value = firstUnread ? firstUnread._id : '';
    } else {
      messages.value = [...result.messages, ...messages.value];
    }
    hasMore.value = result.pagination.page < result.pagination.pages;
    if (isFirst) {
      // 有未读时定位到第一条未读（配合分隔线），否则贴底
      if (firstUnreadId.value) {
        nextTick(() => scrollToMessage(firstUnreadId.value));
      } else {
        scrollToBottom();
      }
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
  } else if (isFirst) {
    // 首屏加载失败（网络/服务异常）：给出可见的重试入口而非空白
    msgLoadFailed.value = true;
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

// 让响应式数组中的代理对象与临时消息引用保持同步，确保上传状态及时刷新
const patchLocalMessage = (msg, patch) => {
  Object.assign(msg, patch);
  const local = messages.value.find(x => x._id === msg._id);
  if (local && local !== msg) Object.assign(local, patch);
};

// 发送并跟踪确认：未连接立即失败，已发出则启动 ACK 超时（重发复用同一 msg，不重复 push）
const sendWithAck = (msg, send) => {
  patchLocalMessage(msg, { status: 'sending' });
  if (!send(msg.clientId)) {
    patchLocalMessage(msg, { status: 'failed' });
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
  // 先以本地预览占位上屏，上传进度在气泡内展示（替代全局 loading）
  const tempMsg = {
    _id: 'temp-img-' + Date.now(),
    clientId: genClientId(),
    status: 'sending',
    uploading: true,
    uploadProgress: 0,
    conversationId: conversationId.value,
    sender: { _id: currentUserId.value },
    type: 'IMAGE',
    mediaUrl: '',
    thumbnailUrl: filePath, // 本地 blob 预览（getMediaUrl 对 blob: 直通）
    content: '[图片]',
    replyInfo,
    createdAt: new Date().toISOString()
  };
  messages.value.push(tempMsg);
  scrollToBottom();
  try {
    const uploadRes = await upload('/api/upload', filePath, 'file', {
      onProgress: (p) => { patchLocalMessage(tempMsg, { uploadProgress: p }); }
    });
    if (uploadRes.code === 200) {
      patchLocalMessage(tempMsg, {
        uploading: false,
        mediaUrl: uploadRes.data.url,
        thumbnailUrl: uploadRes.data.thumbnailUrl
      });
      sendWithAck(tempMsg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, '[图片]', 'IMAGE', uploadRes.data.url, uploadRes.data.thumbnailUrl, [], replyInfo, cid));
    } else {
      messages.value = messages.value.filter(m => m._id !== tempMsg._id);
      uni.showToast({ title: uploadRes.msg || '上传失败', icon: 'none' });
    }
  } catch (e) {
    messages.value = messages.value.filter(m => m._id !== tempMsg._id);
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
  updateMentionPicker();

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
  trackRecentEmoji(emoji);
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
    startWave(stream);
    requestScreenWakeLock(); // 录音期间屏幕常亮
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
  releaseScreenWakeLock();
  stopWave();
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
// 转发前确保会话列表已加载：深链刷新/通知直达会话时 store 可能为空
const ensureForwardTargets = () => {
  chatStore.fetchConversations();
};

const doForward = (msg) => {
  contextMenuMsg.value = null;
  forwardMsg.value = msg;
  ensureForwardTargets();
  showForwardModal.value = true;
};

// 单条转发：以同一内容向目标会话发送新消息（保留类型/媒体/时长/富文本，剥离回复引用与状态）
const forwardOne = (msg, target) => {
  if (!msg || !target) return;
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
};

// 确认转发：单条（长按菜单）或多选批量（时间正序逐条发送）
const confirmForward = (target) => {
  showForwardModal.value = false;
  // 转发走 WS 通道且无 ACK 重试机制，断线时明确失败而非假报成功
  if (!wsClient.isConnected) {
    uni.showToast({ title: '当前未连接，请稍后重试', icon: 'none' });
    return;
  }
  if (multiSelectMode.value) {
    const msgs = messages.value
      .filter(m => selectedMsgIds.value.has(m._id) && !m.recalled)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    msgs.forEach(m => forwardOne(m, target));
    exitMultiSelect();
    uni.showToast({ title: `已转发 ${msgs.length} 条消息`, icon: 'success' });
    return;
  }
  const msg = forwardMsg.value;
  if (!msg || !target) return;
  forwardOne(msg, target);
  uni.showToast({ title: '已转发', icon: 'success' });
};

// ========== 群信息 ==========
const openGroupInfo = async () => {
  try {
    const res = await get(`/api/conversations/${conversationId.value}`, null, { silent: true });
    if (res.code === 200) {
      groupInfo.value = res.data;
      groupNameDraft.value = res.data.name || '';
      announcementDraft.value = res.data.announcement || '';
      groupAnnouncement.value = res.data.announcement || '';
      memberCount.value = res.data.memberCount || 0;
      showGroupModal.value = true;
    }
  } catch (e) {
    console.error('获取群信息失败:', e);
  }
};

// 从群信息弹窗点击成员：关闭弹窗并插入 @提及（快捷定位到输入框）
const mentionFromModal = (member) => {
  if (!member || member._id === currentUserId.value) return;
  showGroupModal.value = false;
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, '@' + (member.nickname || member.username || '') + ' ');
  onEditorInput();
  // #endif
};

// 保存群公告（仅群主；成功后顶部公告条即时更新）
const saveAnnouncement = async () => {
  const announcement = announcementDraft.value.trim();
  try {
    const res = await put(`/api/conversations/${conversationId.value}/announcement`, { announcement }, { silent: true });
    if (res.code === 200) {
      groupInfo.value.announcement = res.data.announcement;
      groupAnnouncement.value = res.data.announcement;
      uni.showToast({ title: '公告已保存', icon: 'success' });
    }
  } catch (e) {
    console.error('保存群公告失败:', e);
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

// 录音/通话期间申请屏幕常亮（H5 Wake Lock，不支持时静默）
let screenWakeLock = null;
const requestScreenWakeLock = async () => {
  // #ifdef H5
  try {
    if (navigator.wakeLock) {
      screenWakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* 不支持或被拒绝不影响主流程 */ }
  // #endif
};
const releaseScreenWakeLock = () => {
  // #ifdef H5
  try {
    if (screenWakeLock) {
      screenWakeLock.release();
      screenWakeLock = null;
    }
  } catch (e) { /* ignore */ }
  // #endif
};

// 语音消息剩余秒数：播放中气泡倒计时（结束/暂停恢复总时长显示）
const voiceRemaining = ref(0);
// 当前播放语音的总时长（进度填充用）
const voiceTotal = ref(0);

const voiceProgress = computed(() => {
  if (!voiceTotal.value) return 0;
  return Math.min(100, Math.round((1 - voiceRemaining.value / voiceTotal.value) * 100));
});

// 播放/暂停语音（同时只播放一条）
const togglePlayVoice = (msg) => {
  // #ifdef H5
  if (playingId.value === msg._id) {
    currentAudio && currentAudio.pause();
    playingId.value = '';
    voiceRemaining.value = 0;
    voiceTotal.value = 0;
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(getMediaUrl(msg.mediaUrl));
  const total = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (msg.duration || 1);
  voiceRemaining.value = Math.ceil(total);
  voiceTotal.value = Math.ceil(total);
  audio.ontimeupdate = () => {
    voiceRemaining.value = Math.max(0, Math.ceil(total - audio.currentTime));
  };
  audio.onended = () => {
    // 自动连续播放列表中的下一条语音（微信式）；没有则复位
    const idx = messages.value.findIndex(m => m._id === msg._id);
    const next = messages.value.slice(idx + 1).find(m => m.type === 'VOICE' && m.mediaUrl && !m.recalled);
    if (next) {
      togglePlayVoice(next);
    } else {
      playingId.value = '';
      voiceRemaining.value = 0;
      voiceTotal.value = 0;
    }
  };
  audio.onerror = () => {
    playingId.value = '';
    voiceRemaining.value = 0;
    voiceTotal.value = 0;
    uni.showToast({ title: '播放失败', icon: 'none' });
  };
  currentAudio = audio;
  audio.play().catch(() => {
    playingId.value = '';
    voiceRemaining.value = 0;
    voiceTotal.value = 0;
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
  // 富文本粘贴（网页/文档携带的行内样式与结构）降级为纯文本，避免污染消息排版；
  // 纯文本来源（text/plain only）保持浏览器默认行为
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  if (html && text) {
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) {
        const br = document.createElement('br');
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
      }
      if (line) {
        const node = document.createTextNode(line);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
    });
    sel.removeAllRanges();
    sel.addRange(range);
    onEditorInput();
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
  // 输入法组合中（拼音选字等）的回车是确认候选词，不能当作发送
  if (e.isComposing || e.keyCode === 229) return;
  // @成员选择面板打开时：↑↓ 切换候选、Enter 选中（不发送消息）
  if (showMentionPicker.value && mentionCandidates.value.length) {
    const n = mentionCandidates.value.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mentionActiveIndex.value = e.key === 'ArrowDown'
        ? (mentionActiveIndex.value + 1) % n
        : (mentionActiveIndex.value - 1 + n) % n;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pickMention(mentionCandidates.value[mentionActiveIndex.value]);
      return;
    }
  }
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

// Esc 收起长按菜单 / 表情面板 / 功能面板（文档级：菜单打开时焦点不在编辑器）
// #ifdef H5
const onDocKeyDown = (e) => {
  // Ctrl/Cmd + F 呼出会话内搜索（拦截浏览器默认查找）
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    showSearch.value = true;
    // #ifdef H5
    nextTick(() => {
      const input = document.querySelector('.search-panel-input-field');
      if (input) input.focus();
    });
    // #endif
    return;
  }
  if (e.key !== 'Escape') return;
  if (contextMenuMsg.value) {
    contextMenuMsg.value = null;
    return;
  }
  if (multiSelectMode.value) {
    exitMultiSelect();
    return;
  }
  if (showMentionPicker.value) {
    showMentionPicker.value = false;
    return;
  }
  if (showSearch.value) {
    showSearch.value = false;
    return;
  }
  if (showEmojiPanel.value || showActionPanel.value) {
    closePanels();
  }
};
// #endif

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
  // 服务端上限 10000 字：超长时前端明确拦截（否则 HTTP/WS 静默失败）
  const totalLen = blocks.reduce((n, b) => n + (b.content || '').length, 0);
  if (totalLen > 10000) {
    uni.showToast({ title: '消息内容过长（最多 10000 字）', icon: 'none' });
    return;
  }
  closePanels();

  // 构建回复引用快照（在清空编辑器前）
  const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;

  // 清空编辑器
  const el = getEditorEl();
  if (el) el.innerHTML = '';
  hasEditorContent.value = false;

  // 发送后把焦点放回编辑器（点发送按钮会抢焦点，连续聊天不用再点一次）
  // #ifdef H5
  if (el) el.focus();
  // #endif

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
      // 本地预览占位上屏 + 气泡内进度（与图片一致，替代全局 loading）
      const replyInfo = replyToMsg.value ? buildReplyInfo(replyToMsg.value) : null;
      replyToMsg.value = null;
      const tempMsg = {
        _id: 'temp-vid-' + Date.now(),
        clientId: genClientId(),
        status: 'sending',
        uploading: true,
        uploadProgress: 0,
        conversationId: conversationId.value,
        sender: { _id: currentUserId.value },
        type: 'VIDEO',
        mediaUrl: filePath,
        content: '[视频]',
        replyInfo,
        createdAt: new Date().toISOString()
      };
      messages.value.push(tempMsg);
      scrollToBottom();
      try {
        const uploadRes = await upload('/api/upload', filePath, 'file', {
          onProgress: (p) => { patchLocalMessage(tempMsg, { uploadProgress: p }); }
        });
        if (uploadRes.code === 200) {
          patchLocalMessage(tempMsg, {
            uploading: false,
            mediaUrl: uploadRes.data.url
          });
          sendWithAck(tempMsg, (cid) => wsClient.sendMessage(conversationId.value, otherUserId.value, '[视频]', 'VIDEO', uploadRes.data.url, '', [], replyInfo, cid));
        } else {
          messages.value = messages.value.filter(m => m._id !== tempMsg._id);
          uni.showToast({ title: uploadRes.msg || '上传失败', icon: 'none' });
        }
      } catch (e) {
        messages.value = messages.value.filter(m => m._id !== tempMsg._id);
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

// 完整日期时间（时间徽章悬浮提示用）
const fullTime = (time) => {
  if (!time) return '';
  const d = new Date(time);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 消息加载失败标记（首屏）：展示重试入口
const msgLoadFailed = ref(false);

const retryLoad = () => {
  msgLoadFailed.value = false;
  loadMessages(true);
};

// 快捷打招呼（空会话引导）
const GREETINGS = ['你好！👋', '在吗？', '好久不见～', '晚上一起玩？'];

const quickSend = (text) => {
  // #ifdef H5
  const el = getEditorEl();
  if (!el) return;
  el.focus();
  document.execCommand('insertText', false, text);
  // #endif
  sendMessage();
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

/* 在线状态副标题：绿色点缀 */
.nav-subtitle-online {
  color: var(--color-success);
}

/* 群聊他人消息的发送者昵称 */
.group-sender-name {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  margin: 0 0 6rpx 8rpx;
}

.nav-search-btn {
  width: 88rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 24rpx;
  box-sizing: border-box;
}

.nav-search-btn:active {
  opacity: 0.6;
}

/* ========== 会话内消息搜索面板 ========== */
.search-panel {
  position: fixed;
  top: 96rpx;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  max-height: 56vh;
  display: flex;
  flex-direction: column;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1rpx solid var(--color-border);
  box-shadow: var(--shadow-md);
  z-index: 95;
  box-sizing: border-box;
}

.search-panel-input {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 16rpx 24rpx;
  padding: 0 20rpx;
  height: 72rpx;
  background: var(--color-input-bg);
  border-radius: 999rpx;
  flex-shrink: 0;
}

.search-panel-input-field {
  flex: 1;
  height: 100%;
  font-size: 26rpx;
  color: var(--color-text-primary);
}

.search-panel-placeholder {
  color: var(--color-text-tertiary);
}

.search-panel-clear {
  padding: 8rpx;
}

.search-panel-go {
  padding: 8rpx 24rpx;
  background: var(--gradient-primary);
  border-radius: 999rpx;
}

.search-panel-go:active {
  transform: scale(0.94);
}

.search-panel-go-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #FFFFFF;
}

.search-results {
  flex: 1;
  min-height: 0;
  padding: 0 24rpx 24rpx;
  box-sizing: border-box;
}

.search-state {
  padding: 48rpx 0;
  display: flex;
  justify-content: center;
}

.search-state-text {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

.search-result-item {
  padding: 20rpx 20rpx;
  border-radius: 16rpx;
  margin-bottom: 8rpx;
  background: var(--color-card);
  border: 1rpx solid var(--glass-border);
  transition: transform 0.15s ease;
}

.search-result-item:active {
  transform: scale(0.98);
}

.search-result-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8rpx;
}

.search-result-name {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.search-result-time {
  font-size: 20rpx;
  color: var(--color-text-tertiary);
}

.search-result-content {
  font-size: 26rpx;
  line-height: 1.5;
  word-break: break-all;
}

.search-result-text {
  color: var(--color-text-primary);
}

.search-result-hit {
  color: var(--color-primary);
  font-weight: 700;
}

/* ========== 表情回应 ========== */
.reaction-strip {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 10rpx 12rpx 6rpx;
}

.reaction-strip-emoji {
  font-size: 44rpx;
  padding: 6rpx;
  transition: transform 0.15s ease;
}

.reaction-strip-emoji:active {
  transform: scale(1.3);
}

.reaction-strip-divider {
  height: 1rpx;
  background: rgba(255, 255, 255, 0.12);
  margin: 4rpx 0;
}

.reaction-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 8rpx;
}

.reaction-chip {
  display: flex;
  align-items: center;
  gap: 4rpx;
  padding: 4rpx 14rpx;
  background: var(--color-quote-bg);
  border: 2rpx solid transparent;
  border-radius: 999rpx;
}

.reaction-chip:active {
  transform: scale(0.92);
}

.reaction-chip--mine {
  background: rgba(255, 107, 107, 0.12);
  border-color: var(--color-primary);
}

.reaction-chip-emoji {
  font-size: 26rpx;
  line-height: 1.2;
}

.reaction-chip-count {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* ========== 桌面悬停工具栏 ========== */
.bubble-col {
  position: relative;
}

.bubble-quickbar {
  position: absolute;
  top: -30rpx;
  display: flex;
  align-items: center;
  gap: 4rpx;
  padding: 4rpx 10rpx;
  background: var(--color-nav);
  border: 1rpx solid var(--glass-border);
  border-radius: 999rpx;
  box-shadow: var(--shadow-sm);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 30;
}

/* 他人消息：工具栏在气泡右侧；自己消息：在左侧 */
.bubble-quickbar {
  left: calc(100% + 10rpx);
}

.bubble-quickbar--self {
  left: auto;
  right: calc(100% + 10rpx);
}

/* 桌面悬停显示；触屏设备（无 hover 能力）隐藏 */
.bubble:hover .bubble-quickbar,
.bubble-quickbar:hover {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .bubble-quickbar {
    display: none;
  }
}

.quickbar-btn {
  font-size: 26rpx;
  padding: 4rpx 10rpx;
  cursor: pointer;
  line-height: 1.4;
}

.quickbar-btn:active {
  transform: scale(0.9);
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
  position: relative;
  margin-bottom: 28rpx;
  width: 100%;
}

/* ========== 多选消息 ========== */
.select-check {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: -52rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 3rpx solid var(--color-border);
  background: var(--color-card-solid);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.select-check--self {
  left: auto;
  right: -52rpx;
}

.select-check--on {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.multiselect-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
}

.ms-count {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.ms-btn {
  padding: 14rpx 30rpx;
  background: var(--color-bg);
  border-radius: 999rpx;
}

.ms-btn:active {
  transform: scale(0.95);
}

.ms-btn-primary {
  background: var(--gradient-primary);
}

.ms-btn--disabled {
  opacity: 0.5;
}

.ms-btn-danger {
  background: rgba(248, 113, 113, 0.12);
}

.ms-btn-text-danger {
  color: var(--color-error);
}

.ms-btn-text {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.ms-btn-text-primary {
  color: #FFFFFF;
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
  min-height: 120rpx;
  border-radius: 12rpx;
  display: block;
  /* 加载期间以中性底色占位，避免空白闪现 */
  background: var(--color-quote-bg);
  min-width: 200rpx;
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

/* 群公告编辑（群主）与只读展示（成员） */
.gi-announcement-input {
  width: 100%;
  min-height: 120rpx;
  max-height: 240rpx;
  background: var(--color-bg);
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  box-sizing: border-box;
  font-size: 26rpx;
  color: var(--color-text-primary);
  line-height: 1.5;
}

.gi-announcement-text {
  font-size: 26rpx;
  color: var(--color-text-primary);
  line-height: 1.5;
}

/* 公告底栏：字数统计 + 保存按钮 */
.gi-announcement-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
}

.gi-announcement-count {
  font-size: 20rpx;
  color: var(--color-text-tertiary);
}

.gi-announcement-count-limit {
  color: var(--color-error);
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
/* 消息行头像按钮（群聊快捷 @ 的点击区，自己头像无交互） */
.msg-avatar-btn {
  flex-shrink: 0;
  border-radius: 20rpx;
}

.msg-avatar-btn--plain {
  cursor: default;
}

/* 群公告条（消息列表顶部，随内容滚动） */
.announcement-bar {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin: 8rpx 0 4rpx;
  padding: 12rpx 20rpx;
  background: rgba(255, 107, 107, 0.08);
  border-radius: 14rpx;
}

.announcement-bar:active {
  opacity: 0.7;
}

.announcement-bar-text {
  flex: 1;
  font-size: 24rpx;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 语音条播放进度填充线 */
.voice-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5rpx;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
  border-radius: 0 0 16rpx 16rpx;
}

.voice-progress-fill {
  height: 100%;
  background: currentColor;
  transition: width 0.3s linear;
}

.voice-bubble {
  position: relative;
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

/* "以下为新消息"分隔线：品牌红胶囊，与时间徽章同层 */
.unread-divider {
  display: flex;
  justify-content: center;
  margin: 24rpx 0 16rpx;
}

.unread-divider-text {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--color-error);
  background: rgba(248, 113, 113, 0.12);
  padding: 8rpx 28rpx;
  border-radius: 999rpx;
}

/* 录音实时音量波形：贴底对齐，电平驱动条高 */
.recording-wave {
  flex: 1;
  height: 44rpx;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 6rpx;
  min-width: 0;
}

.recording-wave-bar {
  width: 8rpx;
  border-radius: 4rpx;
  background: var(--color-primary);
  opacity: 0.75;
  transition: height 0.12s linear;
}

.recording-cancel {
  padding: 12rpx 26rpx;
  background: var(--color-bg);
  border-radius: 999rpx;
  flex-shrink: 0;
}

.recording-cancel:active {
  transform: scale(0.95);
}

.recording-cancel-text {
  font-size: 24rpx;
  color: var(--color-text-secondary);
}

/* 结束并发送：渐变主按钮，录音中一眼可见的结束入口 */
.recording-send {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 14rpx 28rpx;
  background: var(--gradient-primary);
  border-radius: 999rpx;
  box-shadow: var(--shadow-primary);
  flex-shrink: 0;
}

.recording-send:active {
  transform: scale(0.95);
}

.recording-send-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #FFFFFF;
}

/* 图片加载失败占位 */
.image-load-failed {
  min-height: 160rpx;
  border: 2rpx dashed var(--color-border);
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

.image-load-failed-text {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

/* 图片上传进度遮罩 */
.bubble-image-wrap {
  position: relative;
  display: block;
}

.image-uploading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 16rpx;
}

.image-uploading-spinner {
  width: 44rpx;
  height: 44rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.4);
  border-top-color: #FFFFFF;
  border-radius: 50%;
  animation: global-loading-spin 1s linear infinite;
}

.image-uploading-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #FFFFFF;
}

/* @提及高亮（群聊消息文本中的 @昵称） */
.bubble-mention {
  color: #FFD166;
  font-weight: 700;
}

/* @提及成员选择面板（与表情面板一致：输入栏上方文档流展开） */
.mention-picker {
  max-height: 420rpx;
  overflow-y: auto;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
  z-index: 90;
}

.mention-picker-title {
  padding: 16rpx 28rpx 4rpx;
}

.mention-picker-title-text {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 28rpx;
}

.mention-item:active {
  background: var(--color-quote-bg);
}

.mention-item--active {
  background: var(--color-quote-bg);
}

.mention-item-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-item-username {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
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
  flex-direction: column;
  gap: 8rpx;
  padding: 20rpx 24rpx;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid var(--color-border);
  max-height: 320rpx;
  overflow-y: auto;
}

/* 分区（最近使用 / 全部表情）：无最近使用时不渲染分区结构，保持原有平铺 */
.emoji-section {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.emoji-section-label {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  padding: 4rpx 4rpx 0;
}

.emoji-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
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

/* ========== 空会话快捷打招呼 ========== */
.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 100rpx 40rpx;
}

.empty-chat-emoji {
  font-size: 64rpx;
}

.empty-chat-text {
  font-size: 26rpx;
  color: var(--color-text-tertiary);
}

.empty-chat-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16rpx;
  margin-top: 12rpx;
}

.empty-chat-chip {
  padding: 12rpx 28rpx;
  background: var(--color-card);
  border: 1rpx solid var(--glass-border);
  border-radius: 999rpx;
}

.empty-chat-chip:active {
  transform: scale(0.94);
  background: rgba(255, 107, 107, 0.1);
}

.empty-chat-chip-text {
  font-size: 24rpx;
  color: var(--color-primary);
}

/* ========== 消息加载失败重试 ========== */
.msg-load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 80rpx 0;
}

.msg-load-error-text {
  font-size: 28rpx;
  color: var(--color-text-secondary);
}

.msg-load-retry {
  padding: 14rpx 40rpx;
  background: var(--gradient-primary);
  border-radius: 999rpx;
}

.msg-load-retry:active {
  transform: scale(0.95);
}

.msg-load-retry-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #FFFFFF;
}
</style>
