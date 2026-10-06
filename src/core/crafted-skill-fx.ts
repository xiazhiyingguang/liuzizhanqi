/** Hand-built materials for the heroes whose old effects relied on neon rings. */
export type CraftedFxTheme = 'particle-beam' | 'particle-burst' | 'soul-array' | 'soul-cycle'
    | 'abyss-pull' | 'abyss-ward' | 'time-swap' | 'cold-star' | 'rune-awaken'
    | 'moon-double' | 'dread-arrow' | 'dread-curse' | 'wind-vortex' | 'wind-corridor';
export type CraftedFxVariant = 'caster' | 'target' | 'impact' | 'area' | 'splash' | 'chain';

export function craftedVariantVisible(theme: CraftedFxTheme | undefined, variant: CraftedFxVariant) {
    if(!theme || variant==='chain' || variant==='splash')return false;
    if(variant==='area')return theme==='wind-corridor' || theme==='abyss-ward';
    if(theme==='soul-array')return variant==='caster';
    return true;
}

export interface CraftedFrame {
    theme: CraftedFxTheme;
    variant: CraftedFxVariant;
    time: number;
    duration: number;
    dx: number;
    dy: number;
    angle: number;
    lite: boolean;
    image?: HTMLImageElement;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 41.7) * 43758.5453; return v - Math.floor(v); };
const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;

function stroke(ctx: Ctx, color: string, width: number, points: number[][], close = false) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function polygon(ctx: Ctx, points: number[][], fill: string | CanvasGradient, edge?: string) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = .75; ctx.stroke(); }
}
/** Clipped scratches and mineral inclusions, rather than a perfectly smooth filled face. */
function grain(ctx: Ctx, points: number[][], seed: number, color: string, count = 28) {
    ctx.save();ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
    const xs=points.map(v=>v[0]),ys=points.map(v=>v[1]);const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
    ctx.globalAlpha*=.25;
    for(let i=0;i<count;i++){
        const x=x0+noise(i+seed)*w,y=y0+noise(i+seed+61)*h;
        stroke(ctx,color,.35,[[x,y],[x+1+noise(i+9)*6,y-2-noise(i+15)*4]]);
    }ctx.restore();
}
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = .35) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = g; ctx.fillRect(x-r, y-r, r*2, r*2); ctx.restore();
}
function fragments(ctx: Ctx, t: number, color: string, count: number, reach = 60, seed = 1) {
    const p = ease(t); ctx.save(); ctx.globalAlpha *= 1-clamp(t);
    for (let i=0; i<count; i++) {
        const a=noise(i+seed)*TAU, r=(12+noise(i+seed+29)*reach)*p;
        const x=Math.cos(a)*r, y=Math.sin(a)*r + t*t*13, size=1+noise(i+seed+4)*3;
        ctx.save(); ctx.translate(x,y); ctx.rotate(a+t*2);
        polygon(ctx, [[-size,0],[size*.2,-size*1.8],[size,.3],[0,size*.4]],color); ctx.restore();
    } ctx.restore();
}
function sparks(ctx: Ctx, t: number, color: string, count: number, reach = 60) {
    ctx.save(); ctx.globalAlpha *= 1-clamp(t);
    for (let i=0; i<count; i++) {
        const a=noise(i+11)*TAU, r=8+ease(t)*(20+noise(i+70)*reach), tail=2+8*(1-t);
        stroke(ctx,color, .5+noise(i)*.8,[[Math.cos(a)*(r-tail),Math.sin(a)*(r-tail)],[Math.cos(a)*r,Math.sin(a)*r]]);
    } ctx.restore();
}

function particle(ctx: Ctx, f: CraftedFrame, p: number) {
    const cast=f.variant==='caster';
    if (f.theme==='particle-beam' && cast) {
        const length=Math.hypot(f.dx,f.dy), head=ease((p-.06)/.19)*length;
        ctx.rotate(f.angle);
        if (p<.24) {
            ctx.save(); ctx.globalAlpha*=1-p/.24;
            for (let i=0;i<3;i++) { ctx.beginPath(); ctx.ellipse(-6+i*5,0,5,16-i*3,0,-1.1,1.1); ctx.strokeStyle=i===1?'#b49361':'#466478'; ctx.lineWidth=1.5; ctx.stroke(); } ctx.restore();
        }
        const fade=1-clamp((p-.48)/.38);
        ctx.save(); ctx.globalAlpha*=fade;
        // Narrow white core, etched filaments and broken trajectories, rather than a filled gradient bar.
        for (let i=0;i<(f.lite?3:7);i++) {
            const y=(i-3)*1.7, offset=Math.sin(p*22+i)*1.5;
            stroke(ctx,i%2?'#527e96':'#a4c8d4',.7,[[0,y],[head*.32,y+offset],[head*.7,y-offset*.4],[head,y*.15]]);
        }
        stroke(ctx,'#325067',4,[[0,0],[head,0]]); stroke(ctx,'#c7e9ef',2,[[0,0],[head,0]]); stroke(ctx,'#fff6dc',.8,[[0,0],[head,0]]);
        for (let i=0;i<6;i++) { const x=head*noise(i+8); stroke(ctx,'#8b7755',.7,[[x,-4-i%3],[x+5,-1],[x+10,2+i%2]]); }
        glow(ctx,head,0,14,'#e3eff3',.6); ctx.restore(); return;
    }
    if (cast) {
        ctx.save(); ctx.globalAlpha*=1-clamp(p/.45);
        for(let i=0;i<3;i++) { ctx.beginPath(); ctx.ellipse(0,0,27*(1-p),8, i*1.05+p,0,TAU); ctx.strokeStyle=i===1?'#967e54':'#567181'; ctx.lineWidth=.9;ctx.stroke(); } ctx.restore(); return;
    }
    if(f.variant==='area') { stroke(ctx,'#7c8d98',.6,[[-25,12],[-12,9],[5,13],[27,8]]);return; }
    const q=clamp(p/.65), burst=f.theme==='particle-burst';
    if(p<.2 && burst) {
        ctx.save();ctx.globalAlpha*=1-p/.2;
        for(let i=0;i<5;i++){ctx.rotate(1.26);stroke(ctx,'#536b7d',1,[[-58*(1-p*4),-7],[-10,-2],[0,0]]);}ctx.restore();
    }
    if(p<.28) {
        ctx.save();ctx.globalAlpha*=1-p/.28;
        polygon(ctx,[[0,-33],[4,-5],[33,0],[5,4],[0,26],[-4,3],[-28,0],[-5,-4]],'#fff7df','#85b3bf');
        glow(ctx,0,0,40,'#aecad5',.4);ctx.restore();
    }
    sparks(ctx,q,'#6b5a3a',f.lite?7:16,burst?73:42);
    fragments(ctx,q,'#4d6579',f.lite?5:10,burst?66:38,5);
}

function soul(ctx: Ctx, f: CraftedFrame, p: number) {
    const main=f.variant==='caster';
    if (!main) {
        if(f.variant==='area') return;
        ctx.save();ctx.globalAlpha*=.65;
        for(let i=0;i<(f.lite?5:10);i++){
            const x=(noise(i+13)-.5)*56,y=25-p*65-noise(i+4)*12;
            stroke(ctx,i%2?'#a89b6d':'#52766f',.8,[[x,y],[x+Math.sin(p*9+i)*4,y-5]]);
        }
        if(p<.65) {ctx.beginPath();ctx.ellipse(0,27,32+ease(p)*9,7,0,.3,2.6);ctx.strokeStyle='#638777';ctx.lineWidth=1;ctx.stroke();}
        ctx.restore();return;
    }
    if(f.theme==='soul-cycle' && Math.hypot(f.dx,f.dy)>0){
        ctx.save();ctx.rotate(f.angle);const d=Math.hypot(f.dx,f.dy),travel=ease((p-.12)/.5);
        ctx.globalAlpha*=Math.sin(travel*Math.PI)*.65;
        ctx.beginPath();ctx.moveTo(0,-15);ctx.bezierCurveTo(d*.25,-37,d*.7,12,d*travel,-6);
        ctx.strokeStyle='#698879';ctx.lineWidth=1.4;ctx.stroke();
        for(let i=0;i<5;i++){const x=Math.max(0,d*travel-i*7);stroke(ctx,i%2?'#bfa777':'#7fae99',.7,[[x,-6],[x+3,-9-i%2]]);}ctx.restore();
    }
    ctx.save();ctx.globalAlpha*=Math.min(1,p*9)*(1-clamp((p-.7)/.3));
    // Uneven, incomplete ground sigil; the bronze lantern is the only main silhouette.
    for(let i=0;i<7;i++){
        const a=i*.87+.12, r=37+noise(i+9)*7;
        stroke(ctx,'#48615b',1.2,[[Math.cos(a-.14)*r,27+Math.sin(a-.14)*r*.28],[Math.cos(a)*r,27+Math.sin(a)*r*.28],[Math.cos(a+.19)*(r-4),27+Math.sin(a+.19)*(r-4)*.28]]);
    }
    ctx.translate(0,-33-ease(p)*11+(f.theme==='soul-cycle'?Math.sin(p*Math.PI)*-7:0));
    glow(ctx,0,-5,37,'#6b9785',.28);
    // Smoke uses curved, tapering threads, avoiding a stack of identical glowing blobs.
    for(let i=0;i<(f.lite?3:6);i++) {
        ctx.save();ctx.globalAlpha*=.13;
        ctx.beginPath();ctx.moveTo((i-2)*3,0);ctx.bezierCurveTo(-24+Math.sin(p*9+i)*15,-16,29*Math.sin(i+p*5),-28,Math.sin(i+p*7)*19,-43-p*8);
        ctx.strokeStyle=i%2?'#718b79':'#344f4b';ctx.lineWidth=5+noise(i)*7;ctx.stroke();
        ctx.globalAlpha*=1.8;ctx.lineWidth=.8;ctx.stroke();ctx.restore();
    }
    ctx.globalAlpha=Math.min(1,p*9)*(1-clamp((p-.7)/.3));
    ctx.beginPath();ctx.moveTo(-7,11);ctx.bezierCurveTo(-17,-4,6,-8,Math.sin(p*18)*5,-29);ctx.bezierCurveTo(15,-16,10,-7,8,11);ctx.closePath();
    const flame=ctx.createLinearGradient(0,12,0,-28);flame.addColorStop(0,'#294d46');flame.addColorStop(.45,'#6fbc9e');flame.addColorStop(.72,'#d8e8b1');flame.addColorStop(1,'#668777');ctx.fillStyle=flame;ctx.fill();
    ctx.beginPath();ctx.moveTo(-3,9);ctx.quadraticCurveTo(-5,-2,2,-14);ctx.quadraticCurveTo(7,1,3,10);ctx.fillStyle='#ebdbab';ctx.fill();
    const bronze=ctx.createLinearGradient(-17,0,17,0);bronze.addColorStop(0,'#282e2a');bronze.addColorStop(.25,'#7b7051');bronze.addColorStop(.4,'#c0a578');bronze.addColorStop(.7,'#5c5742');bronze.addColorStop(1,'#303b34');
    const hood=[[-17,-18],[-10,-24],[-4,-26],[4,-26],[10,-24],[17,-18],[10,-15],[-10,-15]];
    polygon(ctx,hood,bronze,'#ad9a71');grain(ctx,hood,21,'#d9c69d',20);
    const foot=[[-15,12],[-10,17],[-5,19],[5,19],[10,17],[15,12]];
    polygon(ctx,foot,bronze,'#8d805d');grain(ctx,foot,16,'#d9c69d',14);
    stroke(ctx,'#61583e',2,[[-12,-17],[-15,10],[15,10],[12,-17]]);
    stroke(ctx,'#bea26d',.8,[[-11,-15],[-13,8]]);stroke(ctx,'#a28b62',1,[[12,-16],[14,9]]);
    stroke(ctx,'#8b7850',.8,[[-12,-10],[12,8]]);stroke(ctx,'#5b604c',.7,[[11,-11],[-11,8]]);
    stroke(ctx,'#e0c494',.5,[[-10,-23],[-4,-24],[4,-24],[10,-22]]);
    for(let i=0;i<6;i++)stroke(ctx,'#393e31',.5,[[i*3-8,13],[i*3-7,15]]);
    ctx.beginPath();ctx.arc(0,-28,5,Math.PI,TAU);ctx.strokeStyle='#9c855e';ctx.lineWidth=1.4;ctx.stroke();
    ctx.restore();
}

function ice(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.theme==='abyss-pull' && f.variant==='caster') {
        ctx.rotate(f.angle);const d=Math.hypot(f.dx,f.dy), head=d*(1-ease((p-.25)/.55));
        for(let i=0;i<(f.lite?3:6);i++) {
            ctx.beginPath();ctx.moveTo(0,(i-2)*3);ctx.bezierCurveTo(d*.25,-16+Math.sin(p*15+i)*9,d*.6,12-i*4,Math.max(10,head),0);
            ctx.strokeStyle=i%2?'#829ca4':'#263e50';ctx.lineWidth=i===0?3:1;ctx.stroke();
        }return;
    }
    if(f.variant==='area') return;
    const ward=f.theme==='abyss-ward', cast=f.variant==='caster';
    if(cast){fragments(ctx,p,'#3f5865',f.lite?4:8,42,23);return;}
    ctx.save();ctx.globalAlpha*=Math.min(1,p*8)*(1-clamp((p-.65)/.35));
    const spread=ward?ease(p/.26):1-ease(p/.65);
    // Low, weighty ice plates surround the feet; the face and health bar stay readable.
    for(let i=0;i<(ward?4:3);i++){
        const x=((i-(ward?1.5:1))*(ward?19:26)+(noise(i+12)-.5)*7)*spread, y=15+noise(i+8)*2;
        const h=ward?19+noise(i+6)*12:30;
        const plate=[[x-10,y],[x-9,y-h*.6],[x+1,y-h],[x+8,y-h*.45],[x+11,y+3],[x-3,y+7]];
        const glass=ctx.createLinearGradient(x-10,y-h,x+12,y+7);
        glass.addColorStop(0,'rgba(206,228,226,.7)');glass.addColorStop(.17,'rgba(110,163,179,.43)');glass.addColorStop(.49,'rgba(51,90,109,.68)');glass.addColorStop(.59,'rgba(181,215,214,.56)');glass.addColorStop(1,'rgba(42,72,88,.45)');
        polygon(ctx,plate,glass,'#91afb7');
        grain(ctx,plate,i*7+3,'#eff0db',f.lite?12:32);
        polygon(ctx,[[x-9,y-h*.6],[x+1,y-h],[x+1,y+4]],'rgba(174,211,216,.25)');
        stroke(ctx,'#e9e8d2',.7,[[x-9,y-h*.6],[x+1,y-h],[x+8,y-h*.45]]);
        stroke(ctx,'rgba(32,56,76,.6)',.65,[[x+1,y-h],[x-1,y-8],[x+5,y-3],[x+2,y+3]]);
        stroke(ctx,'#b6d0ce',.5,[[x-1,y-8],[x-5,y-4],[x-4,y+2]]);
    }
    ctx.restore();if(!ward)fragments(ctx,clamp((p-.25)/.75),'#597c8d',f.lite?5:10,44,17);
}

function timeSwap(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.variant==='area')return;
    const dir=f.variant==='caster'?-1:1, slide=Math.sin(p*Math.PI)*23*dir;
    const a=1-clamp((p-.68)/.32);ctx.save();ctx.globalAlpha*=a;
    for(let i=0;i<4;i++) {
        const y=-32+i*16,x=slide*(i%2?1:-.65);
        ctx.save();ctx.translate(x,0);ctx.beginPath();ctx.rect(-28,y,56,14);ctx.clip();
        if(f.image?.complete && f.image.naturalWidth) {ctx.globalAlpha*=.68;ctx.drawImage(f.image,-28,-32,56,64);}
        else {const g=ctx.createLinearGradient(-28,y,28,y+14);g.addColorStop(0,'#273845');g.addColorStop(.5,'#aab9b4');g.addColorStop(1,'#625c76');ctx.fillStyle=g;ctx.fillRect(-28,y,56,14);}
        ctx.restore();stroke(ctx,i%2?'#c6b28d':'#627b8d',.8,[[-31+x,y+14],[21+x,y+14],[29+x,y+10]]);
    }
    // A shutter cuts the image; the time ticks break apart instead of forming a portal ring.
    if(p<.55){stroke(ctx,'#fff3d4',1.6,[[-45,slide*.4],[43,-slide*.4]]);}
    for(let i=0;i<7;i++){const x=-32+i*10;stroke(ctx,'#86745c',.9,[[x,38],[x+slide*.5,32+(i%3)*2]]);}
    fragments(ctx,p,'#857e8d',f.lite?4:8,43,33);ctx.restore();
}

function coldStar(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.variant==='area')return;
    if(f.variant==='caster'){stroke(ctx,'#7194a4',1,[[-13,8],[3,-6],[15,-9]]);return;}
    ctx.save();ctx.rotate(f.angle-.7);ctx.globalAlpha*=1-clamp((p-.32)/.4);
    const sweep=ease(p/.24);ctx.translate((1-sweep)*-25,0);
    polygon(ctx,[[-73,-2],[-14,-4],[58,0],[-12,3]],'#446878');
    polygon(ctx,[[-68,-.6],[-10,-1.3],[60,0],[-8,1]],'#fffbe5');
    stroke(ctx,'#9ebcc6',.9,[[-46,9],[-10,5],[28,4]]);ctx.restore();
    if(p<.34) {
        ctx.save();ctx.globalAlpha*=1-p/.34;
        polygon(ctx,[[0,-31],[2,-3],[25,0],[3,2],[0,18],[-2,3],[-19,0],[-3,-2]],'#fffbe8');ctx.restore();
    } fragments(ctx,clamp((p-.08)/.86),'#557f90',f.lite?6:13,58,7);
    sparks(ctx,p,'#94aeb5',f.lite?4:9,38);
}

function rune(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.variant==='area')return;
    ctx.save();ctx.globalAlpha*=Math.min(1,p*10)*(1-clamp((p-.65)/.35));
    if(f.variant==='caster'){stroke(ctx,'#6a5b78',2,[[-19,15],[-5,-5],[14,-13],[9,-2]]);ctx.restore();return;}
    const y=-24-Math.sin(p*Math.PI)*12;ctx.translate(0,y);
    ctx.translate(0,-18);
    ctx.save();ctx.beginPath();ctx.rect(-25,-24,50,48*ease(p/.25));ctx.clip();
    ctx.font='32px "KaiTi", "STKaiti", serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#5a4764';ctx.fillText('敕',0,0);ctx.strokeStyle='#baa172';ctx.lineWidth=.3;ctx.strokeText('敕',0,0);ctx.restore();
    // Two broken seal corners, not another enclosing circle.
    stroke(ctx,'#a28b58',.8,[[-23,-11],[-23,-22],[-12,-22]]);
    stroke(ctx,'#a28b58',.8,[[23,10],[23,21],[13,21]]);
    ctx.restore();ctx.save();ctx.globalAlpha*=1-clamp((p-.5)/.5);
    for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-34+i*7,25);ctx.bezierCurveTo(-20,6,20,8,32-i*5,-10-ease(p)*22);ctx.strokeStyle=i===1?'#ac8d51':'#7c678d';ctx.lineWidth=i===1?1.5:.8;ctx.stroke();}
    if(p>.24 && p<.6){stroke(ctx,'#b49a64',1.4,[[-18,32],[13,32],[7,26]]);}ctx.restore();
}

function moon(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.variant==='area')return;
    ctx.save();ctx.globalAlpha*=Math.min(1,p*8)*(1-clamp((p-.7)/.3));
    // Reflection stays below the portrait and breaks into water streaks as it rises.
    if(f.image?.complete && f.image.naturalWidth){
        ctx.save();ctx.beginPath();ctx.ellipse(0,27,33,17,0,0,TAU);ctx.clip();ctx.globalAlpha*=.4*(f.variant==='caster'?1-p:p);
        ctx.translate(0,54);ctx.scale(1,-.55);ctx.drawImage(f.image,-25,0,50,57);ctx.restore();
    }
    for(let i=0;i<5;i++){
        ctx.beginPath();ctx.ellipse(Math.sin(i+p*5)*2,27+i*.5,14+i*6+ease(p)*6,3+i*1.6,0,.2+i*.35,2.6+i*.2);
        ctx.strokeStyle=i%2?'#526c82':'#bec9c3';ctx.lineWidth=i===0?1.3:.6;ctx.stroke();
    }
    if(f.variant!=='caster'){
        ctx.translate(0,-30-ease(p)*13);ctx.beginPath();ctx.arc(0,0,17,-1.8,1.7);ctx.quadraticCurveTo(14,2,-4,-16);ctx.closePath();
        const silver=ctx.createLinearGradient(-10,-17,17,17);silver.addColorStop(0,'#52697d');silver.addColorStop(.5,'#ece6ca');silver.addColorStop(1,'#839cab');ctx.fillStyle=silver;ctx.fill();
        for(let i=0;i<4;i++){const x=(noise(i+5)-.5)*58;stroke(ctx,'#819eab',.8,[[x,30+p*7],[x,33+p*7]]);}
    }ctx.restore();
}

function dread(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.variant==='area')return;
    if(f.theme==='dread-arrow' && f.variant==='caster'){
        ctx.rotate(f.angle);const d=Math.hypot(f.dx,f.dy), x=ease(p/.7)*d;
        for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(Math.max(0,x-45),i*2-2);ctx.quadraticCurveTo(x-22,Math.sin(p*17+i)*6,x,0);ctx.strokeStyle=i===1?'#692d3d':'#493544';ctx.lineWidth=2-i*.5;ctx.stroke();}
        ctx.translate(x,0);polygon(ctx,[[9,0],[-5,-4],[-2,0],[-5,4]],'#31242f','#bf837d');stroke(ctx,'#995b63',1,[[-22,0],[3,0]]);return;
    }
    if(f.variant==='caster'){fragments(ctx,p,'#554051',5,25,44);return;}
    const arrow=f.theme==='dread-arrow', reach=arrow?25:43;
    ctx.save();ctx.globalAlpha*=Math.min(1,p*10)*(1-clamp((p-.64)/.36));
    for(let i=0;i<3;i++) {
        ctx.save();ctx.rotate(i*1.33+.3);
        const r=reach*(1-ease(p/.6)*.23);
        // Curved, irregular thorn branches, with the dark mass kept off the target's face.
        const branch=ctx.createLinearGradient(-r,0,r,-r);branch.addColorStop(0,'rgba(51,37,46,.05)');branch.addColorStop(.3,'#48323e');branch.addColorStop(.72,'#764350');branch.addColorStop(1,'#ad7976');
        ctx.beginPath();ctx.moveTo(-r-10,15);ctx.bezierCurveTo(-r+4,18,-r,-r*.55,-8,-r);ctx.bezierCurveTo(9,-r-7,19,-r+4,r+8,-r+6);
        ctx.strokeStyle=branch;ctx.lineWidth=arrow?1.7:2.7;ctx.stroke();
        ctx.beginPath();ctx.moveTo(-r+1,10);ctx.bezierCurveTo(-r+2,-13,-19,-r,-8,-r);ctx.strokeStyle='#b08080';ctx.lineWidth=.55;ctx.stroke();
        for(let j=0;j<4;j++){
            const x=-r+8+j*10,y=-Math.sqrt(Math.max(0,r*r-x*x))+(noise(i*5+j)-.5)*4;
            polygon(ctx,[[x-2,y+2],[x+noise(j+7)*5,y-7-noise(j+2)*4],[x+3,y]],'#563441','#97616a');
        }ctx.restore();
    }
    if(p<.35){stroke(ctx,'#c19a92',1.3,[[-15,-23],[-2,-4],[5,-8],[0,8],[13,25]]);}
    ctx.restore();fragments(ctx,p,'#684052',f.lite?4:9,38,31);
}

function wind(ctx: Ctx, f: CraftedFrame, p: number) {
    if(f.theme==='wind-corridor'){
        if(f.variant==='caster')return;
        ctx.save();ctx.rotate(f.angle);ctx.globalAlpha*=Math.min(1,p*7)*(1-clamp((p-.72)/.28));
        for(let i=0;i<3;i++){
            const center=(i-1)*13,points:number[][]=[],back:number[][]=[];
            for(let j=0;j<=24;j++){
                const q=j/24,x=q*96-48,y=center+Math.sin(q*4-p*10+i)*3;
                points.push([x,y]);back.push([x,y+Math.sin(q*Math.PI)*(i===1?3:1.5)]);
            }
            const wash=ctx.createLinearGradient(-48,0,48,0);wash.addColorStop(0,'rgba(80,110,117,0)');wash.addColorStop(.45,'rgba(80,110,117,.35)');wash.addColorStop(.8,'rgba(180,192,176,.4)');wash.addColorStop(1,'rgba(80,110,117,0)');
            polygon(ctx,[...points,...back.reverse()],wash);stroke(ctx,i===1?'#688b8e':'#a6b5a7',.6,points.slice(4,21));
            const x=(p*145+i*29)%90-45,y=center+Math.sin(x*.04-p*10+i)*3;
            stroke(ctx,'#779893',.9,[[x-6,y],[x,y-1]]);
        }ctx.restore();return;
    }
    if(f.variant==='area')return;
    if(f.variant==='caster'){fragments(ctx,p,'#9aa69c',5,24,51);return;}
    if(f.variant==='impact'){sparks(ctx,p,'#668a88',f.lite?4:8,34);return;}
    ctx.save();ctx.globalAlpha*=Math.min(1,p*9)*(1-clamp((p-.65)/.35));
    const r=27+ease(p)*34;
    for(let i=0;i<(f.lite?3:6);i++){
        const a=p*6+i*.9, points:number[][]=[],edge:number[][]=[];
        for(let j=0;j<=24;j++) {const q=j/24, t=a+q*2.4, rad=r*(.25+.75*q);const x=Math.cos(t)*rad,y=Math.sin(t)*rad*.46-(i%3)*14;
            points.push([x,y]);edge.push([x,y-Math.sin(q*Math.PI)*(i%2?3:6)]);}
        const ribbon=[...points,...edge.reverse()];
        const wash=ctx.createLinearGradient(-r,-25,r,22);wash.addColorStop(0,'rgba(49,86,94,.08)');wash.addColorStop(.4,i%2?'rgba(122,148,143,.5)':'rgba(69,110,117,.6)');wash.addColorStop(1,'rgba(189,196,173,.15)');
        polygon(ctx,ribbon,wash);stroke(ctx,i%2?'#a6b4a9':'#5c8589',.65,points.slice(5,21));
        grain(ctx,ribbon,i*9+4,'#e4ddc5',f.lite?8:20);
    }
    for(let i=0;i<5;i++){
        const a=i*1.3+p*5,x=Math.cos(a)*r,y=Math.sin(a)*r*.52-8;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);polygon(ctx,[[-5,0],[0,-2],[7,0],[0,1.5]],i%2?'#68817b':'#d0cbb2');ctx.restore();
    }ctx.restore();
}

/** Coordinates are in cell units: 100 px is one cell. No gameplay state is changed. */
export function drawCraftedFrame(ctx: Ctx, f: CraftedFrame) {
    if(f.time<0 || f.time>f.duration) return;
    const p=clamp(f.time/f.duration);ctx.save();
    ctx.globalAlpha*=1-clamp((p-.88)/.12);
    ctx.lineCap='butt';ctx.lineJoin='miter';
    switch(f.theme){
        case 'particle-beam':case 'particle-burst':particle(ctx,f,p);break;
        case 'soul-array':case 'soul-cycle':soul(ctx,f,p);break;
        case 'abyss-pull':case 'abyss-ward':ice(ctx,f,p);break;
        case 'time-swap':timeSwap(ctx,f,p);break;
        case 'cold-star':coldStar(ctx,f,p);break;
        case 'rune-awaken':rune(ctx,f,p);break;
        case 'moon-double':moon(ctx,f,p);break;
        case 'dread-arrow':case 'dread-curse':dread(ctx,f,p);break;
        case 'wind-vortex':case 'wind-corridor':wind(ctx,f,p);break;
    }ctx.restore();
}
