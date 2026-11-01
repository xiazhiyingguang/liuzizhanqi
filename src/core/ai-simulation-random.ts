/** 同步模拟专用随机流。绝不消耗实战随机数，异常与嵌套调用也保证还原。 */
export function withAiSimulationRandom<T>(seed: number, sample: number, samples: number, run: () => T): T {
    const original = Math.random;
    let value = seed >>> 0;
    Math.random = () => {
        value = (value + 0x6D2B79F5) >>> 0;
        let mixed = value;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        // 各样本在同一随机序列上分层，减少三个样本恰巧全暴击/全闪避的偏差。
        return ((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) + sample / samples) % 1;
    };
    try { return run(); } finally { Math.random = original; }
}
