import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { battleBgm, menuBgm, midiToFrequency, trackById } from '../../src/audio/bgms';
import { audioManager, computeBgmDrift } from '../../src/audio/audio-manager';

describe('背景音乐乐谱', () => {
    it('提供界面曲与战斗曲两首独立曲目', () => {
        expect(menuBgm.id).not.toBe(battleBgm.id);
        expect(trackById(menuBgm.id)).toBe(menuBgm);
        expect(trackById(battleBgm.id)).toBe(battleBgm);
        expect(trackById('nonexistent')).toBeUndefined();
        for (const track of [menuBgm, battleBgm]) {
            expect(track.bpm).toBeGreaterThan(0);
            expect(track.stepsPerBeat).toBeGreaterThan(0);
            expect(track.layers.length).toBeGreaterThan(0);
        }
    });

    it('所有音符数据合法且落在循环范围内', () => {
        for (const track of [menuBgm, battleBgm]) {
            expect(track.layers.flatMap(l => l.notes).length).toBeGreaterThan(0);
            for (const layer of track.layers) {
                for (const note of layer.notes) {
                    expect(note.step).toBeGreaterThanOrEqual(0);
                    expect(note.step).toBeLessThan(track.totalSteps);
                    expect(note.duration).toBeGreaterThan(0);
                    expect(note.velocity).toBeGreaterThan(0);
                    expect(note.velocity).toBeLessThanOrEqual(1);
                    expect(note.midi).toBeGreaterThanOrEqual(20);
                    expect(note.midi).toBeLessThanOrEqual(96);
                }
            }
        }
    });

    it('界面曲柔和织体（无打击乐），战斗曲含完整节奏组', () => {
        const menuInstruments = new Set(menuBgm.layers.map(l => l.instrument));
        const battleInstruments = new Set(battleBgm.layers.map(l => l.instrument));
        for (const drum of ['kick', 'snare', 'hat'] as const) {
            expect(menuInstruments.has(drum)).toBe(false);
            expect(battleInstruments.has(drum)).toBe(true);
        }
        expect(battleInstruments.has('bass')).toBe(true);
        expect(battleInstruments.has('lead')).toBe(true);
        expect(menuInstruments.has('pad')).toBe(true);
    });

    it('界面曲舒缓、战斗曲紧凑', () => {
        expect(menuBgm.bpm).toBeLessThan(battleBgm.bpm);
        const menuNoteCount = menuBgm.layers.flatMap(l => l.notes).length;
        const battleNoteCount = battleBgm.layers.flatMap(l => l.notes).length;
        expect(menuNoteCount).toBeLessThan(battleNoteCount);
        const bellVelocities = menuBgm.layers.find(l => l.instrument === 'bell')!.notes.map(n => n.velocity);
        expect(Math.max(...bellVelocities)).toBeLessThanOrEqual(0.25);
    });

    it('midiToFrequency 换算正确', () => {
        expect(midiToFrequency(69)).toBeCloseTo(440, 5);
        expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
        expect(midiToFrequency(81)).toBeCloseTo(880, 5);
    });
});

describe('AudioManager 无音频环境安全降级', () => {
    const createLocalStorageStub = () => {
        const store = new Map<string, string>();
        return {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
            clear: () => store.clear(),
        };
    };

    beforeEach(() => {
        vi.stubGlobal('localStorage', createLocalStorageStub());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('AudioContext 不可用时 applyPhase 不抛错', () => {
        expect(() => audioManager.applyPhase('menu')).not.toThrow();
        expect(() => audioManager.applyPhase('battle')).not.toThrow();
        expect(() => audioManager.applyPhase('ended')).not.toThrow();
        expect(() => audioManager.unlock()).not.toThrow();
    });

    it('音量与静音偏好持久化到 localStorage', () => {
        audioManager.setVolume(0.5);
        expect(JSON.parse(localStorage.getItem('six-chess-bgm-state') ?? '{}').volume).toBe(0.5);
        audioManager.toggleMute();
        expect(JSON.parse(localStorage.getItem('six-chess-bgm-state') ?? '{}').muted).toBe(true);
        expect(audioManager.getUserState().muted).toBe(true);
    });

    it('音量越界值被钳制到 [0, 1]', () => {
        audioManager.setVolume(2);
        expect(audioManager.getUserState().volume).toBe(1);
        audioManager.setVolume(-0.5);
        expect(audioManager.getUserState().volume).toBe(0);
    });
});

describe('computeBgmDrift（联机 BGM 同步偏差）', () => {
    const LOOP = 100;

    it('同位置偏差为 0', () => {
        expect(computeBgmDrift(40, 40, LOOP)).toBeCloseTo(0);
    });

    it('本地超前返回正偏差、滞后返回负偏差', () => {
        expect(computeBgmDrift(42, 40, LOOP)).toBeCloseTo(2);
        expect(computeBgmDrift(38, 40, LOOP)).toBeCloseTo(-2);
    });

    it('跨循环边界走环形最短路径', () => {
        // 本地在 1、主机在 99：本地其实超前 2 秒，而非滞后 98 秒
        expect(computeBgmDrift(1, 99, LOOP)).toBeCloseTo(2);
        // 反向：本地 99、主机 1 → 滞后 2 秒
        expect(computeBgmDrift(99, 1, LOOP)).toBeCloseTo(-2);
    });

    it('半周期处折叠到 ±loop/2 之内', () => {
        const drift = computeBgmDrift(50, 0, LOOP);
        expect(Math.abs(drift)).toBeLessThanOrEqual(LOOP / 2);
    });

    it('非法输入安全返回 0', () => {
        expect(computeBgmDrift(10, 5, 0)).toBe(0);
        expect(computeBgmDrift(NaN, 5, LOOP)).toBe(0);
        expect(computeBgmDrift(10, Infinity, LOOP)).toBe(0);
    });
});
