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
    constructor(name, role, bot, colony, llmClient) {
        super(name, role, bot, colony)
        this.bridge = new ColonyBridge(bot)
        this.llmClient = llmClient
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
            await this._decideAndExecute()
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

    async _decideAndExecute() {
        if (this.llmBusy) return
        this.llmBusy = true

        try {
            const situation = this.bridge.toPromptSummary()
            const actions = this._getAvailableActions()
            const result = await this.llmClient.decideAction(
                this.getSystemPrompt(),
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
