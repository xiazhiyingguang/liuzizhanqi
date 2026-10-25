import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 夕月辞的界面核对：明灯与灯影在米白棋盘上读不读得出来、辞光·散影的一圈有没有"掀开"的手感。
 * 灯影是当场推导的，所以只要摆好灯与站位就能看到三道影（含她自己那道）。
 *
 * 用法：node scripts/e2e/xiyueci-look.mjs [--headed]
 * 产物：reports/xiyueci-look/{board,skill1-fx,codex}.png
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'reports', 'xiyueci-look');

/** 进战斗：选将 → 部署 → 确认，全程走真实 store 动作，不绕过任何门禁 */
const SETUP = `(() => {
    const store = window.__SIX_CHESS_STORE__;
    const s = store.getState();
    s.initGame();
    const p1 = ['xiyueci', 'moran', 'baize', 'wangshu'];
    const p2 = ['soul_lamp', 'fengling', 'zhenxiao', 'changli'];
    p1.forEach(id => store.getState().selectHeroForPlayer('player1', id));
    p2.forEach(id => store.getState().selectHeroForPlayer('player2', id));
    store.getState().confirmHeroSelectionForPlayer('player1');
    store.getState().confirmHeroSelectionForPlayer('player2');
    const live = id => store.getState().player1Heroes.concat(store.getState().player2Heroes).find(hero => hero.id.startsWith(id + '-'));
    const spots1 = [[0, 1], [0, 3], [1, 0], [1, 4]];
    const spots2 = [[4, 1], [4, 3], [5, 0], [5, 4]];
    p1.forEach((id, i) => { const hero = live(id); if (hero) store.getState().deployHeroForPlayer('player1', hero.id, spots1[i]); });
    p2.forEach((id, i) => { const hero = live(id); if (hero) store.getState().deployHeroForPlayer('player2', hero.id, spots2[i]); });
    store.getState().confirmDeploymentForPlayer('player1');
    store.getState().confirmDeploymentForPlayer('player2');
    return store.getState().phase;
})()`;

/** 摆一个"一盏灯照出两道影"的局面：一道压在有人格上、一道落在空格；她自己与队友都不落影 */
const SCENE = `(() => {
    const store = window.__SIX_CHESS_STORE__;
    const state = store.getState();
    const find = (player, template) => state[player + 'Heroes'].find(hero => hero.id.startsWith(template + '-'));
    const xiyueci = find('player1', 'xiyueci');
    const moran = find('player1', 'moran');
    const baize = find('player1', 'baize');
    const soulLamp = find('player2', 'soul_lamp');
    const fengling = find('player2', 'fengling');
    const zhenxiao = find('player2', 'zhenxiao');
    const changli = find('player2', 'changli');

    const board = Array.from({ length: 6 }, () => Array(6).fill(null));
    const place = (hero, row, col) => { if (hero) { hero.position = [row, col]; board[row][col] = hero; } };
    place(xiyueci, 2, 2);
    place(moran, 1, 1);
    place(baize, 0, 0);
    place(soulLamp, 3, 4);     // 灯圈里的敌人，影子投在 [4,5]（被风铃占着，正好演"影子不占格"）
    place(fengling, 4, 5);     // 站在别人的影子上
    place(zhenxiao, 1, 4);     // 灯圈里的敌人，影子投在空格 [0,5]
    place(changli, 5, 0);      // 三格外，不被照
    soulLamp.currentHp = 30; fengling.currentHp = 26; zhenxiao.currentHp = 22;

    store.setState({
        board,
        boardEffects: [{
            id: 'lit-lamp-' + xiyueci.id + '-look',
            type: 'lit-lamp',
            position: [2, 3],
            owner: 'player1',
            sourceHeroId: xiyueci.id,
            duration: 2,
        }],
        battleLog: [{
            id: 1, timestamp: Date.now(), type: 'skill', player: 'player1',
            message: '夕月辞在(3,4)点起明灯，亮2回合：缚魂灯的影子落在(5,6)，震霄的影子落在(1,6)',
        }],
    });
    return { lamp: [2, 3], shadows: [[4, 5], [0, 5]] };
})()`;

/** 真实放一次技能一：一圈伤害 + 击飞概率照常掷，特效自己排队 */
const CAST_SKILL1 = `(() => {
    const store = window.__SIX_CHESS_STORE__;
    const state = store.getState();
    const xiyueci = state.player1Heroes.find(hero => hero.id.startsWith('xiyueci-'));
    store.setState({ currentPlayer: 'player1', activeHero: xiyueci, selectedHero: xiyueci });
    store.getState().selectHeroForAction(xiyueci);
    store.getState().selectSkill('xiyueci_skill1');
    store.getState().executeSkill([1, 2]);
    return store.getState().battleLog.slice(-6).map(log => log.message);
})()`;

async function shoot(page, name) {
    const data = await page.screenshot();
    await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`saved reports/xiyueci-look/${name}.png`);
}

const server = await startGameServer(ROOT);
const { page, close } = await launchBrowser({ baseUrl: server.baseUrl, label: '夕月辞核对', headed: process.argv.includes('--headed') });

try {
    await mkdir(OUT, { recursive: true });
    console.log('phase after setup:', await page.evaluate(SETUP));
    await delay(600);
    console.log('scene:', JSON.stringify(await page.evaluate(SCENE)));
    await delay(500);
    await shoot(page, 'board');

    console.log('skill1 logs:', JSON.stringify(await page.evaluate(CAST_SKILL1)));
    await delay(430);
    await shoot(page, 'skill1-fx');

    await page.evaluate(`window.__SIX_CHESS_STORE__.setState({ phase: 'hero-codex', selectedHero: null, activeHero: null })`);
    await delay(700);
    await page.evaluate(`(() => {
        const card = [...document.querySelectorAll('button, [data-testid]')]
            .find(node => (node.textContent || '').includes('夕月辞'));
        if (card) card.click();
        return Boolean(card);
    })()`);
    await delay(700);
    await shoot(page, 'codex');
} finally {
    await close();
    await server.close();
}
