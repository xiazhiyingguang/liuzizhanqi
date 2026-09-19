import type { ReactNode } from 'react';
import { resolveHeroTemplateId } from '../../data/hero-assets';

interface HeroIconProps {
    heroId: string;
    size?: number;
    className?: string;
}

/*
 * 每个英雄一个独特 SVG 图标，32x32 viewBox
 * 使用 currentColor 以便继承玩家颜色
 */

function MoranIcon() {
    // 墨阑 — 墨笔剑：斜向剑身 + 墨点飞溅
    return (
        <g>
            <line x1="6" y1="26" x2="26" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="22" y1="10" x2="26" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <line x1="8" y1="24" x2="5" y2="27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="28" cy="5" r="1.5" fill="currentColor" opacity="0.6" />
            <circle cx="26" cy="3" r="1" fill="currentColor" opacity="0.4" />
            <circle cx="30" cy="7" r="0.8" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function ZhenxiaoIcon() {
    // 震霄 — 雷电：闪电折线 + 小云朵
    return (
        <g>
            <polyline points="16,2 10,14 18,14 12,30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M4 8 Q6 5 9 7 Q11 4 14 7" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <path d="M20 5 Q22 2 25 4 Q27 2 29 5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="14" cy="14" r="1.5" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function WukongIcon() {
    // 孙悟空 — 金箍棒 + 王冠
    return (
        <g>
            <line x1="16" y1="12" x2="16" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M10 6 L13 2 L16 5 L19 2 L22 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="16" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="12" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </g>
    );
}

function NightowlIcon() {
    // 暗影猎手·夜枭 — 猫头鹰：大眼 + 翅膀
    return (
        <g>
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="20" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="20" cy="12" r="1.5" fill="currentColor" />
            <path d="M6 18 Q10 14 16 18 Q22 14 26 18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <line x1="16" y1="16" x2="16" y2="20" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path d="M10 20 L16 28 L22 20" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" strokeLinecap="round" />
        </g>
    );
}

function LiuliIcon() {
    // 琉璃 — 玉盾：圆角盾 + 内部翡翠纹理
    return (
        <g>
            <path d="M16 3 L26 8 L26 18 Q26 26 16 30 Q6 26 6 18 L6 8 Z" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M16 8 L21 11 L21 18 Q21 23 16 26 Q11 23 11 18 L11 11 Z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function BaizeIcon() {
    // 白泽 — 神兽角：螺旋角 + 柔和弧线
    return (
        <g>
            <path d="M16 28 Q16 18 12 12 Q8 6 14 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M14 3 Q18 2 20 5 Q22 8 19 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M16 28 Q16 20 20 14 Q24 8 22 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
            <circle cx="16" cy="22" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="14" cy="17" r="1" fill="currentColor" opacity="0.3" />
        </g>
    );
}

function MirrorIcon() {
    // 镜 — 镜像：圆 + 对称分割线
    return (
        <g>
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
            <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
            <path d="M10 12 Q16 8 22 12" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" />
            <path d="M10 20 Q16 24 22 20" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
            <circle cx="13" cy="14" r="1" fill="currentColor" opacity="0.5" />
            <circle cx="19" cy="14" r="1" fill="currentColor" opacity="0.5" />
        </g>
    );
}

function MowenIcon() {
    // 莫问 — 时光剑：表盘 + 剑形指针
    return (
        <g>
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="1.5" fill="currentColor" />
            <line x1="16" y1="16" x2="16" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="16" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="16" y1="5" x2="16" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="16" y1="25" x2="16" y2="27" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="5" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <line x1="25" y1="16" x2="27" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
        </g>
    );
}

function GuyingIcon() {
    // 孤影 — 冰晶双剑：交叉剑 + 冰晶点
    return (
        <g>
            <line x1="8" y1="28" x2="24" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="28" x2="8" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="22" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="16" cy="16" r="2" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            <line x1="5" y1="10" x2="7" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="25" y1="10" x2="27" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="5" y1="22" x2="7" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <line x1="25" y1="22" x2="27" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        </g>
    );
}

/** 后补图标共用的描边容器：统一 currentColor 与圆角线帽，子元素按需覆盖粗细/填充 */
function Stroke({ children }: { children: ReactNode }) {
    return (
        <g
            stroke="currentColor"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {children}
        </g>
    );
}

/** 实心点缀（眼、星、墨点等） */
function Dot({ cx, cy, r, opacity = 0.5 }: { cx: number; cy: number; r: number; opacity?: number }) {
    return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" opacity={opacity} />;
}

function HuifengIcon() {
    // 回锋 — 回旋刃：折返的刃弧 + 层层回声（连击与锋鸣）
    return (
        <Stroke>
            <path d="M6 21 Q14 5 26 9" />
            <path d="M26 9 L21 8 M26 9 L26 14" strokeWidth={1.5} />
            <path d="M9 25 Q17 20 24 22" strokeWidth={1.5} opacity={0.55} />
            <path d="M13 28 Q18 25 23 26" strokeWidth={1} opacity={0.35} />
            <Dot cx={6.5} cy={22} r={1.6} opacity={0.6} />
        </Stroke>
    );
}

function XuanxiaoIcon() {
    // 玄霄 — 加持光环：光环 + 向下注能的光柱与再动箭头
    return (
        <Stroke>
            <circle cx={16} cy={12} r={7} strokeWidth={1.5} />
            <Dot cx={16} cy={12} r={2.2} opacity={0.55} />
            <path d="M16 19 V28" />
            <path d="M11 24 L16 29 L21 24" strokeWidth={1.5} />
            <path d="M5 8 Q8 4 11 6" strokeWidth={1} opacity={0.4} />
            <path d="M27 8 Q24 4 21 6" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function ChangliIcon() {
    // 长离 — 星羽：复生的火羽与四点暗夜星火
    return (
        <Stroke>
            <path d="M19 28 Q10 21 12 8 Q21 12 22 22" />
            <path d="M16 26 L14 10" strokeWidth={1.5} opacity={0.6} />
            <path d="M17 20 L21 19 M16 15 L19 13" strokeWidth={1} opacity={0.4} />
            <Dot cx={25} cy={6} r={1.8} opacity={0.7} />
            <Dot cx={28} cy={12} r={1.1} opacity={0.45} />
            <Dot cx={22} cy={4} r={0.9} opacity={0.35} />
        </Stroke>
    );
}

function HanjiangxueIcon() {
    // 寒江雪 — 六棱雪纹环抱冰晶核心
    return (
        <Stroke>
            <path d="M16 4 V28" strokeWidth={1.5} />
            <path d="M7 9 L25 23 M25 9 L7 23" strokeWidth={1.5} />
            <path d="M13 6.5 L16 9.5 L19 6.5 M13 25.5 L16 22.5 L19 25.5" strokeWidth={1} opacity={0.55} />
            <circle cx={16} cy={16} r={3} strokeWidth={1.5} />
            <Dot cx={16} cy={16} r={1.2} opacity={0.5} />
        </Stroke>
    );
}

function SkeletonkingIcon() {
    // 骸骨君王 — 王冠下的骷髅与亡灵之力
    return (
        <Stroke>
            <path d="M8 4 L11 7 L14 3 L16 7 L19 3 L21 7 L24 4" strokeWidth={1.5} opacity={0.7} />
            <path d="M10 17 Q10 9 16 9 Q22 9 22 17 Q22 21 19 22 L19 25 L13 25 L13 22 Q10 21 10 17 Z" />
            <Dot cx={13.5} cy={16} r={2} opacity={0.85} />
            <Dot cx={18.5} cy={16} r={2} opacity={0.85} />
            <path d="M13 28 H19" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function JetzmiIcon() {
    // 亡灵城主 — 城寨剪影与轮流盈亏的双月（暂时死亡换形态）
    return (
        <Stroke>
            <path d="M7 28 V15 H11 V11 H15 V15 H18 V11 H22 V28 Z" />
            <path d="M11.5 28 V22 Q14.5 20 17.5 22 V28" strokeWidth={1.5} opacity={0.6} />
            <path d="M27 4 Q23 6 23 10 Q23 14 27 16 Q26 10 27 4 Z" strokeWidth={1.5} opacity={0.65} />
            <Dot cx={14.5} cy={25} r={1.2} opacity={0.5} />
        </Stroke>
    );
}

function PipaIcon() {
    // 五弦琵琶 — 梨形音箱、琴弦与飞出的音符
    return (
        <Stroke>
            <path d="M16 28 Q9 28 9.5 21 Q10 15.5 16 14.5 Q22 15.5 22.5 21 Q23 28 16 28 Z" />
            <path d="M16 14.5 V5 M13.5 5 H18.5" strokeWidth={1.5} />
            <path d="M13 18 V25 M16 17.5 V25.5 M19 18 V25" strokeWidth={1} opacity={0.5} />
            <path d="M27.5 3.5 V8" strokeWidth={1.5} opacity={0.65} />
            <Dot cx={26} cy={9.5} r={1.6} opacity={0.65} />
        </Stroke>
    );
}

function BountyIcon() {
    // 赏金猎人 — 猎杀令准星与悬赏符印
    return (
        <Stroke>
            <circle cx={15} cy={14} r={8} />
            <path d="M15 2 V6 M15 22 V26 M3 14 H7 M23 14 H27" strokeWidth={1.5} />
            <Dot cx={15} cy={14} r={2} opacity={0.7} />
            <path d="M19 24 L27 22 L29 27 L21 29 Z" strokeWidth={1.5} opacity={0.55} />
        </Stroke>
    );
}

function YinyangIcon() {
    // 阴阳师 — 阴阳双鱼：阳线加持与阴线削弱
    return (
        <Stroke>
            <circle cx={16} cy={16} r={11} />
            <path d="M16 5 C22 9 22 13 16 16 C10 19 10 23 16 27" strokeWidth={1.5} />
            <Dot cx={16} cy={10.5} r={1.8} opacity={0.75} />
            <circle cx={16} cy={21.5} r={1.8} strokeWidth={1.2} />
        </Stroke>
    );
}

function SoulLampIcon() {
    // 缚魂灯 — 提灯与灯内魂火
    return (
        <Stroke>
            <path d="M12 5 Q16 2 20 5" strokeWidth={1.5} />
            <path d="M16 5 V9" strokeWidth={1.5} />
            <path d="M10 11 H22 L24 25 H8 Z" />
            <path d="M16 13 Q19 16 17.5 19 Q16 21.5 14.5 19 Q13 16.5 16 13 Z" strokeWidth={1.5} opacity={0.75} />
            <path d="M7 28 H25" strokeWidth={1.5} opacity={0.5} />
        </Stroke>
    );
}

function HeroXIcon() {
    // 英雄X — 震怒面具与 X 纹、增势护线
    return (
        <Stroke>
            <path d="M6 12 Q16 5 26 12 Q24 24 16 28 Q8 24 6 12 Z" />
            <path d="M11 13.5 L21 22.5 M21 13.5 L11 22.5" />
            <path d="M6.5 12 Q16 16.5 25.5 12" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function BardIcon() {
    // 吟游诗人 — 张臂的里拉琴与散开的和声波
    return (
        <Stroke>
            <path d="M8 26 Q4.5 14 12 6" />
            <path d="M24 26 Q27.5 14 20 6" />
            <path d="M8 26 H24" />
            <path d="M12 6 Q16 9.5 20 6" strokeWidth={1.5} />
            <path d="M13 10.5 V24 M16 12 V24.5 M19 10.5 V24" strokeWidth={1} opacity={0.5} />
            <path d="M28 12 Q30 16 28 20" strokeWidth={1.5} opacity={0.45} />
        </Stroke>
    );
}

function WitherLordIcon() {
    // 凋零之主 — 枯萎垂枝与飘落层数
    return (
        <Stroke>
            <path d="M16 28 V11" />
            <path d="M16 11 Q15 6 19 3" strokeWidth={1.5} />
            <path d="M16 15 Q10 14 8 9 Q14 8 16 12 Z" strokeWidth={1.5} opacity={0.75} />
            <path d="M16 20 Q22 19 24 14 Q18 13 16 17 Z" strokeWidth={1.5} opacity={0.75} />
            <Dot cx={10} cy={23} r={1.3} opacity={0.45} />
            <Dot cx={21} cy={26} r={1} opacity={0.3} />
        </Stroke>
    );
}

function TPaintingIcon() {
    // T型帛画 — T形画幅上的金乌日轮与玄龟水纹
    return (
        <Stroke>
            <path d="M8 5 H24 V10 H20 V27 H12 V10 H8 Z" />
            <circle cx={16} cy={15} r={3} strokeWidth={1.5} />
            <path d="M13 22 Q16 20.5 19 22 Q16 24.5 13 22 Z" strokeWidth={1} opacity={0.5} />
            <path d="M8 7.5 H24" strokeWidth={1} opacity={0.35} />
        </Stroke>
    );
}

function FeynmanIcon() {
    // 粒子加速者 — 三条电子轨道与中心粒子
    return (
        <Stroke>
            <ellipse cx={16} cy={16} rx={12} ry={5} strokeWidth={1.5} />
            <ellipse cx={16} cy={16} rx={12} ry={5} strokeWidth={1.5} transform="rotate(60 16 16)" opacity={0.7} />
            <ellipse cx={16} cy={16} rx={12} ry={5} strokeWidth={1.5} transform="rotate(-60 16 16)" opacity={0.7} />
            <Dot cx={16} cy={16} r={2.4} opacity={0.9} />
            <Dot cx={27} cy={10} r={1.3} opacity={0.5} />
        </Stroke>
    );
}

function WangcaiIcon() {
    // 旺财 — 方孔铜钱与来财宝气
    return (
        <Stroke>
            <circle cx={16} cy={14} r={9} />
            <rect x={12.5} y={10.5} width={7} height={7} strokeWidth={1.5} />
            <path d="M7 27 Q16 23 25 27" strokeWidth={1.5} opacity={0.5} />
            <path d="M24 24 Q27 22 29 25" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function SchrodingerIcon() {
    // 量子观测者 — 猫形轮廓下的叠加波纹
    return (
        <Stroke>
            <path d="M9 10 L10.5 4 L14 8" strokeWidth={1.5} />
            <path d="M23 10 L21.5 4 L18 8" strokeWidth={1.5} />
            <path d="M9 10 Q16 6 23 10 Q25 17 16 21 Q7 17 9 10 Z" />
            <Dot cx={13} cy={13} r={1.3} opacity={0.8} />
            <Dot cx={19} cy={13} r={1.3} opacity={0.8} />
            <path d="M5 26 Q8.5 22.5 12 26 Q15.5 29.5 19 26 Q22.5 22.5 26 26" strokeWidth={1.5} opacity={0.5} />
        </Stroke>
    );
}

function LilithIcon() {
    // 恐惧编织者 — 织出的蛛网与中央之眼
    return (
        <Stroke>
            <path d="M16 4 V28 M4 16 H28 M7.5 7.5 L24.5 24.5 M24.5 7.5 L7.5 24.5" strokeWidth={1} opacity={0.5} />
            <circle cx={16} cy={16} r={11} strokeWidth={1.5} />
            <circle cx={16} cy={16} r={6.5} strokeWidth={1} opacity={0.6} />
            <Dot cx={16} cy={16} r={2} opacity={0.8} />
        </Stroke>
    );
}

function LibaiIcon() {
    // 李太白 — 酒壶、斜佩的剑与脚印
    return (
        <Stroke>
            <path d="M10 27 Q6.5 21 10 16 Q12 12 16.5 12 Q21 12 23 16 Q26.5 21 23 27 Z" />
            <path d="M14 12 V8 H19 V12" strokeWidth={1.5} />
            <path d="M27 5 L21 13" strokeWidth={1.5} opacity={0.6} />
            <path d="M4 6 Q7 7 7.5 10" strokeWidth={1} opacity={0.4} />
            <Dot cx={5} cy={22} r={1.1} opacity={0.4} />
        </Stroke>
    );
}

function ZuizhendaoIcon() {
    // 醉枕刀 — 弯月形刀身与洒落的酒珠
    return (
        <Stroke>
            <path d="M5 22 Q16 29 27 18 Q19 20 12 15 Q7.5 12 5 22 Z" />
            <path d="M8 20 Q15 23 22 19" strokeWidth={1} opacity={0.4} />
            <Dot cx={9} cy={8} r={1.6} opacity={0.55} />
            <Dot cx={15.5} cy={5} r={1.2} opacity={0.4} />
            <Dot cx={22} cy={7} r={1} opacity={0.3} />
        </Stroke>
    );
}

function FeixueIcon() {
    // 绯雪 — 长冰锥与一点绯红
    return (
        <Stroke>
            <path d="M16 3 L20.5 12 L16 29 L11.5 12 Z" />
            <path d="M11.5 12 H20.5" strokeWidth={1.5} />
            <path d="M13 8 L16 6 L19 8" strokeWidth={1} opacity={0.4} />
            <Dot cx={25} cy={8} r={1.9} opacity={0.8} />
            <path d="M22 22 Q26 21 28 17" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function FenglingIcon() {
    // 风铃 — 悬铃、舌片与被风吹起的沙线
    return (
        <Stroke>
            <path d="M16 4 V7" strokeWidth={1.5} />
            <path d="M9 17 Q9 8 16 8 Q23 8 23 17 Z" />
            <path d="M9 17 H23" strokeWidth={1.5} />
            <circle cx={16} cy={21} r={2.2} strokeWidth={1.5} />
            <path d="M16 23.2 V26" strokeWidth={1} />
            <path d="M3 20 Q6 23 9 23 M29 20 Q26 23 23 23" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function DilanIcon() {
    // 帝兰 — 一根羽毛引来顺逆双向风
    return (
        <Stroke>
            <path d="M20 4 Q26 12 20 21 Q17 26 12 28 Q13 19 16 11 Q18 6 20 4 Z" />
            <path d="M13 27 L19 11" strokeWidth={1.5} opacity={0.6} />
            <path d="M3 11 H9 M6.5 8 L9.5 11 L6.5 14" strokeWidth={1.5} opacity={0.5} />
            <path d="M9 21 H3 M6 18 L3 21 L6 24" strokeWidth={1.5} opacity={0.5} />
        </Stroke>
    );
}

function NanfengIcon() {
    // 南风 — 贯穿整线的风道与末端旋涡
    return (
        <Stroke>
            <path d="M4 10 H20 Q25 10 25 14.5 Q25 19 20 19 H12" />
            <path d="M12 19 Q7 19 7 23.5 Q7 27.5 12 27.5 H19" strokeWidth={1.5} />
            <path d="M4 19 H11" strokeWidth={1} opacity={0.4} />
            <Dot cx={23} cy={25} r={1.5} opacity={0.5} />
        </Stroke>
    );
}

function ShangguanIcon() {
    // 上官婉儿 — 斜下的毛笔与落在棋盘的一子
    return (
        <Stroke>
            <path d="M21 4 L27 9 L14 20 L9 22 L11 17 Z" />
            <path d="M9 22 L6 27 L11.5 25" strokeWidth={1.5} />
            <path d="M18.5 6.5 L24.5 12" strokeWidth={1} opacity={0.4} />
            <circle cx={25} cy={22} r={3.5} strokeWidth={1.5} opacity={0.7} />
        </Stroke>
    );
}

function ChenyuanIcon() {
    // 沉渊·镇岳 — 镇岳双峰与其下的渊引涡流
    return (
        <Stroke>
            <path d="M3 16 L10 6 L14.5 12.5 L18.5 8 L28 16" />
            <path d="M14.5 12.5 L16 16" strokeWidth={1} opacity={0.4} />
            <path d="M7 21 Q16 29 25 21" strokeWidth={1.5} opacity={0.6} />
            <path d="M11 25.5 Q16 30 21 25.5" strokeWidth={1} opacity={0.35} />
        </Stroke>
    );
}

function DaiIcon() {
    // 时空旅者 — 沙漏与置换双箭
    return (
        <Stroke>
            <path d="M10 4 H21 M10 28 H21" />
            <path d="M11 4 Q11 12 15.5 16 Q20 12 20 4" strokeWidth={1.5} />
            <path d="M11 28 Q11 20 15.5 16 Q20 20 20 28" strokeWidth={1.5} />
            <Dot cx={15.5} cy={23} r={1.6} opacity={0.5} />
            <path d="M24 12 H29 M27 9.5 L29.5 12 L27 14.5 M29 19 H24 M26 16.5 L23.5 19 L26 21.5" strokeWidth={1} opacity={0.5} />
        </Stroke>
    );
}

function YoujunIcon() {
    // 游隼 — 掠击的尖翼与三道冲刺速度线
    return (
        <Stroke>
            <path d="M6 13 Q15 8 22 10 Q28 12 28 16 Q22 14.5 16 16.5 Q9.5 18.5 6 22 Z" />
            <Dot cx={24} cy={13} r={1.2} opacity={0.85} />
            <path d="M2 8 H12" strokeWidth={1} opacity={0.45} />
            <path d="M3 16 H9" strokeWidth={1} opacity={0.35} />
            <path d="M2 24 H11" strokeWidth={1} opacity={0.45} />
        </Stroke>
    );
}

function XubaiIcon() {
    // 叙白 — 净钵涤秽，一滴净水落下，钵中凝出黑白双珠
    return (
        <Stroke>
            <path d="M5.5 15 Q16 12 26.5 15 Q24 26.5 16 27.5 Q8 26.5 5.5 15 Z" />
            <path d="M16 3.5 Q18.5 6.5 16.8 8.6 Q15 6.5 16 3.5 Z" strokeWidth={1.5} opacity={0.7} />
            <Dot cx={12.5} cy={20.5} r={2.6} opacity={0.85} />
            <circle cx={19.5} cy={20.5} r={2.6} strokeWidth={1.5} />
        </Stroke>
    );
}

function LingxiIcon() {
    // 泠汐 — 海螺回响与层叠潮汐
    return (
        <Stroke>
            <path d="M19 4 Q27 7 26.5 15.5 Q26 23.5 18 25 Q11 26.5 9 21 Q7.5 16.5 12 15 Q16.5 13.5 17 18 Q17.2 21.5 14.5 21" />
            <path d="M13 8 Q18 9.5 20 14" strokeWidth={1} opacity={0.45} />
            <path d="M4 28 Q8 24.5 12 28 Q16 31.5 20 28" strokeWidth={1.5} opacity={0.6} />
            <path d="M23 29.5 Q26 27 29 29.5" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

function XueqiIcon() {
    // 血契 — 血滴、誓约横痕与缠链
    return (
        <Stroke>
            <path d="M16 5 Q22 13 22 18 A6 6 0 0 1 10 18 Q10 13 16 5 Z" />
            <path d="M11.5 18.5 Q16 21 20.5 18.5" strokeWidth={1} opacity={0.5} />
            <path d="M4 25.5 Q9 22.5 14 25.5 T24 25.5 T29.5 24" strokeWidth={1.4} opacity={0.6} />
            <circle cx="16" cy="17" r="1.6" strokeWidth={1} opacity={0.7} />
        </Stroke>
    );
}

function JinghongIcon() {
    // 惊鸿·止水 — 一撇雁影掠过静水，落点荡开一圈涟漪
    return (
        <Stroke>
            <path d="M5 12 Q12 4 19 9 Q23.5 11.5 27 8" />
            <path d="M19 9 Q21 14 18.5 18" strokeWidth={1.4} opacity={0.6} />
            <path d="M4 24 Q10 21 16 24 Q22 27 28.5 24" strokeWidth={1.5} opacity={0.55} />
            <path d="M12.5 28.5 Q16 26.5 19.5 28.5" strokeWidth={1} opacity={0.4} />
        </Stroke>
    );
}

/* 通用/默认图标 */
function DefaultIcon() {
    return (
        <g>
            <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M8 28 Q8 20 16 18 Q24 20 24 28" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </g>
    );
}

function YunyingIcon() {
    // 云缨 — 燃火长缨：斜枪杆 + 菱形枪头 + 飘穗红缨 + 飞火
    return (
        <g>
            <line x1="6" y1="27" x2="20" y2="10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M20 10 L24 3 L27 11 Z" fill="currentColor" opacity="0.9" />
            <path d="M19 12 Q14 13 12 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.7" />
            <path d="M20 14 Q16 17 15 21" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.5" />
            <path d="M26 14 q3 3 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.8" />
            <circle cx="29" cy="13" r="1.3" fill="currentColor" opacity="0.55" />
            <circle cx="24" cy="24" r="1" fill="currentColor" opacity="0.4" />
        </g>
    );
}

const iconMap: Record<string, () => JSX.Element> = {
    moran: () => <MoranIcon />,
    zhenxiao: () => <ZhenxiaoIcon />,
    huifeng: () => <HuifengIcon />,
    wukong: () => <WukongIcon />,
    xuanxiao: () => <XuanxiaoIcon />,
    nightowl: () => <NightowlIcon />,
    liuli: () => <LiuliIcon />,
    baize: () => <BaizeIcon />,
    changli: () => <ChangliIcon />,
    mirror: () => <MirrorIcon />,
    mowen: () => <MowenIcon />,
    guying: () => <GuyingIcon />,
    hanjiangxue: () => <HanjiangxueIcon />,
    skeletonking: () => <SkeletonkingIcon />,
    jetzmi: () => <JetzmiIcon />,
    pipa: () => <PipaIcon />,
    bounty: () => <BountyIcon />,
    yinyang: () => <YinyangIcon />,
    soul_lamp: () => <SoulLampIcon />,
    hero_x: () => <HeroXIcon />,
    bard: () => <BardIcon />,
    wither_lord: () => <WitherLordIcon />,
    t_painting: () => <TPaintingIcon />,
    feynman: () => <FeynmanIcon />,
    wangcai: () => <WangcaiIcon />,
    schrodinger: () => <SchrodingerIcon />,
    lilith: () => <LilithIcon />,
    libai: () => <LibaiIcon />,
    zuizhendao: () => <ZuizhendaoIcon />,
    feixue: () => <FeixueIcon />,
    fengling: () => <FenglingIcon />,
    dilan: () => <DilanIcon />,
    nanfeng: () => <NanfengIcon />,
    shangguan: () => <ShangguanIcon />,
    // 这三名的键沿用立绘资产命名（resolveHeroTemplateId 会把 youjun/chenyuan/dai 归一化成它们）
    zhenyue: () => <ChenyuanIcon />,
    daier: () => <DaiIcon />,
    yousun: () => <YoujunIcon />,
    xubai: () => <XubaiIcon />,
    lingxi: () => <LingxiIcon />,
    xueqi: () => <XueqiIcon />,
    yunying: () => <YunyingIcon />,
    jinghong: () => <JinghongIcon />,
};

/** 已拥有专属线性图标的英雄模板 id；新增英雄必须补一个，否则测试会拦住通用兜底图标 */
export const HERO_ICON_IDS = Object.keys(iconMap);

export default function HeroIcon({ heroId, size = 32, className = '' }: HeroIconProps) {
    const baseId = resolveHeroTemplateId(heroId) ?? heroId;

    const IconComponent = iconMap[baseId] || (() => <DefaultIcon />);

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            className={className}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <IconComponent />
        </svg>
    );
}
