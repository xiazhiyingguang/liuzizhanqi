/** 新旧 AI 轮换双方对打；旧 AI 从指定 Git 提交读出，不修改/检出工作区文件。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { ViteNodeServer } from 'vite-node/server';
import { ViteNodeRunner } from 'vite-node/client';

const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'HEAD';
const baselineRef = execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const baselineFile = option('--baseline-file');
const baselineHookFile = option('--baseline-hook-file');
if (Boolean(baselineFile) !== Boolean(baselineHookFile)) throw new Error('比较工作区快照时必须同时指定 AI 与执行器快照');
const oldSource = baselineFile ? readFileSync(baselineFile, 'utf8')
    : execFileSync('git', ['show', `${baselineRef}:src/core/computer-ai.ts`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const oldHook = baselineHookFile ? readFileSync(baselineHookFile, 'utf8')
    : execFileSync('git', ['show', `${baselineRef}:src/hooks/useComputerOpponent.ts`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (/getGMovePlans|__xuanyuan_leap_start/.test(oldSource + oldHook)) {
    throw new Error('基线仍使用轩辕旧 G 型规则，不能与当前对角跳机制混比。请指定兼容新机制的 --ref（例如 origin/pr-1），或提供新机制下的 AI 与执行器快照。历史报告保留，不覆盖。');
}
const root = process.cwd().replaceAll('\\', '/');
const oldId = `${root}/src/core/__benchmark_ai_baseline.ts`;
const policyId = `${root}/src/core/__benchmark_ai_policy.ts`;
const oldHookId = `${root}/src/hooks/__benchmark_ai_baseline_hook.ts`;
const currentSource = readFileSync('src/core/computer-ai.ts', 'utf8');
const names = [...currentSource.matchAll(/export function (\w+)\(/g)].map(match => match[1]);
const policySource = `import * as current from './computer-ai';\nimport * as baseline from './__benchmark_ai_baseline';\n` + names.map(name =>
    `export const ${name} = (...args) => ((globalThis.__AI_BENCHMARK_POLICY__ === 'baseline' ? baseline : current)['${name}'] ?? current['${name}'])(...args);`).join('\n');
const server = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'ai-policy-comparison', enforce: 'pre',
        resolveId(id) {
            if (/__benchmark_ai_baseline(?:\.ts)?$/.test(id)) return oldId;
            if (/__benchmark_ai_policy(?:\.ts)?$/.test(id)) return policyId;
            if (/__benchmark_ai_baseline_hook(?:\.ts)?$/.test(id)) return oldHookId;
        },
        load(id) {
            if (id.endsWith('__benchmark_ai_baseline.ts')) return oldSource;
            if (id.endsWith('__benchmark_ai_policy.ts')) return policySource;
            if (id.endsWith('__benchmark_ai_baseline_hook.ts')) return oldHook.replace("'../core/computer-ai'", "'../core/__benchmark_ai_baseline'");
        },
        transform(code, id) {
            if (id.replaceAll('\\', '/').endsWith('/scripts/ai/policy-matches.ts')) {
                return code.replace("'../../src/core/computer-ai'", "'../../src/core/__benchmark_ai_policy'");
            }
        },
    }],
});
try {
    const source = new ViteNodeServer(server);
    const runner = new ViteNodeRunner({ root: server.config.root, base: server.config.base,
        fetchModule: id => source.fetchModule(id), resolveId: (id, importer) => source.resolveId(id, importer) });
    const { runComparisonMatch, scenarios, compareTactics } = await runner.executeFile('scripts/ai/policy-matches.ts');
    const tactics = compareTactics();
    console.log(`Tactics: ${JSON.stringify(tactics)}`);
    const filter = option('--case');
    const mirrored = process.argv.includes('--mirror');
    const results = [];
    for (const scenario of scenarios.filter(item => !filter || filter.split(',').includes(item.name))) {
        for (const updatedSide of ['player1', 'player2']) {
            const result = runComparisonMatch(mirrored ? { ...scenario, right: scenario.left, rightBench: scenario.leftBench } : scenario, updatedSide);
            results.push(result);
            console.log(JSON.stringify(result));
        }
    }
    const report = { baselineRef, baselineFile, baselineHookFile, baselineHash: createHash('sha256').update(oldSource).digest('hex'),
        currentHash: createHash('sha256').update(currentSource).digest('hex'),
        seed: 20261023, initializeFirstTurn: true, tactics, matches: results.length,
        updatedWins: results.filter(row => row.updatedWon).length,
        finished: results.filter(row => row.finished).length, results };
    mkdirSync('reports/ai-optimization', { recursive: true });
    const file = path.join('reports/ai-optimization', `${baselineFile ? 'new-heroes' : 'policy'}-comparison${filter ? `-${filter.replaceAll(',', '-')}` : ''}${mirrored ? '-mirror' : ''}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`Report: ${file} | new AI ${report.updatedWins}/${report.matches} wins | finished ${report.finished}/${report.matches}`);
    if (report.finished !== report.matches) process.exitCode = 1;
} finally {
    delete globalThis.__AI_BENCHMARK_POLICY__;
    await server.close();
}
