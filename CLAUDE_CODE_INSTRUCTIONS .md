# mine_sim 改善設計書 & Claude Code 作業指示

> このドキュメントはローカルのClaude Codeへの作業指示です。
> リポジトリ: https://github.com/YacobiHime/mine_sim

---

## 現状の問題点（診断）

| # | 問題 | 影響 |
|---|------|------|
| 1 | `mineflayer-pathfinder` が `package.json` の依存に**ない** | 実行時に移動が全て無効になる |
| 2 | `BuilderAgent._gatherWood()` で pathfinder を dynamic import しているが毎回 `new goals.GoalBlock(...)` と書いており、pathfinder未ロード時のエラーハンドリングが不完全 | 木を切れずBot停止リスク |
| 3 | `StateMachine.tickCount` を `this.sm.tickCount` で直接参照（`GuardAgent`）しているが、`tickCount` はプロパティとして公開されていない | ガードの自動スキャンが動かない |
| 4 | `DECIDING → IDLE` トランジションが `!this.llmBusy` 条件で走るが、LLMが完了した後 `llmBusy=false` にしてから `setState(EXECUTING)` するため、IDLEに戻ってしまう競合がある | LLM結果が無視されることがある |
| 5 | `LeaderAgent._broadcastDirective()` は他エージェントに `speak()` を呼ぶだけで、実際の行動変更につながっていない（エージェントは次の自分のLLMターンまで無視する） | 指揮系統が機能しない |
| 6 | `Colony.getSummary()` にエージェントごとの状態が含まれない | LLMが仲間の状況を知れない |
| 7 | `BaseAgent._buildSituationPrompt()` が全エージェント共通なので、仲間の状態・位置が見えない | 協調行動ができない |
| 8 | 建物が完成してもゲームワールドに何も変化しない（`_build()` は `sleep(5000)` のみ） | シミュレーションとして空虚 |
| 9 | `FarmerAgent` の種の初期供給がなく `wheat` が尽きると農業が永久停止する | 数ターンで詰む |
| 10 | エラー時の再接続・再起動ロジックがない | 本番運用で落ちっぱなし |

---

## 改善設計

### アーキテクチャ方針

```
現状:  Bot → Agent → LLM（行動決定） → executeAction()
目標:  Bot → Agent → [優先度レイヤー] → LLM（行動決定） → executeAction() → [Worldへの反映]
                         ↑
                    CitizenAI.calculateNextState()相当
                    （緊急割り込みを先に処理）
```

MineColoniesの `CitizenAI.calculateNextState()` を参考に、LLMを呼ぶ前に**ルールベースの優先度チェック**を挟む。
緊急事態（瀕死・攻撃中）はLLMを待たずに即座に行動する。

---

## 作業タスク一覧（優先度順）

---

### Task 1: 依存パッケージ修正
**ファイル:** `package.json`

```json
{
  "dependencies": {
    "minecraft-data": "^3.111.0",
    "mineflayer": "^4.37.1",
    "mineflayer-pathfinder": "^2.4.5",
    "mineflayer-collectblock": "^1.4.1",
    "vec3": "^0.1.10"
  }
}
```

`npm install` を実行してlock fileも更新すること。

---

### Task 2: StateMachine のバグ修正
**ファイル:** `src/statemachine/StateMachine.js`

`tickCount` を外部から参照できるよう、`getTickCount()` メソッドを追加する。

```js
// 追加するメソッド
getTickCount() { return this.tickCount }
```

また、DECIDING → IDLE の競合を防ぐため、`addTransition` に優先度パラメータを追加し、
EXECUTING ステートのときは DECIDING→IDLE トランジションが発火しないようにする。

具体的な変更:
- `addTransition(state, condition, handler, interval, priority = 0)` にシグネチャ変更
- `tick()` 内でトランジション評価前に `if (tr.state !== this.state) continue` を維持しつつ、EXECUTINGのときはIDLE関連トランジションをスキップ

---

### Task 3: BaseAgent のLLM競合バグ修正 & 優先度レイヤー追加
**ファイル:** `src/agents/BaseAgent.js`

#### 3-1. DECIDING/EXECUTING 競合修正

`_triggerDecision()` の中で `llmBusy = false` にする前に `setState(EXECUTING)` に変更:

```js
async _triggerDecision() {
  if (this.llmBusy) return
  this.llmBusy = true
  try {
    const result = await decideAction(...)
    this.speak(result.speech)
    this.currentTask = result.action
    // ← ここで先にEXECUTINGにしてからllmBusyをfalseにする
    this.sm.setState(CommonState.EXECUTING)
    this.llmBusy = false  // ← falseにした後にexecuteAction
    this.executeAction(result.action)
      .then(() => { ... })
  } catch (err) {
    this.llmBusy = false
    this.sm.setState(CommonState.IDLE)
  }
  // finally で llmBusy = false を消す（上で制御するため）
}
```

#### 3-2. MineColonies式 優先度チェックレイヤー追加

`_setupCommonTransitions()` を以下の優先度構造に変更:

```
優先度1（即時、LLMなし）: 瀕死(health<4) → EMERGENCY_RETREAT
優先度2（割り込み、LLMなし）: 空腹(hunger<8) → EATING
優先度3（通常、LLMあり）: IDLE → DECIDING
```

`CommonState` に `EMERGENCY_RETREAT` を追加し、
`_setupCommonTransitions()` でイベントとして登録:

```js
// 最高優先度（MineColonies の AIBlockingEventType.EVENT 相当）
this.sm.addEvent(
  () => this.health < 4 && this.sm.getState() !== CommonState.EMERGENCY_RETREAT,
  () => {
    this.speak('死にそうだ！逃げろ！')
    this._emergencyRetreat()
    return CommonState.EMERGENCY_RETREAT
  },
  5  // 5tickごとにチェック
)
```

`_emergencyRetreat()` の実装:
```js
async _emergencyRetreat() {
  // ランダム方向に走る（pathfinder未使用でも動く）
  this.bot.setControlState('sprint', true)
  await this._sleep(2000)
  this.bot.setControlState('sprint', false)
  this.health = Math.min(20, this.health + 2)
  this.sm.setState(CommonState.IDLE)
}
```

#### 3-3. 仲間情報を含むSituationPrompt

`_buildSituationPrompt()` に仲間の状態を追加:

```js
_buildSituationPrompt() {
  // 仲間のサマリーを生成
  const teammates = Object.values(this.colony.agents)
    .filter(a => a !== this)
    .map(a => `  ${a.name}(${a.role}): HP${a.health} 空腹${Math.floor(a.hunger)} 状態=${a.sm.getState()} タスク=${a.currentTask ?? 'なし'}`)
    .join('\n')

  return [
    this.colony.getSummary(),
    `--- 自分の状態 ---`,
    `名前: ${this.name}  役職: ${this.role}`,
    `体力: ${this.health}/20  空腹度: ${Math.floor(this.hunger)}/20`,
    `現在地: ${this._posStr()}`,
    `現在の状態: ${this.sm.getState()}`,
    `--- 仲間の状態 ---`,
    teammates || '  （なし）',
    `--- 指導者からの最新指示 ---`,
    this.lastDirective ?? '  （なし）',
  ].join('\n')
}
```

`this.lastDirective` プロパティをコンストラクタで `null` に初期化すること。

---

### Task 4: Colony の強化
**ファイル:** `src/colony/Colony.js`

#### 4-1. 指令システム追加

エージェントへの指令を `directive` として保持できるようにする:

```js
// コンストラクタに追加
this.directives = {}  // { agentName: { role, message, timestamp } }

// 新メソッド追加
issueDirective(targetRole, message) {
  for (const [name, agent] of Object.entries(this.agents)) {
    if (agent.role === targetRole) {
      this.directives[name] = { role: targetRole, message, timestamp: this.day }
      agent.lastDirective = message  // エージェントに直接セット
    }
  }
  this.log(`[指令] ${targetRole}へ: ${message}`)
}

getDirective(agentName) {
  return this.directives[agentName]?.message ?? null
}
```

#### 4-2. Building定義の追加

建物ごとのコスト・効果を定義:

```js
// コンストラクタに追加
this.buildingDefs = {
  house:     { woodCost: 10, stoneCost: 0,  effect: 'capacity+2' },
  farm:      { woodCost: 5,  stoneCost: 0,  effect: 'food_production+1' },
  warehouse: { woodCost: 8,  stoneCost: 5,  effect: 'storage+20' },
  barracks:  { woodCost: 12, stoneCost: 8,  effect: 'guard_capacity+1' },
  mine:      { woodCost: 6,  stoneCost: 0,  effect: 'stone_production+1' },
}

// requestBuild に検証を追加
requestBuild(buildingType) {
  if (!this.buildingDefs[buildingType]) {
    this.log(`未知の建物タイプ: ${buildingType}`)
    return false
  }
  if (this.buildQueue.includes(buildingType)) {
    this.log(`${buildingType}はすでにキュー済み`)
    return false
  }
  this.buildQueue.push(buildingType)
  this.log(`建築要求: ${buildingType}`)
  return true
}
```

#### 4-3. Colony.getSummary() の強化

エージェント状態を含めたサマリー:

```js
getSummary() {
  const agentStatus = Object.values(this.agents)
    .map(a => `  ${a.name}(${a.role}): ${a.sm.getState()}`)
    .join('\n')

  return [
    `=== コロニー状況 Day${this.day} ===`,
    `資源: 木材${this.inventory.wood} 食料${this.inventory.food} 石材${this.inventory.stone} 小麦${this.inventory.wheat}`,
    `建築待ち: ${this.buildQueue.join(', ') || 'なし'}`,
    `完成建物: ${this.completedBuildings.join(', ') || 'なし'}`,
    `攻撃中: ${this.isUnderAttack ? '⚠️はい' : 'いいえ'}`,
    `食料不足: ${this.needsFood ? '⚠️はい' : 'いいえ'}`,
    `エージェント:\n${agentStatus}`,
    `最近のイベント: ${this.eventLog.slice(-5).join(' | ')}`,
  ].join('\n')
}
```

---

### Task 5: LeaderAgent の指揮系統を実装
**ファイル:** `src/agents/LeaderAgent.js`

`_broadcastDirective()` を `colony.issueDirective()` を使うように変更:

```js
_broadcastDirective(targetRole, directive) {
  this.colony.issueDirective(this._roleKey(targetRole), directive)
  this.speak(`${targetRole}へ指令: ${directive}`)
}
```

また `getAvailableActions()` に石材採掘・兵舎建設を追加:

```js
getAvailableActions() {
  const actions = [
    'コロニーの状況を評価する',
  ]
  if (this.colony.inventory.wood < 10) actions.push('木材収集を指示する')
  if (this.colony.inventory.food < this.colony.agentCount() * 3) actions.push('食料増産を指示する')
  if (this.colony.isUnderAttack) actions.push('防衛緊急指令を出す')
  if (this.colony.buildQueue.length === 0) {
    actions.push('家の建築を命令する')
    actions.push('農地の建築を命令する')
    actions.push('倉庫の建築を命令する')
    actions.push('兵舎の建築を命令する')
  }
  actions.push('全員に休息を命令する')
  return actions
}
```

`Colony` に `agentCount()` メソッドを追加:
```js
agentCount() { return Object.keys(this.agents).length }
```

---

### Task 6: BuilderAgent の建築実装を強化
**ファイル:** `src/agents/BuilderAgent.js`

#### 6-1. WorkOrder システム（MineColonies参考）

`WorkOrderType` に相当する定数を追加:

```js
const WorkOrderType = {
  BUILD:   'BUILD',
  UPGRADE: 'UPGRADE',
  REPAIR:  'REPAIR',
  REMOVE:  'REMOVE',
}
```

#### 6-2. 実際のブロック設置

`_build()` をmineflayerのブロック設置APIで実装:

```js
async _build() {
  const job = this.colony.getNextBuildJob()
  if (!job) { this.speak('建築依頼がない'); return false }

  const def = this.colony.buildingDefs?.[job]
  if (!def) { this.speak(`${job}の設計図がない`); return false }

  // 資源チェック
  if (!this.colony.hasResource('wood', def.woodCost)) {
    this.speak(`木材が足りない(必要:${def.woodCost} 所持:${this.colony.inventory.wood})`)
    return false
  }
  if (def.stoneCost > 0 && !this.colony.hasResource('stone', def.stoneCost)) {
    this.speak(`石材が足りない(必要:${def.stoneCost})`)
    return false
  }

  this.speak(`${job}の建築を開始！(木材${def.woodCost}本使用)`)
  this.colony.consumeResource('wood', def.woodCost)
  if (def.stoneCost > 0) this.colony.consumeResource('stone', def.stoneCost)

  // 足場ブロックを実際に設置（シンプルな3x3基礎）
  try {
    const pos = this.bot.entity.position.floored()
    const oakLog = this.bot.registry?.blocksByName?.['oak_log'] 
                   ?? this.bot.registry?.blocksByName?.['minecraft:oak_log']
    if (oakLog) {
      // 建物の目印として1ブロック設置
      const placePos = pos.offset(1, 0, 1)
      const refBlock = this.bot.blockAt(placePos.offset(0, -1, 0))
      if (refBlock) {
        await this.bot.placeBlock(refBlock, new (await import('vec3')).default(0, 1, 0))
      }
    }
  } catch (e) {
    // ブロック設置失敗でも建築完了とする（ログのみ）
    console.warn(`[${this.name}] ブロック設置失敗:`, e.message)
  }

  // 建築完了処理
  const buildTime = 3000 + def.woodCost * 500
  await this._sleep(buildTime)
  this.colony.completeBuild(job)
  this.speak(`${job}完成！`)
  return true
}
```

#### 6-3. 石材採掘の追加

```js
getAvailableActions() {
  const actions = []
  if (this.colony.hasResource('wood', 5) && this.colony.getNextBuildJob()) actions.push('建築する')
  if (this.colony.inventory.wood < 20) actions.push('木を伐採する')
  if (this.woodInHand > 0) actions.push('木材を倉庫に運ぶ')
  if (this.colony.inventory.stone < 10) actions.push('石を採掘する')
  actions.push('周囲を偵察する')
  actions.push('待機する')
  return actions
}

async _mineStone() {
  this.speak('石を採掘します')
  const stoneBlock = this.bot.findBlock({
    matching: block => ['stone', 'cobblestone', 'deepslate'].some(n => block.name.includes(n)),
    maxDistance: 20,
  })
  if (!stoneBlock) { this.speak('石が見つからない'); return false }
  try {
    if (this.bot.pathfinder) {
      const { goals } = await import('mineflayer-pathfinder')
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(stoneBlock.position.x, stoneBlock.position.y, stoneBlock.position.z)
      )
    }
    await this.bot.dig(stoneBlock)
    this.colony.addResource('stone', 1)
    this.speak('石を採掘した')
  } catch { this.speak('採掘できなかった') }
  return true
}
```

`executeAction()` の switch に `case '石を採掘する': return this._mineStone()` を追加。

---

### Task 7: FarmerAgent の種枯渇バグ修正
**ファイル:** `src/agents/FarmerAgent.js`

収穫時に種を再生産（小麦収穫 → 一部を種として保持）:

```js
async _harvest() {
  this.speak('収穫します！')
  await this._sleep(3000)
  const amount = 3 + Math.floor(Math.random() * 3)
  this.harvestedWheat += amount
  // 収穫した小麦の1/3を種として自動保持
  const seeds = Math.max(1, Math.floor(amount / 3))
  this.seedStock = (this.seedStock ?? 0) + seeds
  this.cropGrown = false
  this.fieldReady = false
  this.colony.log(`${this.name}が小麦${amount}個収穫(種${seeds}個確保)`)
  this.speak(`収穫完了！小麦${amount}個(種${seeds}個)`)
  return true
}
```

`_plantSeeds()` を変更して、`this.seedStock` を優先使用し、なければ `colony.wheat` を使う:

```js
async _plantSeeds() {
  this.speak('種を植えます')
  // 自前の種を優先
  if ((this.seedStock ?? 0) > 0) {
    this.seedStock--
  } else if (!this.colony.consumeResource('wheat', 1)) {
    this.speak('種がない…次の収穫を待とう')
    // 農地は耕し直して再試行できるよう fieldReady を false に
    this.fieldReady = false
    return false
  }
  await this._sleep(2000)
  this.cropGrown = false
  this.cropGrowTimer = 0
  this.colony.log(`${this.name}が種を植えた`)
  this.speak('植えた！')
  return true
}
```

コンストラクタに `this.seedStock = 2` を追加（初期種2個）。

---

### Task 8: GuardAgent のバグ修正
**ファイル:** `src/agents/GuardAgent.js`

`tick()` 内の `this.sm.tickCount` を `this.sm.getTickCount()` に変更（Task 2で追加したメソッドを使う）:

```js
tick() {
  super.tick()
  if (this.sm.getTickCount() % 50 === 0) {
    this._scanThreats().catch(() => {})
  }
}
```

---

### Task 9: 接続管理の強化
**ファイル:** `src/index.js`

#### 9-1. 再接続ロジック

```js
function createBot(config, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ ... })

    bot.on('end', () => {
      console.warn(`[${config.username}] 切断。5秒後に再接続...`)
      setTimeout(() => {
        createBot(config, retryCount + 1).then(resolve).catch(reject)
      }, 5000)
    })

    bot.on('error', (err) => {
      if (retryCount > 5) {
        console.error(`[${config.username}] 再接続上限。停止。`)
        reject(err)
        return
      }
      console.error(`[${config.username}] エラー:`, err.message)
    })
    ...
  })
}
```

#### 9-2. pathfinder の初期化を共通関数化

```js
async function setupPathfinder(bot) {
  try {
    const { pathfinder, Movements } = await import('mineflayer-pathfinder')
    bot.loadPlugin(pathfinder)
    const mcDataModule = await import('minecraft-data')
    const mcData = mcDataModule.default(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)
    return true
  } catch (e) {
    console.warn(`[${bot.username}] pathfinder 初期化失敗:`, e.message)
    return false
  }
}
```

#### 9-3. ゲーム内時間に合わせた sleep/wake

```js
bot.on('time', () => {
  const timeOfDay = bot.time.timeOfDay
  // 13000-23000 = 夜
  const isNight = timeOfDay > 13000 && timeOfDay < 23000
  if (myAgent) myAgent.isNight = isNight
})
```

`BaseAgent` に `isNight = false` プロパティを追加し、
`_setupCommonTransitions()` の sleep イベントで `this.isNight` を条件に使う:

```js
// 夜になったら寝る（MineColonies の EntityAISleep 相当）
this.sm.addEvent(
  () => this.isNight && this.sm.getState() !== CommonState.SLEEPING,
  () => {
    this.speak('夜になった。休もう')
    return CommonState.SLEEPING
  },
  100
)
this.sm.addTransition(
  CommonState.SLEEPING,
  () => !this.isNight,
  () => {
    this.speak('朝だ！働くぞ')
    return CommonState.IDLE
  },
  100
)
```

---

### Task 10: config.js の外出し（設定の一元管理）
**新規ファイル:** `src/config.js`

```js
export const config = {
  server: {
    host:    process.env.MC_HOST    ?? '192.168.15.10',
    port:    parseInt(process.env.MC_PORT ?? '25565'),
    version: process.env.MC_VERSION ?? '1.21.4',
  },
  ollama: {
    url:   process.env.OLLAMA_URL   ?? 'http://192.168.15.150:11434/v1',
    model: process.env.OLLAMA_MODEL ?? 'gemma4:e4b',
  },
  colony: {
    tickMs:           50,    // 1tick = 50ms (20tps)
    dayLengthTicks:   100,   // 100tick = 1ゲーム内日
    llmDecideInterval: 10,   // 10tickごとにLLM判断
    leaderInterval:   200,   // 200tickごとに指導者評価
    statsPrintInterval: 1000,
  },
  initialResources: {
    wood:  5,
    food:  10,
    wheat: 3,
    stone: 0,
  },
  agents: [
    { username: 'Leader_Alex',  role: 'leader'  },
    { username: 'Builder_Bob',  role: 'builder' },
    { username: 'Farmer_Carol', role: 'farmer'  },
    { username: 'Guard_Dave',   role: 'guard'   },
  ],
}
```

`index.js`・`LLMClient.js` でハードコードされている定数を全てここから import するように変更。

---

## MineColonies からの手動コピー指示

以下のファイルは参照のみ（コードをJSに移植する際の設計参考）:

| 参照用MineColoniesファイル | 用途 |
|---|---|
| `src/main/java/com/minecolonies/core/entity/ai/workers/CitizenAI.java` | Task 3-2の優先度レイヤー設計参考 |
| `src/main/java/com/minecolonies/api/colony/workorders/WorkOrderType.java` | Task 6-1のWorkOrder定数参考 |
| `src/main/java/com/minecolonies/api/colony/requestsystem/request/RequestState.java` | 将来のRequest System実装参考 |
| `src/main/java/com/minecolonies/core/entity/ai/combat/AttackMoveAI.java` | GuardAgentの戦闘ロジック改善参考 |
| `src/main/java/com/minecolonies/api/entity/ai/combat/threat/ThreatTable.java` | ThreatTableの距離係数計算参考 |

**これらはJavaファイルのためそのままは使えません。設計の参考として読むだけでOKです。**
コードのコピーは不要です。

---

## 実装順序の推奨

```
Step 1: Task 1（package.json） → npm install
Step 2: Task 2（StateMachine バグ修正）
Step 3: Task 3（BaseAgent 競合修正 + 優先度レイヤー）
Step 4: Task 4（Colony 強化）
Step 5: Task 5（LeaderAgent 指揮系統）
Step 6: Task 7（FarmerAgent 種バグ）← 簡単で効果大
Step 7: Task 8（GuardAgent バグ）← 1行修正
Step 8: Task 10（config.js）
Step 9: Task 6（BuilderAgent 建築強化）
Step 10: Task 9（再接続）← 最後でよい
```

---

## テスト方法

各Task実装後に以下で動作確認:

```bash
# 依存インストール
npm install

# 起動
node src/index.js

# 期待するログ出力例
# [System] Leader_Alex がスポーンしました
# [Leader_Alex] 💬 コロニーを評価中...
# [Colony] [Day1] 建築要求: house
# [Builder_Bob] 💬 木材を集めに行くぞ
# [Guard_Dave] 💬 周囲に敵なし
# [Farmer_Carol] 💬 農地を耕します！
```

---

## 将来の拡張（今回は対象外）

- **DeliverymanAgent** — MineColonies の Deliveryman相当。倉庫間の物資移送
- **MinerAgent** — 洞窟探索・石炭・鉄採掘
- **Request System** — `RequestState` ベースの非同期物資調達
- **Research System** — コロニーのアップグレードツリー
- **Structurize連携** — NBTファイルを読み込んで実際の建物を設置
