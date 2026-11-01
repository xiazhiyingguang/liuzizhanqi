import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

// 新角色接入验收：真实选将与布阵，随后在确定性战术夹具上点界面施法。
const root = process.cwd();
const out = path.join(root, 'reports', 'pr-1-integration', 'browser');
const own = ['wenren', 'shuangfeiyan', 'xiyueci', 'baize', 'huifeng', 'liuli'];
const foes = ['moran', 'zhenxiao', 'wukong', 'xuanxiao', 'mirror', 'hanjiangxue'];
const checks = [];
let session;
let peer;
const server = await startGameServer(root);
const state = 'window.__SIX_CHESS_STORE__.getState()';
const hero = (id, owner = 'player1') => `${state}.${owner}Heroes.find(h => h.id.startsWith('${id}-'))`;
const check = label => { checks.push(label); console.log(`✓ ${label}`); };

try {
    await mkdir(out, { recursive: true });
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'PR1 新角色', headed: process.argv.includes('--headed') });
    const { page } = session;
    const wait = (expression, label) => page.waitForExpression(expression, label);
    const shoot = async name => writeFile(path.join(out, `${name}.png`), Buffer.from(await page.screenshot(), 'base64'));
    await page.click('menu-local-game');
    await page.click('menu-mode-standard');
    for (const team of [own, foes]) {
        for (const id of team) await page.click(`hero-select-${id}`);
        await page.click('confirm-hero-selection');
    }
    for (const [team, positions] of [[own, [[0, 1], [1, 0], [2, 1], [3, 0]]], [foes, [[0, 4], [1, 4], [3, 5], [5, 5]]]]) {
        for (let i = 0; i < 4; i++) {
            await page.click(`deploy-hero-${team[i]}`);
            await page.click(`deploy-cell-${positions[i][0]}-${positions[i][1]}`);
        }
        await page.click('confirm-deployment');
    }
    await wait(`${state}.phase === 'battle'`, '进入战斗');
    check('三名新角色能经真实选将、布阵进入战斗');

    // 每个场景只重置夹具的站位和行动状态；施法仍点真实棋盘与技能按钮。
    async function layout(positions) {
        await page.evaluate(`(() => {
            const store = window.__SIX_CHESS_STORE__;
            const s = store.getState();
            const board = Array.from({length:6}, () => Array(6).fill(null));
            const all = [...s.player1Heroes, ...s.player2Heroes];
            for (const h of all) {
                h.state = 'alive'; h.currentHp = h.maxHp; h.shield = 0; h.defense = 0;
                h.effects = []; h.counters = {}; h.hasMovedThisTurn = false; h.hasActedThisTurn = false;
                h.position = null;
            }
            for (const [id, cell] of Object.entries(${JSON.stringify(positions)})) {
                const h = all.find(h => h.id.startsWith(id + '-'));
                h.position = cell; board[cell[0]][cell[1]] = h;
            }
            store.setState({board, boardEffects: [], currentPlayer:'player1', phase:'battle', roundNumber:1,
                actionsThisTurn:0, actionsRequiredThisTurn:8, selectedHero:null, activeHero:null, selectedSkill:null,
                moveRange:[], skillRange:[], highlightedPositions:[], pendingExtraActionHeroIds:{},
                pendingBoardAction:undefined, pendingSkillTargetPositions:[], reinforcingPlayer:undefined,
                forcedActionResumePlayer:undefined, pendingForcedActionHeroId:undefined,
                battleLog:[], battleStatistics:{}, skillFx:[], autoBattle:false});
            Math.random = () => .99;
        })()`);
        await wait(`document.querySelector('[data-testid="battle-cell-2-1"]')`, '战术夹具就绪');
    }
    const far = { zhenxiao: [0, 5], wukong: [4, 5], xuanxiao: [5, 5] };
    await layout({ wenren:[2,1], baize:[2,2], shuangfeiyan:[4,0], xiyueci:[0,0], moran:[1,3], ...far });
    await page.click('battle-cell-2-1');
    await page.click('skill-button-wenren_skill1');
    await page.click('battle-cell-2-2');
    await wait(`${hero('wenren')}.counters.__wenren_waypoint !== undefined`, '选定中途友军');
    assert.deepEqual(await page.evaluate(`${hero('wenren')}.position`), [2, 1]);
    await page.click('battle-cell-2-3');
    await wait(`${hero('wenren')}.position.join() === '2,3'`, '飞跃落地');
    assert.ok(await page.evaluate(`${hero('moran','player2')}.currentHp < ${hero('moran','player2')}.maxHp`));
    await shoot('wenren-leap');
    check('闻人翊悬两段点选成功，落地伤害结算正确');

    await layout({ wenren:[0,0], baize:[5,0], shuangfeiyan:[2,1], xiyueci:[0,1], moran:[2,3], ...far });
    await page.click('battle-cell-2-1');
    await page.click('skill-button-shuangfeiyan_skill1');
    await page.click('battle-cell-2-4');
    await wait(`${hero('shuangfeiyan')}.counters.sfy_extra_skill_only === 1`, '被动第二手');
    assert.equal(await page.evaluate(`${state}.currentPlayer`), 'player1');
    assert.equal(await page.evaluate(`${state}.moveRange.length`), 0);
    await page.click('skill-button-shuangfeiyan_skill1');
    await page.click('battle-cell-4-3');
    await wait(`${state}.boardEffects.filter(e => e.type === 'boomerang').length === 2`, '双镖留场');
    await wait(`document.querySelectorAll('.bf-boomerang, .bf-boomerang-occupied').length === 2`, '双镖棋盘标记');
    await shoot('shuangfeiyan-boomerangs');
    check('双飞燕两次出手、第二手禁普通走位、双镖显示正确');

    await layout({ wenren:[0,0], baize:[5,0], shuangfeiyan:[5,3], xiyueci:[2,2], moran:[3,3], ...far });
    await page.click('battle-cell-2-2');
    await page.click('skill-button-xiyueci_skill2');
    await page.click('battle-cell-2-3');
    await wait(`document.querySelectorAll('.bf-lamp').length === 1 && document.querySelectorAll('.bf-lamp-shadow').length >= 1`, '明灯与灯影');
    const hpBefore = await page.evaluate(`${hero('moran','player2')}.currentHp`);
    await page.evaluate(`window.__SIX_CHESS_STORE__.setState({ currentPlayer:'player1', selectedHero:null, activeHero:null, selectedSkill:null, skillRange:[], moveRange:[] })`);
    await page.click('battle-cell-5-3');
    await page.click('skill-button-shuangfeiyan_skill1');
    await page.click('battle-cell-4-3');
    await wait(`${hero('moran','player2')}.currentHp < ${hpBefore}`, '攻击灯影传伤');
    assert.equal(hpBefore - await page.evaluate(`${hero('moran','player2')}.currentHp`), 2);
    await shoot('xiyueci-lamp-shadow');
    check('夕月辞明灯和灯影可见，双飞燕攻击空影格向本体传递半伤');

    await page.evaluate(`window.__SIX_CHESS_STORE__.setState({ phase:'hero-codex', selectedHero:null, activeHero:null })`);
    for (const [id, name, skill] of [['wenren','闻人翊悬','蹈火·跃阵'], ['shuangfeiyan','双飞燕','双飞剪'], ['xiyueci','夕月辞','明灯·照影']]) {
        await page.clickByText(name);
        await wait(`document.body.innerText.includes(${JSON.stringify(skill)})`, `${name}图鉴技能`);
        await wait(`document.querySelector('.hero-radar-wrap svg')`, `${name}能力雷达`);
        await wait(`getComputedStyle(document.querySelector('.codex-detail .animate-fade-up')).opacity === '1'`, '图鉴入场动画完成');
        if (id === 'shuangfeiyan') assert.match(await page.bodyText(), /天威 · 待定/);
        await shoot(`codex-${id}`);
        check(`${name}图鉴、能力雷达与技能详情正常`);
    }
    assert.deepEqual(page.errors, []);

    // 真实双端联机：新角色两段操作、场地物及被动第二手都通过服务器转发。
    await session.close();
    session = await launchBrowser({ baseUrl: server.baseUrl, label: 'PR1 联机主端' });
    peer = await launchBrowser({ baseUrl: server.baseUrl, label: 'PR1 联机对端' });
    const first = session.page;
    const second = peer.page;
    for (const client of [first, second]) {
        await client.click('menu-online-game');
        await client.click('menu-mode-standard');
        await client.waitForExpression(`document.querySelector('[data-testid="online-connection-state"]')?.textContent?.trim() === 'connected'`, '连到测试服务器');
        await client.setInput('room-code-input', '7931');
        await client.click('enter-code-room');
    }
    await first.waitForExpression(`${state}.phase === 'hero-select'`, '联机选将开始');
    for (const [client, team] of [[first, own], [second, foes]]) {
        for (const id of team) await client.click(`hero-select-${id}`);
        await client.click('confirm-hero-selection');
    }
    await first.waitForExpression(`${state}.phase === 'deploy'`, '联机布阵开始');
    for (const [client, team, positions] of [[first, own, [[0,1],[1,0],[2,1],[3,0]]], [second, foes, [[0,4],[1,4],[3,5],[5,5]]]]) {
        for (let i = 0; i < 4; i++) {
            await client.click(`deploy-hero-${team[i]}`);
            await client.click(`deploy-cell-${positions[i][0]}-${positions[i][1]}`);
        }
        await client.click('confirm-deployment');
    }
    await first.waitForExpression(`${state}.phase === 'battle'`, '主端联机战斗');
    await second.waitForExpression(`${state}.phase === 'battle'`, '对端联机战斗');
    await first.click('battle-cell-0-1');
    await first.click('skill-button-wenren_skill1');
    await first.click('battle-cell-2-1');
    await first.click('battle-cell-3-1');
    await second.waitForExpression(`${hero('wenren')}.position.join() === '3,1' && ${state}.currentPlayer === 'player2'`, '闻人飞跃传到对端');
    check('双端联机闻人两段飞跃结果一致');

    await second.click('battle-cell-0-4');
    await second.click('end-hero-action');
    await first.waitForExpression(`${state}.currentPlayer === 'player1'`, '主端再次行动');
    await first.click('battle-cell-2-1');
    await first.click('skill-button-xiyueci_skill2');
    await first.click('battle-cell-2-3');
    await second.waitForExpression(`${state}.boardEffects.some(e => e.type === 'lit-lamp') && document.querySelectorAll('.bf-lamp-shadow').length > 0`, '对端出现明灯和灯影');
    check('双端联机明灯及实时灯影显示一致');

    await second.click('battle-cell-1-4');
    await second.click('end-hero-action');
    await first.waitForExpression(`${state}.currentPlayer === 'player1'`, '主端轮到双飞燕');
    await first.click('battle-cell-1-0');
    await first.click('skill-button-shuangfeiyan_skill1');
    await first.click('battle-cell-1-3');
    await second.waitForExpression(`${hero('shuangfeiyan')}.counters.sfy_extra_skill_only === 1 && ${state}.boardEffects.some(e => e.type === 'boomerang')`, '对端收到镖和第二手');
    await first.click('skill-button-shuangfeiyan_skill1');
    await first.click('battle-cell-0-1');
    await second.waitForExpression(`${state}.boardEffects.filter(e => e.type === 'boomerang').length === 2 && ${state}.currentPlayer === 'player2'`, '第二手收尾同步');
    const canonical = `(() => { const s = ${state}; return {currentPlayer:s.currentPlayer, round:s.roundNumber, actions:s.actionsThisTurn,
        effects:s.boardEffects, heroes:[...s.player1Heroes,...s.player2Heroes].map(h=>({id:h.id,position:h.position,hp:h.currentHp,counters:h.counters,effects:h.effects}))}; })()`;
    assert.deepEqual(await first.evaluate(canonical), await second.evaluate(canonical));
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    await writeFile(path.join(out, 'online-new-heroes.png'), Buffer.from(await second.screenshot(), 'base64'));
    check('双端联机双镖与被动第二手收尾一致，双方状态完全相同');

    await writeFile(path.join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
    console.log(`Browser checks ${checks.length}/${checks.length} passed. Screenshots: ${out}`);
} catch (error) {
    if (session) {
        await writeFile(path.join(out, 'failure.png'), Buffer.from(await session.page.screenshot(), 'base64')).catch(() => {});
    }
    throw error;
} finally {
    if (peer) await peer.close();
    if (session) await session.close();
    await server.close();
}
