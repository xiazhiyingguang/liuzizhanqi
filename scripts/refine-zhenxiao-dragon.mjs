/** Trace the real dragon in the avatar crop, excluding hair/paper before vectorization.
 * node scripts/refine-zhenxiao-dragon.mjs
 * The PNG is input only; the shipped result contains vector paths, no embedded bitmap.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import ImageTracer from 'imagetracerjs';

const source = PNG.sync.read(readFileSync('public/fx/_dragon-crop.png'));
const width = 500;
const scale = width / source.width;
const height = Math.round(source.height * scale);
// The inner edge follows the dragon's neck, rather than the nearby strands of hair.
const contour = [[87,0],[437,0],[514,108],[553,189],[568,277],[657,338],[659,443],
    [589,493],[571,563],[491,563],[506,485],[466,440],[425,385],[382,327],
    [335,244],[268,187],[199,145],[110,116],[63,79],[47,36]];
function inside(x, y) {
    let hit = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const a = contour[i], b = contour[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
}
const palette = [
    [245,239,228], // Empty paper; removed from the vector output.
    [26,29,29], [51,51,47], [85,81,71], [112,103,85],
    [137,120,88], [172,141,86], [200,163,100], [223,193,137],
];
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = (x + .5) / scale, sy = (y + .5) / scale;
    const index = (y * width + x) * 4;
    let chosen = 0;
    if (inside(sx, sy)) {
        // Bilinear sampling keeps diagonals and narrow whiskers smooth.
        const x0 = Math.max(0, Math.min(source.width - 2, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(source.height - 2, Math.floor(sy)));
        const dx = sx - x0, dy = sy - y0;
        const rgb = [0,0,0];
        for (let c = 0; c < 3; c++) {
            const at = (xx, yy) => source.data[(yy * source.width + xx) * 4 + c];
            rgb[c] = at(x0,y0)*(1-dx)*(1-dy)+at(x0+1,y0)*dx*(1-dy)+at(x0,y0+1)*(1-dx)*dy+at(x0+1,y0+1)*dx*dy;
        }
        const brightness = (rgb[0]+rgb[1]+rgb[2])/3;
        const saturation = Math.max(...rgb)-Math.min(...rgb);
        // Preserve ink shading and bronze flecks; discard the light paper wash.
        if (brightness < 154 || (saturation > 38 && brightness < 216)) {
            let best = Infinity;
            for (let i = 1; i < palette.length; i++) {
                const distance = rgb.reduce((sum, value, c) => sum + (value - palette[i][c]) ** 2, 0);
                if (distance < best) { best = distance; chosen = i; }
            }
        }
    }
    pixels.set([...palette[chosen],255],index);
}
const traced = ImageTracer.imagedataToSVG({width,height,data:pixels}, {
    colorsampling:0, pal:palette.map(([r,g,b])=>({r,g,b,a:255})),
    ltres:1, qtres:.85, pathomit:28, blurradius:2, blurdelta:20,
    roundcoords:1, viewbox:true, desc:false,
});
const paths = [...traced.matchAll(/<path\b[^>]*\/>/g)].map(([path]) => {
    const color = path.match(/fill="rgb\((\d+),(\d+),(\d+)\)"/);
    if (!color || +color[1] > 235) return '';
    // Remove tracer's thick outline, which used to turn narrow gaps into hard cutouts.
    let result = path.replace(/\s+stroke="[^"]*"/,'').replace(/\s+stroke-width="[^"]*"/,'');
    const brightness = (+color[1]+ +color[2]+ +color[3])/3;
    const opacity = brightness < 72 ? .98 : brightness < 130 ? .78 : .9;
    result = result.replace(/opacity="[^"]*"/,`opacity="${opacity}"`);
    return result;
}).filter(Boolean);
// A small rotation lets the original sweeping dragon settle across the hairline.
const angle = -28 * Math.PI / 180;
const rotate = ([x,y]) => [340+(x-340)*Math.cos(angle)-(y-280)*Math.sin(angle),280+(x-340)*Math.sin(angle)+(y-280)*Math.cos(angle)];
const points = contour.map(rotate);
const x = Math.floor(Math.min(...points.map(p=>p[0])) - 6);
const y = Math.floor(Math.min(...points.map(p=>p[1])) - 6);
const w = Math.ceil(Math.max(...points.map(p=>p[0])) - x + 6);
const h = Math.ceil(Math.max(...points.map(p=>p[1])) - y + 6);
const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" fill="none">
<title>震霄头像中的墨龙·精细矢量描摹</title>
<desc>Original dragon silhouette and brushwork, with hair and paper excluded, smoother curves and translucent ink layers.</desc>
<defs>
  <linearGradient id="tail" x1="55" y1="0" x2="206" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="white" stop-opacity="0"/><stop offset=".48" stop-color="white" stop-opacity=".55"/><stop offset="1" stop-color="white"/></linearGradient>
  <linearGradient id="jaw" x1="0" y1="485" x2="0" y2="563" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset=".7" stop-color="white" stop-opacity=".75"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <mask id="tail-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="681" height="563"><path fill="url(#tail)" d="M0 0H681V563H0Z"/></mask>
  <mask id="jaw-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="681" height="563"><path fill="url(#jaw)" d="M0 0H681V563H0Z"/></mask>
  <linearGradient id="spine" x1="205" y1="82" x2="587" y2="373" gradientUnits="userSpaceOnUse"><stop stop-color="#423f34" stop-opacity="0"/><stop offset=".3" stop-color="#363a34" stop-opacity=".38"/><stop offset=".8" stop-color="#232925" stop-opacity=".52"/><stop offset="1" stop-color="#292a24" stop-opacity="0"/></linearGradient>
  <linearGradient id="edge" x1="258" y1="68" x2="566" y2="345" gradientUnits="userSpaceOnUse"><stop stop-color="#c3a66a" stop-opacity="0"/><stop offset=".5" stop-color="#c3a66a" stop-opacity=".6"/><stop offset="1" stop-color="#dcc695" stop-opacity=".25"/></linearGradient>
</defs>
<g transform="rotate(-28 340 280)" mask="url(#tail-mask)"><g mask="url(#jaw-mask)">
  <!-- A restrained ink bridge joins the original neck strokes, without replacing the silhouette. -->
  <path d="M202 82C285 72 350 118 385 189S456 296 543 331L600 373" stroke="url(#spine)" stroke-width="22" stroke-linecap="round"/>
  <g transform="scale(${1/scale})">${paths.join('\n')}</g>
  <!-- Fine accents follow the source's brow, horn ridge and jaw; no new crown shape. -->
  <g stroke="url(#edge)" stroke-width="1.2" stroke-linecap="round" fill="none">
    <path d="M260 56C336 84 375 134 401 196M409 215C442 251 464 291 502 318"/>
    <path d="M494 270C515 244 526 217 519 192M531 306C548 280 553 254 548 230"/>
    <path d="M578 352Q594 344 608 355M600 404C592 422 580 437 570 450"/>
    <path d="M547 445C551 464 548 484 535 503M613 394Q627 400 635 391"/>
  </g>
  <path d="M597 360Q604 356 610 361L603 364Z" fill="#d2bb8d" opacity=".7"/>
  <path d="M604 358L603 364" stroke="#252722" stroke-width="1.4" stroke-linecap="round"/>
</g></g>
</svg>`;
writeFileSync('public/fx/zhenxiao-dragon-crown.svg', content);
console.log(`Original dragon: ${paths.length} paths, ${w}x${h}, ${(Buffer.byteLength(content)/1024).toFixed(1)} KiB`);
