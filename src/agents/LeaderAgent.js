/**
 * LeaderAgent
 * コロニーの指導者。MineColoniesにはプレイヤーが担う役割を
 * LLMエージェントとして自律化したもの。
 * 他エージェントに指示を出し、建築優先度や戦略を決定する。
 */

import { BaseAgent } from './BaseAgent.js'
import { decideAction } from '../llm/LLMClient.js'

export class LeaderAgent extends BaseAgent {
  constructor(name, bot, colony) {
    super(name, 'leader', bot, colony)
    this.lastDirectiveTime = 0
    this.directiveInterval = 200 // 200tickごとに指示
  }

  getSystemPrompt() {
    return `あなたはMinecraftコロニーの指導者「${this.name}」です。
あなたの使命はコロニー全体を繁栄させることです。
農家・建築家・衛兵のエージェントを統率し、コロニーの発展を導いてください。
食料・木材・安全のバランスを考えて判断してください。
返答は必ずJSON形式のみにしてください。`
  }

  getAvailableActions() {
    return [
      '家の建築を命令する',
      '農地の建築を命令する',
      '倉庫の建築を命令する',
      '食料増産を指示する',
      '防衛強化を指示する',
      'コロニーの状況を評価する',
      '全員に休息を命令する',
    ]
  }

  async executeAction(action) {
    switch (action) {
      case '家の建築を命令する':
        this.colony.requestBuild('house')
        this.speak('建築家よ、家を建てろ！')
        this._broadcastDirective('建築家', '家の建築を急げ')
        break
      case '農地の建築を命令する':
        this.colony.requestBuild('farm')
        this.speak('農地を整備せよ！')
        this._broadcastDirective('農家', '農地を耕し食料を増やせ')
        break
      case '倉庫の建築を命令する':
        this.colony.requestBuild('warehouse')
        this.speak('倉庫を建設する！')
        this._broadcastDirective('建築家', '倉庫建設を優先せよ')
        break
      case '食料増産を指示する':
        this.speak('農家よ、食料を増産せよ！')
        this._broadcastDirective('農家', '食料が不足している。増産を急げ')
        break
      case '防衛強化を指示する':
        this.speak('衛兵よ、警戒を強化せよ！')
        this._broadcastDirective('衛兵', '防衛態勢を最大にせよ')
        break
      case 'コロニーの状況を評価する':
        await this._evaluateColony()
        break
      case '全員に休息を命令する':
        this.speak('今日はここまで。全員休息せよ')
        break
    }
    await this._sleep(3000)
    return true
  }

  _broadcastDirective(targetRole, directive) {
    // 対象の役職エージェントにチャットで指示
    for (const agent of Object.values(this.colony.agents)) {
      if (agent.role === this._roleKey(targetRole) && agent !== this) {
        agent.speak(`（指導者からの命令）${directive}`)
      }
    }
    this.colony.log(`指導者が${targetRole}に指示: ${directive}`)
  }

  _roleKey(label) {
    const map = { '農家': 'farmer', '建築家': 'builder', '衛兵': 'guard' }
    return map[label] ?? label
  }

  async _evaluateColony() {
    const summary = this.colony.getSummary()
    this.speak('コロニーを評価中...')
    console.log(`[${this.name}] 評価:\n${summary}`)

    // 評価に基づいて自動判断
    if (this.colony.inventory.food < 5) {
      this.colony.log('指導者判断: 食料危機！農家に増産を命令')
      this._broadcastDirective('農家', '緊急！食料が危機的に不足している')
    }
    if (this.colony.inventory.wood < 10 && this.colony.buildQueue.length > 0) {
      this.colony.log('指導者判断: 木材不足。建築家に伐採を命令')
      this._broadcastDirective('建築家', '木材を急いで集めろ')
    }
    if (this.colony.isUnderAttack) {
      this.colony.log('指導者判断: 攻撃中！衛兵に防衛を命令')
      this._broadcastDirective('衛兵', 'コロニーへの攻撃を排除せよ！')
    }
  }

  // 指導者は定期的にコロニー状況を見て自ら判断も行う
  tick() {
    super.tick()
    this.lastDirectiveTime++
    if (this.lastDirectiveTime >= this.directiveInterval) {
      this.lastDirectiveTime = 0
      this._evaluateColony().catch(() => {})
    }
  }
}
