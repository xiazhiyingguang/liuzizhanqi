import { useGameStore } from '../../store/game-store';
import { useEffect, useMemo, useRef } from 'react';
import { tokenizeBattleLogContent } from '../../core/battle-presentation';
import BattleGlossaryTerm from './BattleGlossaryTerm';

export default function BattleLog() {
    const battleLog = useGameStore(state => state.battleLog);
    const player1Heroes = useGameStore(state => state.player1Heroes);
    const player2Heroes = useGameStore(state => state.player2Heroes);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const heroReferences = useMemo(() => [
        ...player1Heroes.map(hero => ({ name: hero.name, owner: hero.owner })),
        ...player2Heroes.map(hero => ({ name: hero.name, owner: hero.owner }))
    ], [player1Heroes, player2Heroes]);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [battleLog]);

    const getLogPrefix = (type: string) => {
        switch (type) {
            case 'move': return '行';
            case 'skill': return '技';
            case 'damage': return '伤';
            case 'heal': return '愈';
            case 'kill': return '殁';
            case 'tianwei': return '威';
            case 'effect': return '效';
            case 'system': return '令';
            default: return '·';
        }
    };

    return (
        <div className="ink-panel p-4 h-full flex flex-col overflow-hidden">
            <h3 className="font-title text-base text-ink mb-3 flex items-center gap-2.5 flex-shrink-0">
                <span className="w-1 h-5 rounded-full inline-block bg-ink/10" />
                战报
            </h3>

            <div
                ref={logContainerRef}
                className="flex-1 overflow-y-auto space-y-0.5 min-h-0 light-scrollbar"
                style={{ scrollBehavior: 'auto' }}
            >
                {battleLog.length === 0 ? (
                    <p className="text-ink-faint text-sm font-body text-center py-6">
                        战局未启
                    </p>
                ) : (
                    battleLog.map((log) => {
                        const tokens = tokenizeBattleLogContent(log.message, heroReferences);
                        return (
                            <div
                                key={log.id}
                                className="text-[13px] leading-relaxed py-1.5 px-2.5 rounded-md font-body text-gold-dark
                                    hover:bg-gold/5 transition-colors"
                            >
                                <span className="inline-block w-4 text-center text-[10px] font-title opacity-50 mr-1.5">
                                    {getLogPrefix(log.type)}
                                </span>
                                {tokens.map((token, index) => {
                                    if (token.owner) {
                                        return (
                                            <span
                                                key={`${log.id}-${index}`}
                                                className="font-semibold text-ink"
                                            >
                                                {token.text}
                                            </span>
                                        );
                                    }

                                    if (token.glossary) {
                                        return (
                                            <BattleGlossaryTerm
                                                key={`${log.id}-${index}-${token.glossary.term}`}
                                                glossary={token.glossary}
                                            >
                                                {token.text}
                                            </BattleGlossaryTerm>
                                        );
                                    }

                                    return token.text;
                                })}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
