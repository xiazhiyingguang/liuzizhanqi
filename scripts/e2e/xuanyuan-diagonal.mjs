import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, runCommand, startGameServer } from './browser-harness.mjs';

const out = path.join(process.cwd(), 'reports', 'xuanyuan-pr1', 'browser');
const own = ['xuanyuan', 'moran', 'baize', 'wenren', 'shuangfeiyan', 'xiyueci'];
const foes = ['liuli', 'wukong', 'xuanxiao', 'hanjiangxue', 'huifeng', 'mirror'];
const S = 'window.__SIX_CHESS_STORE__.getState()';
const caster = `${S}.player1Heroes.find(h => h.skill1Id === 'xuanyuan_skill1')`;
const checks = [];
const sessions = [];
// 并行开发时可独立验收浏览器行为；默认仍必须通过 tsc，不能把这个选项当成构建通过。
async function testServer() {
    if (!process.argv.includes('--transpile-only')) return startGameServer(process.cwd());
    console.warn('仅验证浏览器行为：跳过类型检查，不能据此宣称 npm run build 成功。');
    await runCommand('npx', ['vite', 'build'], { cwd: process.cwd(), env: { ...process.env, VITE_E2E: 'true' } });
    const { startServer, stopServer } = await import('../../server/server.js');
    const { port } = await startServer(0, '127.0.0.1');
    return { baseUrl: `http://127.0.0.1:${port}`, close: stopServer };
}
const server = await testServer();
const passed = name => { checks.push(name); console.log(`✓ ${name}`); };

async function pick(page, team) {
    for (const id of team) await page.click(`hero-select-${id}`);
    await page.click('confirm-hero-selection');
}
async function deploy(page, team, positions) {
    for (let i = 0; i < 4; i++) {
        await page.click(`deploy-hero-${team[i]}`);
        await page.click(`deploy-cell-${positions[i][0]}-${positions[i][1]}`);
    }
    await page.click('confirm-deployment');
}
const positions = [[[2,1],[1,0],[3,0],[4,1]], [[2,4],[3,4],[1,5],[4,5]]];
const fixture = `(() => {
    const store = window.__SIX_CHESS_STORE__, s = store.getState();
    const all = [...s.player1Heroes,...s.player2Heroes];
    const board = Array.from({length:6},()=>Array(6).fill(null));
    const layout = {xuanyuan:[2,2],moran:[0,0],baize:[0,1],wenren:[5,0],liuli:[2,4],wukong:[4,5],xuanxiao:[5,5],hanjiangxue:[0,5]};
    for (const h of all) {
        h.position=layout[h.id.split('-')[0]]; h.state='alive'; h.currentHp=h.maxHp=100;
        h.effects=[];h.counters={};h.shield=0;h.defense=0;h.hasMovedThisTurn=false;h.hasActedThisTurn=false;
        board[h.position[0]][h.position[1]]=h;
    }
    const hero=all.find(h=>h.skill1Id==='xuanyuan_skill1');hero.counters['昭神']=1;
    const boardEffects=[[0,3],[2,0]].map((cell,i)=>({id:'drift-fixture-'+i,type:'flying-sword',position:cell,owner:'player1',sourceHeroId:hero.id,duration:3}));
    store.setState({board,boardEffects,currentPlayer:'player1',phase:'battle',roundNumber:1,actionsThisTurn:0,actionsRequiredThisTurn:8,
        activeHero:null,selectedHero:null,selectedSkill:null,moveRange:[],skillRange:[],highlightedPositions:[],
        pendingExtraActionHeroIds:{},pendingBoardAction:undefined,pendingSkillTargetPositions:[],reinforcingPlayer:undefined,
        battleLog:[],battleStatistics:{},skillFx:[],autoBattle:false});
    Math.random=()=>.99;
})()`;
const swordCells = `${S}.boardEffects.filter(e=>e.type==='flying-sword').map(e=>e.position.join()).sort()`;
const shot = async (page, name) => writeFile(path.join(out, `${name}.png`), Buffer.from(await page.screenshot(),'base64'));

try {
    await mkdir(out,{recursive:true});
    const local = await launchBrowser({baseUrl:server.baseUrl,label:'轩辕新机制本地'});sessions.push(local);
    const page = local.page;
    await page.click('menu-local-game');await page.click('menu-mode-standard');
    await pick(page,own);await pick(page,foes);
    await deploy(page,own,positions[0]);await deploy(page,foes,positions[1]);
    await page.waitForExpression(`${S}.phase==='battle'`,'进入战斗');
    await page.evaluate(fixture);
    await page.click('battle-cell-2-2');await page.click('show-move-range');
    assert.ok(await page.evaluate(`${S}.moveRange.some(p=>p.join()==='1,1') && ${S}.moveRange.some(p=>p.join()==='4,4')`));
    await page.click('battle-cell-1-1');
    await page.waitForExpression(`document.querySelector('[data-testid="skill-button-xuanyuan_skill1"]')?.disabled`,'移动后技能一禁用');
    assert.ok((await page.evaluate(swordCells)).includes('0,4'));
    await shot(page,'move-lock');
    await page.click('undo-move');
    await page.waitForExpression(`${caster}.position.join()==='2,2' && !document.querySelector('[data-testid="skill-button-xuanyuan_skill1"]')?.disabled`,'撤回恢复');
    assert.deepEqual(await page.evaluate(swordCells),['0,3','2,0']);
    passed('昭神移动一格或两格、移动后禁技能一、撤回恢复剑位及按钮');
    await page.click('skill-button-xuanyuan_skill1');
    assert.ok(await page.evaluate(`${S}.skillRange.some(p=>p.join()==='1,3') && !${S}.skillRange.some(p=>p.join()==='2,3')`));
    await page.click('battle-cell-1-3');
    await page.waitForExpression(`${caster}.position.join()==='1,3' && ${caster}.counters.__xuanyuan_leap_used===1`,'单击首跳');
    assert.ok(await page.evaluate(`${S}.skillRange.some(p=>p.join()==='0,4')`));
    await shot(page,'first-leap');
    await page.click('battle-cell-0-4');
    await page.waitForExpression(`${caster}.position.join()==='0,4' && ${caster}.counters.__xuanyuan_leap_used===2`,'第二跳');
    await page.click('battle-cell-2-2');
    await page.waitForExpression(`${caster}.position.join()==='2,2' && ${S}.currentPlayer==='player2'`,'第三跳结束');
    passed('首跳不踩剑、续跳踩漂移后的剑、三跳结束并交出控制权');
    await page.evaluate(`window.__SIX_CHESS_STORE__.setState({phase:'hero-codex',selectedHero:null,activeHero:null})`);
    await page.clickByText('轩辕神君');
    await page.waitForExpression(`document.body.innerText.includes('剑随气走') && getComputedStyle(document.querySelector('.codex-detail .animate-fade-up')).opacity==='1'`,'新图鉴说明');
    assert.ok(!(await page.bodyText()).includes('周身G型'));
    await shot(page,'codex');passed('图鉴已显示新被动与对角跳说明，无旧G型介绍');
    assert.deepEqual(page.errors,[]);

    const first = await launchBrowser({baseUrl:server.baseUrl,label:'轩辕联机主端'});sessions.push(first);
    const second = await launchBrowser({baseUrl:server.baseUrl,label:'轩辕联机对端'});sessions.push(second);
    for(const client of [first.page,second.page]) {
        await client.click('menu-online-game');await client.click('menu-mode-standard');
        await client.waitForExpression(`document.querySelector('[data-testid="online-connection-state"]')?.textContent?.trim()==='connected'`,'连接测试服务器');
        await client.setInput('room-code-input','8261');await client.click('enter-code-room');
    }
    await first.page.waitForExpression(`${S}.phase==='hero-select'`,'联机选将');
    await pick(first.page,own);await pick(second.page,foes);
    await first.page.waitForExpression(`${S}.phase==='deploy'`,'联机布阵');
    await deploy(first.page,own,positions[0]);await deploy(second.page,foes,positions[1]);
    for (const client of [first.page,second.page]) {
        await client.waitForExpression(`${S}.phase==='battle'`,'联机战斗');
        await client.evaluate(fixture);
    }
    await first.page.click('battle-cell-2-2');await first.page.click('show-move-range');await first.page.click('battle-cell-1-1');
    await second.page.waitForExpression(`${caster}.position.join()==='1,1' && ${S}.boardEffects.some(e=>e.position.join()==='0,4')`,'漂移同步');
    await first.page.click('undo-move');
    await second.page.waitForExpression(`${caster}.position.join()==='2,2' && ${S}.boardEffects.some(e=>e.position.join()==='0,3')`,'撤回同步');
    passed('双端联机普通移动漂移与撤回恢复一致');
    await first.page.click('skill-button-xuanyuan_skill1');
    for (const [cell,used] of [[[1,3],1],[[0,4],2],[[2,2],0]]) {
        await first.page.click(`battle-cell-${cell[0]}-${cell[1]}`);
        await second.page.waitForExpression(`${caster}.position.join()==='${cell.join()}' ${used ? `&& ${caster}.counters.__xuanyuan_leap_used===${used}` : `&& ${S}.currentPlayer==='player2'`}`,'连跳结果同步');
    }
    const canonical=`(() => {const s=${S};return {current:s.currentPlayer,actions:s.actionsThisTurn,effects:s.boardEffects,
        heroes:[...s.player1Heroes,...s.player2Heroes].map(h=>({id:h.id,hp:h.currentHp,position:h.position,counters:h.counters,effects:h.effects}))};})()`;
    assert.deepEqual(await first.page.evaluate(canonical),await second.page.evaluate(canonical));
    assert.deepEqual(first.page.errors,[]);assert.deepEqual(second.page.errors,[]);
    await shot(second.page,'online-three-leaps');passed('双端联机三连跳与最终状态完全一致');
    await writeFile(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));
    console.log(`Browser checks ${checks.length}/${checks.length} passed`);
} catch (error) {
    for(let i=0;i<sessions.length;i++) await shot(sessions[i].page,`failure-${i}`).catch(()=>{});
    throw error;
} finally {
    while(sessions.length)await sessions.pop().close();
    await server.close();
}
