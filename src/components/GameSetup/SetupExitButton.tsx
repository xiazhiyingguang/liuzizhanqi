import { useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { disconnectFromServer, leaveRoom } from '../../services/socket-service';
import InkButton from '../ui/InkButton';

interface SetupExitButtonProps {
    stage: '点将' | '布阵';
}

interface SetupExitButtonViewProps extends SetupExitButtonProps {
    isOnlineMode: boolean;
}

export function SetupExitButtonView({ stage, isOnlineMode }: SetupExitButtonViewProps) {
    const [showConfirm, setShowConfirm] = useState(false);

    const leaveSetup = async () => {
        const { onlineRoomId, resetGame } = useGameStore.getState();
        if (isOnlineMode) {
            if (onlineRoomId) await leaveRoom(onlineRoomId);
            disconnectFromServer();
        }
        resetGame();
    };

    return (
        <>
            <div className="absolute left-4 top-4 z-30 sm:left-6 sm:top-6">
                <InkButton
                    data-testid={`setup-exit-${stage}`}
                    variant="ghost"
                    size="sm"
                    className="border-ink/10 bg-rice-light/70 shadow-sm backdrop-blur-sm hover:bg-rice-light"
                    onClick={() => setShowConfirm(true)}
                    aria-label={isOnlineMode ? `退出${stage}` : '返回主界面'}
                >
                    <span aria-hidden="true" className="mr-1.5 text-base">←</span>
                    <span className="hidden sm:inline">{isOnlineMode ? `退出${stage}` : '返回主界面'}</span>
                    <span className="sm:hidden">返回</span>
                </InkButton>
            </div>

            {showConfirm && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="setup-exit-title"
                >
                    <button
                        type="button"
                        data-sfx="cancel"
                        className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
                        aria-label="取消返回"
                        onClick={() => setShowConfirm(false)}
                    />
                    <div className="ink-card relative z-10 w-[min(420px,calc(100%-32px))] p-8 text-center animate-fade-up">
                        <span className="ink-seal-sm mb-4 inline-flex">退</span>
                        <h2 id="setup-exit-title" className="font-title text-2xl text-ink">
                            {isOnlineMode ? `确认退出${stage}？` : '确认返回主界面？'}
                        </h2>
                        <p className="mt-3 text-sm leading-6 text-ink-faint">
                            当前{stage}进度不会保留。
                            {isOnlineMode && ' 退出后将同时离开当前联机房间。'}
                        </p>
                        <div className="mt-7 flex justify-center gap-3">
                            <InkButton variant="ghost" sfx="cancel" onClick={() => setShowConfirm(false)}>
                                继续{stage}
                            </InkButton>
                            <InkButton data-testid="confirm-setup-exit" variant="primary" sfx="primary" onClick={leaveSetup}>
                                确认返回
                            </InkButton>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function SetupExitButton({ stage }: SetupExitButtonProps) {
    const isOnlineMode = useGameStore(state => Boolean(state.isOnlineMode));
    return <SetupExitButtonView stage={stage} isOnlineMode={isOnlineMode} />;
}
