const { NodeSSH } = require("node-ssh");
const { spawn } = require("child_process");
const chalk = require("chalk");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ora = require("ora").default || require("ora");
require("dotenv").config();

const ssh = new NodeSSH();

// 宝塔 Node.js 环境加载命令
const BT_NODE_ENV =
  "export PATH=/www/server/nodejs/bin:$PATH && export NODE_HOME=/www/server/nodejs && export PATH=$NODE_HOME/bin:$PATH";

// Configuration
const config = {
  host: process.env.SERVER_HOST,
  port: process.env.SERVER_PORT || 22,
  username: process.env.SERVER_USER,
  password: process.env.SERVER_PASSWORD,
  privateKeyPath: process.env.SERVER_PRIVATE_KEY_PATH,
  remotePath: process.env.REMOTE_PATH || "/www/wwwroot/happychat",
  pm2AppName: process.env.PM2_APP_NAME || "happychat-backend",
  keepReleases: parseInt(process.env.KEEP_RELEASES) || 3,
  siteUrl: process.env.SITE_URL || "https://chat.misaka12648.asia",
};

function validateConfig() {
  const required = ["host", "username"];
  const missing = required.filter((key) => !config[key]);

  if (!config.password && !config.privateKeyPath) {
    missing.push("password OR privateKeyPath");
  }

  if (missing.length > 0) {
    console.error(chalk.red("错误: 缺少配置变量:"));
    missing.forEach((key) => console.error(chalk.red(` - ${key}`)));
    console.error(chalk.yellow("请检查 .env 文件。"));
    process.exit(1);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, {
      shell: true,
      stdio: "inherit",
      ...options,
    });

    cmd.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`命令执行失败，退出码 ${code}`));
      }
    });

    cmd.on("error", (err) => {
      reject(err);
    });
  });
}

async function buildFrontend() {
  console.log(chalk.blue("\n构建前端..."));

  try {
    // 安装依赖
    console.log(chalk.yellow("\n安装前端依赖..."));
    await runCommand("npm", ["install", "--legacy-peer-deps"], {
      cwd: path.join(__dirname, "../frontend"),
    });
    console.log(chalk.green("依赖安装完成"));

    // 构建
    console.log(chalk.yellow("\n构建 H5..."));
    await runCommand("npm", ["run", "build:h5"], {
      cwd: path.join(__dirname, "../frontend"),
    });

    // 验证构建产物
    const buildPath = path.join(__dirname, "../frontend/dist/build/h5");
    if (!fs.existsSync(path.join(buildPath, "index.html"))) {
      throw new Error("构建失败: index.html 不存在");
    }

    console.log(chalk.green("前端构建完成"));
  } catch (err) {
    console.error(chalk.red("\n前端构建失败:"));
    console.error(err);
    process.exit(1);
  }
}

async function connectServer() {
  const spinner = ora(`连接服务器 ${config.host}...`).start();
  try {
    const sshConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
    };

    if (config.privateKeyPath) {
      sshConfig.privateKeyPath = config.privateKeyPath;
    } else {
      sshConfig.password = config.password;
    }

    await ssh.connect(sshConfig);
    spinner.succeed(`已连接到 ${config.host}`);
  } catch (err) {
    spinner.fail("连接失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function backupRemote() {
  const spinner = ora("备份远程文件...").start();
  try {
    // 检查远程目录是否存在
    const checkDir = await ssh.execCommand(
      `[ -d "${config.remotePath}" ] && echo "exists"`,
    );

    if (checkDir.stdout.trim() === "exists") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupName = `backup_${timestamp}.tar.gz`;
      const parentDir = path.posix.dirname(config.remotePath);
      const dirName = path.posix.basename(config.remotePath);

      // 创建备份
      const cmd = `tar -czf ${path.posix.join(parentDir, backupName)} -C ${parentDir} ${dirName}`;
      const result = await ssh.execCommand(cmd);

      if (result.code !== 0) {
        throw new Error(`备份失败: ${result.stderr}`);
      }
      spinner.succeed(`备份已创建: ${backupName}`);
    } else {
      spinner.info("远程目录不存在，跳过备份");
      await ssh.execCommand(`mkdir -p ${config.remotePath}`);
    }
  } catch (err) {
    spinner.fail("备份失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function cleanupOldBackups() {
  if (!config.keepReleases || config.keepReleases <= 0) return;

  const spinner = ora("清理旧备份...").start();
  try {
    const parentDir = path.posix.dirname(config.remotePath);
    const cmd = `ls -tp ${parentDir}/backup_*.tar.gz | grep -v '/$' | tail -n +${config.keepReleases + 1} | xargs -I {} rm -- "{}"`;

    await ssh.execCommand(cmd);
    spinner.succeed(`已清理旧备份 (保留 ${config.keepReleases} 份)`);
  } catch (err) {
    spinner.warn("清理旧备份失败 (非关键错误)");
  }
}

async function uploadFrontend() {
  const spinner = ora("上传前端文件...").start();
  try {
    const localPath = path.join(__dirname, "../frontend/dist/build/h5");
    const remotePath = path.posix.join(config.remotePath, "frontend");

    // 确保远程目录存在
    await ssh.execCommand(`mkdir -p ${remotePath}`);

    // 上传文件
    const status = await ssh.putDirectory(localPath, remotePath, {
      recursive: true,
      concurrency: 10,
      validate: (itemPath) => {
        const baseName = path.basename(itemPath);
        return baseName !== "node_modules" && baseName.charAt(0) !== ".";
      },
    });

    if (!status) {
      throw new Error("上传失败");
    }
    spinner.succeed("前端文件上传完成");
  } catch (err) {
    spinner.fail("前端上传失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function uploadBackend() {
  const spinner = ora("上传后端文件...").start();
  try {
    const localPath = path.join(__dirname, "../backend");
    const remotePath = path.posix.join(config.remotePath, "backend");

    // 确保远程目录存在
    await ssh.execCommand(`mkdir -p ${remotePath}`);

    // 上传文件（排除 node_modules 和 uploads）
    const status = await ssh.putDirectory(localPath, remotePath, {
      recursive: true,
      concurrency: 10,
      validate: (itemPath) => {
        const baseName = path.basename(itemPath);
        return (
          baseName !== "node_modules" &&
          baseName !== "uploads" &&
          baseName.charAt(0) !== "."
        );
      },
    });

    if (!status) {
      throw new Error("上传失败");
    }
    spinner.succeed("后端文件上传完成");
  } catch (err) {
    spinner.fail("后端上传失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function installBackendDeps() {
  const spinner = ora("安装后端依赖...").start();
  try {
    const remotePath = path.posix.join(config.remotePath, "backend");
    const cmd = `${BT_NODE_ENV} && cd ${remotePath} && npm install --production`;
    const result = await ssh.execCommand(cmd);

    if (result.code !== 0) {
      throw new Error(`安装失败: ${result.stderr}`);
    }
    spinner.succeed("后端依赖安装完成");
  } catch (err) {
    spinner.fail("后端依赖安装失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function setupBackendEnv() {
  const spinner = ora("配置后端环境...").start();
  try {
    const envPath = path.posix.join(config.remotePath, ".env");

    // 检查根目录 .env 是否存在
    const checkEnv = await ssh.execCommand(
      `[ -f "${envPath}" ] && echo "exists"`,
    );

    if (checkEnv.stdout.trim() !== "exists") {
      // 创建根目录 .env 文件
      const envContent = `# 后端配置
MONGODB_URI=mongodb://localhost:27017/happychat
PORT=8080
JWT_SECRET=${crypto.randomBytes(32).toString("hex")}
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760`;

      await ssh.execCommand(
        `cat > ${envPath} << 'ENVEOF'\n${envContent}\nENVEOF`,
      );
      spinner.succeed("环境配置完成");
    } else {
      spinner.info(".env 已存在，跳过配置");
    }

    // 确保 uploads 目录存在
    await ssh.execCommand(
      `mkdir -p ${path.posix.join(config.remotePath, "backend/uploads")}`,
    );
  } catch (err) {
    spinner.fail("环境配置失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function restartBackend() {
  const spinner = ora("重启后端服务...").start();
  try {
    const remotePath = path.posix.join(config.remotePath, "backend");

    // 检查 PM2 是否已安装
    const checkPm2 = await ssh.execCommand(`${BT_NODE_ENV} && which pm2`);
    if (checkPm2.code !== 0) {
      // 安装 PM2
      await ssh.execCommand(`${BT_NODE_ENV} && npm install -g pm2`);
    }

    // 强制终止占用 8080 端口的旧进程，避免 EADDRINUSE
    await ssh.execCommand(
      `fuser -k 8080/tcp 2>/dev/null || true`
    );

    // 使用 PM2 重启或启动应用
    const restartCmd = `${BT_NODE_ENV} && cd ${remotePath} && pm2 restart ${config.pm2AppName} || pm2 start src/app.js --name ${config.pm2AppName}`;
    const result = await ssh.execCommand(restartCmd);

    if (result.code !== 0) {
      throw new Error(`重启失败: ${result.stderr}`);
    }

    // 保存 PM2 配置
    await ssh.execCommand(`${BT_NODE_ENV} && pm2 save`);

    spinner.succeed("后端服务已重启");
  } catch (err) {
    spinner.fail("后端重启失败");
    console.error(chalk.red(err));
    process.exit(1);
  }
}

async function verifyDeployment() {
  const spinner = ora("验证部署...").start();
  try {
    // 检查前端文件
    const checkFrontend = await ssh.execCommand(
      `[ -s "${path.posix.join(config.remotePath, "frontend/index.html")}" ] && echo "verified"`,
    );

    // 检查后端进程
    const checkBackend = await ssh.execCommand(
      `${BT_NODE_ENV} && pm2 list | grep ${config.pm2AppName}`,
    );

    if (
      checkFrontend.stdout.trim() === "verified" &&
      checkBackend.stdout.includes(config.pm2AppName)
    ) {
      spinner.succeed("部署验证成功");
    } else {
      throw new Error("验证失败");
    }
  } catch (err) {
    spinner.fail("部署验证失败");
    console.error(chalk.red(err));
  }
}

async function run() {
  console.log(chalk.green("开始部署 HappyChat\n"));

  validateConfig();

  await buildFrontend();

  await connectServer();

  await backupRemote();

  await cleanupOldBackups();

  await uploadFrontend();

  await uploadBackend();

  await installBackendDeps();

  await setupBackendEnv();

  await restartBackend();

  await verifyDeployment();

  ssh.dispose();

  console.log(chalk.green("\n部署完成!"));
  console.log(chalk.cyan(`访问地址: ${config.siteUrl}`));
  console.log(
    chalk.gray(
      "(后端 8080 仅本机监听，经 Nginx 反向代理对外提供 /api、/ws、/media)",
    ),
  );
}

if (require.main === module) {
  run();
}
