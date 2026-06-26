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
        this._capturing = false
        this._captureMode = null
        this._resolveCapture = null

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
