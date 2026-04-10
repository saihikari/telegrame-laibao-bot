#!/bin/bash

# ==============================================================================
# RuntoAds Telegram Bot 一键部署脚本 (OpenCloud OS 9)
# 环境要求: 公网IP, OpenCloud OS 9
# ==============================================================================

set -e

echo "=========================================================="
echo "    开始部署 RuntoAds Telegram Bot (OpenCloud OS 9)       "
echo "=========================================================="

# 1. 更新系统并安装 Node.js 20
echo ">> 1. 更新系统并安装 Node.js 20..."
if command -v apt-get &> /dev/null; then
    # Debian/Ubuntu 系列
    echo "检测到 APT 包管理器 (Debian/Ubuntu/Linux Mint 等)"
    sudo apt-get update -y
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
elif command -v dnf &> /dev/null || command -v yum &> /dev/null; then
    # CentOS/RHEL/OpenCloudOS
    echo "检测到 RPM 包管理器 (CentOS/RHEL/OpenCloudOS 等)"
    # 跳过 nodesource 脚本的环境检测直接安装，或者使用 NVM/官方二进制包
    # OpenCloudOS 可能会被 nodesource 拦截，因此我们直接下载预编译二进制包或使用内置源
    if command -v dnf &> /dev/null; then
        sudo dnf update -y
    else
        sudo yum update -y
    fi
    
    echo "尝试通过官方预编译包安装 Node.js 20..."
    NODE_VERSION="v20.12.2"
    NODE_DIST="linux-x64"
    cd /tmp
    curl -fsSLO https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DIST}.tar.xz
    sudo tar -xJf node-${NODE_VERSION}-${NODE_DIST}.tar.xz -C /usr/local --strip-components=1
    rm -f node-${NODE_VERSION}-${NODE_DIST}.tar.xz
    cd -
else
    echo "⚠️ 未知的包管理器！请手动安装 Node.js 20。"
    exit 1
fi

# 验证安装
node -v
npm -v

# 3. 安装 pnpm
echo ">> 3. 全局安装 pnpm..."
sudo npm install -g pnpm

# 4. 创建部署目录
echo ">> 4. 创建项目目录..."
PROJECT_DIR="/opt/runtoads-tg-bot"
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

# 将当前目录文件复制到部署目录 (假设在代码根目录执行)
cp -r ./* $PROJECT_DIR/
cd $PROJECT_DIR

# 5. 安装依赖并编译
echo ">> 5. 安装项目依赖并编译..."
pnpm install
pnpm run build

# 6. 生成 .env 文件 (带随机密码)
echo ">> 6. 配置环境变量..."
if [ ! -f ".env" ]; then
    RANDOM_PASS=$(openssl rand -base64 12)
    cat <<EOF > .env
BOT_TOKEN=8536488446:AAEiK7S4ukQNB6gltkPH7VxIiqLeg6yGcwg
INTERNAL_CHAT_IDS=-1003717624726
ADMIN_PORT=8090
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$RANDOM_PASS
GOOGLE_SHEET_ID=1FjFul0KvQ78udE70hcb-z658reJ7-Ko9jAl0Tyo8IvA
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_CREDENTIALS_PATH=config/google-credentials.json
LOG_LEVEL=info
EOF
    echo "已生成默认 .env 文件，ADMIN_PASSWORD 为: $RANDOM_PASS"
else
    echo ".env 文件已存在，跳过生成。"
fi

# 7. 提示上传 Google 凭据
echo ">> 7. 检查 Google Sheets 凭据..."
mkdir -p config/backups
if [ ! -f "config/google-credentials.json" ]; then
    echo "⚠️ 警告: config/google-credentials.json 不存在！"
    echo "请在服务启动前将 Google Service Account JSON 凭据上传至该路径。"
fi

# 8. 创建 systemd 服务
echo ">> 8. 配置 systemd 服务..."
cat <<EOF | sudo tee /etc/systemd/system/runtoads-tg-bot.service
[Unit]
Description=RuntoAds Telegram Bot Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable runtoads-tg-bot
sudo systemctl start runtoads-tg-bot

# 9. 开放防火墙 (适配 UFW 和 Firewalld)
echo ">> 9. 开放防火墙端口 8090..."
if command -v ufw &> /dev/null && sudo ufw status | grep -qw "active"; then
    echo "检测到 UFW，正在放行 8090 端口..."
    sudo ufw allow 8090/tcp
elif command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
    echo "检测到 Firewalld，正在放行 8090 端口..."
    sudo firewall-cmd --zone=public --add-port=8090/tcp --permanent
    sudo firewall-cmd --reload
else
    echo "未检测到活跃的 UFW 或 Firewalld，跳过防火墙配置。请确保云服务商安全组已放行 8090 端口。"
fi

echo "=========================================================="
echo "部署完成！🎉"
echo "状态检查: sudo systemctl status runtoads-tg-bot"
echo "日志查看: sudo journalctl -fu runtoads-tg-bot"
echo "管理后台: http://43.155.232.10:8090/admin/config"
if [ -n "$RANDOM_PASS" ]; then
    echo "后台默认账号: admin"
    echo "后台默认密码: $RANDOM_PASS"
fi
echo "=========================================================="
