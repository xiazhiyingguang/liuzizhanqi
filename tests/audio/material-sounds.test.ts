import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioManager } from '../../src/audio/audio-manager';
import { SoundManager } from '../../src/core/sound-manager';
import { MATERIAL_SOUND_DESIGNS, MATERIAL_SOUND_FILES, planSkillSoundCues } from '../../src/core/skill-sound-cues';
import { computeFxImpactDelayMs, computeMirrorBladeTiming, resolveSkillFx, type SkillFxEvent } from '../../src/core/skill-fx';
import { getSkillSound } from '../../src/data/skill-sounds';

function event(skillId: string, patch: Partial<SkillFxEvent> = {}): SkillFxEvent {
    return { id: 1, bornAt: 10000, skillId, profile: resolveSkillFx(skillId), owner: 'player1',
        fromPos: [2, 1], targetPos: [2, 3], angleDeg: 0, direction: 'E', damagePositions: [[2, 3]], ...patch };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('材质与关键声音时间', () => {
    it.each([
        ['hanjiangxue_skill1', 'ice'], ['libai_skill1', 'metal'], ['soul_lamp_skill2', 'soulfire'],
        ['nanfeng_skill1', 'wind'], ['lingxi_skill2', 'water'],
    ])('%s 使用 %s 材质，主音与画面共用抵达时间', (id, material) => {
        const fx = event(id);
        const cues = planSkillSoundCues(fx);
        expect(getSkillSound(id)).toBe(material);
        expect(cues.filter(cue => cue.role === 'impact').map(cue => cue.at)).toContain(fx.bornAt + computeFxImpactDelayMs(fx, fx.targetPos));
        expect(cues[0].volume).toBeLessThan(cues[1].volume);
    });
    it('近处与远处飞刃的声音分别随实际飞行时间改变', () => {
        const fx = event('mirror_blade', { profile: resolveSkillFx('mirror_blade'), mirrorBlades: [
            { fromPos: [2, 1], targetPos: [2, 2], logIds: ['a'] },
            { fromPos: [2, 1], targetPos: [5, 5], logIds: ['b'] },
        ] });
        const at = planSkillSoundCues(fx).filter(cue => cue.role === 'impact').map(cue => cue.at);
        expect(at).toEqual(fx.mirrorBlades!.map((blade, index) => fx.bornAt + computeMirrorBladeTiming(blade, index).impactMs));
        expect(at[1]).toBeGreaterThan(at[0]);
    });
    it('泠汐第二道浪峰保留较轻的后续拍击，不复制起手声', () => {
        const cues = planSkillSoundCues(event('lingxi_skill2', { damagePositions: [[2, 3]], coveredPositions: [[2, 3]] }));
        expect(cues.filter(cue => cue.role === 'cast')).toHaveLength(1);
        const contacts = cues.filter(cue => cue.role === 'impact');
        expect(contacts).toHaveLength(2);
        expect(contacts[1].at - contacts[0].at).toBe(130);
        expect(contacts[1].volume).toBeLessThan(contacts[0].volume);
    });
    it('同时命中的整片格子合并声音，连续接触最多保留四拍', () => {
        const cells: [number, number][] = Array.from({ length: 36 }, (_, i) => [Math.floor(i / 6), i % 6]);
        const cues = planSkillSoundCues(event('nanfeng_skill1', { damagePositions: cells }));
        expect(cues.filter(cue => cue.role === 'impact').length).toBeLessThanOrEqual(4);
        const same = planSkillSoundCues(event('nanfeng_skill1', { damagePositions: Array.from({ length: 30 }, () => [2, 3]) }));
        expect(same.filter(cue => cue.role === 'impact')).toHaveLength(1);
    });
    it('冰冻击碎形态使用爆震素材，恢复段不重复播放起手声', () => {
        const shattered = planSkillSoundCues(event('feixue_skill1', { profile: resolveSkillFx('feixue_shatter') }));
        expect(shattered.every(cue => cue.file.includes('feixue_shatter'))).toBe(true);
        expect(planSkillSoundCues(event('lingxi_regen')).map(cue => cue.role)).toEqual(['impact']);
        expect(planSkillSoundCues(event('bard_skill1'))).toEqual([]);
    });
    it('每条素材是有限、未削波、短尾的 PCM，清单补偿实测主峰而非截取前 60ms', () => {
        const hashes = new Set<string>();
        for (const id of Object.keys(MATERIAL_SOUND_DESIGNS)) {
            for (const clip of Object.values(MATERIAL_SOUND_FILES[id])) {
                const wav = readFileSync(`public/sounds/${clip.file}`);
                expect(wav.toString('ascii', 0, 4), clip.file).toBe('RIFF');
                expect(wav.readUInt32LE(24)).toBe(44100);
                expect(wav.readUInt16LE(22)).toBe(1);
                let peak = 0, energy = 0;
                for (let i = 44; i < wav.length; i += 2) {
                    const sample = wav.readInt16LE(i) / 32768;
                    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
                }
                expect(peak).toBeLessThan(.8);
                expect(energy).toBeGreaterThan(1);
                expect(clip.durationMs).toBeLessThanOrEqual(750);
                expect(clip.peakMs).toBeLessThanOrEqual(150);
                expect(wav.readInt16LE(44)).toBe(0);
                expect(wav.readInt16LE(wav.length - 2)).toBe(0);
                expect(Math.abs((wav.length - 44) / 2 / 44100 * 1000 - clip.durationMs)).toBeLessThan(1);
                if (clip.peakMs > 0) {
                    // A real splash/breath can build more slowly than a synthesized impulse.
                    // The manifest must report the true loudest window so playback can align it.
                    const window = Math.round(44100 * .005);
                    let strongest = -1, peakFrame = 0;
                    for (let frame = 0; frame < (wav.length - 44) / 2; frame += window) {
                        let power = 0;
                        for (let j = frame; j < frame + window && 44 + j * 2 < wav.length; j++) power += wav.readInt16LE(44 + j * 2) ** 2;
                        if (power > strongest) { strongest = power; peakFrame = frame; }
                    }
                    expect(Math.abs(clip.peakMs - (peakFrame + window / 2) / 44100 * 1000)).toBeLessThan(1);
                }
                hashes.add(wav.toString('base64'));
            }
        }
        // Seed, pitch and texture vary by character, rather than sharing five identical recordings.
        expect(hashes.size).toBe(Object.values(MATERIAL_SOUND_DESIGNS).reduce((n, design) => n + (design.cast === false ? 1 : 2), 0));
    });
});

function playback() {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => undefined } });
    const nodes: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended?: () => void }> = [];
    const context = {
        currentTime: 7, state: 'running', destination: {},
        decodeAudioData: vi.fn(async () => ({ duration: .75 })),
        createBufferSource: () => {
            const node = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), buffer: null, onended: undefined };
            nodes.push(node); return node;
        },
        createGain: () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }),
        createDynamicsCompressor: vi.fn(() => ({ connect: vi.fn(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } })),
    };
    vi.spyOn(audioManager, 'unlock').mockImplementation(() => undefined);
    vi.spyOn(audioManager, 'getAudioContext').mockReturnValue(context as unknown as AudioContext);
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }));
    vi.stubGlobal('fetch', fetch);
    const manager = new SoundManager();
    return { manager, context, nodes, fetch };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('真实音频调度与清理', () => {
    it('补偿 WAV 瞬态位置，让能量峰落在目标时刻', async () => {
        const { manager, nodes, context } = playback();
        const fx = event('hanjiangxue_skill1');
        manager.playSkillFx(fx); await flush();
        expect(nodes).toHaveLength(2);
        const cue = planSkillSoundCues(fx).find(cue => cue.role === 'impact')!;
        const [when, offset] = nodes[1].start.mock.calls[0];
        expect(when - context.currentTime + cue.peakMs / 1000 - offset).toBeCloseTo((cue.at - Date.now()) / 1000, 4);
    });
    it('同一个事件不会因重新渲染重播；移出队列会停止未到达的声音', async () => {
        const { manager, nodes } = playback();
        const fx = event('lingxi_skill2');
        manager.playSkillFx(fx); manager.playSkillFx(fx); await flush();
        expect(nodes).toHaveLength(3);
        manager.retainSkillFx(new Set());
        expect(nodes.every(node => node.stop.mock.calls.length === 1)).toBe(true);
    });
    it('静音会停止正在响和已预约的声音，解除静音不会补播', async () => {
        const { manager, nodes } = playback();
        manager.playSkillFx(event('libai_skill1')); await flush();
        manager.setMuted(true); manager.setMuted(false);
        expect(nodes.every(node => node.stop.mock.calls.length === 1)).toBe(true);
        manager.setMuted(true); manager.playSkillFx(event('libai_skill1', { id: 2 })); await flush();
        expect(nodes).toHaveLength(2);
    });
    it('退出时即使素材还在下载，也不会在之后补响', async () => {
        const { manager, nodes, fetch } = playback();
        let finish!: (value: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
        fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        manager.playSkillFx(event('lingxi_regen')); manager.cancelSkillSounds();
        finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }); await flush();
        expect(nodes).toHaveLength(0);
    });
    it('下载错过命中时刻就跳过，避免出现迟来的爆发声', async () => {
        const { manager, nodes } = playback();
        manager.playSkillFx(event('guying_skill2'));
        vi.setSystemTime(11000); await flush();
        expect(nodes).toHaveLength(0);
    });
    it('相同素材解码复用，角色再次施法仍可正常响起', async () => {
        const { manager, nodes, context } = playback();
        manager.playSkillFx(event('nanfeng_skill1')); await flush();
        manager.playSkillFx(event('nanfeng_skill1', { id: 2 })); await flush();
        expect(nodes).toHaveLength(4);
        expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
        expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(1);
    });
    it('切到后台取消预约，返回前台也不补播旧声音', async () => {
        const { manager, nodes } = playback();
        let visibilityChange!: () => void;
        const document = { hidden: false, addEventListener: vi.fn((_event, listener) => { visibilityChange = listener; }) };
        vi.stubGlobal('document', document);
        manager.playSkillFx(event('lingxi_skill2')); await flush();
        document.hidden = true; visibilityChange();
        expect(nodes.every(node => node.stop.mock.calls.length === 1)).toBe(true);
        manager.playSkillFx(event('lingxi_skill2', { id: 2 })); await flush();
        document.hidden = false; visibilityChange();
        expect(nodes).toHaveLength(3);
    });
});
