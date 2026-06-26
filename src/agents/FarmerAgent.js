/**
 * FarmerAgent
 * MineColonies の JobFarmer + EntityAIWorkFarmer に相当。
 * 農地を耕し、小麦を育て、収穫してコロニーに食料を供給する。
 */

import { BaseAgent } from './BaseAgent.js'

const FarmerState = {
  HOE:     'HOE',      // 耕す
  PLANT:   'PLANT',    // 植える
  HARVEST: 'HARVEST',  // 収穫
  STORE:   'STORE',    // 格納
}

export class FarmerAgent extends BaseAgent {
  constructor(name, bot, colony) {
    super(name, 'farmer', bot, colony)
    this.harvestedWheat = 0
    this.seedStock = 2        // 初期種2個
    this.fieldReady = false   // 農地が準備済みか
    this.cropGrowTimer = 0    // 作物成長タイマー（tick）
    this.cropGrown = false
  }

  getSystemPrompt() {
    return `あなたはMinecraftコロニーの農家「${this.name}」です。
あなたの使命はコロニーの食料を確保することです。農地を耕し、作物を植え、収穫してください。
コロニーの食料状況を常に意識して行動してください。
返答は必ずJSON形式のみにしてください。`
  }

  getAvailableActions() {
    const actions = []

    if (!this.fieldReady) {
      actions.push('農地を耕す')
    }
    const hasSeeds = (this.seedStock ?? 0) > 0 || this.colony.hasResource('wheat', 1)
    if (this.fieldReady && !this.cropGrown && hasSeeds) {
      actions.push('種を植える')
    }
    if (this.cropGrown) {
      actions.push('作物を収穫する')
    }
    if (this.harvestedWheat > 0) {
      actions.push('小麦を製粉してパンにする')
      actions.push('小麦を倉庫に格納する')
    }
    actions.push('農地の様子を確認する')
    actions.push('待機する')

    return actions
  }

  async executeAction(action) {
    switch (action) {
      case '農地を耕す':
        return this._hoeField()
      case '種を植える':
        return this._plantSeeds()
      case '作物を収穫する':
        return this._harvest()
      case '小麦を製粉してパンにする':
        return this._makeBread()
      case '小麦を倉庫に格納する':
        return this._storeWheat()
      case '農地の様子を確認する':
        return this._checkField()
      default:
        await this._sleep(2000)
        return true
    }
  }

  async _hoeField() {
    this.speak('農地を耕します！')
    await this._sleep(3000)
    this.fieldReady = true
    this.colony.log(`${this.name}が農地を耕した`)
    this.speak('耕し終わった。次は種を植えよう')
    return true
  }

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

  async _makeBread() {
    if (this.harvestedWheat < 3) {
      this.speak('小麦が3個必要だ')
      return false
    }
    this.speak('パンを焼きます')
    await this._sleep(2000)
    const breadAmount = Math.floor(this.harvestedWheat / 3)
    this.harvestedWheat -= breadAmount * 3
    this.colony.addResource('food', breadAmount)
    this.colony.log(`${this.name}がパン${breadAmount}個を作成`)
    this.speak(`パン${breadAmount}個焼けた！`)
    return true
  }

  async _storeWheat() {
    this.speak('小麦を格納します')
    await this._sleep(1000)
    this.colony.addResource('wheat', this.harvestedWheat)
    this.harvestedWheat = 0
    this.speak('格納完了')
    return true
  }

  async _checkField() {
    this.speak('農地を確認中...')
    await this._sleep(1000)
    // 時間経過で作物が育つシミュレーション
    this.cropGrowTimer += 30
    if (this.cropGrowTimer >= 100 && this.fieldReady) {
      this.cropGrown = true
      this.speak('作物が育った！収穫できるぞ')
    } else if (this.fieldReady) {
      this.speak(`作物はまだ育ち中 (${this.cropGrowTimer}%)`)
    } else {
      this.speak('農地が必要だ')
    }
    return true
  }

  // 時間経過で作物が育つ（tickで更新）
  tick() {
    super.tick()
    if (this.fieldReady && !this.cropGrown) {
      this.cropGrowTimer += 0.1
      if (this.cropGrowTimer >= 100) {
        this.cropGrown = true
        this.colony.log(`${this.name}の農地の作物が育った`)
      }
    }
  }
}
