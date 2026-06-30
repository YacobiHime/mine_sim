#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 既存のMinecraftサーバープロセスを停止
echo "既存のサーバーを確認中..."
EXISTING_PID=$(ps aux | grep -E "java.*forge.*1.20.1" | grep -v grep | awk '{print $2}')
if [ -n "$EXISTING_PID" ]; then
  echo "既存のサーバー(PID: $EXISTING_PID)を停止します..."
  kill $EXISTING_PID 2>/dev/null
  sleep 2
  # まだ生きていれば強制終了
  if ps -p $EXISTING_PID > /dev/null 2>&1; then
    echo "強制終了します..."
    kill -9 $EXISTING_PID 2>/dev/null
  fi
  echo "サーバーを停止しました"
  sleep 1
else
  echo "既存のサーバーはありません"
fi
echo ""

# Forge が生成する run.sh か、直接起動
if [ -f "run.sh" ]; then
    bash run.sh
else
    java -Xmx4G -Xms2G \
        -jar forge-1.20.1-47.1.3.jar \
        nogui
fi
