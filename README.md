# Colony Simulation

MineColonies のアーキテクチャを参考に、LLM（Ollama）で行動決定・セリフ生成を行う
Minecraft コロニーシミュレーション。

## 構成

```
src/
├── index.js                   # エントリーポイント（全ボット起動・メインループ）
├── colony/
│   └── Colony.js              # コロニー共有状態（IColony相当）
├── statemachine/
│   └── StateMachine.js        # ティックレートステートマシン（TickRateStateMachine相当）
├── llm/
│   └── LLMClient.js           # Ollamaラッパー（行動決定 + セリフ生成）
└── agents/
    ├── BaseAgent.js           # 全エージェント基底クラス（AbstractJob + AbstractEntityAIBasic相当）
    ├── BuilderAgent.js        # 建築家（EntityAIStructureBuilder相当）
    ├── FarmerAgent.js         # 農家（EntityAIWorkFarmer相当）
    ├── GuardAgent.js          # 衛兵（AbstractEntityAIGuard + AttackMoveAI相当）
    └── LeaderAgent.js         # 指導者（プレイヤー役をLLMが担当）
```

## MineColonies との対応関係

| MineColonies | このプロジェクト | 役割 |
|---|---|---|
| `TickRateStateMachine` | `StateMachine.js` | tick毎の状態遷移エンジン |
| `IColony` | `Colony.js` | コロニー共有状態 |
| `AbstractJob` | `BaseAgent.js` | エージェント基底 |
| `EntityAIWorkFarmer` | `FarmerAgent.js` | 農業AI |
| `EntityAIStructureBuilder` | `BuilderAgent.js` | 建築AI |
| `AbstractEntityAIGuard + AttackMoveAI` | `GuardAgent.js` | 防衛AI |
| `ThreatTable` | `GuardAgent._threatTable` | 脅威テーブル |
| `CitizenAI.calculateNextState()` | `BaseAgent._triggerDecision()` | 行動決定（LLM） |
| プレイヤー | `LeaderAgent.js` | 指導者AI |

## LLMの役割

MineColonies ではコードで行動を決定しますが、このシミュレーションでは：

1. **行動決定**：`decideAction()` でLLMに現在状況と選択肢を渡し、次のアクションをJSON形式で取得
2. **セリフ生成**：各アクションの実行時に状況に応じたセリフをLLMが生成
3. **指導者判断**：LeaderAgentがコロニー全体の戦略をLLMで決定し他エージェントに指示

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# Minecraft サーバーとOllama の設定
export MC_HOST=192.168.15.10
export MC_PORT=25565
export OLLAMA_URL=http://192.168.15.150:11434/v1
export OLLAMA_MODEL=gemma4:e4b

# 起動
npm start
```

## 拡張方法

### 新しい職種を追加する

1. `src/agents/BaseAgent.js` を継承した新しいクラスを作成
2. `getSystemPrompt()` で人格を定義
3. `getAvailableActions()` で取れる行動リストを返す
4. `executeAction(action)` で各行動の実装を書く
5. `src/index.js` の `AGENT_CONFIGS` に追加

### 行動の実装を本格化する

- `BuilderAgent._build()` → Structurize連携で実際のNBTを配置
- `GuardAgent._attackTarget()` → mineflayer-pathfinderで実際に追跡・攻撃
- `FarmerAgent._hoeField()` → 実際のブロック操作で農地を耕す

## プレイヤーからの指示

ゲーム内チャットで指示を送ると、Leaderエージェントが受け取り
コロニーログに追記。次回のLLM判断時に考慮される。

例：
```
家を10軒建てろ
食料が足りない、農業を優先しろ
西側を防衛強化せよ
```
