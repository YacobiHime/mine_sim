/**
 * Colony
 * MineColonies の IColony に相当するコロニー共有状態。
 * 全エージェントはここを通じて情報を共有する。
 */
export class Colony {
  constructor() {
    // 資源在庫
    this.inventory = {
      wood: 0,
      food: 0,
      stone: 0,
      wheat: 0,
    }

    // コロニーの状態フラグ
    this.isUnderAttack = false
    this.needsFood = false
    this.buildQueue = []          // 建築リクエストキュー ['house', 'farm', ...]
    this.completedBuildings = []  // 完成した建物リスト

    // 全エージェントの参照（登録後に埋まる）
    this.agents = {}

    // 指令システム
    this.directives = {}  // { agentName: { role, message, timestamp } }

    // 建物定義
    this.buildingDefs = {
      house:     { woodCost: 10, stoneCost: 0,  effect: 'capacity+2' },
      farm:      { woodCost: 5,  stoneCost: 0,  effect: 'food_production+1' },
      warehouse: { woodCost: 8,  stoneCost: 5,  effect: 'storage+20' },
      barracks:  { woodCost: 12, stoneCost: 8,  effect: 'guard_capacity+1' },
      mine:      { woodCost: 6,  stoneCost: 0,  effect: 'stone_production+1' },
    }

    // イベントログ（指導者LLMが読む）
    this.eventLog = []

    // コロニーの日数
    this.day = 0
    this.lastDayTick = 0
  }

  // --- 資源操作 ---

  addResource(type, amount) {
    if (!(type in this.inventory)) return
    this.inventory[type] += amount
    this.log(`+${amount} ${type} (計${this.inventory[type]})`)
  }

  consumeResource(type, amount) {
    if (this.inventory[type] < amount) return false
    this.inventory[type] -= amount
    return true
  }

  hasResource(type, amount = 1) {
    return (this.inventory[type] ?? 0) >= amount
  }

  // --- 建築キュー ---

  requestBuild(buildingType) {
    if (!this.buildingDefs[buildingType]) {
      this.log(`未知の建物タイプ: ${buildingType}`)
      return false
    }
    if (this.buildQueue.includes(buildingType)) {
      this.log(`${buildingType}はすでにキュー済み`)
      return false
    }
    this.buildQueue.push(buildingType)
    this.log(`建築要求: ${buildingType}`)
    return true
  }

  completeBuild(buildingType) {
    this.buildQueue = this.buildQueue.filter(b => b !== buildingType)
    this.completedBuildings.push(buildingType)
    this.log(`建築完了: ${buildingType}`)
  }

  getNextBuildJob() {
    return this.buildQueue[0] ?? null
  }

  // --- イベントログ ---

  log(message) {
    const entry = `[Day${this.day}] ${message}`
    this.eventLog.push(entry)
    if (this.eventLog.length > 50) this.eventLog.shift()
    console.log(`[Colony] ${entry}`)
  }

  // --- 状態サマリー（LLMのプロンプトに渡す） ---

  getSummary() {
    const agentStatus = Object.values(this.agents)
      .map(a => `  ${a.name}(${a.role}): ${a.sm.getState()}`)
      .join('\n')

    return [
      `=== コロニー状況 Day${this.day} ===`,
      `資源: 木材${this.inventory.wood} 食料${this.inventory.food} 石材${this.inventory.stone} 小麦${this.inventory.wheat}`,
      `建築待ち: ${this.buildQueue.join(', ') || 'なし'}`,
      `完成建物: ${this.completedBuildings.join(', ') || 'なし'}`,
      `攻撃中: ${this.isUnderAttack ? '⚠️はい' : 'いいえ'}`,
      `食料不足: ${this.needsFood ? '⚠️はい' : 'いいえ'}`,
      `エージェント:\n${agentStatus}`,
      `最近のイベント: ${this.eventLog.slice(-5).join(' | ')}`,
    ].join('\n')
  }

  // --- エージェント登録 ---

  registerAgent(agent) {
    this.agents[agent.name] = agent
  }

  agentCount() {
    return Object.keys(this.agents).length
  }

  // --- 指令システム ---

  issueDirective(targetRole, message) {
    for (const [name, agent] of Object.entries(this.agents)) {
      if (agent.role === targetRole) {
        this.directives[name] = { role: targetRole, message, timestamp: this.day }
        agent.lastDirective = message  // エージェントに直接セット
      }
    }
    this.log(`[指令] ${targetRole}へ: ${message}`)
  }

  getDirective(agentName) {
    return this.directives[agentName]?.message ?? null
  }

  // --- tick（時間経過） ---

  tick(currentTick) {
    // 100tick = 1ゲーム内日（調整可能）
    if (currentTick - this.lastDayTick >= 100) {
      this.day++
      this.lastDayTick = currentTick
      this.needsFood = this.inventory.food < Object.keys(this.agents).length * 2
      this.log(`新しい日が始まりました (Day ${this.day})`)
    }
  }
}
