/**
 * H5 消息提醒（仅 H5 端生效，其他端各方法安全降级为 no-op）
 * - 桌面通知开关持久化在本地存储 'notifyEnabled'；提示音开关 'soundEnabled'（默认开）
 * - 提醒分三层，随场景选择，避免"只有声音没有任何可见提示"：
 *   1) 页面可见且不在该会话 → 应用内顶部横幅（点击直达会话）
 *   2) 页面在后台          → 桌面系统通知（需用户开启且浏览器已授权），点击直达会话
 *   3) 非当前会话/后台      → 提示音（可开关）
 * - 免打扰会话三层提醒全部静默；自己在其他端发出的消息不提醒
 */
import wsClient from '@/utils/socket';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { getMediaUrl } from '@/utils/format';

const STORAGE_KEY = 'notifyEnabled';
const SOUND_KEY = 'soundEnabled';

export const isNotificationEnabled = () => {
  // #ifdef H5
  return uni.getStorageSync(STORAGE_KEY) === '1';
  // #endif
  return false;
};

/** 提示音是否开启（未设置过默认开启） */
export const isSoundEnabled = () => {
  // #ifdef H5
  return uni.getStorageSync(SOUND_KEY) !== '0';
  // #endif
  return true;
};

/** 开关提示音，返回切换后的状态 */
export const toggleSound = () => {
  // #ifdef H5
  const next = !isSoundEnabled();
  uni.setStorageSync(SOUND_KEY, next ? '1' : '0');
  return next;
  // #endif
  return false;
};

/**
 * 开关桌面通知：开启时向浏览器申请授权
 * @returns {Promise<{enabled: boolean, reason?: string}>}
 */
export const toggleNotifications = async () => {
  // #ifdef H5
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { enabled: false, reason: '当前环境不支持消息通知' };
  }
  if (isNotificationEnabled()) {
    uni.removeStorageSync(STORAGE_KEY);
    return { enabled: false };
  }
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { enabled: false, reason: '浏览器通知权限被拒绝，请在浏览器设置中开启' };
  }
  uni.setStorageSync(STORAGE_KEY, '1');
  return { enabled: true };
  // #endif
};

/**
 * 消息提示音：WebAudio 合成的两音短促"叮咚"，无资源文件依赖
 */
export const playMessageTone = () => {
  // #ifdef H5
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = playMessageTone._ctx || (playMessageTone._ctx = new Ctx());
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const now = ctx.currentTime;
    [[880, 0, 0.12], [1174.66, 0.1, 0.18]].forEach(([freq, delay, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.09, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  } catch (e) { /* 忽略音频设备缺失 */ }
  // #endif
};

// 预览文案：图片/视频/语音/富文本转摘要，与会话列表预览规则一致
const buildPreview = (msg) => {
  if (msg.recalled) return '撤回了一条消息';
  if (msg.type === 'IMAGE') return '[图片]';
  if (msg.type === 'VIDEO') return '[视频]';
  if (msg.type === 'VOICE') return `[语音] ${msg.duration || 1}″`;
  if (msg.type === 'RICH' && msg.contentBlocks) {
    const text = msg.contentBlocks
      .map(b => (b.blockType === 'image' ? '[图片]' : b.content))
      .join(' ')
      .replace(/\n/g, ' ')
      .trim();
    return text || '[富文本]';
  }
  return msg.content || '';
};

/**
 * 跳转到指定会话的聊天页：从会话列表取展示信息拼参数；
 * 会话不在列表（已删除/隐藏）时退回消息列表页
 */
export const navigateToConversation = (conversationId) => {
  const conv = useChatStore().getConversations.find(c => c._id === conversationId);
  if (!conv) {
    uni.switchTab({ url: '/pages/chat/list' });
    return;
  }
  let url;
  if (conv.type === 'GROUP') {
    url = `/pages/chat/detail?conversationId=${conv._id}&type=GROUP&name=${encodeURIComponent(conv.name || '群聊')}`;
  } else {
    const u = conv.otherUser || {};
    url = `/pages/chat/detail?conversationId=${conv._id}&userId=${u._id}&nickname=${encodeURIComponent(u.remark || u.nickname || u.username || '')}&username=${encodeURIComponent(u.username || '')}`;
  }
  uni.navigateTo({ url, fail: () => uni.switchTab({ url: '/pages/chat/list' }) });
};

// ========== 应用内消息横幅（页面可见但不在该会话时的可见提醒） ==========
// uni-app H5 下 App.vue 的 <template> 不渲染，无法挂全局 Vue 组件；
// 直接往 document.body 挂 DOM（notify 本就是 H5 专属模块），样式读 CSS 变量自动跟随明暗主题。

const BANNER_STYLE_ID = 'hc-inapp-banner-style';
const BANNER_STYLE = `
.hc-msg-banner {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translate(-50%, -130%);
  width: min(440px, calc(100% - 24px));
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  box-sizing: border-box;
  border-radius: 16px;
  background: var(--color-nav);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  cursor: pointer;
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.hc-msg-banner--show { transform: translate(-50%, 0); }
.hc-msg-banner--leave { opacity: 0; transform: translate(-50%, -130%); }
.hc-msg-banner__avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.hc-msg-banner__fallback {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gradient-primary);
  color: #FFFFFF;
  font-size: 15px;
  font-weight: 600;
}
.hc-msg-banner__meta { flex: 1; min-width: 0; }
.hc-msg-banner__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hc-msg-banner__preview {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hc-msg-banner__tag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-primary);
  background: rgba(255, 107, 107, 0.1);
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 600;
}
`;
// 群聊横幅在名字前缀 [群] 标识

let bannerEl = null;
let bannerTimer = null;

const removeBanner = () => {
  if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
};

// 挂载横幅骨架（头像区/文本区/查看标签 + 弹入动画 + 自动消失），返回内容填充回调所需的结构
const mountBanner = (onTap) => {
  // #ifdef H5
  if (typeof document === 'undefined' || document.hidden) return null;
  if (!document.getElementById(BANNER_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = BANNER_STYLE_ID;
    style.textContent = BANNER_STYLE;
    document.head.appendChild(style);
  }
  removeBanner();

  const el = document.createElement('div');
  el.className = 'hc-msg-banner';
  el.addEventListener('click', () => {
    removeBanner();
    if (onTap) onTap();
  });
  document.body.appendChild(el);
  bannerEl = el;
  // 下一帧再加 show 类，保证从初始位滑入的过渡动画生效
  requestAnimationFrame(() => el.classList.add('hc-msg-banner--show'));
  bannerTimer = setTimeout(() => {
    if (!bannerEl) return;
    bannerEl.classList.add('hc-msg-banner--leave');
    setTimeout(removeBanner, 300);
  }, 4000);
  return el;
  // #endif
};

// 头像区：有头像用图片，否则渐变底首字
const appendBannerAvatar = (el, avatar, fallbackChar) => {
  // #ifdef H5
  if (avatar) {
    const img = document.createElement('img');
    img.className = 'hc-msg-banner__avatar';
    img.src = getMediaUrl(avatar);
    el.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.className = 'hc-msg-banner__fallback';
    fb.textContent = fallbackChar;
    el.appendChild(fb);
  }
  // #endif
};

const appendBannerText = (el, name, preview) => {
  // #ifdef H5
  const meta = document.createElement('div');
  meta.className = 'hc-msg-banner__meta';
  const nameEl = document.createElement('div');
  nameEl.className = 'hc-msg-banner__name';
  nameEl.textContent = name || '';
  const prevEl = document.createElement('div');
  prevEl.className = 'hc-msg-banner__preview';
  prevEl.textContent = preview || '';
  meta.appendChild(nameEl);
  meta.appendChild(prevEl);
  el.appendChild(meta);
  const tag = document.createElement('div');
  tag.className = 'hc-msg-banner__tag';
  tag.textContent = '查看';
  el.appendChild(tag);
  // #endif
};

/** 弹出应用内消息横幅；4s 自动消失，点击直达会话；新消息到来时替换旧横幅 */
export const showInAppBanner = ({ conversationId, senderName, preview, avatar, isGroup }) => {
  // #ifdef H5
  const el = mountBanner(() => navigateToConversation(conversationId));
  if (!el) return;
  appendBannerAvatar(el, avatar, (senderName || '消').charAt(0));
  appendBannerText(el, (isGroup ? '[群聊] ' : '') + (senderName || '新消息'), preview || '');
  // #endif
};

/** 事件横幅（好友请求/群邀请等）：结构与消息横幅一致，点击执行 onTap */
export const showEventBanner = ({ iconChar, title, text, onTap }) => {
  // #ifdef H5
  const el = mountBanner(onTap);
  if (!el) return;
  appendBannerAvatar(el, '', (iconChar || '🔔').charAt(0));
  appendBannerText(el, title || '', text || '');
  // #endif
};

// ========== 后台未读时标签页标题闪动提醒 ==========
// 页面在后台且有未读时，标题在「💬 N 条新消息」与站名间交替，回到前台即恢复常显计数
let titleBlinkTimer = null;
let titleBlinkOn = false;
let visibilityHooked = false;

const readTotalUnread = () => useChatStore().getConversations
  .filter(c => !c.muted)
  .reduce((sum, c) => sum + (c.unreadCount || 0), 0);

// ========== Favicon 未读角标（canvas 生成品牌图标 + 红色数字） ==========
const updateFavicon = (count) => {
  // #ifdef H5
  if (typeof document === 'undefined') return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    // 底：品牌渐变圆角
    const g = ctx.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, '#FF6B6B');
    g.addColorStop(1, '#A78BFA');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.font = '34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💬', 32, 30);
    if (count > 0) {
      ctx.beginPath();
      ctx.arc(50, 14, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#F87171';
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(count > 99 ? '9+' : String(count), 50, 15);
    }
    let link = document.querySelector('link[rel*="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
  } catch (e) { /* canvas 异常不影响主流程 */ }
  // #endif
};

const refreshTitle = () => {
  // #ifdef H5
  const total = readTotalUnread();
  document.title = total > 0 ? `(${total}) HappyChat` : 'HappyChat';
  updateFavicon(total);
  // #endif
};

const stopTitleBlink = () => {
  if (titleBlinkTimer) {
    clearInterval(titleBlinkTimer);
    titleBlinkTimer = null;
  }
};

const startTitleBlink = () => {
  // #ifdef H5
  if (titleBlinkTimer) return;
  titleBlinkOn = false;
  titleBlinkTimer = setInterval(() => {
    const total = readTotalUnread();
    if (total <= 0) {
      stopTitleBlink();
      refreshTitle();
      return;
    }
    titleBlinkOn = !titleBlinkOn;
    document.title = titleBlinkOn ? `💬 ${total} 条新消息 · HappyChat` : 'HappyChat';
    updateFavicon(total);
  }, 1200);
  // #endif
};

// 群聊消息是否 @ 了我：按内容包含我的昵称/用户名判断（@提及为纯文本约定，无需协议扩展）
const mentionedMe = (msg, conv) => {
  if (!conv || conv.type !== 'GROUP') return false;
  const u = useUserStore().getUserInfo || {};
  const text = buildPreview(msg);
  return !!(text && [u.nickname, u.username].filter(Boolean).some(n => text.includes('@' + n)));
};

/** 登出时重置标题与 favicon 为无未读状态 */
export const resetTitleBadge = () => {
  // #ifdef H5
  stopTitleBlink();
  document.title = 'HappyChat';
  updateFavicon(0);
  // #endif
};

/**
 * 注册全局 NEW_MESSAGE 通知处理器（App.vue 启动 / 用户登录后各调用一次；
 * wsClient.disconnect 会清空处理器，因此两处注册不会叠加）
 */
export const registerNotificationHandler = () => {
  // #ifdef H5
  // 回到前台：停止标题闪动并恢复按未读数的常显标题
  if (!visibilityHooked && typeof document !== 'undefined') {
    visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        stopTitleBlink();
        refreshTitle();
      }
    });
    // 启动即绘制品牌 favicon（带当前未读角标）
    updateFavicon(readTotalUnread());
  }

  // 首次使用引导：一次性横幅建议开启桌面通知（点横幅即申请授权，无论结果不再打扰）
  setTimeout(() => {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window &&
          Notification.permission === 'default' &&
          !uni.getStorageSync('notifyGuideShown')) {
        uni.setStorageSync('notifyGuideShown', '1');
        showEventBanner({
          iconChar: '🔔',
          title: '开启桌面通知',
          text: '页面在后台时不错过任何新消息',
          onTap: async () => { await toggleNotifications(); }
        });
      }
    } catch (e) { /* ignore */ }
  }, 3000);
  wsClient.on('NEW_MESSAGE', (msg) => {
    try {
      // 自己在其他端发出的消息（多端同步回显）不提醒
      const myId = useUserStore().getUserInfo?._id;
      if (msg.sender && msg.sender._id && msg.sender._id === myId) return;

      // 免打扰会话静默；但群聊 @ 我时穿透提醒（微信同规则）
      const conv = useChatStore().getConversations.find(c => c._id === msg.conversationId);
      if (conv && conv.muted && !mentionedMe(msg, conv)) return;

      const viewingIt = useChatStore().currentConversation && useChatStore().currentConversation._id === msg.conversationId;
      const senderName = (msg.sender && (msg.sender.nickname || msg.sender.username)) || '新消息';
      const preview = buildPreview(msg);

      // 提示音：消息来自非当前会话，或页面处于后台
      if (!document.hidden && viewingIt) {
        // 正看着这个会话：对方再发消息不响铃不弹横幅
        return;
      }
      if (isSoundEnabled()) playMessageTone();

      // 页面在后台：标签页标题闪动提醒（不依赖任何授权）
      if (document.hidden) startTitleBlink();

      // 页面可见但不在该会话：应用内横幅（可见提醒，不依赖浏览器授权）
      if (!document.hidden) {
        showInAppBanner({
          conversationId: msg.conversationId,
          senderName,
          preview,
          avatar: msg.sender && msg.sender.avatar,
          isGroup: conv ? conv.type === 'GROUP' : false
        });
        return;
      }

      // 页面在后台：桌面系统通知（需已开启且已授权），点击直达会话；群聊标题带群名
      if (!isNotificationEnabled()) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      const notifTitle = (conv && conv.type === 'GROUP' && conv.name) ? `${conv.name} · ${senderName}` : senderName;
      const notification = new Notification(notifTitle, {
        body: preview,
        tag: msg.conversationId, // 同一会话的通知合并，避免刷屏
        icon: msg.sender && msg.sender.avatar ? getMediaUrl(msg.sender.avatar) : undefined
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
        navigateToConversation(msg.conversationId);
      };
    } catch (e) {
      console.error('桌面通知失败:', e);
    }
  });

  // 好友请求：全局横幅提醒，点击直达通讯录
  wsClient.on('FRIEND_REQUEST', (data) => {
    try {
      const who = data && data.requester && (data.requester.nickname || data.requester.username) || '有人';
      showEventBanner({
        iconChar: '👤',
        title: '好友请求',
        text: `${who} 请求添加你为好友`,
        onTap: () => uni.switchTab({ url: '/pages/contacts/contacts' })
      });
      if (isSoundEnabled()) playMessageTone();
    } catch (e) {
      console.error('好友请求提醒失败:', e);
    }
  });

  // 被拉入群聊：全局横幅提醒，点击直达消息列表
  wsClient.on('GROUP_ADDED', (data) => {
    try {
      showEventBanner({
        iconChar: '👥',
        title: '群聊邀请',
        text: data && data.name ? `你被邀请加入「${data.name}」` : '你被邀请加入了新的群聊',
        onTap: () => uni.switchTab({ url: '/pages/chat/list' })
      });
      if (isSoundEnabled()) playMessageTone();
    } catch (e) {
      console.error('群聊邀请提醒失败:', e);
    }
  });

  // 有成员退群：提示并强刷会话列表；正在浏览该群详情时经事件总线刷新群信息弹窗
  wsClient.on('GROUP_MEMBER_LEFT', (data) => {
    try {
      uni.showToast({ title: data && data.nickname ? `${data.nickname} 退出了群聊` : '有成员退出了群聊', icon: 'none' });
      useChatStore().fetchConversations({ force: true });
      uni.$emit('group-member-left', data);
    } catch (e) {
      console.error('退群提醒失败:', e);
    }
  });

  // 群解散：本地移除会话；若正在浏览该群详情则退出到列表
  wsClient.on('GROUP_DISBANDED', (data) => {
    try {
      const cs = useChatStore();
      const convId = data && data.conversationId;
      if (!convId) return;
      // 先记录是否正浏览该群，移除后 currentConversation 必为空，不能再以其判断
      const wasViewing = cs.currentConversation && cs.currentConversation._id === convId;
      cs.removeConversationLocal(convId);
      uni.showToast({ title: data && data.name ? `「${data.name}」已解散` : '群聊已解散', icon: 'none' });
      if (wasViewing) {
        const pages = getCurrentPages();
        const top = pages[pages.length - 1];
        if (top && top.route && top.route.indexOf('pages/chat/detail') !== -1) {
          uni.switchTab({ url: '/pages/chat/list' });
        }
      }
    } catch (e) {
      console.error('群解散处理失败:', e);
    }
  });

  // 群公告更新：浏览中的公告条经事件总线即时刷新，未浏览弹提示
  wsClient.on('GROUP_ANNOUNCEMENT', (data) => {
    try {
      const cs = useChatStore();
      const viewing = cs.currentConversation && cs.currentConversation._id === (data && data.conversationId);
      uni.$emit('group-announcement', data);
      if (!viewing) {
        uni.showToast({ title: data && data.name ? `「${data.name}」更新了群公告` : '群公告已更新', icon: 'none' });
      }
    } catch (e) {
      console.error('群公告提醒失败:', e);
    }
  });
  // #endif
};
