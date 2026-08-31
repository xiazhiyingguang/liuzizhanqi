/**
 * 临时视觉验收台（战斗技能面板）：挂载真实的 SkillPanel，
 * 用按钮切换不同状态（未移动 / 已移动 / 技能已选中 / 已用完 / 带子选择面板），
 * 方便逐态截图。验收完毕后连同 skill-panel-preview.html 一并删除。
 */

/* eslint-disable react-refresh/only-export-components -- 临时视觉验收台：自挂载预览页，无导出属预期 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/ink-wash.css';
import SkillPanel from '../components/Game/SkillPanel';
import { useGameStore } from '../store/game-store';
import { getSkill } from '../data/skills';
import { createHero } from '../data/heroes';
import type { GameState, Hero, Position } from '../types/game';

function place(heroes: Hero[]): GameState['board'] {
    const board = Array.from({ length: 6 }, () => Array<Hero | null>(6).fill(null));
    for (const hero of heroes) {
        if (hero.position) board[hero.position[0]][hero.position[1]] = hero;
    }
    return board;
}

const ROSTER: Record<string, { p1: Array<[string, Position]>; p2: Array<[string, Position]>; focus: string }> = {
    游隼: { p1: [['youjun', [2, 1]], ['moran', [1, 1]]], p2: [['baize', [3, 4]], ['liuli', [4, 4]]], focus: 'youjun' },
    白泽: { p1: [['baize', [2, 1]], ['moran', [1, 1]]], p2: [['liuli', [3, 4]], ['youjun', [4, 4]]], focus: 'baize' },
    英雄X: { p1: [['hero_x', [2, 1]], ['moran', [1, 1]]], p2: [['liuli', [3, 4]], ['baize', [4, 4]]], focus: 'hero_x' },
    回锋: { p1: [['huifeng', [2, 1]], ['moran', [1, 1]]], p2: [['liuli', [3, 4]], ['baize', [4, 4]]], focus: 'huifeng' },
    长离: { p1: [['changli', [2, 1]], ['moran', [1, 1]]], p2: [['liuli', [3, 4]], ['baize', [4, 4]]], focus: 'changli' },
    杰茨米: { p1: [['jetzmi', [2, 1]], ['moran', [1, 1]]], p2: [['liuli', [3, 4]], ['baize', [4, 4]]], focus: 'jetzmi' },
};

/** 各英雄用来暴露"可选强化"开关的技能 */
const TOGGLE_SKILL: Record<string, string> = {
    长离: 'changli_skill2',
    杰茨米: 'jetzmi_skill1',
};

function loadVariant(rosterKey: string, mode: string): void {
    const roster = ROSTER[rosterKey];
    const player1Heroes = roster.p1.map(([id, pos]) => createHero(id, 'player1', pos));
    const player2Heroes = roster.p2.map(([id, pos]) => createHero(id, 'player2', pos));
    const focus = player1Heroes.find(hero => hero.id.startsWith(`${roster.focus}-`))!;

    if (mode === 'moved') focus.hasMovedThisTurn = true;
    if (mode === 'acted') focus.hasActedThisTurn = true;
    if (focus.id.startsWith('baize-')) focus.counters['天禄'] = 3;
    if (focus.id.startsWith('hero_x-')) focus.counters['增势'] = 3;
    if (focus.id.startsWith('huifeng-')) focus.counters['破锋'] = 3;
    if (focus.id.startsWith('changli-')) focus.counters['暗夜星火'] = 3;

    useGameStore.setState({
        phase: 'battle',
        currentPlayer: 'player1',
        isAiMode: false,
        player1Heroes,
        player2Heroes,
        board: place([...player1Heroes, ...player2Heroes]),
        selectedHero: focus,
        activeHero: focus,
        selectedSkill: mode.startsWith('skill') ? getSkill(TOGGLE_SKILL[rosterKey] ?? focus.skill1Id) : null,
        changliSkill2Empowered: mode === 'skill-on',
        jetzmiSkill1Enhanced: mode === 'skill-on',
        battleLog: [],
    });
}

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const INITIAL_HERO = params.get('hero') ?? '游隼';
const INITIAL_MODE = params.get('mode') ?? 'idle';

function Preview() {
    const [roster, setRoster] = useState(INITIAL_HERO);
    const [mode, setMode] = useState(INITIAL_MODE);

    return (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', fontFamily: 'serif' }}>
            <div style={{ width: 300, flexShrink: 0 }}>
                <div className="battle-command">
                    <SkillPanel />
                </div>
            </div>
            <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <b style={{ fontSize: 13 }}>验收台状态切换</b>
                {Object.keys(ROSTER).map(name => (
                    <button
                        key={name}
                        onClick={() => { setRoster(name); loadVariant(name, mode); }}
                        style={{ padding: '6px 10px', border: '1px solid rgba(26,26,26,.15)', borderRadius: 8, background: roster === name ? '#e8dfd0' : '#fff' }}
                    >
                        英雄：{name}
                    </button>
                ))}
                {['idle', 'moved', 'skill', 'skill-on', 'acted'].map(item => (
                    <button
                        key={item}
                        onClick={() => { setMode(item); loadVariant(roster, item); }}
                        style={{ padding: '6px 10px', border: '1px solid rgba(26,26,26,.15)', borderRadius: 8, background: mode === item ? '#e8dfd0' : '#fff' }}
                    >
                        状态：{item}
                    </button>
                ))}
            </div>
        </div>
    );
}

loadVariant(INITIAL_HERO, INITIAL_MODE);
createRoot(document.getElementById('root')!).render(<Preview />);
