# mine_sim × MineColonies 統合プロジェクト

MineColonies（Forge mod）と mine_sim（mineflayer ボット）を統合し、LLMがコロニーを指揮するシミュレーションシステム。

## 概要

このプロジェクトは以下の2つのシステムを統合しています：

- **MineColonies**: MinecraftのForge modで、コロニー建設・市民管理・自動化を行うJavaベースのシステム
- **mine_sim**: Node.js/mineflayerベースのLLM指導者ボット

LLM指導者がMineColoniesの `/mc` コマンドを通じてコロニーを運営します。

## 構成

```
mine_sim/
├── minecolonies/           ← MineColonies ソース（22,382ファイル）
│   └── src/main/java/     ← コロニーロジック全体
├── server/                 ← Forgeサーバー実行環境
│   ├── setup.sh           ← サーバーセットアップスクリプト
│   ├── start.sh           ← サーバー起動スクリプト
│   └── config/            ← MineColonies 設定
├── src/
│   ├── bridge/
│   │   └── ColonyBridge.js ← MineColonies ↔ JS ブリッジ
│   ├── agents/
│   │   ├── BaseAgent.js
│   │   ├── LeaderAgent.js  ← LLM指導者（MineColonies操作版）
│   │   ├── BuilderAgent.js
│   │   ├── FarmerAgent.js
│   │   └── GuardAgent.js
│   ├── colony/
│   │   └── Colony.js
│   ├── statemachine/
│   │   └── StateMachine.js
│   ├── llm/
│   │   └── LLMClient.js
│   ├── config.js
│   └── index.js
└── package.json
```

## 動作イメージ

```
[Forgeサーバー]                         [mine_sim / Node.js]
  MineColonies mod が動作           →   mineflayer ボット（Leader_Alex）が接続
  市民AIが自律的にコロニーを運営     ←   LLMが /mc コマンドで指揮
  建物建設・農業・警備               →   チャット出力を ColonyBridge が解析
  レイドイベントが発生               ←   LeaderAgent が LLM判断で対応指令
```

## セットアップ

### 1. MineColonies Forge サーバーのセットアップ

```bash
# Java 17 が必要
java -version

# サーバーセットアップ（Forge + MineColonies を自動ダウンロード）
cd server
bash setup.sh

# サーバー起動
bash start.sh
```

### 2. mine_sim の起動

```bash
# 依存パッケージのインストール
npm install

# 環境変数設定
export MC_HOST=localhost
export MC_PORT=25565
export OLLAMA_URL=http://localhost:11434/v1
export OLLAMA_MODEL=gemma4:e4b

# 起動
npm start
```

## MineColonies コマンド対応

ColonyBridge は以下の `/mc` コマンド出力を解析します：

| コマンド | 取得情報 |
|---|---|
| `/mc colony info <id>` | コロニー名、市民数、中心座標 |
| `/mc citizen list <colonyId>` | 市民名・職業リスト |
| `/mc citizen info <id> <cId>` | 個別市民の状態（健康・幸福度） |
| `/mc colony raid <id> tonight` | レイドをトリガー |

## LLM指導者の機能

LeaderAgent は以下の判断を行います：

- コロニー状態の定期更新（5秒ごと）
- LLMによる戦略判断（10秒ごと）
- 市民のスポーン
- 建設指示
- 防衛指令（レイド時）

## 参照した MineColonies ソース

| ファイル | 参照目的 |
|---|---|
| `CitizenAI.java` | 状態遷移の優先度構造 |
| `CommandColonyInfo.java` | コロニー情報コマンドの出力形式 |
| `CommandCitizenList.java` | 市民リストの出力形式 |
| `AbstractEntityAIBasic.java` | tick() 構造・状態遷移 |
| `ThreatTable.java` | 脅威テーブルの距離係数 |

## プレイヤーからの指示

ゲーム内チャットで指示を送ると、Leaderエージェントが受け取りコロニーログに追記。

例：
```
家を10軒建てろ
食料が足りない、農業を優先しろ
西側を防衛強化せよ
```

## 今後の拡張

- MineColonies パケットプロトコルへの直接接続
- 建物スキャンによる状態推定精度向上
- Structurize 連携による建設完全自動化
- マルチコロニー管理
