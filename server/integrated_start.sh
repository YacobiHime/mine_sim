#!/bin/bash
# 統合モード起動スクリプト
# Forgeサーバーをバックグラウンドで起動し、その後mine_simを起動
#
# 使い方:
#   cd server
#   bash integrated_start.sh
#
# 注意: .envファイルでMC_HOST=localhostを設定してください

cd "$(dirname "$0")"

echo "=========================================="
echo "MineSim 統合モード起動スクリプト"
echo "=========================================="
echo ""

# 既存のMinecraftサーバープロセスを停止
echo "[0/2] 既存のサーバーを確認中..."
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

echo "[1/2] Forgeサーバーを起動中..."
bash start.sh &
SERVER_PID=$!

echo "サーバーPID: $SERVER_PID"
echo ""
echo "[2/2] サーバー起動待機中（60秒）..."

# 60秒待機（サーバー起動時間 - Forgeは時間がかかる）
sleep 60

echo ""
echo "=========================================="
echo "mine_sim エージェントを起動中..."
echo "=========================================="
cd ..
npm start

# mine_sim終了時、サーバーも停止
echo ""
echo "mine_simが終了しました。サーバーを停止します..."
kill $SERVER_PID 2>/dev/null
