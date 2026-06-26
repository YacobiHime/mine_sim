/**
 * BaseAgent
 * MineColonies の AbstractJob + AbstractEntityAIBasic に相当する基底クラス。
 * 各職種はこれを継承し、getSystemPrompt() と getAvailableActions() を実装する。
 */

import { StateMachine } from '../statemachine/StateMachine.js'
import { decideAction, generateSpeech } from '../llm/LLMClient.js'

// MineColonies の AIWorkerState に相当する共通ステート
export const CommonState = {
  IDLE:             'IDLE',
  DECIDING:         'DECIDING',    // LLMに行動を問い合わせ中
  EXECUTING:        'EXECUTING',   // 行動実行中
  NEEDS_RESOURCE:   'NEEDS_RESOURCE',
  EATING:           'EATING',
  SLEEPING:         'SLEEPING',
  EMERGENCY_RETREAT: 'EMERGENCY_RETREAT',  // 緊急退避
}

export class BaseAgent {
  /**
   * @param {string} name         エージェント名
   * @param {string} role         職種（'builder'|'farmer'|'guard'|'leader'）
   * @param {object} bot          mineflayer bot インスタンス
   * @param {Colony} colony       共有コロニー状態
   */
  constructor(name, role, bot, colony) {
    this.name    = name
    this.role    = role
    this.bot     = bot
    this.colony  = colony

    // 状態
    this.hunger     = 20      // 0-20
    this.health     = 20
    this.isSleeping = false
    this.isNight    = false   // 夜かどうか
    this.currentTask = null   // 現在実行中のタスク名
    this.llmBusy    = false   // LLM呼び出し中フラグ
    this.lastDirective = null // 指導者からの最新指示

    // MineColonies の TickRateStateMachine に相当
    this.sm = new StateMachine(CommonState.IDLE, (err) => {
      console.error(`[${this.name}] StateMachine error:`, err)
    })

    this._setupCommonTransitions()
    this._setupJobTransitions()

    colony.registerAgent(this)
    console.log(`[${name}] スポーン (役職: ${role})`)
  }

  // ---- 継承先が実装する ----

  /** LLMに渡すシステムプロンプト（人格・役割定義） */
  getSystemPrompt() {
    return `あなたはMinecraftのNPCエージェント「${this.name}」です。役職は${this.role}です。`
  }

  /** 現在取れる行動のリストを返す（LLMへの選択肢） */
  getAvailableActions() {
    return ['待機する', '周囲を探索する']
  }

  /** 行動を実際に実行する */
  async executeAction(action) {
    this.speak(`${action}します`)
    await this._sleep(2000)
    return true
  }

  // ---- 共通ステートマシン設定 ----

  _setupCommonTransitions() {
    // 優先度1（最高）：瀕死(health<4) → EMERGENCY_RETREAT
    this.sm.addEvent(
      () => this.health < 4 && this.sm.getState() !== CommonState.EMERGENCY_RETREAT,
      () => {
        this.speak('死にそうだ！逃げろ！')
        this._emergencyRetreat()
        return CommonState.EMERGENCY_RETREAT
      },
      5  // 5tickごとにチェック
    )

    // 優先度2：空腹(hunger<8) → EATING
    this.sm.addEvent(
      () => this.hunger < 8 && this.sm.getState() !== CommonState.EATING,
      () => {
        this.speak('お腹が空いた…食事にしよう')
        return CommonState.EATING
      },
      20
    )

    // 夜になったら寝る（MineColonies の EntityAISleep 相当）
    this.sm.addEvent(
      () => this.isNight && this.sm.getState() !== CommonState.SLEEPING,
      () => {
        this.speak('夜になった。休もう')
        return CommonState.SLEEPING
      },
      100
    )

    // IDLE → DECIDING（10tickごとに次の行動を判断）優先度0（通常）
    this.sm.addTransition(
      CommonState.IDLE,
      () => !this.llmBusy,
      () => {
        this._triggerDecision()
        return CommonState.DECIDING
      },
      10,
      0  // 通常優先度
    )

    // DECIDING → IDLE（LLM応答待ち）
    // 注意: 優先度を低くして、EXECUTING移行後は発火しないようにする
    this.sm.addTransition(
      CommonState.DECIDING,
      () => !this.llmBusy,
      () => CommonState.IDLE,
      5,
      -1  // 最低優先度（EXECUTING移行後は発火しない）
    )

    // EATING
    this.sm.addTransition(
      CommonState.EATING,
      () => this.colony.hasResource('food', 1),
      () => {
        this.colony.consumeResource('food', 1)
        this.hunger = Math.min(20, this.hunger + 8)
        this.speak('ごちそうさま')
        return CommonState.IDLE
      },
      10
    )
    this.sm.addTransition(
      CommonState.EATING,
      () => !this.colony.hasResource('food', 1),
      () => {
        this.speak('食料がない…')
        return CommonState.IDLE
      },
      20
    )

    // SLEEPING → IDLE（朝になったら）
    this.sm.addTransition(
      CommonState.SLEEPING,
      () => !this.isNight,
      () => {
        this.speak('朝だ！働くぞ')
        return CommonState.IDLE
      },
      100
    )

    // EMERGENCY_RETREAT → IDLE
    this.sm.addTransition(
      CommonState.EMERGENCY_RETREAT,
      () => this.health >= 10,
      () => {
        this.speak('落ち着いた')
        return CommonState.IDLE
      },
      10
    )
  }

  /** 継承先でジョブ固有のトランジションを追加する */
  _setupJobTransitions() {}

  /** 緊急退避処理 */
  async _emergencyRetreat() {
    // ランダム方向に走る（pathfinder未使用でも動く）
    this.bot.setControlState('sprint', true)
    await this._sleep(2000)
    this.bot.setControlState('sprint', false)
    this.health = Math.min(20, this.health + 2)
    this.sm.setState(CommonState.IDLE)
  }

  // ---- LLM行動決定 ----

  async _triggerDecision() {
    if (this.llmBusy) return
    this.llmBusy = true
    try {
      const situation = this._buildSituationPrompt()
      const choices   = this.getAvailableActions()
      const result    = await decideAction(this.getSystemPrompt(), situation, choices)

      this.speak(result.speech)
      this.currentTask = result.action
      // 先にEXECUTINGにしてからllmBusyをfalseにする
      this.sm.setState(CommonState.EXECUTING)
      this.llmBusy = false  // falseにした後にexecuteAction

      // 行動実行（非同期、完了したらIDLEへ）
      this.executeAction(result.action)
        .then(() => {
          if (this.sm.getState() === CommonState.EXECUTING) {
            this.sm.setState(CommonState.IDLE)
          }
        })
        .catch(err => {
          console.error(`[${this.name}] executeAction error:`, err)
          this.sm.setState(CommonState.IDLE)
        })
    } catch (err) {
      console.error(`[${this.name}] LLM error:`, err)
      this.llmBusy = false
      this.sm.setState(CommonState.IDLE)
    }
    // finally で llmBusy = false を消す（上で制御するため）
  }

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

  // ---- ユーティリティ ----

  speak(text) {
    if (!text) return
    try {
      this.bot.chat(`[${this.name}] ${text}`)
    } catch {}
    console.log(`[${this.name}] 💬 ${text}`)
  }

  _posStr() {
    const p = this.bot.entity?.position
    return p ? `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})` : '不明'
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ---- メインループから呼ばれる ----

  tick() {
    this.sm.tick()
    this.hunger = Math.max(0, this.hunger - 0.01)
  }
}
