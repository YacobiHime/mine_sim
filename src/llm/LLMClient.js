/**
 * LLMClient
 * Ollamaラッパー。MineColoniesのAIでは行動はコードで決定するが、
 * このシミュレーションではLLMが行動決定（nextState選択）とセリフ生成を担う。
 */

import { config } from '../config.js'

const OLLAMA_URL = config.ollama.url
const MODEL      = config.ollama.model

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

async function callOllama(system, user) {
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
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  return res.json()
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
