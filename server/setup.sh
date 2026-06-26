#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MC_VERSION="1.20.1"
FORGE_VERSION="47.1.3"
FORGE_INSTALLER="forge-${MC_VERSION}-${FORGE_VERSION}-installer.jar"
FORGE_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/${FORGE_INSTALLER}"

# CurseForge File IDs (2024年7月の安定版)
MINECOLONIES_FILE_ID="5510053"  # 1.1.603-RELEASE
STRUCTURIZE_FILE_ID="5510044"   # 1.0.742-RELEASE
DOMUM_ORNAMENTUM_FILE_ID="5610509"  # 1.0.196-BETA
BLOCKUI_FILE_ID="7041657"        # 1.0.194

echo "=== MineColonies Forge Server Setup ==="

# Java 17 確認
if ! java -version 2>&1 | grep -q "17\|21"; then
    echo "ERROR: Java 17 or 21 required. Install with: sudo apt install openjdk-17-jdk"
    exit 1
fi

# Forge installer ダウンロード
if [ ! -f "$FORGE_INSTALLER" ]; then
    echo "[1/5] Downloading Forge installer..."
    curl -L -o "$FORGE_INSTALLER" "$FORGE_URL"
fi

# Forge インストール（サーバーモード）
echo "[2/5] Installing Forge server..."
java -jar "$FORGE_INSTALLER" --installServer

# mods/ ディレクトリ準備
mkdir -p mods

# MineColonies ダウンロード
if [ ! -f "mods/minecolonies.jar" ]; then
    echo "[3/5] Downloading MineColonies from CurseForge..."
    curl -L -o "mods/minecolonies.jar" \
        "https://www.curseforge.com/api/v1/mods/245506/files/${MINECOLONIES_FILE_ID}/download"
fi

# Structurize ダウンロード
if [ ! -f "mods/structurize.jar" ]; then
    echo "[4/5] Downloading Structurize from CurseForge..."
    curl -L -o "mods/structurize.jar" \
        "https://www.curseforge.com/api/v1/mods/296937/files/${STRUCTURIZE_FILE_ID}/download"
fi

# Domum Ornamentum ダウンロード
if [ ! -f "mods/domum_ornamentum.jar" ]; then
    echo "[4/5] Downloading Domum Ornamentum from CurseForge..."
    curl -L -o "mods/domum_ornamentum.jar" \
        "https://www.curseforge.com/api/v1/mods/527361/files/${DOMUM_ORNAMENTUM_FILE_ID}/download"
fi

# BlockUI ダウンロード
if [ ! -f "mods/blockui.jar" ]; then
    echo "[5/5] Downloading BlockUI from CurseForge..."
    wget -O "mods/blockui.jar" \
        "https://edge.forgecdn.net/files/7041/657/blockui-1.20.1-1.0.194.jar"
fi

# eula.txt
echo "eula=true" > eula.txt

# server.properties（シミュレーション向け設定）
cat > server.properties << 'EOF'
server-port=25565
gamemode=creative
difficulty=normal
max-players=10
online-mode=false
spawn-protection=0
enable-command-block=true
EOF

echo ""
echo "=== Setup Complete! ==="
echo "Mods downloaded:"
ls -lh mods/*.jar
echo ""
echo "Run: bash start.sh"
