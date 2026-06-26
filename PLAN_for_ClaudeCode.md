# mine_sim × MineColonies 統合計画書
> Claude Code への作業指示書
> 対象リポジトリ: https://github.com/YacobiHime/mine_sim.git

---

## 全体方針・アーキテクチャ

### なぜこの構成か

MineColonies は Java の Forge mod（2091ファイル）。mine_sim は JavaScript の mineflayer ボット。
コードをそのまま混ぜることはできないが、**「MineColonies を実際のForgeサーバーとして動かし、mine_sim のボットがそこに接続してLLM指導者として振る舞う」** という構成なら完全に統合できる。

結果として：
- **コードの90%以上 = MineColonies のソース**（mine_sim/minecolonies/ に丸ごと存在）
- **新規追加分 = LLMブリッジ層のみ**（ColonyBridge.js と LeaderAgent の改修）

### 動作イメージ

```
[Forgeサーバー]                         [mine_sim / Node.js]
  MineColonies mod が動作           →   mineflayer ボット（Leader_Alex）が接続
  市民AIが自律的にコロニーを運営     ←   LLMが /mc コマンドで指揮
  建物建設・農業・警備               →   チャット出力を ColonyBridge が解析
  レイドイベントが発生               ←   LeaderAgent が LLM判断で対応指令
```

---

## リポジトリ最終構成

```
mine_sim/
├── minecolonies/           ← MineColonies ソース（git clone のまま、変更しない）
│   ├── src/                ← 2091個のJavaファイル（コロニーロジック全体）
│   ├── build.gradle
│   └── gradle.properties   ← MC 1.20.1 / Forge 47.1.3 / Java 17
│
├── server/                 ← Forgeサーバー実行環境（セットアップスクリプト）
│   ├── setup.sh            ← Forge installer ダウンロード→実行→mod配置
│   ├── start.sh            ← サーバー起動スクリプト
│   ├── eula.txt
│   └── server.properties
│
├── src/                    ← JS LLM層（既存 + 新規追加）
│   ├── bridge/
│   │   └── ColonyBridge.js ← NEW: /mc コマンド出力パーサー + 状態管理
│   ├── agents/
│   │   ├── BaseAgent.js    ← 既存（バグ修正）
│   │   ├── LeaderAgent.js  ← 大幅改修：MineColoniesを操作する指導者
│   │   ├── BuilderAgent.js ← 既存（補助的役割に縮小）
│   │   ├── FarmerAgent.js  ← 既存（補助的役割に縮小）
│   │   └── GuardAgent.js   ← 既存（補助的役割に縮小）
│   ├── colony/
│   │   └── Colony.js       ← 既存（JS側ミラー状態、ColonyBridgeが更新）
│   ├── statemachine/
│   │   └── StateMachine.js ← 既存（バグ修正のみ）
│   ├── llm/
│   │   └── LLMClient.js    ← 既存（変更なし）
│   ├── config.js           ← 既存（変更なし）
│   └── index.js            ← 既存（起動処理）
│
├── package.json
└── README.md               ← 更新
```

---

## フェーズ1：MineColonies ソースの取り込み

### Step 1-1: git subtree で minecolonies/ にクローン

```bash
cd /path/to/mine_sim
git subtree add --prefix=minecolonies https://github.com/ldtteam/minecolonies.git main --squash
```

> `git subtree` が使えない場合は：
> ```bash
> git clone --depth=1 https://github.com/ldtteam/minecolonies.git minecolonies
> rm -rf minecolonies/.git  # mine_sim の git 管理下に置く
> git add minecolonies/
> git commit -m "feat: add MineColonies source as subtree"
> ```

### Step 1-2: .gitignore 更新

mine_sim の `.gitignore` に追加：
```
minecolonies/build/
minecolonies/.gradle/
server/forge-*.jar
server/libraries/
server/world/
server/logs/
server/crash-reports/
*.log
```

---

## フェーズ2：Forgeサーバーセットアップスクリプト

### Step 2-1: server/setup.sh を作成

```bash
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
```

### Step 2-2: server/start.sh を作成

```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Forge が生成する run.sh か、直接起動
if [ -f "run.sh" ]; then
    bash run.sh
else
    java -Xmx4G -Xms2G \
        -jar forge-1.20.1-47.1.3.jar \
        nogui
fi
```

### Step 2-3: server/config/ に MineColonies 設定を配置

`server/config/minecolonies-server.toml` を作成：

```toml
[gameplay]
    # LLMが /mc コマンドを使えるよう有効化
    canPlayerUseColonyCommands = true
    canPlayerUseShowColonyInfoCommand = true
    canPlayerUseAddOfficerCommand = true
    
    # シミュレーション向け設定
    turnOffRaiderEvents = false          # レイドを有効（LLMに判断させる）
    maxCitizens = 50                     # 最大市民数
    initialCitizenCount = 4             # 初期市民数
    workerBreakResistance = 100         # 設備破壊しない
    
    # 1日の長さ（デフォルト = MC時間）
    nightModeSleepDefault = true
    
[requestSystem]
    deliverymanResourceAvailabilitySkipDelay = 5
    assignmentMode = "BEST"
```

---

## フェーズ3：ColonyBridge.js の新規作成（核心部分）

**ファイル:** `src/bridge/ColonyBridge.js`

このクラスが mine_sim と MineColonies を繋ぐ唯一の橋渡し。
mineflayer のチャットメッセージを監視し、`/mc` コマンド出力をパースして JS オブジェクトに変換する。

```javascript
/**
 * ColonyBridge.js
 * MineColonies の /mc コマンド出力を解析し、コロニー状態を JS オブジェクトとして管理する。
 * 
 * 対応する /mc コマンド一覧:
 *   /mc colony info <id>         → colony.name, citizens, center座標
 *   /mc citizen list <colonyId>  → 市民名・職業リスト
 *   /mc citizen info <id> <cId>  → 個別市民の状態
 *   /mc colony raid <id> tonight → レイドをトリガー
 *   /mc colony delete <id>       → コロニー削除
 *
 * 参照した MineColonies ソース:
 *   minecolonies/src/main/java/com/minecolonies/core/commands/colonycommands/CommandColonyInfo.java
 *   minecolonies/src/main/java/com/minecolonies/core/commands/citizencommands/CommandCitizenList.java
 *   minecolonies/src/main/java/com/minecolonies/core/commands/colonycommands/CommandColonyPrintStats.java
 */
export class ColonyBridge {
    constructor(bot) {
        this.bot = bot
        this.colonyId = null

        // コロニー状態（MineColonies の IColony 相当）
        this.state = {
            id: null,
            name: null,
            mayor: null,
            citizens: [],          // { id, name, job, health, happiness }
            buildings: [],         // { type, level, pos, workers }
            center: null,          // { x, y, z }
            isRaided: false,
            citizenCount: 0,
            maxCitizens: 0,
            lastUpdated: null,
        }

        this._pendingCommand = null
        this._messageBuffer = []
        this._parseTimeout = null

        // チャットメッセージ監視（/mc コマンドの返答をここでキャッチ）
        bot.on('message', (jsonMsg) => {
            const text = jsonMsg.toString()
            this._handleMessage(text)
        })
    }

    // ──────────────────────────────────────────────────
    // パブリックAPI
    // ──────────────────────────────────────────────────

    /** コロニー情報を更新（非同期、チャット出力待ち） */
    async refreshColonyInfo(colonyId = this.colonyId ?? 1) {
        this.colonyId = colonyId
        this._startCapture('colonyInfo')
        await this._sendCommand(`/mc colony info ${colonyId}`)
        await this._waitForCapture(2000)
        return this.state
    }

    /** 市民リストを更新 */
    async refreshCitizenList(colonyId = this.colonyId ?? 1) {
        this._startCapture('citizenList')
        await this._sendCommand(`/mc citizen list ${colonyId} 1`)
        await this._waitForCapture(2000)
        return this.state.citizens
    }

    /** 特定市民の詳細情報を取得 */
    async getCitizenInfo(citizenId, colonyId = this.colonyId ?? 1) {
        this._startCapture('citizenInfo')
        await this._sendCommand(`/mc citizen info ${colonyId} ${citizenId}`)
        await this._waitForCapture(1500)
    }

    /** レイドを今夜トリガー（LLMが防衛判断した後に呼ぶ） */
    async triggerRaid(colonyId = this.colonyId ?? 1) {
        await this._sendCommand(`/mc colony raid ${colonyId} tonight`)
    }

    /** コロニーチャンクをクレーム */
    async claimChunks(colonyId = this.colonyId ?? 1) {
        await this._sendCommand(`/mc colony claimchunks ${colonyId} true 5`)
    }

    /** 現在のコロニー状態を返す（JS オブジェクト） */
    getState() {
        return { ...this.state }
    }

    /** LLM用サマリー文字列を生成（LeaderAgent が LLM プロンプトに埋め込む） */
    toPromptSummary() {
        const s = this.state
        const citizenSummary = s.citizens
            .slice(0, 10)
            .map(c => `  ${c.name}(${c.job ?? '未配属'}): HP${c.health ?? '?'} 幸福度${c.happiness ?? '?'}`)
            .join('\n')

        const buildingSummary = s.buildings
            .map(b => `  ${b.type} Lv${b.level} at (${b.pos?.x},${b.pos?.y},${b.pos?.z}) 担当:${b.workers?.join(',') ?? 'なし'}`)
            .join('\n')

        return [
            `=== MineColonies コロニー状態 ===`,
            `コロニー名: ${s.name ?? '未設立'}  ID: ${s.id ?? '-'}`,
            `市長: ${s.mayor ?? '-'}`,
            `市民: ${s.citizenCount}/${s.maxCitizens}人`,
            `中心座標: ${s.center ? `(${s.center.x}, ${s.center.y}, ${s.center.z})` : '不明'}`,
            `レイド中: ${s.isRaided ? '⚠️ はい' : 'いいえ'}`,
            ``,
            `--- 市民一覧 ---`,
            citizenSummary || '  （なし）',
            ``,
            `--- 建物一覧 ---`,
            buildingSummary || '  （なし）',
            ``,
            `最終更新: ${s.lastUpdated ? new Date(s.lastUpdated).toLocaleTimeString('ja-JP') : 'なし'}`,
        ].join('\n')
    }

    // ──────────────────────────────────────────────────
    // 内部パーサー群
    // CommandColonyInfo.java / CommandCitizenList.java の出力形式に合わせている
    // ──────────────────────────────────────────────────

    _handleMessage(text) {
        if (!this._capturing) return
        this._messageBuffer.push(text)

        // バッファを解析（タイムアウトをリセットしながら）
        clearTimeout(this._parseTimeout)
        this._parseTimeout = setTimeout(() => this._parseBuffer(), 500)
    }

    _parseBuffer() {
        const lines = this._messageBuffer
        this._messageBuffer = []
        this._capturing = false

        switch (this._captureMode) {
            case 'colonyInfo':   this._parseColonyInfo(lines); break
            case 'citizenList':  this._parseCitizenList(lines); break
            case 'citizenInfo':  this._parseCitizenInfo(lines); break
        }

        this.state.lastUpdated = Date.now()
        this._resolveCapture?.()
    }

    /**
     * CommandColonyInfo.java の出力形式:
     *   "ID: 1 Name: MyColony"
     *   "Mayor: PlayerName"
     *   "Citizens: 3/10"
     *   "Coordinates: x=100 y=64 z=200"
     */
    _parseColonyInfo(lines) {
        for (const line of lines) {
            const idName = line.match(/ID:\s*(\d+)\s+Name:\s*(.+)/)
            if (idName) {
                this.state.id = parseInt(idName[1])
                this.state.name = idName[2].trim()
                continue
            }
            const mayor = line.match(/Mayor:\s*(.+)/)
            if (mayor) { this.state.mayor = mayor[1].trim(); continue }

            const citizens = line.match(/Citizens:\s*(\d+)\/(\d+)/)
            if (citizens) {
                this.state.citizenCount = parseInt(citizens[1])
                this.state.maxCitizens = parseInt(citizens[2])
                continue
            }
            const coords = line.match(/x=(-?\d+)\s+y=(-?\d+)\s+z=(-?\d+)/)
            if (coords) {
                this.state.center = { x: parseInt(coords[1]), y: parseInt(coords[2]), z: parseInt(coords[3]) }
                continue
            }
            if (line.includes('is being raided')) this.state.isRaided = true
        }
    }

    /**
     * CommandCitizenList.java の出力形式:
     *   "1: Steve (Farmer)"
     *   "2: Alex (Builder)"
     */
    _parseCitizenList(lines) {
        this.state.citizens = []
        for (const line of lines) {
            const m = line.match(/^(\d+):\s*(.+?)\s*\((.+?)\)/)
            if (m) {
                this.state.citizens.push({
                    id: parseInt(m[1]),
                    name: m[2].trim(),
                    job: m[3].trim(),
                    health: null,
                    happiness: null,
                })
            }
        }
    }

    /**
     * CommandCitizenInfo.java の出力（市民個別情報で health/happiness 更新）
     */
    _parseCitizenInfo(lines) {
        let citizenId = null
        for (const line of lines) {
            const id = line.match(/Citizen ID:\s*(\d+)/)
            if (id) { citizenId = parseInt(id[1]); continue }

            const hp = line.match(/Health:\s*([\d.]+)/)
            if (hp && citizenId != null) {
                const c = this.state.citizens.find(c => c.id === citizenId)
                if (c) c.health = parseFloat(hp[1])
                continue
            }
            const hap = line.match(/Happiness:\s*([\d.]+)/)
            if (hap && citizenId != null) {
                const c = this.state.citizens.find(c => c.id === citizenId)
                if (c) c.happiness = parseFloat(hap[1])
            }
        }
    }

    // ──────────────────────────────────────────────────
    // ユーティリティ
    // ──────────────────────────────────────────────────

    _startCapture(mode) {
        this._capturing = true
        this._captureMode = mode
        this._messageBuffer = []
    }

    _waitForCapture(timeoutMs) {
        return new Promise((resolve) => {
            this._resolveCapture = resolve
            setTimeout(resolve, timeoutMs)
        })
    }

    async _sendCommand(cmd) {
        await this.bot.chat(cmd)
        await new Promise(r => setTimeout(r, 200))
    }
}
```

---

## フェーズ4：LeaderAgent.js の全面改修

**ファイル:** `src/agents/LeaderAgent.js`

MineColonies を実際に操作するLLM指導者に作り替える。

```javascript
/**
 * LeaderAgent.js — LLM指導者（MineColonies操作版）
 *
 * プレイヤーの代わりにLLMがコロニーを指揮する。
 * MineColonies の IColonyManager / ICitizenManager に相当する役割を
 * チャットコマンド経由で担う。
 *
 * 参照した MineColonies ソース:
 *   CitizenAI.java       → calculateNextState() の優先度構造
 *   AbstractEntityAIBasic.java → tick() の構造
 *   CommandColonyInfo.java → /mc colony info の出力形式
 */
import { BaseAgent } from './BaseAgent.js'
import { ColonyBridge } from '../bridge/ColonyBridge.js'

export class LeaderAgent extends BaseAgent {
    constructor(bot, colony, llmClient) {
        super(bot, colony, llmClient, 'leader')
        this.bridge = new ColonyBridge(bot)
        this.decisionIntervalTicks = 200    // 200tick（10秒）ごとにLLM判断
        this.refreshIntervalTicks  = 100    // 100tick（5秒）ごとにコロニー状態更新
        this.ticksSinceDecision = 0
        this.ticksSinceRefresh  = 0
        this.colonyInitialized = false
    }

    // ──────────────────────────────────────────────────
    // 初期化：スポーン後にタウンホールを設置してコロニーを開始
    // ──────────────────────────────────────────────────

    async onSpawn() {
        this.speak('コロニーの設立を開始します')
        await this._sleep(3000)

        // タウンホール設置（creative モードで直接設置）
        // MineColonies の TownHallBlock 相当
        try {
            await this.bot.chat('/give @s minecolonies:supplycampitem')
            await this._sleep(500)
            // プレイヤー足元に置く
            const pos = this.bot.entity.position.floored()
            await this.bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} minecolonies:townhall`)
            await this._sleep(2000)
            await this.bridge.refreshColonyInfo(1)
            this.colonyInitialized = true
            this.speak('コロニー設立完了！統治を開始します')
        } catch (e) {
            this.speak('コロニー設立に失敗。サーバー側で手動でタウンホールを置いてください')
            console.error('[LeaderAgent] spawn error:', e.message)
        }
    }

    // ──────────────────────────────────────────────────
    // メインティックループ
    // CitizenAI.calculateNextState() の優先度構造を参考に
    // ──────────────────────────────────────────────────

    async tick() {
        this.ticksSinceRefresh++
        this.ticksSinceDecision++

        // 優先度1（毎100tick）: MineColonies 状態を更新
        if (this.ticksSinceRefresh >= this.refreshIntervalTicks) {
            this.ticksSinceRefresh = 0
            await this._refreshState()
        }

        // 優先度2（毎200tick）: LLMで次のアクションを決定
        if (this.ticksSinceDecision >= this.decisionIntervalTicks && !this.llmBusy) {
            this.ticksSinceDecision = 0
            await this._decidAndExecute()
        }
    }

    // ──────────────────────────────────────────────────
    // MineColonies 状態の更新
    // ──────────────────────────────────────────────────

    async _refreshState() {
        try {
            await this.bridge.refreshColonyInfo(1)
            await this.bridge.refreshCitizenList(1)
            // JS側のColonyにもミラーリング（他エージェントから参照できるよう）
            const s = this.bridge.getState()
            this.colony.mcState = s
        } catch (e) {
            // 更新失敗はスキップ（次回に持ち越し）
        }
    }

    // ──────────────────────────────────────────────────
    // LLMによる意思決定 → MineColonies コマンド実行
    // ──────────────────────────────────────────────────

    async _decidAndExecute() {
        if (this.llmBusy) return
        this.llmBusy = true

        try {
            const situation = this.bridge.toPromptSummary()
            const actions = this._getAvailableActions()
            const result = await this.llmClient.decideAction(
                this._getSystemPrompt(),
                situation,
                actions
            )

            this.speak(result.speech ?? '考え中...')
            await this._executeAction(result.action)
        } catch (e) {
            console.error('[LeaderAgent] LLM error:', e.message)
        } finally {
            this.llmBusy = false
        }
    }

    getSystemPrompt() {
        return `あなたはMinecraftのコロニーを統治するLLM指導者です。
MineColonies modが動作しているサーバーに接続しており、
/mc コマンドを通じてコロニーを管理します。
市民の幸福度・健康・食料を維持しつつ、コロニーを発展させてください。
レイドが来たら防衛を優先してください。
返答は必ずJSON形式: {"action": "アクション名", "speech": "一言セリフ"}`
    }

    _getAvailableActions() {
        const s = this.bridge.getState()
        const actions = ['コロニーの状態を確認する']

        if (!s.name) {
            return ['コロニーを設立する']
        }

        // 市民数が少ない → 採用
        if (s.citizenCount < s.maxCitizens) {
            actions.push('新しい市民をスポーンさせる(/mc citizen spawnnew 1)')
        }

        // レイド中 → 防衛
        if (s.isRaided) {
            actions.push('防衛指令を出す(/mc colony raid 1 now で追加レイドを防ぐ)')
            actions.push('全市民に撤退を命令する')
        }

        // 建物関連
        actions.push('建物の建設を指示する（/mc コマンドで建設依頼）')
        actions.push('市民の職業割り当てを最適化する')
        actions.push('コロニーに挨拶する')

        return actions
    }

    async _executeAction(action) {
        const s = this.bridge.getState()

        if (action?.includes('市民をスポーン') || action?.includes('spawnnew')) {
            await this.bot.chat(`/mc citizen spawnnew ${s.id ?? 1}`)
            this.colony.log('[指導者] 市民を召喚しました')

        } else if (action?.includes('コロニーの状態')) {
            await this.bridge.refreshColonyInfo(s.id ?? 1)
            await this.bridge.refreshCitizenList(s.id ?? 1)
            this.colony.log('[指導者] コロニー状態を更新しました')

        } else if (action?.includes('防衛') || action?.includes('レイド')) {
            // 衛兵に優先的にアラートを送る（チャット経由）
            await this.bot.chat('コロニー防衛！全員戦闘準備！')
            this.colony.isUnderAttack = true
            this.colony.log('[指導者] 防衛指令を発令しました')

        } else if (action?.includes('建設')) {
            // MineColonies のビルダーボットへの依頼
            // 実際の建設は MineColonies の EntityAIStructureBuilder が行う
            await this.bot.chat('コロニーの建設を進めてください')
            this.colony.log('[指導者] 建設指示を送りました')

        } else if (action?.includes('挨拶')) {
            await this.bot.chat(`こんにちは！私はコロニーの指導者です。${s.name ?? 'このコロニー'}をよろしく！`)
        }
    }
}
```

---

## フェーズ5：既存コードのバグ修正（既存 CLAUDE_CODE_INSTRUCTIONS .md の内容）

既存の改善指示書にある10個のタスクをそのまま実行する。
特に重要なもの（優先順）：

### Task 1: package.json の依存修正
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
その後 `npm install`

### Task 2: StateMachine のバグ修正
`getTickCount()` メソッドを追加：
```js
getTickCount() { return this.tickCount }
```

### Task 3: BaseAgent の LLM競合バグ修正
`_triggerDecision()` 内で `setState(EXECUTING)` を `llmBusy=false` より先に呼ぶ

### Task 7: FarmerAgent の種枯渇バグ修正
コンストラクタに `this.seedStock = 2` 追加

### Task 8: GuardAgent のバグ修正
`this.sm.tickCount` → `this.sm.getTickCount()` に変更

---

## フェーズ6：index.js の更新

LeaderAgent が起動時に ColonyBridge を持つよう、スポーンイベントで `onSpawn()` を呼ぶ：

```javascript
// index.js の bot.once('spawn', ...) ブロックに追加
bot.once('spawn', async () => {
    // pathfinder 初期化
    await setupPathfinder(bot)
    
    // エージェント生成
    const agent = createAgent(config, bot, colony, llmClient)
    
    // LeaderAgent はスポーン後に初期化処理
    if (agent.role === 'leader') {
        await agent.onSpawn()
    }
    
    // メインティックループ開始
    setInterval(() => agent.tick(), config.colony.tickMs)
})
```

---

## 実行手順

### 初回セットアップ

```bash
# 1. MineColonies ソースを mine_sim に取り込む
cd mine_sim
git clone --depth=1 https://github.com/ldtteam/minecolonies.git minecolonies

# 2. Forge サーバーをセットアップ（Java 17 が必要）
cd server
bash setup.sh   # Forge + MineColonies jar を自動ダウンロード

# 3. Forge サーバーを起動（別ターミナル）
bash start.sh

# 4. mine_sim の依存インストール
cd ..
npm install

# 5. 環境変数設定
export MC_HOST=localhost
export MC_PORT=25565
export OLLAMA_URL=http://localhost:11434/v1
export OLLAMA_MODEL=gemma4:e4b

# 6. mine_sim 起動
npm start
```

### 期待するログ出力

```
[System] Leader_Alex がスポーンしました
[Leader_Alex] 💬 コロニーの設立を開始します
[System] /mc colony info 1 を送信...
[Bridge] コロニー情報を取得: "MyColony" (市民: 0/10)
[Leader_Alex] 💬 コロニー設立完了！統治を開始します
... 200tick後 ...
[LLM] 判断中... (状態: 市民0人, 建物なし)
[Leader_Alex] 💬 まずは市民を集めよう！
[System] /mc citizen spawnnew 1 を送信
[Bridge] 市民リスト更新: Steve(未配属), Alex(未配属)
```

---

## 参照した MineColonies ソースファイル一覧

| ファイル | 参照目的 |
|---|---|
| `minecolonies/src/main/java/com/minecolonies/core/entity/ai/workers/CitizenAI.java` | `calculateNextState()` の優先度構造 → BaseAgent の優先度レイヤー設計 |
| `minecolonies/src/main/java/com/minecolonies/core/commands/colonycommands/CommandColonyInfo.java` | コロニー情報コマンドの出力形式 → ColonyBridge のパーサー設計 |
| `minecolonies/src/main/java/com/minecolonies/core/commands/colonycommands/CommandColonyPrintStats.java` | 統計情報コマンドの出力形式 |
| `minecolonies/src/main/java/com/minecolonies/core/commands/citizencommands/CommandCitizenList.java` | 市民リストの出力形式 → ColonyBridge._parseCitizenList() |
| `minecolonies/src/main/java/com/minecolonies/core/entity/ai/workers/AbstractEntityAIBasic.java` | tick() 構造・状態遷移 → BaseAgent 設計 |
| `minecolonies/src/main/java/com/minecolonies/api/colony/requestsystem/request/RequestState.java` | リクエストシステムの状態（将来の拡張参考） |
| `minecolonies/src/main/java/com/minecolonies/core/entity/ai/AttackMoveAI.java` | 戦闘AIの構造 → GuardAgent 改善参考 |
| `minecolonies/src/main/java/com/minecolonies/api/entity/ai/combat/threat/ThreatTable.java` | 脅威テーブルの距離係数 → GuardAgent._threatTable 設計 |

---

## 今後の拡張（フェーズ7以降、今回は対象外）

- **MineColonies パケットプロトコルへの直接接続**: mineflayer にカスタムパケットハンドラーを追加し、GUI操作（市民への職業割り当て等）を自動化
- **建物スキャン**: `mineflayer-blockfinder` で MineColonies 建物ブロックを検出し、状態推定精度を向上
- **Structurize 連携**: NBT ファイルの自動配置で建設を完全自動化
- **研究システム**: MineColonies の ResearchManager に対応した `/mc research` コマンド連携
- **マルチコロニー**: 複数コロニーの並行管理（LLMに外交判断させる）
