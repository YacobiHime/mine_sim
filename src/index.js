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
import { config }       from './config.js'

// エージェント定義（名前・役職・クラス）
const AGENT_CONFIGS = config.agents.map(a => ({
  username: a.username,
  AgentClass: a.role === 'leader'  ? LeaderAgent  :
              a.role === 'builder' ? BuilderAgent :
              a.role === 'farmer'  ? FarmerAgent  :
              a.role === 'guard'   ? GuardAgent   : LeaderAgent,
}))

// ---- コロニー共有状態 ----
const colony = new Colony()

// 初期資源
colony.addResource('wood',  config.initialResources.wood)
colony.addResource('food',  config.initialResources.food)
colony.addResource('wheat', config.initialResources.wheat)

// 最初の建築依頼
colony.requestBuild('house')
colony.requestBuild('farm')

// ---- ボット起動 ----
const agents = []
let   tickCounter = 0

/**
 * pathfinder の初期化を共通関数化
 */
async function setupPathfinder(bot) {
  try {
    // mineflayer-pathfinder を ESM から動的にインポート
    const pathfinderModule = await import('mineflayer-pathfinder')
    const { pathfinder, Movements, goals } = pathfinderModule

    // プラグインをロード（mineflayer 4.x 方式）
    bot.loadPlugin(pathfinder)

    // minecraft-data を取得
    const mcDataModule = await import('minecraft-data')
    const mcData = mcDataModule.default(bot.version)

    // Movements を設定
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    // goals をグローバルに設定（各エージェントから使用可能に）
    global.mineflayerPathfinderGoals = goals

    console.log(`[${bot.username}] pathfinder 初期化成功`)
    return true
  } catch (e) {
    console.warn(`[${bot.username}] pathfinder 初期化失敗:`, e.message)
    return false
  }
}

/**
 * ボット生成（再接続ロジック付き）
 */
function createBot(agentConfig, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({
      host:     config.server.host,
      port:     config.server.port,
      username: agentConfig.username,
      version:  config.server.version,
      auth:     'offline',  // 認証なしモード
    })

    bot.on('spawn', async () => {
      console.log(`[System] ${agentConfig.username} がスポーンしました`)

      // pathfinderプラグインをロード
      await setupPathfinder(bot)

      const agent = new agentConfig.AgentClass(agentConfig.username, bot, colony)

      // ゲーム内時間に合わせた sleep/wake
      bot.on('time', () => {
        const timeOfDay = bot.time.timeOfDay
        // 13000-23000 = 夜
        const isNight = timeOfDay > 13000 && timeOfDay < 23000
        if (agent) agent.isNight = isNight
      })

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
      if (retryCount > 5) {
        console.error(`[${agentConfig.username}] 再接続上限。停止。`)
        reject(err)
        return
      }
      console.error(`[${agentConfig.username}] エラー:`, err.message)
    })

    bot.on('kicked', (reason) => {
      console.warn(`[${agentConfig.username}] キックされました:`, reason)
    })

    bot.on('end', () => {
      console.warn(`[${agentConfig.username}] 切断。5秒後に再接続...`)
      setTimeout(() => {
        createBot(agentConfig, retryCount + 1).then(resolve).catch(reject)
      }, 5000)
    })
  })
}

// ---- メインティックループ ----
// MineColonies の ColonyTickHandler に相当。
// 全エージェントを毎tick更新し、コロニー状態も更新する。
function startColonyLoop() {
  const TICK_MS = config.colony.tickMs
  let lastChatTime = 0

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

    // statsPrintInterval tickごとに状態サマリーを出力
    if (tickCounter % config.colony.statsPrintInterval === 0) {
      console.log('\n' + colony.getSummary() + '\n')
    }

    // 200tickごとにエージェント同士の会話イベント
    if (tickCounter - lastChatTime > 200 && agents.length >= 2) {
      lastChatTime = tickCounter
      // ランダムに2人を選んで会話
      const speaker = agents[Math.floor(Math.random() * agents.length)]
      const listener = agents.filter(a => a !== speaker)[Math.floor(Math.random() * (agents.length - 1))]
      if (speaker && listener && !speaker.llmBusy && !listener.llmBusy) {
        // 会話のトピックを決定
        const topics = [
          '仕事の進捗について',
          'コロニーの将来について',
          '天気について',
          '暇つぶし',
        ]
        const topic = topics[Math.floor(Math.random() * topics.length)]
        speaker.chatWith(listener, `${topic}について話そうか`)
      }
    }
  }, TICK_MS)
}

// ---- 起動シーケンス ----
async function main() {
  console.log('=== Colony Simulation 起動 ===')
  console.log(`サーバー: ${config.server.host}:${config.server.port}  バージョン: ${config.server.version}`)
  console.log(`エージェント数: ${config.agents.length}`)
  console.log(`Ollama: ${config.ollama.url}`)
  console.log('==============================\n')

  // 順番に接続（サーバー負荷軽減のため5秒ずつ間隔）
  for (const agentConfig of AGENT_CONFIGS) {
    await createBot(agentConfig)
    await new Promise(r => setTimeout(r, 5000))
  }

  console.log(`\n全エージェント起動完了。コロニーループ開始...\n`)
  startColonyLoop()
}

main().catch(console.error)
