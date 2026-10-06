/**
 * 经典模式 vs 标准模式的角色强度对比。
 *
 * 两次跑批用同一个 seed，赛程是"同一份配对表按顺序取前 N 对"，
 * 所以**局号相同的两局，对阵双方与那 5 名共享候补完全一致** —— 于是可以按局号配对，
 * 对每名英雄做 McNemar 配对检验（只数"标准输→经典赢"和"标准赢→经典输"的翻转局），
 * 这比"两个独立胜率相减"灵敏得多，也不会被候补抽卡的方差吃掉。
 *
 * 用法：npx vite-node scripts/balance/strength-compare.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getHeroInfo } from '../../src/data/heroes';

interface GameRecord {
    index: number;
    heroA: string;
    heroB: string;
    result: 'A' | 'B' | 'D';
    error?: string;
    rounds: number;
    stats: Record<string, { damage: number; kills: number; survived: boolean }>;
}

interface ShardFile { records: GameRecord[] }

const DIR = resolve('reports/balance/strength');

function loadShards(prefix: string): Map<number, GameRecord> {
    const byIndex = new Map<number, GameRecord>();
    for (const file of readdirSync(DIR)) {
        if (!file.startsWith(`shard-${prefix}-`) || !file.endsWith('.json')) continue;
        const parsed = JSON.parse(readFileSync(resolve(DIR, file), 'utf8')) as ShardFile;
        for (const record of parsed.records ?? []) {
            if (!record.error) byIndex.set(record.index, record);
        }
    }
    return byIndex;
}

/** 旧的标准模式分片文件名没有 label 前缀（shard-0.json） */
function loadLegacyShards(): Map<number, GameRecord> {
    const byIndex = new Map<number, GameRecord>();
    for (const file of readdirSync(DIR)) {
        if (!/^shard-\d+\.json$/.test(file)) continue;
        const parsed = JSON.parse(readFileSync(resolve(DIR, file), 'utf8')) as ShardFile;
        for (const record of parsed.records ?? []) {
            if (!record.error) byIndex.set(record.index, record);
        }
    }
    return byIndex;
}

/** 每名英雄：局号 → 该局的得分（1 胜 / 0.5 平 / 0 负）与个人战果 */
interface HeroGame { score: number; damage: number; kills: number; survived: boolean }

function collect(records: Map<number, GameRecord>): Map<string, Map<number, HeroGame>> {
    const byHero = new Map<string, Map<number, HeroGame>>();
    for (const [index, record] of records) {
        for (const heroId of [record.heroA, record.heroB]) {
            const score = record.result === 'D' ? 0.5 : (record.result === 'A') === (heroId === record.heroA) ? 1 : 0;
            const stats = record.stats?.[heroId];
            const games = byHero.get(heroId) ?? new Map<number, HeroGame>();
            games.set(index, {
                score,
                damage: stats?.damage ?? 0,
                kills: stats?.kills ?? 0,
                survived: !!stats?.survived,
            });
            byHero.set(heroId, games);
        }
    }
    return byHero;
}

/** McNemar 精确双侧 p（二项 n1+n2 下 min(n1,n2) 的双尾概率），小样本不用正态近似 */
function mcNemarExact(b: number, c: number): number {
    const n = b + c;
    if (n === 0) return 1;
    const k = Math.min(b, c);
    let tail = 0;
    let coefficient = 1;                       // C(n, 0)
    for (let i = 0; i <= k; i++) {
        tail += coefficient / (2 ** n);
        coefficient = coefficient * (n - i) / (i + 1);
    }
    return Math.min(1, 2 * tail);
}

function mean(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const classic = collect(loadShards('classic'));
const standard = collect(existsSync(resolve(DIR, 'shard-0.json')) ? loadLegacyShards() : loadShards('standard'));

interface Row {
    hero: string;
    name: string;
    paired: number;
    standardScore: number;
    classicScore: number;
    delta: number;
    flipsUp: number;
    flipsDown: number;
    p: number;
    standardRounds: number;
    classicRounds: number;
    damageUp: number;
    survivedUp: number;
}

const rows: Row[] = [];
for (const [hero, classicGames] of classic) {
    const standardGames = standard.get(hero);
    if (!standardGames) continue;
    const shared = [...classicGames.keys()].filter(index => standardGames.has(index));
    if (shared.length === 0) continue;

    let flipsUp = 0;
    let flipsDown = 0;
    const standardScores: number[] = [];
    const classicScores: number[] = [];
    let damageDeltaSum = 0;
    let survivedDeltaSum = 0;
    for (const index of shared) {
        const before = standardGames.get(index)!;
        const after = classicGames.get(index)!;
        standardScores.push(before.score);
        classicScores.push(after.score);
        if (after.score > before.score) flipsUp++;
        else if (after.score < before.score) flipsDown++;
        damageDeltaSum += after.damage - before.damage;
        survivedDeltaSum += (after.survived ? 1 : 0) - (before.survived ? 1 : 0);
    }
    const standardScore = mean(standardScores);
    const classicScore = mean(classicScores);
    rows.push({
        hero,
        name: getHeroInfo(hero)?.name ?? hero,
        paired: shared.length,
        standardScore,
        classicScore,
        delta: classicScore - standardScore,
        flipsUp,
        flipsDown,
        p: mcNemarExact(flipsUp, flipsDown),
        standardRounds: 0,
        classicRounds: 0,
        damageUp: damageDeltaSum / shared.length,
        survivedUp: survivedDeltaSum / shared.length,
    });
}

rows.sort((left, right) => right.delta - left.delta);

const totalPaired = rows.reduce((sum, row) => sum + row.paired, 0);
console.log(`\n经典 vs 标准：${rows.length} 名英雄有同题配对样本，配对样本合计 ${totalPaired} 人次`);
console.log('得分率 = 胜1/平0.5/负0；Δ = 经典 − 标准；p = McNemar 精确双侧（只数翻转局）\n');
console.log(`${'英雄'.padEnd(12)}  配对  标准→经典      Δ      p     伤害Δ  存活Δ`);
for (const row of rows) {
    const nameWidth = [...row.name].reduce((count, char) => count + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
    const flag = row.p < 0.01 ? '***' : row.p < 0.05 ? ' *' : '  ';
    console.log(
        `${row.name}${' '.repeat(Math.max(1, 13 - nameWidth))}` +
        `${String(row.paired).padStart(4)}` +
        `${`${(row.standardScore * 100).toFixed(0)}%→${(row.classicScore * 100).toFixed(0)}%`.padStart(12)}` +
        `${`${row.delta >= 0 ? '+' : ''}${(row.delta * 100).toFixed(1)}`.padStart(8)}` +
        `${row.p.toFixed(3).padStart(8)} ${flag}` +
        `${`${row.damageUp >= 0 ? '+' : ''}${row.damageUp.toFixed(1)}`.padStart(9)}` +
        `${`${row.survivedUp >= 0 ? '+' : ''}${(row.survivedUp * 100).toFixed(0)}%`.padStart(8)}`,
    );
}
const significant = rows.filter(row => row.p < 0.05);
console.log(`\n显著（p<0.05）：${significant.length} 名 —— ` +
    (significant.map(row => `${row.name}${row.delta >= 0 ? '↑' : '↓'}`).join('、') || '无'));
