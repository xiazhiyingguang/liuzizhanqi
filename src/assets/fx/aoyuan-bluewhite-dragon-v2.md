# 敖渊蓝白游龙素材

- 素材：`aoyuan-bluewhite-dragon-v2.png`，2172 × 724，保留透明通道。
- 使用方式：内置 image_gen 工具，以用户提供的游龙头像为参考生成独立龙皮。未修改角色头像。
- 参考形象：`public/hero-images/avatars/游龙·敖渊.png` 中的蓝白龙。
- 渲染：`AoyuanDragonArt.tsx` 将龙皮分成 40 段（流畅档 24 段），沿 `dragon-skin-rig.ts` 的动态脊线弯曲；头部固定在战斗路径，尾部错相摆动，须鬃另行绘制。
- 盘旋、冲刺、待机共用素材，使用不同脊线和频率。低画质降低分段和刷新率；减弱动态时绘制静止姿态。
- 外层几何的龙首锚点为画框 82% / 28%，与命中计时共用轨迹。

## 最终生成提示词（内置工具，透明背景）

Use case: stylized-concept. Asset type: articulated game VFX dragon skin, intended for a deforming skeletal mesh, NOT a finished scene. Input image 1 is a STYLE AND DRAGON IDENTITY REFERENCE only: use ONLY the beautiful blue-white Chinese dragon in the upper-right of the supplied avatar. Do not reproduce the human. Draw one complete slender Chinese celestial dragon in elegant detailed ink-wash fantasy illustration matching that dragon: white pearl scales, desaturated slate-blue back and wispy layered mane, very thin branched antler horns, angular elongated dragon face, narrow luminous icy-blue eyes, long white whiskers, small fine aged-gold accents. Four delicate claws. Long serpentine tapering tail with flowing pale blue-white fins. Composition is an unusually WIDE horizontal side-view isolated dragon facing RIGHT: tail at far left, long body through the middle, large clearly readable head near the right end, snout pointing straight right. For rigging, the body must be almost straight with only a very shallow natural wave, NOT coiled, NOT a U shape, NOT overlapping itself. Keep the head, neck, body, tail and all small tendrils fully within the frame with a clear transparent margin. Keep body centerline and snout at roughly the same vertical height. Luxurious painterly scale details, crisp separated silhouette that reads at 150px wide. A 3:1 wide subject with 20 percent transparent margin above/below. Actual transparent background and alpha cutout, no paper, no landscape, no person, no clouds or particles detached from the dragon, no glow backdrop, no text or watermark. Preserve the pale blue/ivory and expressive antlered face from the reference, not emerald green, not Western winged dragon, not cute/cartoon.
