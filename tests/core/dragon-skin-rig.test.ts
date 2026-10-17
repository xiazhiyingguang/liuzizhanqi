import { describe, expect, it } from 'vitest';
import {
    DRAGON_HEAD_X, DRAGON_HEAD_Y, DRAGON_RIG_HEIGHT, DRAGON_RIG_WIDTH,
    DRAGON_TEXTURE_ANCHOR_X, dragonSpinePoint, type DragonRigMode,
} from '../../src/core/dragon-skin-rig';

describe('蓝白游龙的脊线变形', () => {
    it.each<DragonRigMode>(['orbit', 'sweep', 'dash', 'idle'])('%s: 游动时龙首始终压在命中轨迹上', mode => {
        for (const time of [0, .11, .27, .53, 1, 3, 12]) {
            const head = dragonSpinePoint(DRAGON_TEXTURE_ANCHOR_X, time, mode);
            expect(head.x).toBeCloseTo(DRAGON_HEAD_X, 6);
            expect(head.y).toBeCloseTo(DRAGON_HEAD_Y, 6);
        }
    });

    it('头、颈、长尾不是整块平移，尾部有更大的错相摆动', () => {
        const motion = (u: number) => {
            const a = dragonSpinePoint(u, 0, 'orbit'), b = dragonSpinePoint(u, .32, 'orbit');
            return Math.hypot(a.x - b.x, a.y - b.y);
        };
        expect(motion(.05)).toBeGreaterThan(8);
        expect(motion(.05)).toBeGreaterThan(motion(.85) * 2);
        expect(motion(DRAGON_TEXTURE_ANCHOR_X)).toBeLessThan(.0001);
    });

    it('盘旋时身体沿弧线跟随龙首，冲刺时顺着前进方向舒展', () => {
        const orbit = dragonSpinePoint(.1, 0, 'orbit');
        const dash = dragonSpinePoint(.1, 0, 'dash');
        expect(orbit.y - dash.y).toBeGreaterThan(250);
        expect(orbit.x).toBeGreaterThan(dash.x);
    });

    it.each<DragonRigMode>(['orbit', 'sweep', 'dash', 'idle'])('%s: 完整周期内脊线连续、不会抖跳或飞出画框', mode => {
        for (let t = 0; t <= 4; t += .1) {
            for (let u = 0; u <= 1; u += .025) {
                const p = dragonSpinePoint(u, t, mode);
                const next = dragonSpinePoint(u, t + .001, mode);
                expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(DRAGON_RIG_WIDTH);
                expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThan(DRAGON_RIG_HEIGHT);
                expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeLessThan(2);
            }
        }
    });
});
