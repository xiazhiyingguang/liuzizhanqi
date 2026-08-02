import { Hero, Effect, GameState } from '../types/game';

/**
 * 效果管理系统
 */
export class EffectManager {
    /**
     * 添加效果到英雄
     */
    static addEffect(hero: Hero, effect: Omit<Effect, 'id'>): void {
        const newEffect: Effect = {
            ...effect,
            id: `effect-${Date.now()}-${Math.random()}`
        };

        // 检查是否是可叠加的效果
        const existingEffect = hero.effects.find(
            e => e.name === effect.name && e.sourceHeroId === effect.sourceHeroId
        );

        if (existingEffect && effect.stackCount !== undefined) {
            // 叠加层数
            existingEffect.stackCount = (existingEffect.stackCount || 1) + (effect.stackCount || 1);
            // 刷新持续时间
            existingEffect.duration = effect.duration;
        } else {
            // 添加新效果
            hero.effects.push(newEffect);
        }
    }

    /**
     * 移除效果
     */
    static removeEffect(hero: Hero, effectId: string): void {
        hero.effects = hero.effects.filter(e => e.id !== effectId);
    }

    /**
     * 根据名称移除效果
     */
    static removeEffectByName(hero: Hero, effectName: string): void {
        hero.effects = hero.effects.filter(e => e.name !== effectName);
    }

    /**
     * 检查英雄是否有某个效果
     */
    static hasEffect(hero: Hero, effectName: string): boolean {
        return hero.effects.some(e => e.name === effectName);
    }

    /**
     * 获取效果
     */
    static getEffect(hero: Hero, effectName: string): Effect | undefined {
        return hero.effects.find(e => e.name === effectName);
    }

    /**
     * 检查英雄是否被眩晕
     */
    static isStunned(hero: Hero): boolean {
        return hero.effects.some(e => e.type === 'stun' && e.duration > 0);
    }

    /**
     * 更新效果持续时间（每回合结束时调用）
     */
    static updateEffectDurations(gameState: GameState): void {
        const allHeroes = [...gameState.player1Heroes, ...gameState.player2Heroes];

        for (const hero of allHeroes) {
            hero.effects = hero.effects.filter(effect => {
                // 永久效果不减少持续时间
                if (effect.duration === -1) return true;

                // 减少持续时间
                effect.duration--;

                // 持续时间为0的效果移除
                if (effect.duration <= 0) {
                    this.onEffectExpire(hero, effect, gameState);
                    return false;
                }

                return true;
            });
        }
    }

    /**
     * 效果过期时的处理
     */
    private static onEffectExpire(hero: Hero, effect: Effect, gameState: GameState): void {
        void hero;
        void effect;
        void gameState;
        // 这里可以添加效果过期时的特殊逻辑
        // 例如某些效果结束时触发额外效果
    }

    /**
     * 添加护盾
     */
    static addShield(hero: Hero, amount: number): void {
        hero.shield += amount;
    }

    /**
     * 添加冰甲：受到的伤害降低20%，攻击者获得1层寒天。
     * 效果不可叠加，重复获得时不刷新持续时间。
     * @returns 是否新获得（已有冰甲时返回 false）
     */
    static addIceArmor(hero: Hero, sourceHeroId: string): boolean {
        if (hero.effects.some(effect => effect.name === '冰甲')) return false;
        hero.effects.push({
            id: `effect-${Date.now()}-${Math.random()}`,
            type: 'buff',
            name: '冰甲',
            duration: 2,
            value: 0.2,
            sourceHeroId,
            description: '受到的伤害降低20%；攻击者获得1层寒天'
        });
        return true;
    }

    /**
     * 设置护盾
     */
    static setShield(hero: Hero, amount: number): void {
        hero.shield = amount;
    }

    /**
     * 增加计数器
     */
    static addCounter(hero: Hero, counterName: string, amount: number = 1): void {
        if (!hero.counters[counterName]) {
            hero.counters[counterName] = 0;
        }
        hero.counters[counterName] += amount;
    }

    /**
     * 设置计数器
     */
    static setCounter(hero: Hero, counterName: string, value: number): void {
        hero.counters[counterName] = value;
    }

    /**
     * 获取计数器值
     */
    static getCounter(hero: Hero, counterName: string): number {
        return hero.counters[counterName] || 0;
    }

    /**
     * 消耗计数器
     */
    static consumeCounter(hero: Hero, counterName: string, amount: number = 1): boolean {
        const current = this.getCounter(hero, counterName);
        if (current >= amount) {
            hero.counters[counterName] = current - amount;
            return true;
        }
        return false;
    }

    /**
     * 清除所有效果
     */
    static clearAllEffects(hero: Hero): void {
        hero.effects = [];
    }

    /**
     * 清除特定类型的效果
     */
    static clearEffectsByType(hero: Hero, type: Effect['type']): void {
        hero.effects = hero.effects.filter(e => e.type !== type);
    }

    /**
     * 复制效果到另一个英雄
     */
    static copyEffect(source: Hero, target: Hero, effectName: string): void {
        const effect = this.getEffect(source, effectName);
        if (effect) {
            this.addEffect(target, {
                type: effect.type,
                name: effect.name,
                duration: effect.duration,
                value: effect.value,
                stackCount: effect.stackCount,
                linkId: effect.linkId,
                sourceHeroId: effect.sourceHeroId,
                description: effect.description
            });
        }
    }

    /**
     * 转移效果
     */
    static transferEffect(source: Hero, target: Hero, effectName: string): void {
        const effectIndex = source.effects.findIndex(e => e.name === effectName);
        if (effectIndex !== -1) {
            const effect = source.effects[effectIndex];
            source.effects.splice(effectIndex, 1);
            target.effects.push(effect);
        }
    }
}
