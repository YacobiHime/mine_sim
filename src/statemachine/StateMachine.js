/**
 * StateMachine
 * MineColonies の TickRateStateMachine を参考にした状態遷移エンジン。
 * AITarget(state, condition, handler, tickInterval) を登録し、
 * tick() ごとに条件を評価して遷移・処理を実行する。
 */
export class StateMachine {
  constructor(initialState, onError = console.error) {
    this.state = initialState
    this.onError = onError
    // { state, condition, handler, interval, tickCount }[]
    this.transitions = []
    // どのstateでも評価されるイベント遷移
    this.events = []
    this.tickCount = 0
  }

  /**
   * 特定のstateにいるときだけ評価されるトランジションを登録
   * @param {string} state       このstateのときだけ発火
   * @param {Function} condition () => boolean
   * @param {Function} handler   () => nextState | null (nullは遷移なし)
   * @param {number} interval    何tickごとに評価するか
   * @param {number} priority    優先度（高いほど優先、デフォルト0）
   */
  addTransition(state, condition, handler, interval = 1, priority = 0) {
    this.transitions.push({ state, condition, handler, interval, tickCount: 0, priority })
  }

  /**
   * どのstateでも評価されるイベント（割り込み）を登録
   * MineColonies の AIBlockingEventType.EVENT に相当
   */
  addEvent(condition, handler, interval = 1) {
    this.events.push({ condition, handler, interval, tickCount: 0 })
  }

  tick() {
    this.tickCount++
    try {
      // イベント（割り込み）を先に評価
      for (const ev of this.events) {
        ev.tickCount++
        if (ev.tickCount < ev.interval) continue
        ev.tickCount = 0
        if (ev.condition()) {
          const next = ev.handler()
          if (next != null) { this.state = next; return }
        }
      }

      // 現在stateのトランジションを評価（優先度順にソート）
      const sortedTransitions = this.transitions
        .filter(tr => tr.state === this.state)
        .sort((a, b) => b.priority - a.priority)

      for (const tr of sortedTransitions) {
        tr.tickCount++
        if (tr.tickCount < tr.interval) continue
        tr.tickCount = 0
        if (tr.condition()) {
          const next = tr.handler()
          if (next != null && next !== this.state) {
            this.state = next
            return
          }
        }
      }
    } catch (err) {
      this.onError(err)
    }
  }

  setState(state) { this.state = state }
  getState() { return this.state }
  getTickCount() { return this.tickCount }
}
