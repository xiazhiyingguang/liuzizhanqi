/**
 * 游隼「风刃」统一图形：弯月形压缩气流，凸背 + 内凹锋口 + 背脊高光，刃尖朝 -y。
 *
 * 施法特效（SkillFxLayer）与棋盘常驻陷阱（Board / ReplayBoard）共用同一轮廓，
 * 保证"飞出去的刀"与"落在地上留下的刀"是同一个东西。
 * viewBox 以 (0,0) 为几何中心，外层 rotate() 旋到任意朝向都围绕刃身自身旋转。
 * 配色由外层容器注入 --wb-* 变量（两个使用场景调色板不同）。
 * 刻意不用 linearGradient defs：多处同时渲染时 SVG id 会相互覆盖。
 */
export function WindBladeGlyph({ className = '' }: { className?: string }) {
    return (
        <svg className={className} viewBox="-12 -12 24 24" aria-hidden="true">
            <path className="wb-halo" d="M3.2 -9.5 C -3.4 -4, -4.6 4, 2 9.5 C 2.2 2, 2.8 -3.5, 3.2 -9.5 Z" />
            <path className="wb-body" d="M3.2 -9.5 C -3.4 -4, -4.6 4, 2 9.5 C 2.2 2, 2.8 -3.5, 3.2 -9.5 Z" />
            <path className="wb-spine" d="M2.4 -6.4 C -1.8 -2.2, -2.6 3, 1.2 7" />
            <path className="wb-edge" d="M3.2 -9.5 C 2.8 -3.5, 2.2 2, 2 9.5" />
        </svg>
    );
}
