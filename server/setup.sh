#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MC_VERSION="1.20.1"
FORGE_VERSION="47.1.3"
FORGE_INSTALLER="forge-${MC_VERSION}-${FORGE_VERSION}-installer.jar"
FORGE_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/${FORGE_INSTALLER}"

MINECOLONIES_VERSION="1.20.1-1.1.859-RELEASE"
MINECOLONIES_JAR="minecolonies-${MINECOLONIES_VERSION}.jar"
MINECOLONIES_URL="https://github.com/ldtteam/minecolonies/releases/download/${MINECOLONIES_VERSION}/${MINECOLONIES_JAR}"

STRUCTURIZE_VERSION="1.20.1-1.0.801-RELEASE"
STRUCTURIZE_URL="https://github.com/ldtteam/Structurize/releases/download/${STRUCTURIZE_VERSION}/structurize-${STRUCTURIZE_VERSION}.jar"

echo "=== MineColonies Forge Server Setup ==="

# Java 17 確認
if ! java -version 2>&1 | grep -q "17\|21"; then
    echo "ERROR: Java 17 or 21 required. Install with: sudo apt install openjdk-17-jdk"
    exit 1
fi

# Forge installer ダウンロード
if [ ! -f "$FORGE_INSTALLER" ]; then
    echo "[1/4] Downloading Forge installer..."
    curl -L -o "$FORGE_INSTALLER" "$FORGE_URL"
fi

# Forge インストール（サーバーモード）
echo "[2/4] Installing Forge server..."
java -jar "$FORGE_INSTALLER" --installServer

# mods/ ディレクトリ準備
mkdir -p mods

# MineColonies jar ダウンロード
if [ ! -f "mods/${MINECOLONIES_JAR}" ]; then
    echo "[3/4] Downloading MineColonies ${MINECOLONIES_VERSION}..."
    curl -L -o "mods/${MINECOLONIES_JAR}" "$MINECOLONIES_URL"
fi

# Structurize（MineColonies依存）ダウンロード
if [ ! -f mods/structurize-*.jar ]; then
    echo "[4/4] Downloading Structurize (dependency)..."
    curl -L -o "mods/structurize-${STRUCTURIZE_VERSION}.jar" "$STRUCTURIZE_URL"
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
echo "Run: bash start.sh"
