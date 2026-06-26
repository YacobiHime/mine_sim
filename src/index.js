/**
 * index.js  —  Colony Simulation エントリーポイント
 *
 * MineColonies の ColonyManager に相当する起動・管理ロジック。
 * 各エージェントボットを生成し、コロニーループを開始する。
 *
 * 環境変数:
 *   MC_HOST         Minecraftサーバーアドレス (default: 192.168.15.10)
 *   MC_PORT         ポート番号 (default: 25565)
 *   MC_VERSION      バージョン (default: 1.21.4)
 *   OLLAMA_URL      Ollama API URL (default: http://192.168.15.150:11434/v1)
 *   OLLAMA_MODEL    使用モデル (default: gemma4:e4b)
 */

import mineflayer from 'mineflayer'
import { Colony }       from './colony/Colony.js'
import { BuilderAgent } from './agents/BuilderAgent.js'
import { FarmerAgent }  from './agents/FarmerAgent.js'
import { GuardAgent }   from './agents/GuardAgent.js'
import { LeaderAgent }  from './agents/LeaderAgent.js'

// ---- 設定 ----
const MC_HOST    = process.env.MC_HOST    ?? '192.168.15.10'
const MC_PORT    = parseInt(process.env.MC_PORT ?? '25565')
const MC_VERSION = process.env.MC_VERSION ?? '1.21.4'

// エージェント定義（名前・役職・クラス）
const AGENT_CONFIGS = [
  { username: 'Leader_Alex',   AgentClass: LeaderAgent  },
  { username: 'Builder_Bob',   AgentClass: BuilderAgent },
  { username: 'Farmer_Carol',  AgentClass: FarmerAgent  },
  { username: 'Guard_Dave',    AgentClass: GuardAgent   },
]

// ---- コロニー共有状態 ----
const colony = new Colony()

// 初期資源
colony.addResource('wood',  5)
colony.addResource('food',  10)
colony.addResource('wheat', 3)

// 最初の建築依頼
colony.requestBuild('house')
colony.requestBuild('farm')

// ---- ボット起動 ----
const agents = []
let   tickCounter = 0

function createBot(config) {
  return new Promise((resolve) => {
    const bot = mineflayer.createBot({
      host:     MC_HOST,
      port:     MC_PORT,
      username: config.username,
      version:  MC_VERSION,
      auth:     'offline',  // 認証なしモード
    })

    bot.on('spawn', async () => {
      console.log(`[System] ${config.username} がスポーンしました`)

      // pathfinderプラグインをロード（インストールされていれば）
      try {
        const { pathfinder, Movements } = await import('mineflayer-pathfinder')
        bot.loadPlugin(pathfinder)
        const mcData = (await import('minecraft-data')).default(bot.version)
        const movements = new Movements(bot, mcData)
        bot.pathfinder.setMovements(movements)
      } catch {
        console.warn(`[${config.username}] pathfinderなし（移動機能無効）`)
      }

      const agent = new config.AgentClass(config.username, bot, colony)

      // 衛兵に巡回ポイントを設定（スポーン座標周辺）
      if (agent instanceof GuardAgent) {
        const pos = bot.entity.position
        agent.setPatrolPoints([
          { x: pos.x + 10, y: pos.y, z: pos.z },
          { x: pos.x,      y: pos.y, z: pos.z + 10 },
          { x: pos.x - 10, y: pos.y, z: pos.z },
          { x: pos.x,      y: pos.y, z: pos.z - 10 },
        ])
      }

      agents.push(agent)
      resolve(agent)
    })

    // チャット受信（プレイヤーからの指示をLeaderに伝える）
    bot.on('chat', async (username, message) => {
      if (username === bot.username) return
      // 自分がLeaderのときだけ返答
      const myAgent = agents.find(a => a.bot === bot)
      if (!myAgent || myAgent.role !== 'leader') return

      console.log(`[Chat→Leader] ${username}: ${message}`)
      // プレイヤー指示をコロニーログに追加してLeaderのLLMが次回判断に使う
      colony.log(`プレイヤー「${username}」の指示: ${message}`)
      myAgent.speak(`${username}様の指示を承りました: ${message}`)
    })

    bot.on('error', (err) => {
      console.error(`[${config.username}] エラー:`, err.message)
    })

    bot.on('kicked', (reason) => {
      console.warn(`[${config.username}] キックされました:`, reason)
    })

    bot.on('end', () => {
      console.warn(`[${config.username}] 接続終了`)
    })
  })
}

// ---- メインティックループ ----
// MineColonies の ColonyTickHandler に相当。
// 全エージェントを毎tick更新し、コロニー状態も更新する。
function startColonyLoop() {
  const TICK_MS = 50 // 20tps（Minecraft標準）

  setInterval(() => {
    tickCounter++
    colony.tick(tickCounter)

    for (const agent of agents) {
      try {
        agent.tick()
      } catch (err) {
        console.error(`[ColonyLoop] ${agent.name} tick error:`, err)
      }
    }

    // 1000tickごとに状態サマリーを出力
    if (tickCounter % 1000 === 0) {
      console.log('\n' + colony.getSummary() + '\n')
    }
  }, TICK_MS)
}

// ---- 起動シーケンス ----
async function main() {
  console.log('=== Colony Simulation 起動 ===')
  console.log(`サーバー: ${MC_HOST}:${MC_PORT}  バージョン: ${MC_VERSION}`)
  console.log(`エージェント数: ${AGENT_CONFIGS.length}`)
  console.log(`Ollama: ${process.env.OLLAMA_URL ?? 'http://192.168.15.150:11434/v1'}`)
  console.log('==============================\n')

  // 順番に接続（サーバー負荷軽減のため5秒ずつ間隔）
  for (const config of AGENT_CONFIGS) {
    await createBot(config)
    await new Promise(r => setTimeout(r, 5000))
  }

  console.log(`\n全エージェント起動完了。コロニーループ開始...\n`)
  startColonyLoop()
}

main().catch(console.error)
