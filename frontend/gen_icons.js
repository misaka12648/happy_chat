/**
 * TabBar 图标生成器
 * ------------------------------------------------------------
 * 用纯 JS（pngjs）矢量渲染一整套「统一风格」的底部导航图标，
 * 保证三个图标的圆润语言、视觉重量、留白完全一致。
 *
 * 设计规范（与 Warm Mist Design System / uni.scss 保持一致）：
 *   - 未选中：中性灰 #9CA3AF
 *   - 选中态：品牌主渐变 linear-gradient(135deg, #FF6B6B 0%, #A78BFA 100%)
 *             （即 $uni-gradient-primary，全站按钮/头像通用，珊瑚→紫）
 *   - 语言：实心填充 + 大圆角，友好、圆润，契合 HappyChat 气质
 *   - 语义：消息=气泡  通讯录=双人  我=单人（双人/单人区分，避免混淆）
 *
 * 渲染采用 4× 超采样抗锯齿，输出 81×81（uni-app tabBar 推荐尺寸）。
 * 运行：node gen_icons.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const S = 81;   // 输出尺寸
const SS = 4;   // 超采样倍数（抗锯齿）

// ---- 主题色 ----
const GRAY = [156, 163, 175];        // #9CA3AF 未选中
// 选中态：品牌主渐变 135deg，珊瑚(左上) -> 紫(右下)
const GRAD_START = [255, 107, 107];  // #FF6B6B $uni-color-primary
const GRAD_END = [167, 139, 250];    // #A78BFA $uni-color-secondary
const GRAD_LO = 12;                  // 渐变映射的内容边界(与图标留白一致)
const GRAD_HI = 69;

// ---- 几何工具（坐标均为最终 81px 空间）----
const d2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
const inCircle = (px, py, cx, cy, r) => d2(px, py, cx, cy) <= r * r;

// 上半圆盘（肩部）：圆心即底边，只取上半部分
const inHalf = (px, py, cx, cb, r) => py <= cb && d2(px, py, cx, cb) <= r * r;

// 可分别设置四角半径的圆角矩形
function inRR(px, py, l, t, r, b, rtl, rtr, rbr, rbl) {
  if (px < l || px > r || py < t || py > b) return false;
  if (px < l + rtl && py < t + rtl) return d2(px, py, l + rtl, t + rtl) <= rtl * rtl;
  if (px > r - rtr && py < t + rtr) return d2(px, py, r - rtr, t + rtr) <= rtr * rtr;
  if (px > r - rbr && py > b - rbr) return d2(px, py, r - rbr, b - rbr) <= rbr * rbr;
  if (px < l + rbl && py > b - rbl) return d2(px, py, l + rbl, b - rbl) <= rbl * rbl;
  return true;
}

// 三角形（用于气泡小尾巴）
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

// ---- 三个图标的轮廓定义 ----
// 消息：圆角气泡 + 左下小尾巴
function chatShape(px, py) {
  const body = inRR(px, py, 13, 15, 68, 51, 15, 15, 15, 15);
  const tail = inTri(px, py, 26, 47, 41, 47, 23, 62);
  return body || tail;
}

// 我：单人（头 + 肩）
function personShape(px, py) {
  return inCircle(px, py, 40.5, 27, 12.5) || inHalf(px, py, 40.5, 64, 21);
}

// 通讯录：双人（前左 + 后右，之间留缝隙以区分层次）
function contactsShape(px, py) {
  const g = 3; // 前后人物之间的间隙
  const front = inCircle(px, py, 31, 32, 9.5) || inHalf(px, py, 31, 64, 16);
  const frontM = inCircle(px, py, 31, 32, 9.5 + g) || inHalf(px, py, 31, 64, 16 + g);
  const back = inCircle(px, py, 52, 28, 8.5) || inHalf(px, py, 52, 60, 14.5);
  return front || (back && !frontM);
}

// ---- 渲染 ----
// 选中态沿 135deg 对角(左上->右下)做珊瑚->紫渐变，未选中为纯灰
function colorAt(px, py, active) {
  if (!active) return GRAY;
  const nx = (px - GRAD_LO) / (GRAD_HI - GRAD_LO);
  const ny = (py - GRAD_LO) / (GRAD_HI - GRAD_LO);
  const t = Math.max(0, Math.min(1, (nx + ny) / 2));
  return [
    Math.round(GRAD_START[0] + (GRAD_END[0] - GRAD_START[0]) * t),
    Math.round(GRAD_START[1] + (GRAD_END[1] - GRAD_START[1]) * t),
    Math.round(GRAD_START[2] + (GRAD_END[2] - GRAD_START[2]) * t),
  ];
}

function render(shapeFn, active) {
  const png = new PNG({ width: S, height: S });
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (shapeFn(px, py)) cov++;
        }
      }
      const a = cov / (SS * SS);
      const c = colorAt(x + 0.5, y + 0.5, active);
      const idx = (y * S + x) * 4;
      png.data[idx] = c[0];
      png.data[idx + 1] = c[1];
      png.data[idx + 2] = c[2];
      png.data[idx + 3] = Math.round(a * 255);
    }
  }
  return PNG.sync.write(png);
}

// ---- 输出到 uni-app 源码根的 static 目录（src/static 为构建唯一使用的路径）----
const dirs = [
  path.join(__dirname, 'src', 'static', 'tabbar'),
];
const icons = [
  ['chat', chatShape],
  ['contact', contactsShape],
  ['profile', personShape],
];

for (const [name, fn] of icons) {
  const inactive = render(fn, false);
  const activeBuf = render(fn, true);
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.png'), inactive);
    fs.writeFileSync(path.join(dir, name + '-active.png'), activeBuf);
  }
}
console.log('tabbar icons generated ->', dirs.join(' , '));
