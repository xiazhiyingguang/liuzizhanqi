/**
 * 音效连发实测：统计"请求播放"与"真正落到播放器"的次数差。
 * playSkill = 各派发点的请求；playFile = 去抖之后真正会发声的那一次。
 *
 * 用法：npx vite-node scripts/balance/sound-burst-probe.ts
 */
import { createHero } from '../../src/data/heroes';
import { DamageCalculator } from '../../src/core/damage-calculator';
import { soundManager } from '../../src/core/sound-manager';
import { useGameStore } from '../../src/store/game-store';
import { HeroState } from '../../src/types/game';

const requests: Array<{ skillId: string; at: number }> = [];
const plays: Array<{ file: string; at: number }> = [];

const manager = soundManager as unknown as {
    playSkill: (skillId: string, fallback: string, volume?: number) => void;
    playFile: (file: string, volume?: number) => void;
};
const originalPlaySkill = manager.playSkill.bind(soundManager);
const originalPlayFile = manager.playFile.bind(soundManager);
manager.playSkill = (skillId: string, fallback: string, volume?: number) => {
    requests.push({ skillId, at: Date.now() });
    return originalPlaySkill(skillId, fallback as never, volume);
};
manager.playFile = (file: string, volume?: number) => {
    plays.push({ file, at: Date.now() });
    return originalPlayFile(file, volume);
};

function place(heroId: string, owner: 'player1' | 'player2', row: number, col: number) {
    const hero = createHero(heroId, owner, [row, col]);
    const state = useGameStore.getState();
    state.board[row][col] = hero;
    (owner === 'player1' ? state.player1Heroes : state.player2Heroes).push(hero);
    return hero;
}

useGameStore.setState({ isOnlineMode: false, isAiMode: false, suppressOnlineBroadcast: false });
useGameStore.getState().initGame();

const mirror = place('mirror', 'player1', 2, 2);
const victims = [place('moran', 'player2', 0, 2), place('baize', 'player2', 4, 2), place('huifeng', 'player2', 2, 0)];
for (const victim of victims) {
    victim.currentHp = 1;              // 一击即死，保证每层镜刃都能咬下去
    victim.state = HeroState.ALIVE;
}
mirror.counters['破镜之刃'] = 3;        // 三层：一次爆发 = 三次斩击

const state = useGameStore.getState();
const consumed = DamageCalculator.triggerMirrorBrokenBlade(mirror, state);

console.log(`破镜之刃一次爆发：消耗层数 ${consumed}`);
console.log(`  playSkill 请求 ${requests.length} 次：`, requests.map(item => item.skillId).join(', '));
console.log(`  playFile 实发  ${plays.length} 次：`, plays.map(item => item.file.split('/').pop()).join(', '));

// 再走一次"同一瞬间多来源"：连续三次独立请求（模拟施法+天威+延迟段同时到）
requests.length = 0;
plays.length = 0;
for (let index = 0; index < 4; index++) manager.playSkill('mirror_blade', 'ice');
console.log(`\n同一瞬间 4 次 mirror_blade 请求：实发 ${plays.length} 次（期望 1 次）`);

requests.length = 0;
plays.length = 0;
manager.playSkill('mirror_skill1', 'ice');
manager.playSkill('yunying_skill1', 'slash');
manager.playSkill('mirror_skill2', 'teleport');
console.log(`不同音色交替请求 3 次：实发 ${plays.length} 次（期望 3 次，去抖不该误伤）`);
