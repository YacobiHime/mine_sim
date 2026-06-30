/**
 * index.js  —  Colony Simulation エントリーポイント
 *
 * MineColonies の ColonyManager に相当する起動・管理ロジック。
 * 各エージェントボットを生成し、コロニーループを開始する。
 *
 * 環境変数:
 *   SERVERLESS       サーバーレスモード (true/false) - MC_HOST未設定時は自動true
 *   MC_HOST         Minecraftサーバーアドレス (default: 192.168.15.10)
 *   MC_PORT         ポート番号 (default: 25565)
 *   MC_VERSION      バージョン (default: 1.21.4)
 *   OLLAMA_URL      Ollama API URL (default: http://192.168.15.150:11434/v1)
 *   OLLAMA_MODEL    使用モデル (default: gemma4:e4b)
 */

import 'dotenv/config'
import mineflayer from 'mineflayer'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// ESMでCommonJSモジュールを読み込む
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)
const minecraftProtocolForge = require('minecraft-protocol-forge')

import { Colony }       from './colony/Colony.js'
import { BuilderAgent } from './agents/BuilderAgent.js'
import { FarmerAgent }  from './agents/FarmerAgent.js'
import { GuardAgent }   from './agents/GuardAgent.js'
import { LeaderAgent }  from './agents/LeaderAgent.js'
import { config }       from './config.js'
import * as LLMClient    from './llm/LLMClient.js'

// ---- サーバーレスモード用モックボット ----
class MockBot {
  constructor(username) {
    this.username = username
    // floored()メソッドを持つpositionオブジェクト
    this.entity = {
      position: {
        x: 0, y: 64, z: 0,
        floored: () => ({ x: 0, y: 64, z: 0 })
      }
    }
    this.time = { timeOfDay: 0 }
    this._listeners = {}
    this._chatQueue = []
    this._controls = {}
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(callback)
    return this
  }

  emit(event, ...args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(...args))
    }
  }

  chat(message) {
    this._chatQueue.push(message)
    console.log(`[${this.username}] (chat): ${message}`)
  }

  // pathfinder用（ダミー）
  pathfinder = {
    setMovements: () => {},
    setGoal: () => {},
  }

  // setControlState用（移動制御）
  setControlState(control, value) {
    this._controls[control] = value
  }

  // 時間経過のシミュレーション
  simulateTick() {
    this.time.timeOfDay = (this.time.timeOfDay + 10) % 24000
    this.emit('time')
  }

  async spawn() {
    console.log(`[Serverless] ${this.username} をシミュレーション開始`)
    this.emit('spawn')
  }
}

// エージェント定義（名前・役職・クラス）
const AGENT_CONFIGS = config.agents.map(a => {
  const role = a.role || 'worker'
  const AgentClass = role === 'leader'  ? LeaderAgent  :
                    role === 'builder' ? BuilderAgent :
                    role === 'farmer'  ? FarmerAgent  :
                    role === 'guard'   ? GuardAgent   : LeaderAgent
  return {
    username: a.username,
    role: role,
    AgentClass: AgentClass,
  }
})

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
  console.log(`[${bot.username}] pathfinder 初期化開始...`)
  try {
    // mineflayer-pathfinder を ESM から動的にインポート
    const pathfinderModule = await import('mineflayer-pathfinder')
    const { pathfinder, Movements, goals } = pathfinderModule
    console.log(`[${bot.username}] pathfinder モジュール読み込み成功`)

    // プラグインをロード（mineflayer 4.x 方式）
    bot.loadPlugin(pathfinder)
    console.log(`[${bot.username}] pathfinder プラグインロード成功`)

    // minecraft-data を取得
    const mcDataModule = await import('minecraft-data')
    const mcData = mcDataModule.default(bot.version)
    console.log(`[${bot.username}] minecraft-data バージョン: ${bot.version}`)

    // Movements を設定
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)
    console.log(`[${bot.username}] Movements 設定完了`)

    // goals をグローバルに設定（各エージェントから使用可能に）
    global.mineflayerPathfinderGoals = goals
    console.log(`[${bot.username}] pathfinder 初期化完了`)

    return true
  } catch (e) {
    console.error(`[${bot.username}] pathfinder 初期化失敗:`, e.message)
    console.error(e.stack)
    return false
  }
}

/**
 * ボット生成（再接続ロジック付き）
 */
function createBot(agentConfig, retryCount = 0) {
  return new Promise((resolve, reject) => {
    // 先にForge対応のクライアントを作成
    const bot = mineflayer.createBot({
      host:     config.server.host,
      port:     config.server.port,
      username: agentConfig.username,
      version:  '1.20.1',
      auth:     'offline',
    })

    // Forge ハンドシェイク - createBot直後に設定
    // loginイベントで確実に初期化された_clientに適用
    bot.once('login', () => {
      try {
        minecraftProtocolForge(bot._client)
        console.log(`[${agentConfig.username}] Forge ハンドシェイクを開始します`)
      } catch (e) {
        console.error(`[${agentConfig.username}] Forge設定エラー:`, e.message)
      }
    })

    bot.on('spawn', async () => {
      console.log(`[System] ${agentConfig.username} がスポーンしました`)

      // pathfinderプラグインをロード
      await setupPathfinder(bot)

      // LLMClientをまとめたオブジェクト（LeaderAgent専用）
      const llmClient = {
        decideAction: LLMClient.decideAction,
        generateSpeech: LLMClient.generateSpeech,
        generateChat: LLMClient.generateChat,
        generateReaction: LLMClient.generateReaction,
      }

      const agent = new agentConfig.AgentClass(agentConfig.username, agentConfig.AgentClass === LeaderAgent ? 'leader' : agentConfig.role || 'worker', bot, colony, agentConfig.AgentClass === LeaderAgent ? llmClient : null)

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

      // LeaderAgent はスポーン後に初期化処理
      if (agent instanceof LeaderAgent) {
        await agent.onSpawn()
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

/**
 * サーバーレスモード用の簡易エージェント作成
 */
async function createMockAgent(agentConfig) {
  const mockBot = new MockBot(agentConfig.username)

  // LLMClientをまとめたオブジェクト
  const llmClient = {
    decideAction: LLMClient.decideAction,
    generateSpeech: LLMClient.generateSpeech,
    generateChat: LLMClient.generateChat,
    generateReaction: LLMClient.generateReaction,
  }

  const agent = new agentConfig.AgentClass(
    agentConfig.username,
    agentConfig.role || 'worker',
    mockBot,
    colony,
    agentConfig.AgentClass === LeaderAgent ? llmClient : null
  )

  // スポーンイベントを発火
  await mockBot.spawn()
  if (agent instanceof LeaderAgent) {
    await agent.onSpawn()
  }

  agents.push(agent)
  return agent
}

// ---- 起動シーケンス ----
async function main() {
  console.log('=== Colony Simulation 起動 ===')

  if (config.serverless) {
    console.log('🖥️  サーバーレスモード: 実際のMinecraftサーバーには接続しません')
    console.log('📊 シミュレーションのみ実行')
    console.log(`エージェント数: ${config.agents.length}`)
    console.log(`Ollama: ${config.ollama.url}`)
    console.log('==============================\n')

    for (const agentConfig of AGENT_CONFIGS) {
      await createMockAgent(agentConfig)
    }

    console.log(`\n全エージェント起動完了。コロニーループ開始...\n`)
    startColonyLoop()
  } else {
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
}

main().catch(console.error)