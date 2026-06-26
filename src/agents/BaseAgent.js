/**
 * BaseAgent
 * MineColonies の AbstractJob + AbstractEntityAIBasic に相当する基底クラス。
 * 各職種はこれを継承し、getSystemPrompt() と getAvailableActions() を実装する。
 */

import { StateMachine } from '../statemachine/StateMachine.js'
import { decideAction, generateSpeech } from '../llm/LLMClient.js'

// MineColonies の AIWorkerState に相当する共通ステート
export const CommonState = {
  IDLE:           'IDLE',
  DECIDING:       'DECIDING',    // LLMに行動を問い合わせ中
  EXECUTING:      'EXECUTING',   // 行動実行中
  NEEDS_RESOURCE: 'NEEDS_RESOURCE',
  EATING:         'EATING',
  SLEEPING:       'SLEEPING',
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
    this.currentTask = null   // 現在実行中のタスク名
    this.llmBusy    = false   // LLM呼び出し中フラグ

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
    // 割り込みイベント：空腹になったら食事
    this.sm.addEvent(
      () => this.hunger < 8 && this.sm.getState() !== CommonState.EATING,
      () => {
        this.speak('お腹が空いた…食事にしよう')
        return CommonState.EATING
      },
      20
    )

    // IDLE → DECIDING（10tickごとに次の行動を判断）
    this.sm.addTransition(
      CommonState.IDLE,
      () => !this.llmBusy,
      () => {
        this._triggerDecision()
        return CommonState.DECIDING
      },
      10
    )

    // DECIDING → IDLE（LLM応答待ち、完了したらEXECUTINGへ遷移はexecuteActionの中で行う）
    this.sm.addTransition(
      CommonState.DECIDING,
      () => !this.llmBusy,
      () => CommonState.IDLE,
      5
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
  }

  /** 継承先でジョブ固有のトランジションを追加する */
  _setupJobTransitions() {}

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
      this.sm.setState(CommonState.EXECUTING)

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
      this.sm.setState(CommonState.IDLE)
    } finally {
      this.llmBusy = false
    }
  }

  _buildSituationPrompt() {
    return [
      this.colony.getSummary(),
      `--- 自分の状態 ---`,
      `名前: ${this.name}  役職: ${this.role}`,
      `体力: ${this.health}/20  空腹度: ${this.hunger}/20`,
      `現在地: ${this._posStr()}`,
      `現在の状態: ${this.sm.getState()}`,
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
