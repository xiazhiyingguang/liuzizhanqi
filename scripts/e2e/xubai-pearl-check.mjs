import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startGameServer } from './browser-harness.mjs';

const label = process.argv[2] || 'after';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid label');
const output = 'reports/xubai-pearl-check';
mkdirSync(output, { recursive: true });
const server = await startGameServer(process.cwd());
let session;
try {
    session = await launchBrowser({ baseUrl: server.baseUrl, label: `xubai-${label}` });
    const page = session.page;
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const results = [];
    for (const [skillId, timeMs] of [['xubai_skill2', 300], ['xubai_skill2', 800], ['xubai_regen', 650]]) {
        await page.evaluate(`window.__SIX_CHESS_E2E__.skillFxDemo(${JSON.stringify(skillId)})`);
        await page.waitForExpression(`document.querySelector('.skill-fx-target')`, '凝珠主特效');
        const details = await page.evaluate(`(() => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.target?.closest?.('.battle-board-cell')) { animation.pause(); animation.currentTime = ${timeMs}; }
            }
            const target = document.querySelector('.skill-fx-target');
            return { classic: Boolean(target.querySelector('.fx-pearl-formation')),
                incoming: target.querySelectorAll('.fx-pearl').length, orbiting: target.querySelectorAll('.fx-pearl-orb').length,
                layeredReturn: Boolean(target.querySelector('.rfx-pearls.is-returning')),
                filters: [...target.querySelectorAll('*')].filter(node => getComputedStyle(node).filter !== 'none').length };
        })()`);
        if (label !== 'before' && skillId === 'xubai_skill2') {
            assert.equal(details.classic, true);
            assert.equal(details.incoming, 3);
            assert.equal(details.orbiting, 3);
            assert.equal(details.filters, 0);
        }
        if (skillId === 'xubai_regen') assert.equal(details.layeredReturn, true);
        writeFileSync(`${output}/${label}-${skillId}-${timeMs}.png`, Buffer.from(await page.screenshot(), 'base64'));
        if (skillId === 'xubai_skill2' && timeMs === 800) {
            const clip = await page.evaluate(`(() => {
                const rect = document.querySelector('.skill-fx-target').getBoundingClientRect();
                return { x: rect.x + rect.width / 2 - 90, y: rect.y + rect.height / 2 - 90, width: 180, height: 180, scale: 2 };
            })()`);
            const capture = await page.send('Page.captureScreenshot', { format: 'png', clip });
            writeFileSync(`${output}/${label}-detail.png`, Buffer.from(capture.data, 'base64'));
        }
        results.push({ skillId, timeMs, ...details });
        console.log(JSON.stringify(results.at(-1)));
    }
    assert.deepEqual(page.errors, []);
    writeFileSync(`${output}/${label}.json`, JSON.stringify(results, null, 2));
} finally {
    await session?.close();
    await server.close();
}
