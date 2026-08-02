import { useGameStore } from '../../store/game-store';
import './main-menu.css';

type MenuChoiceProps = {
    title: string;
    subtitle: string;
    index: string;
    tone?: 'primary' | 'secondary' | 'quiet';
    disabled?: boolean;
    onClick?: () => void;
};

function MenuChoice({
    title,
    subtitle,
    index,
    tone = 'secondary',
    disabled = false,
    onClick,
}: MenuChoiceProps) {
    return (
        <button
            type="button"
            className={`main-menu-choice main-menu-choice-${tone}`}
            disabled={disabled}
            onClick={onClick}
        >
            <span className="main-menu-choice-index">{index}</span>
            <span className="main-menu-choice-copy">
                <span className="main-menu-choice-title">{title}</span>
                <span className="main-menu-choice-subtitle">{subtitle}</span>
            </span>
            <span className="main-menu-choice-arrow" aria-hidden="true">›</span>
        </button>
    );
}

export default function MainMenu() {
    const initGame = useGameStore(state => state.initGame);

    const handleAiGame = () => {
        useGameStore.setState({
            isOnlineMode: false,
            isAiMode: true,
            aiPlayer: 'player2',
            aiDifficulty: 'master'
        });
        initGame();
    };

    const handleLocalGame = () => {
        useGameStore.setState({
            isOnlineMode: false,
            isAiMode: false,
            aiPlayer: undefined,
            aiDifficulty: undefined
        });
        initGame();
    };

    const handleOnlineGame = () => {
        useGameStore.setState({
            phase: 'online-menu',
            isAiMode: false,
            aiPlayer: undefined,
            aiDifficulty: undefined
        });
    };

    return (
        <main className="main-menu-stage">
            <div className="main-menu-paper-grain" aria-hidden="true" />
            <div className="main-menu-sun" aria-hidden="true" />

            <svg
                className="main-menu-landscape main-menu-landscape-far"
                viewBox="0 0 1440 560"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <path d="M0 426 C95 387 139 402 205 344 C261 294 296 326 351 279 C397 241 449 278 497 251 C550 221 592 243 651 198 C693 166 737 185 779 228 C827 275 865 279 918 253 C987 219 1020 266 1080 300 C1148 339 1214 307 1270 356 C1327 406 1377 391 1440 367 L1440 560 L0 560 Z" />
                <path d="M83 426 C166 378 217 393 281 345 C340 300 376 304 437 263 C499 221 552 248 606 216" />
                <path d="M777 229 C835 253 875 234 927 207 C976 182 1022 220 1067 260 C1123 310 1174 293 1234 329" />
            </svg>

            <svg
                className="main-menu-landscape main-menu-landscape-mid"
                viewBox="0 0 1440 440"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <path d="M0 313 C72 282 134 306 208 265 C279 225 327 259 394 232 C472 200 519 241 594 264 C680 291 735 251 803 221 C883 186 938 247 1006 274 C1082 304 1126 250 1197 275 C1276 303 1348 275 1440 239 L1440 440 L0 440 Z" />
                <path d="M0 351 C91 327 164 349 241 316 C323 280 390 321 470 299 C560 274 617 320 708 306 C798 292 870 315 950 296 C1042 274 1118 325 1200 312 C1292 297 1360 314 1440 289" />
            </svg>

            <svg
                className="main-menu-landscape main-menu-landscape-near"
                viewBox="0 0 1440 300"
                preserveAspectRatio="none"
                aria-hidden="true"
            >
                <path d="M0 204 C75 170 144 219 226 183 C300 151 365 198 443 179 C526 159 603 219 690 196 C772 175 836 204 914 184 C993 164 1063 218 1145 191 C1241 160 1328 194 1440 149 L1440 300 L0 300 Z" />
            </svg>

            <div className="main-menu-mist main-menu-mist-one" aria-hidden="true" />
            <div className="main-menu-mist main-menu-mist-two" aria-hidden="true" />

            <svg className="main-menu-cloud main-menu-cloud-left" viewBox="0 0 240 72" fill="none" aria-hidden="true">
                <path d="M4 52 C32 52 38 29 65 35 C83 10 117 18 122 38 C144 25 172 32 177 49 C198 39 219 42 236 53" />
                <path d="M29 61 C66 61 85 49 112 53 C144 58 168 46 207 57" />
            </svg>
            <svg className="main-menu-cloud main-menu-cloud-right" viewBox="0 0 210 64" fill="none" aria-hidden="true">
                <path d="M3 45 C27 45 34 27 57 32 C75 11 103 17 108 36 C132 23 153 31 160 45 C179 36 195 41 207 48" />
                <path d="M23 55 C54 55 78 44 102 49 C132 54 154 43 191 53" />
            </svg>

            <svg className="main-menu-bamboo main-menu-bamboo-left" viewBox="0 0 260 620" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeLinecap="round">
                    <path d="M53 624 C70 497 83 371 74 218 C71 157 61 92 49 22" strokeWidth="8" />
                    <path d="M82 617 C115 488 129 358 129 180 C128 119 120 63 113 9" strokeWidth="5" />
                    <path d="M43 466 L111 387 M75 366 L24 293 M112 321 L181 232 M128 208 L193 137 M72 252 L20 190 M115 109 L172 52" strokeWidth="3" />
                    <path d="M112 387 C83 367 66 370 48 392 C76 403 95 401 112 387 Z" />
                    <path d="M109 389 C131 361 153 357 180 367 C161 390 138 398 109 389 Z" />
                    <path d="M24 293 C43 265 64 261 91 271 C72 293 51 301 24 293 Z" />
                    <path d="M181 232 C154 211 135 213 117 234 C140 245 160 244 181 232 Z" />
                    <path d="M193 137 C166 118 145 120 128 143 C151 152 173 151 193 137 Z" />
                    <path d="M20 190 C37 163 57 157 83 166 C67 189 46 198 20 190 Z" />
                    <path d="M172 52 C146 34 126 38 110 59 C133 68 153 65 172 52 Z" />
                </g>
            </svg>

            <svg className="main-menu-cranes" viewBox="0 0 180 90" fill="none" aria-hidden="true">
                <path d="M8 47 Q28 25 49 44 Q66 25 84 36" />
                <path d="M94 24 Q112 8 130 25 Q145 11 166 21" />
            </svg>

            <div className="main-menu-side-inscription" aria-hidden="true">
                <span>纵横六道</span>
                <span>落子成局</span>
                <i>弈</i>
            </div>

            <section className="main-menu-center">
                <div className="main-menu-title-block">
                    <div className="main-menu-kicker">
                        <span />
                        <p>东方幻想 · 六路争锋</p>
                        <span />
                    </div>
                    <div className="main-menu-title-row">
                        <h1>六子战棋</h1>
                        <span className="main-menu-title-seal">弈</span>
                    </div>
                    <p className="main-menu-tagline">一方棋枰藏万象，六子落处定乾坤</p>
                    <svg className="main-menu-brush-divider" viewBox="0 0 420 20" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M2 11 C72 7 126 13 190 9 C251 5 310 13 418 8" />
                        <path d="M89 15 C154 12 231 17 327 12" />
                    </svg>
                </div>

                <nav className="main-menu-actions" aria-label="主菜单">
                    <MenuChoice
                        index="壹"
                        title="人机对战"
                        subtitle="宗师电脑 · 智谋博弈"
                        tone="primary"
                        onClick={handleAiGame}
                    />
                    <MenuChoice
                        index="贰"
                        title="本地双人"
                        subtitle="同屏对弈 · 排兵布阵"
                        onClick={handleLocalGame}
                    />
                    <MenuChoice
                        index="叁"
                        title="联机对战"
                        subtitle="远方来客 · 同局争锋"
                        onClick={handleOnlineGame}
                    />
                    <MenuChoice
                        index="肆"
                        title="英雄图鉴"
                        subtitle="群英入卷 · 见招知势"
                        tone="quiet"
                        onClick={() => useGameStore.setState({ phase: 'hero-codex' })}
                    />
                    <MenuChoice
                        index="伍"
                        title="设置"
                        subtitle="敬请期待"
                        tone="quiet"
                        disabled
                    />
                </nav>

                <footer className="main-menu-footer">
                    <span className="main-menu-footer-line" />
                    <span className="main-menu-mini-seal">六</span>
                    <span>水墨策略对弈</span>
                    <b>·</b>
                    <span>VERSION 2.0.0</span>
                    <span className="main-menu-footer-line" />
                </footer>
            </section>
        </main>
    );
}
