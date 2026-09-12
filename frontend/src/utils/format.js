/**
 * 通用格式化 / 展示工具
 * 抽取自 list / detail / contacts / profile 各页的重复实现，统一维护。
 */
import { MEDIA_BASE_URL } from '@/utils/request';

/**
 * 拼接媒体资源完整地址：绝对地址原样返回，相对地址补上 MEDIA_BASE_URL。
 * blob:/data: 等本地预览地址直通（上传进度中的本地图片预览）。
 */
export const getMediaUrl = (url) => {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  return MEDIA_BASE_URL + url;
};

/**
 * 头像渐变色板（Warm Mist）——统一 6 色，按名称首字符稳定取色。
 */
export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #FF6B6B, #FFB88C)',
  'linear-gradient(135deg, #A78BFA, #818CF8)',
  'linear-gradient(135deg, #34D399, #6EE7B7)',
  'linear-gradient(135deg, #FBBF24, #F59E0B)',
  'linear-gradient(135deg, #F472B6, #EC4899)',
  'linear-gradient(135deg, #38BDF8, #0EA5E9)',
];

/**
 * 依据用户昵称/用户名首字符，稳定返回一个头像渐变色。
 */
export const getAvatarGradient = (user) => {
  if (!user) return AVATAR_GRADIENTS[0];
  const charCode = (user.nickname || user.username || '?').charCodeAt(0);
  return AVATAR_GRADIENTS[charCode % AVATAR_GRADIENTS.length];
};

/**
 * 头像占位文字：取昵称/用户名首字符大写。
 */
export const getAvatarText = (user) => {
  if (!user) return '?';
  return (user.nickname || user.username || '?').charAt(0).toUpperCase();
};

/**
 * 会话列表时间：刚刚 / x分钟前 / 今日 HH:mm / 昨天 HH:mm / 星期X / M/D。
 */
export const formatListTime = (time) => {
  if (!time) return '';
  const date = new Date(time);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  const hhmm = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return hhmm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天 ' + hhmm;
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (days < 7) return '星期' + '日一二三四五六'[date.getDay()];
  return (date.getMonth() + 1) + '/' + date.getDate();
};

/**
 * 聊天时间分隔：今日 HH:mm / M月D日 HH:mm。
 */
export const formatMessageTime = (time) => {
  const date = new Date(time);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hm = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
  if (isToday) return hm;
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hm;
};
