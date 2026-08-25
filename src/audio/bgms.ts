export type BgmInstrument =
    | 'pad'
    | 'pluck'
    | 'bell'
    | 'kick'
    | 'snare'
    | 'hat'
    | 'bass'
    | 'lead';

export interface BgmNote {
    step: number;
    midi: number;
    duration: number;
    velocity: number;
}

export interface BgmLayer {
    instrument: BgmInstrument;
    notes: BgmNote[];
}

export interface BgmTrack {
    id: string;
    name: string;
    bpm: number;
    stepsPerBeat: number;
    totalSteps: number;
    layers: BgmLayer[];
}

export const midiToFrequency = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

const note = (step: number, midi: number, duration: number, velocity: number): BgmNote => ({
    step,
    midi,
    duration,
    velocity,
});

/**
 * 界面曲《墨韵》——C 宫五声，行板（60bpm，八分音符步进）。
 * 三层织体：和弦垫（pad）+ 五声琶音（pluck）+ 稀疏风铃点缀（bell），
 * 全曲 64 步循环约 32 秒，营造选将布阵时的水墨静谧氛围。
 */
export const menuBgm: BgmTrack = {
    id: 'menu-bgm',
    name: '墨韵',
    bpm: 60,
    stepsPerBeat: 2,
    totalSteps: 64,
    layers: [
        {
            instrument: 'pad',
            notes: [
                // C — Am — F — G，每和弦 sustain 16 步（8 秒）
                note(0, 48, 16, 0.5),
                note(0, 52, 16, 0.42),
                note(0, 55, 16, 0.4),
                note(16, 45, 16, 0.5),
                note(16, 48, 16, 0.42),
                note(16, 52, 16, 0.4),
                note(32, 41, 16, 0.5),
                note(32, 45, 16, 0.42),
                note(32, 48, 16, 0.4),
                note(48, 43, 16, 0.5),
                note(48, 47, 16, 0.42),
                note(48, 50, 16, 0.4),
            ],
        },
        {
            instrument: 'pluck',
            notes: [
                // 第一遍琶音：C4 D4 E4 G4 | A4 C5 A4 G4 | E4 G4 A4 C5 | D5 C5 A4 G4
                note(0, 60, 2, 0.5), note(2, 62, 2, 0.46), note(4, 64, 2, 0.5), note(6, 67, 2, 0.46),
                note(8, 69, 2, 0.5), note(10, 72, 2, 0.52), note(12, 69, 2, 0.46), note(14, 67, 2, 0.44),
                note(16, 64, 2, 0.5), note(18, 67, 2, 0.46), note(20, 69, 2, 0.5), note(22, 72, 2, 0.52),
                note(24, 74, 2, 0.5), note(26, 72, 2, 0.46), note(28, 69, 2, 0.46), note(30, 67, 2, 0.44),
                // 第二遍收束回落：E4 D4 C4 D4 | E4 G4 A4 G4 | E4 D4 C4 A3 | C4（延长）
                note(32, 64, 2, 0.5), note(34, 62, 2, 0.46), note(36, 60, 2, 0.48), note(38, 62, 2, 0.44),
                note(40, 64, 2, 0.5), note(42, 67, 2, 0.46), note(44, 69, 2, 0.5), note(46, 67, 2, 0.44),
                note(48, 64, 2, 0.48), note(50, 62, 2, 0.44), note(52, 60, 2, 0.46), note(54, 57, 2, 0.42),
                note(56, 60, 6, 0.5),
            ],
        },
        {
            instrument: 'bell',
            notes: [
                note(12, 76, 3, 0.22),
                note(28, 79, 3, 0.18),
                note(44, 74, 3, 0.2),
                note(60, 76, 4, 0.22),
            ],
        },
    ],
};

/**
 * 战斗曲《烽火》——A 和声小调，快板（116bpm，八分音符步进）。
 * 五层织体：底鼓/军鼓/踩镲节奏组 + 低音脉冲 + 主题旋律，
 * 全曲 64 步循环约 16.6 秒，八小节一段的紧张攻防律动。
 */
export const battleBgm: BgmTrack = {
    id: 'battle-bgm',
    name: '烽火',
    bpm: 116,
    stepsPerBeat: 2,
    totalSteps: 64,
    layers: [
        {
            instrument: 'kick',
            notes: Array.from({ length: 64 }, (_, step) =>
                step % 8 === 0 || step % 8 === 5
                    ? note(step, 36, 1, step % 8 === 0 ? 1 : 0.8)
                    : null,
            ).filter((n): n is BgmNote => n !== null),
        },
        {
            instrument: 'snare',
            notes: Array.from({ length: 64 }, (_, step) =>
                step % 8 === 4 ? note(step, 38, 1, 0.8) : null,
            ).filter((n): n is BgmNote => n !== null),
        },
        {
            instrument: 'hat',
            notes: Array.from({ length: 64 }, (_, step) =>
                step % 2 === 1 ? note(step, 42, 1, 0.28) : null,
            ).filter((n): n is BgmNote => n !== null),
        },
        {
            instrument: 'bass',
            // Am | G–E | F | G | Am | F | Dm | E 的低音进行
            notes: [
                note(0, 45, 2, 0.62), note(2, 45, 2, 0.5), note(4, 45, 2, 0.56), note(6, 45, 2, 0.5),
                note(8, 43, 2, 0.58), note(10, 45, 2, 0.48), note(12, 40, 2, 0.56), note(14, 40, 2, 0.48),
                note(16, 41, 2, 0.62), note(18, 41, 2, 0.5), note(20, 36, 2, 0.54), note(22, 41, 2, 0.5),
                note(24, 43, 2, 0.58), note(26, 43, 2, 0.48), note(28, 38, 2, 0.54), note(30, 40, 2, 0.5),
                note(32, 45, 2, 0.62), note(34, 45, 2, 0.5), note(36, 45, 2, 0.56), note(38, 45, 2, 0.5),
                note(40, 41, 2, 0.6), note(42, 41, 2, 0.48), note(44, 41, 2, 0.54), note(46, 41, 2, 0.48),
                note(48, 38, 2, 0.6), note(50, 38, 2, 0.48), note(52, 38, 2, 0.54), note(54, 50, 2, 0.5),
                note(56, 40, 2, 0.58), note(58, 40, 2, 0.48), note(60, 44, 2, 0.54), note(62, 35, 2, 0.5),
            ],
        },
        {
            instrument: 'lead',
            notes: [
                // 第一乐句
                note(0, 69, 2, 0.5), note(4, 64, 2, 0.44), note(6, 69, 1, 0.4),
                note(8, 71, 2, 0.5), note(12, 72, 2, 0.52), note(14, 71, 1, 0.4),
                note(16, 69, 2, 0.5), note(20, 65, 2, 0.46), note(22, 64, 1, 0.42),
                note(24, 62, 2, 0.48), note(28, 62, 2, 0.44),
                // 第二乐句（上扬后收束回主音）
                note(32, 69, 2, 0.5), note(36, 72, 2, 0.52), note(38, 71, 1, 0.42),
                note(40, 69, 2, 0.48), note(44, 65, 2, 0.46), note(46, 69, 1, 0.4),
                note(48, 74, 2, 0.54), note(52, 72, 2, 0.5), note(54, 69, 1, 0.42),
                note(56, 68, 2, 0.48), note(60, 69, 4, 0.5),
            ],
        },
    ],
};

export const trackById = (id: string): BgmTrack | undefined =>
    id === menuBgm.id ? menuBgm : id === battleBgm.id ? battleBgm : undefined;
