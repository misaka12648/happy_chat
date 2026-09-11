const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { ok, fail } = require('../utils/response');

// 文件名扩展名由服务端按 mimetype 映射生成，不信任客户端原始文件名，
// 防止伪造 mimetype 上传 .html/.svg 等可执行内容形成同源存储型 XSS。
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav'
};

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    // 确保上传目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 随机文件名 + 白名单扩展名（fileFilter 已保证 mimetype 在白名单内）
    const ext = EXT_BY_MIME[file.mimetype] || '.bin';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'), false);
  }
};

// 配置 multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  }
});

/**
 * POST /api/upload
 * 上传文件（图片或视频）
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return fail(res, 400, '没有上传文件');
    }

    // 构建文件访问 URL
    const fileUrl = `/media/${req.file.filename}`;

    // 确定文件类型
    let fileType = 'IMAGE';
    let thumbnailUrl = '';

    if (req.file.mimetype.startsWith('video/')) {
      fileType = 'VIDEO';
    } else if (req.file.mimetype.startsWith('audio/')) {
      fileType = 'VOICE';
    } else if (req.file.mimetype.startsWith('image/')) {
      // 生成压缩缩略图
      try {
        const thumbnailFilename = 'thumb_' + req.file.filename;
        const thumbnailPath = path.join(req.file.destination, thumbnailFilename);
        
        await sharp(req.file.path)
          .resize(300, 300, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .jpeg({ quality: 60 })
          .toFile(thumbnailPath);
        
        thumbnailUrl = `/media/${thumbnailFilename}`;
      } catch (err) {
        console.error('生成缩略图失败:', err);
        // 缩略图生成失败时，使用原图
        thumbnailUrl = fileUrl;
      }
    }

    ok(res, {
      url: fileUrl,
      thumbnailUrl: thumbnailUrl || fileUrl,
      type: fileType,
      size: req.file.size,
      originalName: req.file.originalname
    }, '上传成功');
  } catch (error) {
    console.error('上传文件错误:', error);
    fail(res, 500, '上传失败');
  }
});

// 错误处理中间件
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return fail(res, 400, '文件大小超过限制');
    }
    return fail(res, 400, err.message);
  }

  if (err) {
    return fail(res, 400, err.message);
  }

  next();
});

module.exports = router;
