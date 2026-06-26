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

  async executeAction(action) {
    switch (action) {
      case '家の建築を命令する':
        this.colony.requestBuild('house')
        this.speak('建築家よ、家を建てろ！')
        this._broadcastDirective('builder', '家の建築を急げ')
        break
      case '農地の建築を命令する':
        this.colony.requestBuild('farm')
        this.speak('農地を整備せよ！')
        this._broadcastDirective('farmer', '農地を耕し食料を増やせ')
        break
      case '倉庫の建築を命令する':
        this.colony.requestBuild('warehouse')
        this.speak('倉庫を建設する！')
        this._broadcastDirective('builder', '倉庫建設を優先せよ')
        break
      case '兵舎の建築を命令する':
        this.colony.requestBuild('barracks')
        this.speak('兵舎を建設する！')
        this._broadcastDirective('builder', '兵舎建設を優先せよ')
        break
      case '木材収集を指示する':
        this.speak('建築家よ、木材を集めろ！')
        this._broadcastDirective('builder', '木材を緊急に集めろ')
        break
      case '食料増産を指示する':
        this.speak('農家よ、食料を増産せよ！')
        this._broadcastDirective('farmer', '食料が不足している。増産を急げ')
        break
      case '防衛緊急指令を出す':
        this.speak('衛兵よ、警戒を強化せよ！')
        this._broadcastDirective('guard', '防衛態勢を最大にせよ')
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
    this.colony.issueDirective(this._roleKey(targetRole), directive)
    this.speak(`${targetRole}へ指令: ${directive}`)
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
      this._broadcastDirective('farmer', '緊急！食料が危機的に不足している')
    }
    if (this.colony.inventory.wood < 10 && this.colony.buildQueue.length > 0) {
      this.colony.log('指導者判断: 木材不足。建築家に伐採を命令')
      this._broadcastDirective('builder', '木材を急いで集めろ')
    }
    if (this.colony.isUnderAttack) {
      this.colony.log('指導者判断: 攻撃中！衛兵に防衛を命令')
      this._broadcastDirective('guard', 'コロニーへの攻撃を排除せよ！')
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
