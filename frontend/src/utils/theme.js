/**
 * 主题（浅色 / 深色 / 跟随系统）管理
 * - 模式持久化在本地存储 'themeMode'：'system' | 'light' | 'dark'，默认跟随系统
 * - 兼容旧版存储：旧 key 'theme'（'light'|'dark'）自动迁移为显式手动模式
 * - H5 通过在 <html> 上切换 .dark 类使 CSS 变量整体切换
 * - 同步 uni TabBar 的配色（pages.json 中的 tabBar 配色是静态的，运行时经此接口更新）
 * - 每次生效主题变化都会 uni.$emit('theme-changed', mode)，供页面同步开关/图标状态
 */

const MODE_KEY = 'themeMode';
const LEGACY_KEY = 'theme';

/** 读取当前主题模式（'system' | 'light' | 'dark'），含旧存储迁移 */
export const getThemeMode = () => {
  const mode = uni.getStorageSync(MODE_KEY);
  if (mode === 'system' || mode === 'light' || mode === 'dark') return mode;
  const legacy = uni.getStorageSync(LEGACY_KEY);
  if (legacy === 'light' || legacy === 'dark') {
    uni.setStorageSync(MODE_KEY, legacy);
    uni.removeStorageSync(LEGACY_KEY);
    return legacy;
  }
  return 'system';
};

/** 由模式解析实际生效主题：跟随系统时读 prefers-color-scheme */
export const resolveTheme = (mode) => {
  // #ifdef H5
  if (mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  // #endif
  return mode === 'dark' ? 'dark' : 'light';
};

/**
 * 应用主题：切换根类名 + 更新 TabBar 配色
 * @param {'light'|'dark'} theme
 */
const applyTheme = (theme) => {
  // #ifdef H5
  // 切换瞬间开启全局颜色过渡（App.vue 中 html.theme-transition 规则），450ms 后移除避免常驻开销
  const root = document.documentElement;
  root.classList.add('theme-transition');
  setTimeout(() => root.classList.remove('theme-transition'), 450);
  root.classList.toggle('dark', theme === 'dark');
  uni.setTabBarStyle({
    backgroundColor: theme === 'dark' ? '#1E1E2A' : '#FFFFFF',
    color: theme === 'dark' ? '#6E6E80' : '#9CA3AF',
    selectedColor: '#FF6B6B',
    borderStyle: theme === 'dark' ? 'black' : 'white',
    fail: () => {}
  });
  // #endif
};

/** 设置主题模式并立即生效；返回模式名 */
export const setThemeMode = (mode) => {
  if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return getThemeMode();
  uni.setStorageSync(MODE_KEY, mode);
  applyTheme(resolveTheme(mode));
  uni.$emit('theme-changed', mode);
  return mode;
};

/** 初始化：按已存模式应用主题，并在"跟随系统"时监听系统偏好实时切换 */
export const initTheme = () => {
  applyTheme(resolveTheme(getThemeMode()));
  // #ifdef H5
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      // 仅跟随系统模式下随系统实时切换；手动模式不受系统变化影响
      if (getThemeMode() === 'system') {
        applyTheme(resolveTheme('system'));
        uni.$emit('theme-changed', 'system');
      }
    });
  }
  // #endif
  return resolveTheme(getThemeMode());
};

/** 快捷反转主题（列表页顶栏按钮）：以当前生效主题反转，并写入显式手动模式 */
export const toggleTheme = () => {
  const current = resolveTheme(getThemeMode());
  const next = current === 'dark' ? 'light' : 'dark';
  setThemeMode(next);
  return next;
};
