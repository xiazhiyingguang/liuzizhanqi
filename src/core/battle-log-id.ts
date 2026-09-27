let seq = 0;

/**
 * 战斗日志的唯一 id。
 * 不能只靠 Date.now()+Math.random()：测试里 Math.random 被钉成常数后，
 * 同一毫秒生成的两条日志 id 相同，store 特效包装层按 id 集合差分"本次施法新增日志"
 * 时会把新日志误判成旧日志，整次施法的特效派发凭空消失（表现为偶发的"最后一个事件不是它"）。
 */
export function nextBattleLogId(): string {
    return `log-${Date.now()}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
