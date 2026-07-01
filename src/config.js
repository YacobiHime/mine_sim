/**
 * config.js
 * 設定の一元管理
 * 環境変数またはデフォルト値から設定を読み込む
 */

export const config = {
  // サーバーレスモード：実際のMinecraftサーバーに接続せずシミュレーションのみ動作
  serverless: process.env.SERVERLESS === 'true' || process.env.MC_HOST === undefined,

  server: {
    host:    process.env.MC_HOST    ?? '192.168.15.10',
    port:    parseInt(process.env.MC_PORT ?? '25565'),
    version: process.env.MC_VERSION ?? '1.20.1',
  },
  ollama: {
    url:   process.env.OLLAMA_URL   ?? 'http://192.168.15.150:11434/v1',
    model: process.env.OLLAMA_MODEL ?? 'gemma4:e4b',
  },
  colony: {
    tickMs:           50,    // 1tick = 50ms (20tps)
    dayLengthTicks:   100,   // 100tick = 1ゲーム内日
    llmDecideInterval: 10,   // 10tickごとにLLM判断
    leaderInterval:   200,   // 200tickごとに指導者評価
    statsPrintInterval: 1000,
  },
  initialResources: {
    wood:  5,
    food:  10,
    wheat: 3,
    stone: 0,
  },
  agents: [
    { username: 'Leader_Alex',  role: 'leader'  },
    { username: 'Builder_Bob',  role: 'builder' },
    { username: 'Farmer_Carol', role: 'farmer'  },
    { username: 'Guard_Dave',   role: 'guard'   },
  ],
}
