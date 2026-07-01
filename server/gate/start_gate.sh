#!/usr/bin/env bash
# Gateプロキシ起動スクリプト

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[Gate] 起動中..."
echo "[Gate] Config: $SCRIPT_DIR/config.yml"
echo "[Gate] Listen: 0.0.0.0:25565 → Backend: localhost:25566"
echo ""

# Gateをバックグラウンドで起動し、ログをgate.logに出力
./gate --config "$SCRIPT_DIR/config.yml" > gate.log 2>&1 &
GATE_PID=$!

echo "[Gate] PID: $GATE_PID"
echo "[Gate] ログ: $SCRIPT_DIR/gate.log"
echo ""

# PIDをファイルに保存（終了時にkillするため）
echo $GATE_PID > gate.pid

# 起動確認（最大10秒待機）
for i in {1..10}; do
  if grep -q "listening for connections" "$SCRIPT_DIR/gate.log" 2>/dev/null; then
    echo "[Gate] 起動完了（リッスン中）"
    exit 0
  fi
  sleep 1
done

echo "[Gate] 起動に時間がかかっています..."
exit 0
