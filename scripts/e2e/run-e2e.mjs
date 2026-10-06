import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const resultsDir = path.join(projectRoot, 'test-results', 'e2e');
const headed = process.argv.includes('--headed');

// 替补制：每方选 6 位（首发 4 + 替补 2），确认按钮仅在满 6 位后可用；
// 双方名单不得重叠，对手已选的英雄在本方选将面板上不可点击。
const PLAYER_ONE_TEAM = ['moran', 'zhenxiao', 'baize', 'xuanxiao', 'mirror', 'mowen'];
const PLAYER_TWO_TEAM = ['liuli', 'wukong', 'nightowl', 'changli', 'huifeng', 'hanjiangxue'];

function stateExpression(predicate) {
    return `window.__SIX_CHESS_E2E__ && (() => {
        const state = window.__SIX_CHESS_E2E__.snapshot();
        return (${predicate});
    })()`;
}

async function waitForState(page, predicate, description, timeoutMs = 15_000) {
    await page.waitForExpression(stateExpression(predicate), description, timeoutMs);
}

async function selectTeam(page, heroIds, playerKey) {
    for (let index = 0; index < heroIds.length; index += 1) {
        await page.click(`hero-select-${heroIds[index]}`);
        await waitForState(
            page,
            `state.${playerKey}SelectedHeroIds.length === ${index + 1}`,
            `${playerKey} 选择第 ${index + 1} 名英雄`
        );
    }
    await page.click('confirm-hero-selection');
}

async function deployTeam(page, placements, playerKey, { exerciseUndeploy = false } = {}) {
    for (let index = 0; index < placements.length; index += 1) {
        const { heroId, row, col } = placements[index];
        await page.click(`deploy-hero-${heroId}`);
        await page.click(`deploy-cell-${row}-${col}`);
        await waitForState(
            page,
            `state.heroes.filter(hero => hero.owner === '${playerKey}').length === ${index + 1}`,
            `${playerKey} 部署第 ${index + 1} 名英雄`
        );
    }

    if (exerciseUndeploy) {
        // 撤下入口：点已上阵英雄的候选卡片 → 撤下 → 名额释放，替补可以顶上；
        // 最后换回原阵容，保证后续战斗脚本面对的局面不变。
        const { heroId, row, col } = placements[0];
        const benchId = PLAYER_ONE_TEAM.find(id => !placements.some(p => p.heroId === id)) ?? 'mirror';

        await page.click(`deploy-hero-${heroId}`);
        await page.waitForTestId('undeploy-deployed-hero');
        await page.click('undeploy-deployed-hero');
        await waitForState(page,
            `state.heroes.filter(hero => hero.owner === '${playerKey}').length === ${placements.length - 1}`,
            `撤下 ${heroId} 后首发回到 ${placements.length - 1} 人`);

        await page.click(`deploy-hero-${benchId}`);
        await page.click(`deploy-cell-${row}-${col}`);
        await waitForState(page,
            `state.heroes.filter(hero => hero.owner === '${playerKey}' && hero.position && hero.position[0] === ${row} && hero.position[1] === ${col}).length === 1`,
            `${benchId} 顶上空位`);

        await page.click(`deploy-cell-${row}-${col}`);
        await page.waitForTestId('undeploy-deployed-hero');
        await page.click('undeploy-deployed-hero');
        await page.click(`deploy-hero-${heroId}`);
        await page.click(`deploy-cell-${row}-${col}`);
        await waitForState(page,
            `state.heroes.filter(hero => hero.owner === '${playerKey}').length === ${placements.length}`,
            '换回原阵容');
    }

    await page.click('confirm-deployment');
}

const PLAYER_ONE_DEPLOYMENT = [
    { heroId: 'moran', row: 0, col: 2 },
    { heroId: 'zhenxiao', row: 1, col: 1 },
    { heroId: 'baize', row: 2, col: 1 },
    { heroId: 'xuanxiao', row: 3, col: 1 },
];

const PLAYER_TWO_DEPLOYMENT = [
    { heroId: 'liuli', row: 0, col: 3 },
    { heroId: 'wukong', row: 1, col: 4 },
    { heroId: 'nightowl', row: 2, col: 4 },
    { heroId: 'changli', row: 3, col: 4 },
];

async function testLocalCompleteFlow(baseUrl, sessions) {
    const session = await launchBrowser({ baseUrl, label: '本地完整流程', headed });
    sessions.push(session);
    const { page } = session;

    await page.click('menu-local-game');
    // 主菜单现在多了一层模式选择（标准=现行平衡不带武器 / 经典=战前武装），不点它进不去点将
    await page.click('menu-mode-standard');
    await waitForState(page, `state.phase === 'hero-select' && state.selectingPlayer === 'player1'`, '玩家一点将阶段');

    await selectTeam(page, PLAYER_ONE_TEAM, 'player1');
    await waitForState(page, `state.selectingPlayer === 'player2'`, '切换到玩家二点将');
    await selectTeam(page, PLAYER_TWO_TEAM, 'player2');
    await waitForState(page, `state.phase === 'deploy' && state.selectingPlayer === 'player1'`, '玩家一布阵阶段');

    await deployTeam(page, PLAYER_ONE_DEPLOYMENT, 'player1', { exerciseUndeploy: true });
    await waitForState(page, `state.selectingPlayer === 'player2'`, '切换到玩家二布阵');
    await deployTeam(page, PLAYER_TWO_DEPLOYMENT, 'player2');
    await waitForState(page, `state.phase === 'battle' && state.currentPlayer === 'player1'`, '战斗开始');
    await page.waitForTestId('battle-cell-0-2');

    const prepared = await page.evaluate('window.__SIX_CHESS_E2E__.prepareFinalStrike()');
    assert.equal(prepared, true, '应成功准备最后一击局面');

    await page.click('battle-cell-0-2');
    await page.waitForTestId('skill-button-moran_skill2');
    await page.click('skill-button-moran_skill2');
    await page.waitForExpression(
        `document.querySelector('[data-testid="battle-cell-0-3"]')?.classList.contains('cell-attack')`,
        '目标进入技能范围'
    );
    await page.click('battle-cell-0-3');

    await waitForState(page, `state.phase === 'ended'`, '战斗结算');
    await page.waitForTestId('battle-result');
    const resultText = await page.bodyText();
    assert.match(resultText, /玩家一\s*获胜/, '本地对局应显示玩家一获胜');
    assert.equal(page.errors.length, 0, `页面不应出现未捕获异常：${page.errors.join('\n')}`);
}

async function enterCodeRoom(page, code, modeTestId = 'menu-mode-standard') {
    await page.click('menu-online-game');
    await page.click(modeTestId);
    await page.waitForExpression(
        `document.querySelector('[data-testid="online-connection-state"]')?.textContent?.trim() === 'connected'`,
        '联机服务连接',
        20_000
    );
    await page.setInput('room-code-input', code);
    await page.waitForExpression(
        `!document.querySelector('[data-testid="enter-code-room"]')?.disabled`,
        '房间进入按钮可用'
    );
    await page.click('enter-code-room');
}

async function testTwoClientOnlineSync(baseUrl, sessions) {
    const first = await launchBrowser({ baseUrl, label: '联机玩家一', headed });
    const second = await launchBrowser({ baseUrl, label: '联机玩家二', headed });
    sessions.push(first, second);
    const code = String(1000 + Math.floor(Math.random() * 8000));

    await enterCodeRoom(first.page, code);
    await first.page.waitForExpression(`document.body.innerText.includes('${code}')`, '玩家一等待房间');
    await enterCodeRoom(second.page, code);

    await waitForState(first.page, `state.phase === 'hero-select' && state.localPlayerNumber === 1`, '玩家一进入点将', 20_000);
    await waitForState(second.page, `state.phase === 'hero-select' && state.localPlayerNumber === 2`, '玩家二进入点将', 20_000);
    const firstLobby = await first.page.snapshot();
    const secondLobby = await second.page.snapshot();
    assert.equal(firstLobby.onlineRoomId, `ROOM-${code}`);
    assert.equal(secondLobby.onlineRoomId, firstLobby.onlineRoomId, '双方必须进入同一房间');

    await selectTeam(first.page, PLAYER_ONE_TEAM, 'player1');
    await waitForState(second.page, `state.player1SelectedHeroIds.length === 6`, '玩家二收到玩家一点将同步');
    await selectTeam(second.page, PLAYER_TWO_TEAM, 'player2');
    await waitForState(first.page, `state.phase === 'deploy'`, '玩家一进入布阵', 20_000);
    await waitForState(second.page, `state.phase === 'deploy'`, '玩家二进入布阵', 20_000);

    await first.page.click('deploy-hero-moran');
    await first.page.click('deploy-cell-0-2');
    await waitForState(second.page, `state.heroes.some(hero => hero.owner === 'player1' && hero.name === '墨阑')`, '玩家二收到首个部署同步');
    for (const placement of PLAYER_ONE_DEPLOYMENT.slice(1)) {
        await first.page.click(`deploy-hero-${placement.heroId}`);
        await first.page.click(`deploy-cell-${placement.row}-${placement.col}`);
    }
    await first.page.click('confirm-deployment');

    await deployTeam(second.page, PLAYER_TWO_DEPLOYMENT, 'player2');
    await waitForState(first.page, `state.phase === 'battle' && state.currentPlayer === 'player1'`, '玩家一进入联机战斗', 20_000);
    await waitForState(second.page, `state.phase === 'battle' && state.currentPlayer === 'player1'`, '玩家二进入联机战斗', 20_000);

    await first.page.click('battle-cell-0-2');
    await first.page.waitForTestId('end-hero-action');
    await first.page.click('end-hero-action');
    await waitForState(first.page, `state.currentPlayer === 'player2'`, '玩家一完成行动后切换回合');
    await waitForState(second.page, `state.currentPlayer === 'player2'`, '玩家二收到战斗行动同步', 20_000);

    const remoteState = await second.page.snapshot();
    assert.equal(remoteState.heroes.filter(hero => hero.owner === 'player1').length, 4);
    assert.equal(remoteState.heroes.filter(hero => hero.owner === 'player2').length, 4);

    // 玩家二（孙悟空在 (1,4)）释放·毫毛化身到空格 (1,2)。
    // 战斗阶段行动方只提交权威快照，对手端不重跑结算，
    // 音效与特效必须依据转发的 action 重建 —— 这里验证未出手一方确实看到特效。
    await second.page.click('battle-cell-1-4');
    await second.page.waitForTestId('skill-button-wukong_skill1');
    await second.page.click('skill-button-wukong_skill1');
    const fxVisible = `document.querySelectorAll('.fx-anchor, .fx-halo').length > 0`;
    // 特效只存活约 1.3 秒，必须在点击目标格之前就开始轮询两端页面
    const casterFx = second.page.waitForExpression(fxVisible, '玩家二本地看到技能特效', 5_000);
    const receiverFx = first.page.waitForExpression(fxVisible, '玩家一收到对手技能特效', 5_000);
    await second.page.click('battle-cell-1-2');
    await Promise.all([casterFx, receiverFx]);

    assert.equal(first.page.errors.length, 0, `玩家一页面异常：${first.page.errors.join('\n')}`);
    assert.equal(second.page.errors.length, 0, `玩家二页面异常：${second.page.errors.join('\n')}`);
}

/**
 * 经典模式联机全链路：房主开经典局，客机菜单故意选标准局。
 * 这条用例锁的是"模式以房间为准"——客机拿不到房间模式时一端停在武装、另一端直接布阵，
 * 服务端等不齐两次武装确认，房间就永久卡在 weapon-select（玩家表现为"卡在选择武器界面"）。
 */
async function testTwoClientOnlineClassic(baseUrl, sessions) {
    const first = await launchBrowser({ baseUrl, label: '经典联机玩家一', headed });
    const second = await launchBrowser({ baseUrl, label: '经典联机玩家二', headed });
    sessions.push(first, second);
    const code = String(1000 + Math.floor(Math.random() * 8000));

    await enterCodeRoom(first.page, code, 'menu-mode-classic');
    await first.page.waitForExpression(`document.body.innerText.includes('${code}')`, '玩家一等待房间');
    await enterCodeRoom(second.page, code, 'menu-mode-standard');

    await waitForState(first.page, `state.phase === 'hero-select' && state.localPlayerNumber === 1`, '玩家一进入点将', 20_000);
    await waitForState(second.page, `state.phase === 'hero-select' && state.localPlayerNumber === 2`, '玩家二进入点将', 20_000);
    assert.equal((await second.page.snapshot()).gameMode, 'classic', '客机必须跟随房间的经典模式');

    await selectTeam(first.page, PLAYER_ONE_TEAM, 'player1');
    await waitForState(second.page, `state.player1SelectedHeroIds.length === 6`, '玩家二收到玩家一点将同步');
    await selectTeam(second.page, PLAYER_TWO_TEAM, 'player2');

    await waitForState(first.page, `state.phase === 'weapon-select'`, '玩家一进入武装', 20_000);
    await waitForState(second.page, `state.phase === 'weapon-select'`, '玩家二进入武装', 20_000);

    await first.page.click('weapon-toggle-moran');
    await first.page.click('weapon-toggle-zhenxiao');
    await first.page.click('confirm-weapon-selection');
    await waitForState(second.page, `state.player1ReadyWeaponSelect === true`, '玩家二收到对手武装确认', 20_000);

    await second.page.click('weapon-toggle-liuli');
    await second.page.click('weapon-toggle-wukong');
    await second.page.click('confirm-weapon-selection');

    await waitForState(first.page, `state.phase === 'deploy'`, '玩家一等到双方武装确认后进入布阵', 20_000);
    await waitForState(second.page, `state.phase === 'deploy'`, '玩家二进入布阵', 20_000);

    // deployTeam 自带"确认部署"收尾，这里不能再点一次（按钮会变成等待对手且禁用）
    await deployTeam(first.page, PLAYER_ONE_DEPLOYMENT, 'player1');
    await deployTeam(second.page, PLAYER_TWO_DEPLOYMENT, 'player2');

    await waitForState(first.page, `state.phase === 'battle' && state.currentPlayer === 'player1'`, '玩家一进入联机战斗', 20_000);
    await waitForState(second.page, `state.phase === 'battle' && state.currentPlayer === 'player1'`, '玩家二进入联机战斗', 20_000);

    // 武装账本要跟着布阵同步到对面：对面看到的对手英雄也必须带着专属器
    for (const [label, page] of [['玩家一', first.page], ['玩家二', second.page]]) {
        const state = await page.snapshot();
        for (const heroId of ['moran', 'zhenxiao', 'liuli', 'wukong']) {
            const hero = state.heroes.find(item => item.id.startsWith(`${heroId}-`));
            assert.ok(hero && hero.weaponId, `${label}视角下 ${heroId} 应带专属器`);
        }
    }

    await first.page.click('battle-cell-0-2');
    await first.page.waitForTestId('end-hero-action');
    await first.page.click('end-hero-action');
    await waitForState(second.page, `state.currentPlayer === 'player2'`, '玩家二收到回合交接', 20_000);

    assert.equal(first.page.errors.length, 0, `玩家一页面异常：${first.page.errors.join('\n')}`);
    assert.equal(second.page.errors.length, 0, `玩家二页面异常：${second.page.errors.join('\n')}`);
}

async function saveFailureScreenshots(sessions) {
    await mkdir(resultsDir, { recursive: true });
    await Promise.all(sessions.map(async (session, index) => {
        try {
            const base64 = await session.page.screenshot();
            await writeFile(path.join(resultsDir, `failure-${index + 1}.png`), Buffer.from(base64, 'base64'));
        } catch {
            // 页面可能已随浏览器崩溃关闭。
        }
    }));
}

async function main() {
    const sessions = [];
    let server;
    const tests = [
        ['选人 → 布阵 → 战斗 → 结算', testLocalCompleteFlow],
        ['双端联机选人、布阵与战斗同步', testTwoClientOnlineSync],
        ['双端联机经典模式：武装到战斗全链路', testTwoClientOnlineClassic],
    ];

    try {
        console.log('正在构建 E2E 专用版本并启动本地服务…');
        server = await startGameServer(projectRoot);
        let passed = 0;
        for (const [name, test] of tests) {
            const startedAt = Date.now();
            await test(server.baseUrl, sessions);
            passed += 1;
            console.log(`✓ ${name} (${Date.now() - startedAt}ms)`);
            while (sessions.length > 0) await sessions.pop().close();
        }
        console.log(`\nE2E Test Suites  ${passed} passed (${tests.length})`);
    } catch (error) {
        await saveFailureScreenshots(sessions);
        console.error(`\n✗ E2E 测试失败\n${error.stack || error.message}`);
        process.exitCode = 1;
    } finally {
        while (sessions.length > 0) await sessions.pop().close();
        await server?.close();
    }
}

await main();
