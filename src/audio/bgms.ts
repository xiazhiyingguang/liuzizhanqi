export type BgmInstrument =
    | 'pad'
    | 'pluck'
    | 'bell'
    | 'kick'
    | 'snare'
    | 'hat'
    | 'bass'
    | 'lead'
    /** 铜管式和弦刺击（战斗曲专用）：双失谐锯齿 + 滤波下扫，短促有力 */
    | 'stab'
    /** 太鼓式低音战鼓（战斗曲专用）：正弦下扫比底鼓更低更沉 */
    | 'tom'
    /** 镲片（战斗曲专用）：高通噪声长衰减，乐段起始强调 */
    | 'crash';

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
 * 战斗曲《破阵》——A 和声小调，急板（148bpm，十六分音符步进）。
 * 两段体 16 小节（256 步循环约 41 秒）：
 * - 和声进行：Am Am F G | Am Am Dm E | Am G F E | Am G C E（导音 G# 制造推进张力）
 * - 低音疾驰（gallop）：八分音符连奏 + 六/十四步高八度点缀
 * - 战鼓组：底鼓 + 太鼓叠奏、军鼓反拍与乐段末滚奏过门、镲片强调段落起始
 * - 铜管刺击：每小节强拍/次强拍和弦重音
 * - 主旋律：双锯齿厚声部，先抑后扬，第二段冲上 A5 高潮
 */
const STEPS_PER_BAR = 16;
const BATTLE_BARS = 16;

interface BattleChord {
    /** 低音根音（低八度区） */
    bassRoot: number;
    /** 铜管刺击和弦排列（中音区密集排列） */
    stab: [number, number, number];
    /** 弦乐垫低音根音 */
    padRoot: number;
}

//        进行: Am   Am   F    G    Am   Am   Dm   E    Am   G    F    E    Am   G    C    E
const BATTLE_PROGRESSION: BattleChord[] = [
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 41, stab: [57, 60, 65], padRoot: 29 }, // F
    { bassRoot: 43, stab: [55, 59, 62], padRoot: 31 }, // G
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 38, stab: [57, 62, 65], padRoot: 26 }, // Dm
    { bassRoot: 40, stab: [56, 59, 64], padRoot: 28 }, // E
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 43, stab: [55, 59, 62], padRoot: 31 }, // G
    { bassRoot: 41, stab: [57, 60, 65], padRoot: 29 }, // F
    { bassRoot: 40, stab: [56, 59, 64], padRoot: 28 }, // E
    { bassRoot: 45, stab: [57, 60, 64], padRoot: 33 }, // Am
    { bassRoot: 43, stab: [55, 59, 62], padRoot: 31 }, // G
    { bassRoot: 48, stab: [55, 60, 64], padRoot: 36 }, // C
    { bassRoot: 40, stab: [56, 59, 64], padRoot: 28 }, // E
];

const isFillBar = (bar: number): boolean => bar === 7 || bar === BATTLE_BARS - 1;

/** 低音疾驰音型：每小节 8 个八分音符，第 6/14 步跳高八度形成冲刺感 */
const buildBattleBass = (): BgmNote[] => {
    const velocities = [0.55, 0.44, 0.5, 0.44, 0.52, 0.44, 0.5, 0.46];
    const notes: BgmNote[] = [];
    for (let bar = 0; bar < BATTLE_BARS; bar++) {
        const root = BATTLE_PROGRESSION[bar].bassRoot;
        for (let i = 0; i < 8; i++) {
            const step = bar * STEPS_PER_BAR + i * 2;
            const octaveUp = i === 3 || i === 7;
            notes.push(note(step, octaveUp ? root + 12 : root, 2, velocities[i]));
        }
    }
    return notes;
};

/** 铜管刺击：每小节强拍(0)与次强拍(8)短促和弦；过门小节让位给军鼓滚奏 */
const buildBattleStabs = (): BgmNote[] => {
    const notes: BgmNote[] = [];
    for (let bar = 0; bar < BATTLE_BARS; bar++) {
        const voicing = BATTLE_PROGRESSION[bar].stab;
        const base = bar * STEPS_PER_BAR;
        for (const midi of voicing) notes.push(note(base, midi, 2.5, 0.42));
        if (!isFillBar(bar)) {
            for (const midi of voicing) notes.push(note(base + 8, midi, 2, 0.34));
        }
    }
    return notes;
};

/** 战鼓组：底鼓驱动 + 太鼓叠奏 + 反拍军鼓，第 8/16 小节末军鼓滚奏过门 */
const buildBattleDrums = (): { kick: BgmNote[]; snare: BgmNote[]; hat: BgmNote[]; tom: BgmNote[] } => {
    const kick: BgmNote[] = [];
    const snare: BgmNote[] = [];
    const hat: BgmNote[] = [];
    const tom: BgmNote[] = [];
    for (let bar = 0; bar < BATTLE_BARS; bar++) {
        const base = bar * STEPS_PER_BAR;
        // 底鼓：强拍 + 次强拍，偶数小节第 10 步补一脚增加推进
        kick.push(note(base, 36, 1, 0.95));
        kick.push(note(base + 8, 36, 1, 0.78));
        if (bar % 2 === 1) kick.push(note(base + 10, 36, 1, 0.58));
        // 太鼓：与强拍底鼓叠出低频轰鸣
        tom.push(note(base, 43, 1, 0.5));
        // 军鼓反拍；过门小节改为渐强滚奏
        snare.push(note(base + 4, 38, 1, 0.72));
        if (isFillBar(bar)) {
            snare.push(note(base + 12, 38, 1, 0.5));
            snare.push(note(base + 13, 38, 1, 0.6));
            snare.push(note(base + 14, 38, 1, 0.72));
            snare.push(note(base + 15, 38, 1, 0.88));
        } else {
            snare.push(note(base + 12, 38, 1, 0.68));
        }
        // 踩镲十六分律动：正拍清晰、反拍轻扫
        for (let step = 0; step < STEPS_PER_BAR; step++) {
            const accent = step % 4 === 0 ? 0.26 : step % 2 === 0 ? 0.18 : 0.11;
            hat.push(note(base + step, 42, 1, accent));
        }
    }
    return { kick, snare, hat, tom };
};

/** 主旋律：两段体，第一段铺陈动机、第二段冲上 A5 高潮后收束回导音悬置 */
const buildBattleLead = (): BgmNote[] => {
    // [小节, 步偏移, midi, 时值(步), 力度]
    const phrases: Array<[number, number, number, number, number]> = [
        // 第一乐句（Am 上行动机）
        [0, 0, 76, 3, 0.55], [0, 4, 72, 2, 0.46], [0, 6, 74, 2, 0.48], [0, 8, 76, 4, 0.52],
        [1, 12, 69, 2, 0.42], [1, 14, 71, 2, 0.44],
        [2, 0, 72, 4, 0.52], [2, 4, 69, 2, 0.44], [2, 6, 65, 2, 0.42], [2, 8, 69, 4, 0.48],
        [3, 8, 67, 2, 0.42], [3, 10, 69, 2, 0.44], [3, 12, 71, 4, 0.5],
        // 第二乐句（动机再现，收在属和声）
        [4, 0, 76, 3, 0.55], [4, 4, 72, 2, 0.46], [4, 6, 74, 2, 0.48], [4, 8, 76, 4, 0.52],
        [5, 12, 71, 2, 0.44], [5, 14, 72, 2, 0.46],
        [6, 0, 74, 4, 0.54], [6, 4, 77, 2, 0.5], [6, 6, 76, 2, 0.46], [6, 8, 74, 4, 0.5],
        [7, 8, 68, 2, 0.44], [7, 10, 71, 2, 0.46], [7, 12, 76, 4, 0.52],
        // 第三乐句（B 段高潮：A5 开段）
        [8, 0, 81, 3, 0.6], [8, 4, 76, 2, 0.5], [8, 6, 72, 2, 0.46], [8, 8, 69, 4, 0.5],
        [9, 8, 71, 2, 0.44], [9, 10, 74, 2, 0.48], [9, 12, 79, 4, 0.55],
        [10, 0, 81, 3, 0.58], [10, 4, 77, 2, 0.48], [10, 6, 76, 2, 0.46], [10, 8, 72, 4, 0.5],
        [11, 8, 68, 2, 0.44], [11, 10, 71, 2, 0.46], [11, 12, 76, 4, 0.52],
        // 第四乐句（下行琶音冲刺后收束于导音，悬置回环）
        [12, 0, 76, 2, 0.5], [12, 2, 72, 2, 0.44], [12, 4, 69, 2, 0.44], [12, 6, 72, 2, 0.46], [12, 8, 76, 4, 0.52],
        [13, 8, 74, 2, 0.46], [13, 10, 71, 2, 0.42], [13, 12, 67, 2, 0.42], [13, 14, 71, 2, 0.44],
        [14, 0, 72, 3, 0.54], [14, 4, 76, 2, 0.48], [14, 6, 79, 2, 0.52], [14, 8, 76, 4, 0.5],
        [15, 8, 74, 2, 0.46], [15, 10, 72, 2, 0.44], [15, 12, 71, 6, 0.52],
    ];
    return phrases.map(([bar, offset, midi, duration, velocity]) =>
        note(bar * STEPS_PER_BAR + offset, midi, duration, velocity),
    );
};

/** 弦乐垫：逐小节低音持续，粘合节奏组与旋律 */
const buildBattlePad = (): BgmNote[] =>
    BATTLE_PROGRESSION.map((chord, bar) =>
        note(bar * STEPS_PER_BAR, chord.padRoot, STEPS_PER_BAR, 0.26),
    );

const battleDrums = buildBattleDrums();

export const battleBgm: BgmTrack = {
    id: 'battle-bgm',
    name: '破阵',
    bpm: 148,
    stepsPerBeat: 4,
    totalSteps: STEPS_PER_BAR * BATTLE_BARS,
    layers: [
        { instrument: 'kick', notes: battleDrums.kick },
        { instrument: 'snare', notes: battleDrums.snare },
        { instrument: 'hat', notes: battleDrums.hat },
        { instrument: 'tom', notes: [...battleDrums.tom, ...[7, 15].flatMap(bar => [
            note(bar * STEPS_PER_BAR + 12, 43, 1, 0.45),
            note(bar * STEPS_PER_BAR + 13, 43, 1, 0.55),
            note(bar * STEPS_PER_BAR + 14, 48, 1, 0.65),
        ])] },
        { instrument: 'crash', notes: [note(0, 49, 1, 0.5), note(128, 49, 1, 0.45)] },
        { instrument: 'bass', notes: buildBattleBass() },
        { instrument: 'stab', notes: buildBattleStabs() },
        { instrument: 'pad', notes: buildBattlePad() },
        { instrument: 'lead', notes: buildBattleLead() },
    ],
};

export const trackById = (id: string): BgmTrack | undefined =>
    id === menuBgm.id ? menuBgm : id === battleBgm.id ? battleBgm : undefined;
