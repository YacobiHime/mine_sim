/**
 * BuilderAgent
 * MineColonies の JobBuilder + EntityAIStructureBuilder に相当。
 * 木を集め、建築を行う。
 */

import { BaseAgent, CommonState } from './BaseAgent.js'

// MineColonies の WorkOrderType に相当する定数
const WorkOrderType = {
  BUILD:   'BUILD',
  UPGRADE: 'UPGRADE',
  REPAIR:  'REPAIR',
  REMOVE:  'REMOVE',
}

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
    if (this.colony.hasResource('wood', 5) && this.colony.getNextBuildJob()) actions.push('建築する')
    if (this.colony.inventory.wood < 20) actions.push('木を伐採する')
    if (this.woodInHand > 0) actions.push('木材を倉庫に運ぶ')
    if (this.colony.inventory.stone < 10) actions.push('石を採掘する')
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
      case '石を採掘する':
        return this._mineStone()
      default:
        await this._sleep(3000)
        return true
    }
  }

  async _gatherWood() {
    this.speak('木材を集めに行くぞ')
    console.log(`[${this.name}] 木を探します...`)

    const treeBlock = this.bot.findBlock({
      matching: block => block.name.includes('log'),
      maxDistance: 32,
    })

    if (!treeBlock) {
      this.speak('近くに木がない…もっと探そう')
      console.log(`[${this.name}] 木が見つかりませんでした`)
      await this._sleep(2000)
      return false
    }

    console.log(`[${this.name}] 木を発見: ${treeBlock.name} at ${treeBlock.position}`)

    try {
      // pathfinder の状態を確認
      if (!this.bot.pathfinder) {
        console.warn(`[${this.name}] pathfinder が有効ではありません`)
        this.speak('移動機能がありません…')
        return false
      }

      if (!global.mineflayerPathfinderGoals) {
        console.warn(`[${this.name}] pathfinder goals が利用できません`)
        this.speak('移動機能がありません…')
        return false
      }

      const { GoalBlock } = global.mineflayerPathfinderGoals
      console.log(`[${this.name}] 木へ移動開始...`)

      await this.bot.pathfinder.goto(
        new GoalBlock(
          treeBlock.position.x, treeBlock.position.y, treeBlock.position.z
        )
      )

      console.log(`[${this.name}] 木に到着、伐採開始...`)
      await this.bot.dig(treeBlock)
      this.woodInHand += 1
      this.colony.log(`${this.name}が木材を伐採 (手持ち:${this.woodInHand})`)
      this.speak(`木を倒した！(手持ち${this.woodInHand}本)`)
      console.log(`[${this.name}] 伐採完了`)
      return true
    } catch (err) {
      console.error(`[${this.name}] 伐採失敗:`, err.message)
      this.speak(`木を切れませんでした: ${err.message}`)
      return false
    }
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
          const { default: vec3 } = await import('vec3')
          await this.bot.placeBlock(refBlock, new vec3(0, 1, 0))
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

  async _mineStone() {
    this.speak('石を採掘します')
    const stoneBlock = this.bot.findBlock({
      matching: block => ['stone', 'cobblestone', 'deepslate'].some(n => block.name.includes(n)),
      maxDistance: 20,
    })
    if (!stoneBlock) { this.speak('石が見つからない'); return false }
    try {
      if (this.bot.pathfinder && global.mineflayerPathfinderGoals) {
        const { GoalBlock } = global.mineflayerPathfinderGoals
        await this.bot.pathfinder.goto(
          new GoalBlock(stoneBlock.position.x, stoneBlock.position.y, stoneBlock.position.z)
        )
      }
      await this.bot.dig(stoneBlock)
      this.colony.addResource('stone', 1)
      this.speak('石を採掘した')
    } catch { this.speak('採掘できなかった') }
    return true
  }
}
