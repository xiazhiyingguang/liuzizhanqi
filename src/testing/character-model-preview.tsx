/* eslint-disable react-refresh/only-export-components */
/**
 * 墨阑·人物形象建模预览（三条代码路线并排对比）。
 *
 * 只在开发服务器手动打开 character-model-preview.html 时挂载，不影响游戏本体。
 *
 * - 路线 A「CSS 动态立绘」：整图呼吸浮动 + 鼠标视差，零切图成本，最接近现有技术栈；
 * - 路线 B「物理摆动」：发丝/衣摆按弹簧-阻尼模型逐帧摆动（多层切图模拟 Live2D），
 *   用 requestAnimationFrame 驱动 CSS 变量；
 * - 路线 C「3D 化」：Three.js 把立绘铺在带厚度的多层平面上，可拖拽旋转，
 *   演示"从 2D 立绘到 3D 呈现"的观感（层间距产生伪立体）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './character-model-preview.css';

const IMAGE_URL = '/hero-images/full-body/墨阑.png';

/* ============================================================
   路线 A：CSS 动态立绘（呼吸 + 鼠标视差）
   ============================================================ */

function CssPortrait() {
    const stageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const onMove = (e: MouseEvent) => {
            const rect = stage.getBoundingClientRect();
            const nx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 ~ 0.5
            const ny = (e.clientY - rect.top) / rect.height - 0.5;
            stage.style.setProperty('--px', nx.toFixed(3));
            stage.style.setProperty('--py', ny.toFixed(3));
        };
        const onLeave = () => {
            stage.style.setProperty('--px', '0');
            stage.style.setProperty('--py', '0');
        };
        window.addEventListener('mousemove', onMove);
        stage.addEventListener('mouseleave', onLeave);
        return () => {
            window.removeEventListener('mousemove', onMove);
            stage.removeEventListener('mouseleave', onLeave);
        };
    }, []);

    return (
        <div
            ref={stageRef}
            className="cm-stage cm-stage-css"
            style={{ '--px': 0, '--py': 0 } as React.CSSProperties}
        >
            <div className="cm-parallax" style={{ '--depth': 1 } as React.CSSProperties}>
                <img className="cm-image cm-breathe" src={IMAGE_URL} alt="墨阑" />
            </div>
            <div className="cm-caption">
                <b>路线 A · CSS 动态立绘</b>
                <span>整图呼吸浮动 + 鼠标视差跟随——零切图成本，游戏内可直接用</span>
            </div>
        </div>
    );
}

/* ============================================================
   路线 B：弹簧物理摆动（发丝 / 衣摆独立摆动，模拟 Live2D 手感）
   ============================================================ */

/** 简易弹簧-阻尼：向目标值(由输入驱动)收敛，带惯性回摆 */
function useSpringLoop(
    ref: React.RefObject<HTMLDivElement | null>,
    drive: (t: number, mouse: { x: number; y: number }) => { rot: number; sway: number }
) {
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let raf = 0;
        const start = performance.now();
        const mouse = { x: 0, y: 0 };
        const onMove = (e: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            mouse.x = (e.clientX - rect.left) / rect.width - 0.5;
            mouse.y = (e.clientY - rect.top) / rect.height - 0.5;
        };
        window.addEventListener('mousemove', onMove);
        const tick = () => {
            const t = (performance.now() - start) / 1000;
            const { rot, sway } = drive(t, mouse);
            el.style.setProperty('--rot', `${rot.toFixed(2)}deg`);
            el.style.setProperty('--sway', `${sway.toFixed(1)}%`);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('mousemove', onMove);
        };
    }, [ref, drive]);
}

function PhysicsPortrait() {
    const stageRef = useRef<HTMLDivElement>(null);

    // 主体：缓慢呼吸 + 轻微侧倾（鼠标影响权重小）
    useSpringLoop(stageRef, (t, mouse) => ({
        rot: Math.sin(t * 0.7) * 0.6 + mouse.x * 2.4,
        sway: Math.sin(t * 0.9) * 0.35 + mouse.y * 1.2,
    }));

    return (
        <div ref={stageRef} className="cm-stage cm-stage-physics" style={{ '--rot': '0deg', '--sway': '0%' } as React.CSSProperties}>
            {/* 三层深度：衣摆(最远) → 主体 → 发丝(最近)，各自不同摆动节奏 */}
            <div className="cm-layer cm-layer-robe">
                <img src={IMAGE_URL} alt="" aria-hidden="true" className="cm-layer-img" />
            </div>
            <div className="cm-layer cm-layer-body">
                <img src={IMAGE_URL} alt="墨阑" className="cm-layer-img" />
            </div>
            <div className="cm-layer cm-layer-hair">
                <img src={IMAGE_URL} alt="" aria-hidden="true" className="cm-layer-img" />
            </div>
            <div className="cm-caption">
                <b>路线 B · 弹簧物理摆动</b>
                <span>主体/发丝/衣摆三层按弹簧-阻尼独立摆动，移动鼠标感受惯性与回摆</span>
            </div>
        </div>
    );
}

/* ============================================================
   路线 C：Three.js 伪 3D（多层平面 + 拖拽旋转 + 光照）
   ============================================================ */

function ThreePortrait() {
    const mountRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [hasGlb, setHasGlb] = useState(false);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        const width = mount.clientWidth;
        const height = 560;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
        camera.position.set(0, 2.1, 9.4);
        camera.lookAt(0, 1.75, 0);

        // —— 水墨三阶色阶 ——
        const gradientColors = new Uint8Array([110, 185, 255]);
        const gradientMap = new THREE.DataTexture(gradientColors, 3, 1, THREE.RedFormat);
        gradientMap.minFilter = THREE.NearestFilter;
        gradientMap.magFilter = THREE.NearestFilter;
        gradientMap.needsUpdate = true;
        const toon = (color: number, extra: Record<string, unknown> = {}) =>
            new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

        const INK = 0x26262f;
        const INK_SOFT = 0x2f2f3a;
        const PAPER = 0xf1ece0;
        const SKIN = 0xe6d6c2;

        // spinner：旋转/呼吸只作用于这一组（程序化模型与 GLB 模型共用）
        const spinner = new THREE.Group();
        scene.add(spinner);

        // ================= 程序化墨阑（瘦长 1:7 比例，长发随风）=================
        const figure = new THREE.Group();
        spinner.add(figure);
        const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, z);
            mesh.castShadow = true;
            figure.add(mesh);
            return mesh;
        };

        // —— 白内袍（瘦长车削：腰收、裾展）——
        const robeProfile = [
            new THREE.Vector2(0.92, 0.10),
            new THREE.Vector2(0.60, 0.70),
            new THREE.Vector2(0.40, 1.55),
            new THREE.Vector2(0.335, 2.15),
            new THREE.Vector2(0.325, 2.55),
            new THREE.Vector2(0.27, 2.82),
            new THREE.Vector2(0.16, 2.92),
        ];
        part(new THREE.LatheGeometry(robeProfile, 48), toon(PAPER));

        // —— 墨黑外披（后背+两肩，前襟敞开）——
        part(
            new THREE.CylinderGeometry(0.30, 0.98, 2.62, 48, 1, true, 0.75, Math.PI * 2 - 1.5),
            toon(INK, { side: THREE.DoubleSide }),
            0, 1.60, 0
        );

        // —— 胸前斜交领 ——
        for (const side of [-1, 1]) {
            const collar = part(new THREE.PlaneGeometry(0.15, 0.72), toon(INK, { side: THREE.DoubleSide }), side * 0.11, 2.55, 0.31);
            collar.rotation.set(0.10, 0, side * 0.40);
        }

        // —— 腰带 + 垂梢 ——
        const belt = part(new THREE.TorusGeometry(0.355, 0.04, 12, 40), toon(0x1a1a22), 0, 2.12, 0);
        belt.rotation.x = Math.PI / 2;
        part(new THREE.BoxGeometry(0.10, 0.26, 0.045), toon(0x1a1a22), 0, 2.00, 0.36);

        // —— 颈与头（小头长身）——
        part(new THREE.CylinderGeometry(0.075, 0.088, 0.18, 16), toon(SKIN), 0, 2.96, 0);
        part(new THREE.SphereGeometry(0.215, 32, 24), toon(SKIN), 0, 3.16, 0.01);

        // —— 长发：主体包 + 三束向右掠起的马尾（立绘的招牌动势）——
        const hairGroup = new THREE.Group();
        hairGroup.position.set(0, 3.20, 0);
        figure.add(hairGroup);
        const hairMat = toon(0x2a2a34);
        const hairPart = (curve: THREE.CatmullRomCurve3, radius: number) => {
            const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 26, radius, 10), hairMat);
            mesh.castShadow = true;
            hairGroup.add(mesh);
            return mesh;
        };
        // 后脑主体包
        const scalp = new THREE.Mesh(new THREE.SphereGeometry(0.245, 32, 24), hairMat);
        scalp.position.set(0, 0.05, -0.075);
        scalp.castShadow = true;
        hairGroup.add(scalp);
        // 主马尾：向右大幅掠落
        hairPart(new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.02, 0.24, -0.10),
            new THREE.Vector3(0.30, 0.10, -0.14),
            new THREE.Vector3(0.60, -0.20, -0.08),
            new THREE.Vector3(0.78, -0.62, -0.02),
            new THREE.Vector3(0.70, -1.02, 0.02),
        ]), 0.105);
        // 第二束（更细更飘）
        hairPart(new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.0, 0.18, -0.16),
            new THREE.Vector3(0.26, 0.02, -0.20),
            new THREE.Vector3(0.48, -0.30, -0.14),
            new THREE.Vector3(0.52, -0.72, -0.08),
        ]), 0.075);
        // 前侧一缕（贴脸向右）
        hairPart(new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.06, 0.16, 0.10),
            new THREE.Vector3(0.10, 0.02, 0.16),
            new THREE.Vector3(0.22, -0.22, 0.14),
        ]), 0.045);
        // 左侧短发梢（平衡）
        hairPart(new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.10, 0.12, -0.10),
            new THREE.Vector3(-0.26, -0.10, -0.12),
            new THREE.Vector3(-0.32, -0.38, -0.08),
        ]), 0.06);
        // 发冠
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 14), hairMat);
        bun.position.set(0.01, 0.32, -0.04);
        bun.castShadow = true;
        hairGroup.add(bun);
        const bunBand = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.016, 10, 20), toon(0x8a7a54));
        bunBand.position.set(0.01, 0.26, -0.04);
        bunBand.rotation.x = Math.PI / 2 - 0.25;
        hairGroup.add(bunBand);

        // —— 眼（两道极淡短横）——
        for (const side of [-1, 1]) {
            const eye = part(new THREE.BoxGeometry(0.06, 0.013, 0.012), toon(0x33333d), side * 0.082, 3.175, 0.198);
            eye.rotation.z = side * 0.10;
        }

        // —— 广袖（肩宽袖广，斜垂）+ 小臂 + 手 ——
        for (const side of [-1, 1]) {
            const shoulder = part(new THREE.SphereGeometry(0.115, 16, 12), toon(INK), side * 0.40, 2.80, 0);
            const sleeve = part(new THREE.CylinderGeometry(0.105, 0.285, 0.85, 20), toon(INK), side * 0.56, 2.42, 0.02);
            sleeve.rotation.z = side * -0.55;
            shoulder.scale.set(1, 1.1, 1);
            const arm = part(new THREE.CylinderGeometry(0.048, 0.055, 0.34, 12), toon(SKIN), side * 0.74, 2.06, 0.05);
            arm.rotation.z = side * -0.30;
            part(new THREE.SphereGeometry(0.062, 14, 10), toon(SKIN), side * 0.79, 1.94, 0.07);
        }

        // —— 右手长剑（斜指右下，收势）——
        const sword = new THREE.Group();
        sword.position.set(0.79, 1.94, 0.07);
        sword.rotation.set(0.10, 0, -0.42);
        const steel = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.26, metalness: 0.8 });
        const swordPart = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.y = y;
            m.castShadow = true;
            sword.add(m);
        };
        swordPart(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 12), toon(0x3a2e20), 0.02);
        swordPart(new THREE.BoxGeometry(0.15, 0.032, 0.05), toon(0x8a7a54), -0.105);
        swordPart(new THREE.BoxGeometry(0.042, 1.30, 0.014), steel, -0.78);
        const swordTip = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.14, 8), steel);
        swordTip.position.y = -1.50;
        swordTip.rotation.x = Math.PI;
        swordTip.castShadow = true;
        sword.add(swordTip);
        figure.add(sword);

        // —— 左手卷轴 ——
        const scroll = new THREE.Group();
        scroll.position.set(-0.79, 1.94, 0.07);
        const scrollBody = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.52, 16), toon(0x5a4632));
        scrollBody.rotation.z = Math.PI / 2;
        scrollBody.castShadow = true;
        scroll.add(scrollBody);
        for (const side of [-1, 1]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.053, 0.032, 16), toon(0xd8cdb8));
            cap.rotation.z = Math.PI / 2;
            cap.position.x = side * 0.28;
            scroll.add(cap);
        }
        figure.add(scroll);

        // —— 飘带×2（身后）+ 腰梢×2（身前）：统一 CPU 顶点波动 ——
        interface RibbonState { mesh: THREE.Mesh; base: Float32Array; phase: number }
        const ribbons: RibbonState[] = [];
        const addRibbon = (
            w: number, h: number, x: number, y: number, z: number,
            ry: number, rx: number, color: number, phase: number
        ) => {
            const geo = new THREE.PlaneGeometry(w, h, 6, 26);
            const mesh = new THREE.Mesh(geo, toon(color, { side: THREE.DoubleSide }));
            mesh.position.set(x, y, z);
            mesh.rotation.set(rx, ry, 0);
            figure.add(mesh);
            ribbons.push({ mesh, base: Float32Array.from(geo.attributes.position.array), phase });
        };
        addRibbon(0.36, 2.5, 0.26, 1.68, -0.40, -0.22, 0.10, 0x30303a, 1.3);
        addRibbon(0.36, 2.5, -0.26, 1.68, -0.40, 0.22, 0.10, 0x30303a, -1.1);
        addRibbon(0.13, 1.15, 0.09, 1.52, 0.345, 0, 0.06, INK_SOFT, 0.6);
        addRibbon(0.13, 1.15, -0.09, 1.52, 0.345, 0, 0.06, INK_SOFT, 2.0);

        // —— 墨雾（画布柔雾贴图，环绕缓旋）——
        const makeMistTexture = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 128;
            const ctx = canvas.getContext('2d')!;
            for (let i = 0; i < 26; i++) {
                const cx = Math.random() * 256;
                const cy = 30 + Math.random() * 70;
                const r = 18 + Math.random() * 40;
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                g.addColorStop(0, 'rgba(42,42,51,0.16)');
                g.addColorStop(1, 'rgba(42,42,51,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, 256, 128);
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        };
        const mistTex = makeMistTexture();
        const mists: THREE.Mesh[] = [];
        for (const [x, y, z, w, h] of [[1.7, 1.4, -0.6, 2.6, 1.1], [-1.9, 2.3, -0.9, 3.0, 1.2], [0.4, 0.6, -2.1, 2.8, 1.0]] as const) {
            const mist = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.85 })
            );
            mist.position.set(x, y, z);
            scene.add(mist);
            mists.push(mist);
        }

        // —— 地面：宣纸底 + 双墨圈 ——
        const ground = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 1 }));
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);
        for (const [r0, r1, op] of [[1.35, 1.46, 0.30], [1.95, 2.01, 0.17]] as const) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(r0, r1, 56),
                new THREE.MeshBasicMaterial({ color: 0x2a2a33, transparent: true, opacity: op })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.012;
            scene.add(ring);
        }

        // —— 光照 ——
        const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.0);
        keyLight.position.set(2.8, 5, 3.4);
        keyLight.castShadow = true;
        keyLight.shadow.camera.left = -5;
        keyLight.shadow.camera.right = 5;
        keyLight.shadow.camera.top = 6;
        keyLight.shadow.camera.bottom = -2;
        keyLight.shadow.camera.far = 16;
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x9fc4e6, 0.85);
        rimLight.position.set(-3.2, 2.4, -2.6);
        scene.add(rimLight);
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));

        // —— GLB 热插拔：public/hero-images/3d/moran.glb 存在时自动替换程序化模型 ——
        const glbHolder = new THREE.Group();
        spinner.add(glbHolder);
        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
            '/hero-images/3d/moran.glb',
            gltf => {
                const model = gltf.scene;
                model.traverse(obj => {
                    const mesh = obj as THREE.Mesh;
                    if (mesh.isMesh) mesh.castShadow = true;
                });
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                if (size.y > 0.0001) model.scale.setScalar(3.5 / size.y);
                const box2 = new THREE.Box3().setFromObject(model);
                const center = box2.getCenter(new THREE.Vector3());
                model.position.x -= center.x;
                model.position.z -= center.z;
                model.position.y -= box2.min.y;
                glbHolder.add(model);
                figure.visible = false;
                setHasGlb(true);
            },
            undefined,
            () => { /* 没有 GLB：保留程序化模型 */ }
        );

        // —— 拖拽旋转 + 待机自转 ——
        let dragging = false;
        let lastX = 0;
        let spin = 0;
        let spinVelocity = 0.004;
        const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; };
        const onMove = (e: PointerEvent) => {
            if (!dragging) return;
            const dx = e.clientX - lastX;
            lastX = e.clientX;
            spin += dx * 0.008;
            spinVelocity = dx * 0.008;
        };
        const onUp = () => { dragging = false; };
        renderer.domElement.style.cursor = 'grab';
        renderer.domElement.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);

        let raf = 0;
        const clock = new THREE.Clock();
        const tick = () => {
            const t = clock.getElapsedTime();
            if (!dragging) {
                spin += spinVelocity;
                spinVelocity *= 0.94;
                spinVelocity += (0.004 - spinVelocity) * 0.02;
            }
            spinner.rotation.y = spin;
            spinner.position.y = Math.sin(t * 0.9) * 0.03;
            hairGroup.rotation.z = Math.sin(t * 1.15) * 0.035;   // 发丝缓摆
            hairGroup.rotation.x = Math.sin(t * 0.8) * 0.025;
            for (const mist of mists) {
                mist.rotation.y = t * 0.06 + mist.position.x;    // 墨雾缓旋
            }
            for (const ribbon of ribbons) {
                const pos = ribbon.mesh.geometry.attributes.position;
                const halfH = (ribbon.base[1 + 3 * 0] === undefined) ? 1 : Math.abs(ribbon.base[1]);
                for (let i = 0; i < pos.count; i++) {
                    const bx = ribbon.base[i * 3];
                    const by = ribbon.base[i * 3 + 1];
                    const freeFactor = Math.max(0, 1 - (by + halfH) / (2 * halfH));
                    pos.setZ(i, Math.sin(by * 2.6 + t * 2.2 + ribbon.phase) * 0.20 * freeFactor);
                    pos.setX(i, bx + Math.sin(t * 1.6 + ribbon.phase) * 0.055 * freeFactor);
                }
                pos.needsUpdate = true;
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        setReady(true);

        return () => {
            cancelAnimationFrame(raf);
            renderer.domElement.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            renderer.dispose();
            if (renderer.domElement.parentElement === mount) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, []);

    return (
        <div className="cm-stage cm-stage-three">
            <div ref={mountRef} className="cm-three-mount" />
            {!ready && <div className="cm-loading">3D 场景加载中…</div>}
            {hasGlb && (
                <div className="cm-glb-badge">已加载 AI 生成模型 moran.glb</div>
            )}
            <div className="cm-caption">
                <b>{hasGlb ? '路线 C · AI 生成 3D 模型' : '路线 C · 3D 程序化建模（水墨剪影风）'}</b>
                <span>
                    {hasGlb
                        ? '把 public/hero-images/3d/moran.glb 换成新模型即可刷新替换'
                        : '代码几何体的上限摆在这里；放一个 moran.glb 到 public/hero-images/3d/ 即可换成 AI 生成模型'}
                </span>
            </div>
        </div>
    );
}

/* ============================================================
   页面骨架
   ============================================================ */

function PreviewPage() {
    const [tab, setTab] = useState<'all' | 'a' | 'b' | 'c'>('all');
    const tabs = [
        { key: 'all', label: '三路并排' },
        { key: 'a', label: 'A · CSS 动态立绘' },
        { key: 'b', label: 'B · 物理摆动' },
        { key: 'c', label: 'C · 真·3D 建模' },
    ] as const;

    return (
        <div style={{ maxWidth: 1560, margin: '0 auto' }}>
            <h1 style={{ textAlign: 'center', margin: '8px 0 4px', letterSpacing: 2 }}>
                墨阑 · 人物形象建模预览
            </h1>
            <p style={{ textAlign: 'center', color: '#6a6456', marginTop: 0 }}>
                三条纯代码路线并排对比：移动鼠标看 A/B 的跟随与惯性，拖拽 C 的 3D 模型旋转
            </p>
            <div className="cm-tabs">
                {tabs.map(item => (
                    <button
                        key={item.key}
                        className={`cm-tab ${tab === item.key ? 'is-active' : ''}`}
                        onClick={() => setTab(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <div className="cm-grid" data-mode={tab}>
                {(tab === 'all' || tab === 'a') && <CssPortrait />}
                {(tab === 'all' || tab === 'b') && <PhysicsPortrait />}
                {(tab === 'all' || tab === 'c') && <ThreePortrait />}
            </div>
            <p className="cm-footnote">
                A：最省，游戏内立即可用 ｜ B：接近 Live2D 手感，正式采用需把立绘按图层切开
                ｜ C：Three.js 实时渲染，真正的 3D 需要 AI 生成模型（Meshy/Tripo）或 Blender 手工建模
            </p>
        </div>
    );
}

const rootEl = document.getElementById('root');
if (rootEl) {
    createRoot(rootEl).render(<PreviewPage />);
}
