import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILL_FX_PROFILES } from '../../src/core/skill-fx';

/**
 * 联机特效的传递口径：行动方的特效请求必须锚定在"这一次动作新写的战斗日志"上，
 * 对端才能按新日志差分重建画面与音效（commitOnlineTriggeredFx）。
 *
 * 少了 logIds 或少了 gameState 第二参数，请求就只在行动方本地生效：
 * 天威、被动追加段、延迟段这些"不在施法那一拍"的特效，对手全程看不到——
 * 玩家表现为"联机时对面有时没特效"。这条源码级不变式比逐个用例更耐用：
 * 新加特效时漏写锚点，这里直接红。
 */
const SCANNED_FILES = [
    'src/data/extended-skills.ts',
    'src/data/skills.ts',
    'src/core/damage-calculator.ts',
    'src/core/game-engine.ts',
    'src/core/mechanism-fx.ts',
    'src/core/water-marsh.ts',
    'src/store/game-store.ts',
];

function readCallBlocks(filePath: string) {
    const text = readFileSync(resolve(filePath), 'utf8');
    const blocks: Array<{ line: number; body: string }> = [];
    const pattern = /(requestSkillFx|publishSkillFxAnchor)\s*\(/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        // 跳过函数定义本身
        const head = text.slice(Math.max(0, match.index - 20), match.index);
        if (/function\s*$/.test(head)) continue;
        const open = match.index + match[0].length;
        let depth = 1;
        let index = open;
        while (index < text.length && depth > 0) {
            if ('([{'.includes(text[index])) depth += 1;
            else if (')]}'.includes(text[index])) depth -= 1;
            index += 1;
        }
        blocks.push({
            line: text.slice(0, match.index).split('\n').length,
            body: text.slice(open, index - 1),
        });
    }
    // 只登记"现场构造请求对象"的调用；把整个 request 变量原样转发的内部调用没有 skillId，跳过
    return blocks.filter(block => block.body.includes('skillId'));
}

describe('联机特效锚点不变式', () => {
    it('每个 requestSkillFx 调用都带 logIds 锚点与 gameState 参数', () => {
        const offenders: string[] = [];
        let total = 0;
        for (const file of SCANNED_FILES) {
            for (const block of readCallBlocks(file)) {
                total += 1;
                const missing: string[] = [];
                if (!block.body.includes('logIds')) missing.push('缺 logIds');
                // 第二参数：request 对象闭合之后还剩实参
                let depth = 0;
                let hasSecondArg = false;
                for (let index = 0; index < block.body.length; index += 1) {
                    const char = block.body[index];
                    if ('([{'.includes(char)) depth += 1;
                    else if (')]}'.includes(char)) depth -= 1;
                    else if (depth === 0 && char === ',') {
                        hasSecondArg = true;
                        break;
                    }
                }
                if (!hasSecondArg) missing.push('缺 gameState 参数');
                if (missing.length) offenders.push(`  ${file}:${block.line}  ${missing.join('、')}`);
            }
        }
        expect(total, '扫描到调用点，说明路径没读错').toBeGreaterThan(10);
        expect(offenders, `以下特效请求对端收不到：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('锚定的 skillId 必须在特效档案表里，否则对端会静默跳过', () => {
        const unregistered: string[] = [];
        for (const file of SCANNED_FILES) {
            for (const block of readCallBlocks(file)) {
                const literal = /skillId:\s*'([^']+)'/.exec(block.body);
                if (!literal) continue;
                if (!SKILL_FX_PROFILES[literal[1]]) {
                    unregistered.push(`  ${file}:${block.line}  skillId=${literal[1]}`);
                }
            }
        }
        expect(unregistered, `这些 skillId 没有特效档案，对端拿得到也不会播：\n${unregistered.join('\n')}`).toEqual([]);
    });
});
