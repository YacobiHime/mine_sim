/**
 * GuardAgent
 * MineColonies の AbstractEntityAIGuard + AttackMoveAI + ThreatTable に相当。
 * 巡回、脅威検知、戦闘、撤退を行う。
 */

import { BaseAgent } from './BaseAgent.js'

// ThreatTable エントリ（簡略版）
class ThreatEntry {
  constructor(entity) {
    this.entity = entity
    this.threat = 5
    this.lastSeen = Date.now()
  }
}

export class GuardAgent extends BaseAgent {
  constructor(name, bot, colony) {
    super(name, 'guard', bot, colony)
    this.patrolIndex  = 0
    this.patrolPoints = []  // 巡回ポイント（設定で追加可）
    this.threatTable  = []  // ThreatEntry[]
    this.target       = null
    this.isRetreating = false
  }

  getSystemPrompt() {
    return `あなたはMinecraftコロニーの衛兵「${this.name}」です。
あなたの使命はコロニーを守ることです。常に脅威を警戒し、必要なら戦い、危険なら撤退してください。
仲間のことを考え、コロニー全体の安全を最優先にしてください。
返答は必ずJSON形式のみにしてください。`
  }

  getAvailableActions() {
    const actions = []
    const hasTarget = this.threatTable.length > 0

    if (this.health < 8) {
      actions.push('撤退して回復する')
    }
    if (hasTarget && this.health >= 8) {
      actions.push('敵を攻撃する')
    }
    if (!hasTarget && !this.colony.isUnderAttack) {
      actions.push('巡回する')
    }
    actions.push('周囲を警戒する')
    if (this.colony.isUnderAttack) {
      actions.push('コロニーを防衛する')
    }
    actions.push('待機する')

    return actions
  }

  async executeAction(action) {
    switch (action) {
      case '巡回する':
        return this._patrol()
      case '周囲を警戒する':
        return this._scanThreats()
      case '敵を攻撃する':
        return this._attackTarget()
      case '撤退して回復する':
        return this._retreat()
      case 'コロニーを防衛する':
        return this._defend()
      default:
        await this._sleep(2000)
        return true
    }
  }

  async _scanThreats() {
    // ThreatTable更新 - 周囲の敵エンティティを検索
    const hostiles = Object.values(this.bot.entities).filter(e =>
      e.type === 'mob' &&
      ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'pillager'].includes(e.name) &&
      e.position?.distanceTo(this.bot.entity.position) < 20
    )

    // 脅威テーブルに追加・更新
    for (const mob of hostiles) {
      const existing = this.threatTable.find(t => t.entity === mob)
      if (existing) {
        existing.threat += 2
        existing.lastSeen = Date.now()
      } else {
        const entry = new ThreatEntry(mob)
        // 近いほど脅威値が高い
        const dist = mob.position.distanceTo(this.bot.entity.position)
        entry.threat += Math.max(0, 10 - Math.floor(dist / 2))
        this.threatTable.push(entry)
        this.speak(`${mob.name}を発見！脅威度${entry.threat}`)
        this.colony.log(`${this.name}が${mob.name}を発見`)
      }
    }

    // 120秒（=古い）エントリを削除
    const now = Date.now()
    this.threatTable = this.threatTable.filter(t =>
      t.entity.isValid !== false &&
      (now - t.lastSeen) < 120000
    )

    // 最高脅威ターゲット選択
    if (this.threatTable.length > 0) {
      this.threatTable.sort((a, b) => b.threat - a.threat)
      this.target = this.threatTable[0].entity
      this.colony.isUnderAttack = true
    } else {
      this.target = null
      this.colony.isUnderAttack = false
      this.speak('周囲に敵なし')
    }
    return true
  }

  async _attackTarget() {
    if (!this.target || !this.target.isValid) {
      this.target = null
      this.threatTable = []
      this.colony.isUnderAttack = false
      this.speak('敵を倒した！')
      return true
    }

    try {
      if (this.bot.pathfinder && global.mineflayerPathfinderGoals) {
        const { GoalNear } = global.mineflayerPathfinderGoals
        await this.bot.pathfinder.goto(
          new GoalNear(
            this.target.position.x, this.target.position.y, this.target.position.z, 2
          )
        )
      }
      await this.bot.attack(this.target)
      this.speak(`${this.target.name}を攻撃！`)

      // 被ダメージをシミュレート（簡略）
      this.health -= 1
      // ターゲットの脅威値を下げる
      const entry = this.threatTable.find(t => t.entity === this.target)
      if (entry) entry.threat -= 3
    } catch {
      this.speak('攻撃できなかった')
    }
    return true
  }

  async _retreat() {
    this.isRetreating = true
    this.speak('危ない！一旦引きます！')
    this.target = null
    await this._sleep(3000)
    // 体力回復
    this.health = Math.min(20, this.health + 6)
    this.isRetreating = false
    this.speak(`回復した (HP:${this.health}/20)`)
    return true
  }

  async _patrol() {
    if (this.patrolPoints.length === 0) {
      // 設定された巡回ポイントがなければランダム移動
      this.speak('巡回中...')
      await this._sleep(3000)
      return true
    }

    const point = this.patrolPoints[this.patrolIndex % this.patrolPoints.length]
    this.patrolIndex++
    this.speak(`巡回地点${this.patrolIndex}へ`)
    try {
      if (this.bot.pathfinder && global.mineflayerPathfinderGoals) {
        const { GoalBlock } = global.mineflayerPathfinderGoals
        await this.bot.pathfinder.goto(
          new GoalBlock(point.x, point.y, point.z)
        )
      }
    } catch {}
    return true
  }

  async _defend() {
    this.speak('コロニーを守る！')
    await this._scanThreats()
    if (this.target) {
      return this._attackTarget()
    }
    this.colony.isUnderAttack = false
    this.speak('脅威は排除された')
    return true
  }

  // 定期的に脅威スキャン
  tick() {
    super.tick()
    // 50tickごとに自動スキャン
    if (this.sm.getTickCount() % 50 === 0) {
      this._scanThreats().catch(() => {})
    }
  }

  setPatrolPoints(points) {
    this.patrolPoints = points
    this.colony.log(`${this.name}の巡回ポイントを設定 (${points.length}箇所)`)
  }
}
