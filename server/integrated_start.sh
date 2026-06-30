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
echo "[1/2] Forgeサーバーを起動中..."
bash start.sh &
SERVER_PID=$!

echo "サーバーPID: $SERVER_PID"
echo ""
echo "[2/2] サーバー起動待機中（30秒）..."

# 30秒待機（サーバー起動時間）
sleep 30

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
