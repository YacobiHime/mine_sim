/**
 * LLMClient
 * Ollamaラッパー。MineColoniesのAIでは行動はコードで決定するが、
 * このシミュレーションではLLMが行動決定（nextState選択）とセリフ生成を担う。
 */

import { config } from '../config.js'

const OLLAMA_URL = config.ollama.url
const MODEL      = config.ollama.model

let chatHistory = []  // 会話履歴を保持

/**
 * LLMに問い合わせ、JSON形式で行動決定を得る。
 *
 * @param {string} systemPrompt  エージェントの人格・役割定義
 * @param {string} userPrompt    現在の状況・センサー情報
 * @param {string[]} choices     選べる次の行動（stateのリスト）
 * @returns {{ action: string, reason: string, speech: string }}
 */
export async function decideAction(systemPrompt, userPrompt, choices) {
  const prompt = `${userPrompt}

あなたが取れる行動（必ずこの中から1つ選んでください）:
${choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

以下のJSON形式のみで返答してください（他の文章は不要）:
{
  "action": "<上記リストの行動名をそのまま>",
  "reason": "<理由を15文字以内>",
  "speech": "<その場でつぶやく一言（日本語20文字以内）>"
}`

  const data = await callOllama(systemPrompt, prompt)
  return parseJSON(data, choices)
}

/**
 * LLMにセリフのみ生成させる（行動はルールで決まっている場合）
 */
export async function generateSpeech(systemPrompt, situation) {
  const prompt = `${situation}\n一言でつぶやいてください（20文字以内、日本語）:`
  const data = await callOllama(systemPrompt, prompt)
  const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
  return text.slice(0, 60)
}

/**
 * エージェント同士の自由な会話
 * @param {string} speakerName    発言者の名前
 * @param {string} speakerRole    発言者の役職
 * @param {string} listenerName   聞き手の名前
 * @param {string} listenerRole   聞き手の役職
 * @param {string} context        会話の文脈・状況
 * @param {string} lastMessage    前回のメッセージ（会話の継続の場合）
 * @returns {string} 発言内容
 */
export async function generateChat(speakerName, speakerRole, listenerName, listenerRole, context, lastMessage = null) {
  const systemPrompt = `あなたはMinecraftコロニーのNPC「${speakerName}」（役職: ${speakerRole}）です。
会話相手は「${listenerName}」（役職: ${listenerRole}）です。

以下の条件で会話してください:
- 日本語で話す
- 一行で返事をする（30文字以内）
- 役職に応じた性格で話す（建築家は建物について、農家は作物について、衛兵は安全について、指導者はコロニーの運営について）
- 自然な会話をする

状況: ${context}`

  let userPrompt = `一言で返事してください（30文字以内、日本語）:`
  if (lastMessage) {
    userPrompt = `${listenerName}「${lastMessage}」\n\n一言で返事してください（30文字以内、日本語）:`
  }

  try {
    const data = await callOllama(systemPrompt, userPrompt)
    const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
    // 不要なタグや引用を除去
    return text.replace(/["「」『』\n]/g, '').slice(0, 50)
  } catch (e) {
    console.warn('Chat generation failed:', e.message)
    return '...'
  }
}

/**
 * 状況に応じた自然な発話を生成
 * @param {string} name    エージェント名
 * @param {string} role    役職
 * @param {string} event   発生したイベント
 * @param {string} context 状況説明
 * @returns {string} 発話内容
 */
export async function generateReaction(name, role, event, context) {
  const systemPrompt = `あなたはMinecraftコロニーのNPC「${name}」（役職: ${role}）です。
状況に応じて自然な反応をしてください。

状況: ${context}
イベント: ${event}

日本語で一行（30文字以内）で反応してください。`

  const userPrompt = `この状況で一言で反応してください（30文字以内、日本語）:`

  try {
    const data = await callOllama(systemPrompt, userPrompt)
    const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
    return text.replace(/["「」『』\n]/g, '').slice(0, 50)
  } catch (e) {
    console.warn('Reaction generation failed:', e.message)
    return '...'
  }
}

async function callOllama(system, user) {
  try {
    const res = await fetch(`${OLLAMA_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user }
        ]
      })
    })
    if (!res.ok) {
      console.warn(`Ollama HTTP ${res.status}: ${res.statusText}`)
      throw new Error(`Ollama HTTP ${res.status}`)
    }
    return res.json()
  } catch (e) {
    console.error('Ollama connection error:', e.message)
    console.error(`  URL: ${OLLAMA_URL}, Model: ${MODEL}`)
    throw e
  }
}

function parseJSON(data, choices) {
  let raw = data?.choices?.[0]?.message?.content ?? ''
  // thinkingタグ除去
  raw = raw.replace(/<\|?think[^>]*\|?>[\s\S]*?<\/?\|?think[^>]*\|?>/gi, '').trim()
  // JSONブロック抽出
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) {
    // フォールバック：最初の選択肢を選ぶ
    return { action: choices[0], reason: 'parse失敗', speech: '...' }
  }
  try {
    const obj = JSON.parse(match[0])
    // actionが選択肢に含まれているか検証
    if (!choices.includes(obj.action)) {
      obj.action = choices[0]
    }
    return obj
  } catch {
    return { action: choices[0], reason: 'JSON破損', speech: '...' }
  }
}
