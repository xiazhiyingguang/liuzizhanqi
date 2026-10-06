import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeParam {
    value = 0;
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
    cancelScheduledValues = vi.fn();
    cancelAndHoldAtTime = vi.fn();
    setTargetAtTime = vi.fn();
}

class FakeNode {
    gain = new FakeParam();
    frequency = new FakeParam();
    detune = new FakeParam();
    delayTime = new FakeParam();
    Q = new FakeParam();
    connect = vi.fn();
    disconnect = vi.fn();
    stop = vi.fn();
    type = '';
    buffer: unknown;
    loop = false;
    constructor(private ctx: FakeContext) {}
    start(time: number) { this.ctx.starts.push({ time, frequency: this.frequency.value }); }
}

class FakeContext {
    static instance: FakeContext;
    state = 'running';
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    starts: { time: number; frequency: number }[] = [];
    nodes: FakeNode[] = [];
    constructor() { FakeContext.instance = this; }
    createGain() { return this.node(); }
    createDelay() { return this.node(); }
    createOscillator() { return this.node(); }
    createBiquadFilter() { return this.node(); }
    createBufferSource() { return this.node(); }
    createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    private node() { const node = new FakeNode(this); this.nodes.push(node); return node; }
}

describe('背景音乐遇到手机主线程延迟', () => {
    let tick: () => void;
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
        vi.stubGlobal('window', {
            AudioContext: FakeContext,
            setInterval: (callback: () => void) => { tick = callback; return 1; },
            clearInterval: vi.fn(), setTimeout: vi.fn(),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    async function startMenu() {
        const { audioManager } = await import('../../src/audio/audio-manager');
        audioManager.applyPhase('menu');
        audioManager.unlock();
        tick();
        const ctx = FakeContext.instance;
        ctx.starts = [];
        return { audioManager, ctx };
    }

    it('卡住三秒后不把错过的音符集中补播', async () => {
        const { ctx } = await startMenu();
        ctx.currentTime = 3.2;
        tick();
        expect(ctx.starts.every(note => note.time >= ctx.currentTime)).toBe(true);
        // 下一个节拍未进入预排窗口时，保持安静，不能倒放上一个音符。
        expect(ctx.starts).toHaveLength(0);
        ctx.currentTime = 4;
        tick();
        expect(ctx.starts).toHaveLength(1);
        expect(ctx.starts[0].time).toBeCloseTo(4.1);
    });

    it('长时间挂起后保持曲目循环相位，且恢复工作量不随挂起时长增长', async () => {
        const { ctx } = await startMenu();
        ctx.currentTime = 96.05;
        tick();
        expect(ctx.starts).toHaveLength(4); // 三个和弦音与一个琶音。
        expect(ctx.starts.every(note => Math.abs(note.time - 96.1) < .001)).toBe(true);
    });

    it('音频上下文暂停时不推进乐谱', async () => {
        const { ctx } = await startMenu();
        ctx.state = 'suspended';
        ctx.currentTime = 4;
        tick();
        expect(ctx.starts).toHaveLength(0);
        ctx.state = 'running';
        tick();
        expect(ctx.starts).toHaveLength(1);
        expect(ctx.starts[0].time).toBeCloseTo(4.1);
    });

    it('开关音乐和调整音量使用短淡变，避免波形瞬间跳变', async () => {
        const { audioManager, ctx } = await startMenu();
        const [master, bgm] = ctx.nodes;
        ctx.currentTime = 5;
        audioManager.toggleMute();
        expect(master.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(5);
        expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 5.03);
        audioManager.toggleMute();
        expect(master.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(.9, 5.03);
        audioManager.setVolume(.6);
        expect(bgm.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(.6, 5.03);
        expect(bgm.gain.value).toBe(.32); // 不直接写播放中的增益。
    });
});
