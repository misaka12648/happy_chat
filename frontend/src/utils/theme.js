/**
 * 主题（浅色 / 深色）管理
 * - 持久化在本地存储 'theme'；首次使用跟随系统 prefers-color-scheme
 * - H5 通过在 <html> 上切换 .dark 类使 CSS 变量整体切换
 * - 同步 uni TabBar 的配色（pages.json 中的 tabBar 配色是静态的，运行时经此接口更新）
 */

const STORAGE_KEY = 'theme';

/** 读取已保存主题（'' 表示未设置过） */
export const getStoredTheme = () => uni.getStorageSync(STORAGE_KEY) || '';

/**
 * 应用主题：切换根类名 + 更新 TabBar 配色
 * @param {'light'|'dark'} theme
 * @param {{persist?: boolean}} options 是否写入用户手动选择；系统跟随时不写入
 */
export const applyTheme = (theme, { persist = true } = {}) => {
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
  if (persist) uni.setStorageSync(STORAGE_KEY, theme);
};

/** 初始化：优先取已保存主题，否则跟随系统 */
export const initTheme = () => {
  const storedTheme = getStoredTheme();
  let theme = storedTheme;
  // #ifdef H5
  if (!theme && typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    theme = mediaQuery.matches ? 'dark' : 'light';
    // 用户未手动设置过主题时，跟随系统实时切换；系统状态不写入手动主题存储
    mediaQuery.addEventListener('change', (e) => {
      if (!uni.getStorageSync(STORAGE_KEY)) applyTheme(e.matches ? 'dark' : 'light', { persist: false });
    });
  }
  // #endif
  applyTheme(theme || 'light', { persist: Boolean(storedTheme) });
  return theme || 'light';
};

/** 切换主题，返回切换后的主题名 */
export const toggleTheme = () => {
  const stored = getStoredTheme();
  // 未手动设置时以当前根节点（可能来自系统主题）为准，点击才能真正反转
  const current = stored || (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
};
