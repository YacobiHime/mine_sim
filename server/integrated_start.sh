#!/bin/bash
# 統合モード起動スクリプト
# Forgeサーバー → Gateプロキシ → mine_sim エージェント の順序で起動

cd "$(dirname "$0")"

echo "=========================================="
echo "MineSim 統合モード起動スクリプト"
echo "=========================================="
echo ""

# ---- 既存プロセスのクリーンアップ ----
echo "[0/3] 既存のプロセスを確認中..."

# Forgeサーバー
EXISTING_FORGE=$(ps aux | grep -E "java.*forge.*1.20.1" | grep -v grep | awk '{print $2}')
if [ -n "$EXISTING_FORGE" ]; then
  echo "既存のForgeサーバー(PID: $EXISTING_FORGE)を停止します..."
  kill $EXISTING_FORGE 2>/dev/null
  sleep 2
  if ps -p $EXISTING_FORGE > /dev/null 2>&1; then
    kill -9 $EXISTING_FORGE 2>/dev/null
  fi
  echo "Forgeサーバーを停止しました"
fi

# Gateプロキシ
if [ -f "gate/gate.pid" ]; then
  EXISTING_GATE=$(cat gate/gate.pid)
  if ps -p $EXISTING_GATE > /dev/null 2>&1; then
    echo "既存のGate(PID: $EXISTING_GATE)を停止します..."
    kill $EXISTING_GATE 2>/dev/null
    rm -f gate/gate.pid
  fi
fi

# ゴミ掃除
rm -f gate/gate.pid
echo ""
sleep 1

# ---- Forgeサーバー起動 ----
echo "[1/3] Forgeサーバーを起動中 (ポート: 25566)..."
bash start.sh > forge.log 2>&1 &
FORGE_PID=$!
echo "Forge PID: $FORGE_PID"
echo ""

echo "[1/3] Forge起動待機中（60秒）..."
for i in {1..60}; do
  if grep -q "Done (\([0-9.]*s\)\? For help, type \"help\"" forge.log 2>/dev/null; then
    echo "✓ Forgeサーバー起動完了"
    break
  fi
  sleep 1
done
echo ""

# ---- Gateプロキシ起動 ----
echo "[2/3] Gateプロキシを起動中 (Listen: 0.0.0.0:25565)..."
bash gate/start_gate.sh
if [ -f "gate/gate.pid" ]; then
  GATE_PID=$(cat gate/gate.pid)
  echo "✓ Gate PID: $GATE_PID"
fi
echo ""

echo "[2/3] Gate起動待機中（5秒）..."
sleep 5
echo ""

# ---- mine_simエージェント起動 ----
echo "=========================================="
echo "[3/3] mine_sim エージェントを起動中..."
echo "=========================================="
echo ""
echo "構成: mineflayer → Gate(25565) → Forge(25566)"
echo ""

cd ..
npm start

# ---- 終了処理 ----
cd server
echo ""
echo "=========================================="
echo "mine_simが終了しました。各プロセスを停止します..."
echo "=========================================="

if [ -f "gate/gate.pid" ]; then
  GATE_PID=$(cat gate/gate.pid)
  echo "Gate (PID: $GATE_PID) を停止..."
  kill $GATE_PID 2>/dev/null
  rm -f gate/gate.pid
fi

echo "Forge (PID: $FORGE_PID) を停止..."
kill $FORGE_PID 2>/dev/null

echo "全プロセスを停止しました"
