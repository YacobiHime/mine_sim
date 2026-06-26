/**
 * BuilderAgent
 * MineColonies の JobBuilder + EntityAIStructureBuilder に相当。
 * 木を集め、建築を行う。
 */

import { BaseAgent, CommonState } from './BaseAgent.js'

// MineColonies の AIWorkerState（Builder固有）に相当
const BuilderState = {
  GATHER_WOOD:   'GATHER_WOOD',
  BUILD:         'BUILD',
  RETURN_WOOD:   'RETURN_WOOD',
}

export class BuilderAgent extends BaseAgent {
  constructor(name, bot, colony) {
    super(name, 'builder', bot, colony)
    this.woodInHand = 0
    this.buildTarget = null
  }

  getSystemPrompt() {
    return `あなたはMinecraftコロニーの建築家「${this.name}」です。
あなたの使命はコロニーのために建物を建て、木材を集めることです。
コロニーの状況を見て、今何が最も必要かを判断し、最適な行動を選んでください。
返答は必ずJSON形式のみにしてください。`
  }

  getAvailableActions() {
    const actions = []

    if (this.colony.hasResource('wood', 5) && this.colony.getNextBuildJob()) {
      actions.push('建築する')
    }
    if (this.colony.inventory.wood < 20) {
      actions.push('木を伐採する')
    }
    if (this.woodInHand > 0) {
      actions.push('木材を倉庫に運ぶ')
    }
    actions.push('周囲を偵察する')
    actions.push('待機する')

    return actions
  }

  async executeAction(action) {
    switch (action) {
      case '木を伐採する':
        return this._gatherWood()
      case '木材を倉庫に運ぶ':
        return this._returnWood()
      case '建築する':
        return this._build()
      case '周囲を偵察する':
        return this._scout()
      default:
        await this._sleep(3000)
        return true
    }
  }

  async _gatherWood() {
    this.speak('木材を集めに行くぞ')
    const treeBlock = this.bot.findBlock({
      matching: block => block.name.includes('log'),
      maxDistance: 32,
    })

    if (!treeBlock) {
      this.speak('近くに木がない…もっと探そう')
      await this._sleep(2000)
      return false
    }

    try {
      await this.bot.pathfinder?.goto(
        new (await import('mineflayer-pathfinder')).goals.GoalBlock(
          treeBlock.position.x, treeBlock.position.y, treeBlock.position.z
        )
      )
      await this.bot.dig(treeBlock)
      this.woodInHand += 1
      this.colony.log(`${this.name}が木材を伐採 (手持ち:${this.woodInHand})`)
      this.speak(`木を倒した！(手持ち${this.woodInHand}本)`)
    } catch (err) {
      this.speak('木に近づけなかった')
    }
    return true
  }

  async _returnWood() {
    this.speak(`木材${this.woodInHand}本を倉庫に届けます`)
    await this._sleep(2000) // 倉庫への移動をシミュレート
    this.colony.addResource('wood', this.woodInHand)
    this.woodInHand = 0
    this.speak('木材を格納した')
    return true
  }

  async _build() {
    const job = this.colony.getNextBuildJob()
    if (!job) { this.speak('建築依頼がない'); return false }

    this.speak(`${job}の建築を開始します！`)
    const cost = job === 'house' ? 10 : 5

    if (!this.colony.consumeResource('wood', cost)) {
      this.speak('木材が足りない…')
      return false
    }

    // 実際の建築をシミュレート（ここをStructurize連携に拡張可能）
    this.colony.log(`${this.name}が${job}の建築中...`)
    await this._sleep(5000) // 建築時間

    this.colony.completeBuild(job)
    this.speak(`${job}が完成しました！`)
    return true
  }

  async _scout() {
    this.speak('周囲を見回ります')
    await this._sleep(2000)
    // 近くに敵がいたらcolonyに報告
    const hostiles = Object.values(this.bot.entities).filter(
      e => e.type === 'mob' && ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.name)
    )
    if (hostiles.length > 0) {
      this.colony.isUnderAttack = true
      this.speak(`警告！敵が${hostiles.length}体います！`)
      this.colony.log(`${this.name}が敵を発見: ${hostiles.map(e => e.name).join(', ')}`)
    } else {
      this.speak('異常なし')
    }
    return true
  }
}
