import { useEffect, useRef, type CSSProperties } from 'react';
import { computeFxImpactDelayMs, computeFxTailMs, computeFxTravelMs, type Position, type SkillFxEvent } from '../../core/skill-fx';
import { craftedVariantVisible, drawCraftedFrame, type CraftedFxVariant } from '../../core/crafted-skill-fx';
import { isLowQuality } from '../../core/render-quality';
import '../../styles/crafted-skill-fx.css';

export function CraftedSkillFx({ event, variant, atPos }: {
    event: SkillFxEvent; variant: CraftedFxVariant; atPos?: Position;
}) {
    const ref=useRef<HTMLCanvasElement>(null);
    const theme=event.profile.crafted;
    const emptyPull=theme==='abyss-pull' && variant==='target' && !!event.damagePositions?.length
        && !event.damagePositions.some(([r,c])=>r===event.targetPos[0] && c===event.targetPos[1]);
    const visible=craftedVariantVisible(theme,variant) && !emptyPull;
    const cell=atPos ?? event.targetPos;
    const row=cell[0], col=cell[1];
    const clockDuration=event.profile.durationMs+computeFxTailMs(event)+200;
    useEffect(()=>{
        const canvas=ref.current;
        if(!canvas || !theme || !visible)return;
        const host=canvas.parentElement!;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const lite=isLowQuality();
        const media=window.matchMedia('(prefers-reduced-motion: reduce)');
        const cross=variant==='caster' && ['particle-beam','abyss-pull','dread-arrow','soul-cycle','wenren-leap','wenren-leap-zhaoshen'].includes(theme);
        let endpoint=event.targetPos;
        if(theme==='particle-beam'){
            const vx=endpoint[1]-event.fromPos[1],vy=endpoint[0]-event.fromPos[0];
            let far=vx*vx+vy*vy;
            for(const candidate of [...(event.coveredPositions??[]),...(event.damagePositions??[])]){
                const x=candidate[1]-event.fromPos[1],y=candidate[0]-event.fromPos[0],projection=x*vx+y*vy;
                if(Math.abs(x*vy-y*vx)<.001 && projection>far){endpoint=candidate;far=projection;}
            }
        }
        const dx=cross?endpoint[1]-event.fromPos[1]:0;
        const dy=cross?endpoint[0]-event.fromPos[0]:0;
        let scale=1,ox=0,oy=0,deltaX=0,deltaY=0;
        let frame=0,stopped=false;
        const recipient=host.closest('.battle-board-cell, .replay-board-cell, .skill-fx-stage-cell');
        const image=recipient?.querySelector<HTMLImageElement>('img') ?? undefined;
        // Empty ward cells carry no shield; occupied recipients get a separate ice plate contact.
        if(variant==='area' && theme==='abyss-ward' && !recipient?.querySelector(`.battle-board-piece.piece-${event.owner==='player1'?'p1':'p2'}, .skill-fx-stage-piece`))return;
        const delay=variant==='caster'?0:theme==='dread-arrow'
            ?computeFxImpactDelayMs(event,[row,col])
            :theme==='particle-beam'?Math.min(230,computeFxImpactDelayMs(event,[row,col]))
            :computeFxImpactDelayMs(event,[row,col]);
        const duration=theme==='dread-arrow' && variant==='caster'
            ?90+computeFxTravelMs(event):event.profile.durationMs;
        const resize=()=>{
            const r=host.getBoundingClientRect();const unit=r.width;
            if(unit<=0)return;
            const gap=parseFloat(getComputedStyle(host.closest('.battle-board-grid, .skill-fx-stage-grid') ?? host).columnGap)||6;
            const step=unit+gap,margin=unit*1.05;
            const w=unit*2.1+Math.abs(dx)*step,h=unit*2.1+Math.abs(dy)*step;
            const dpr=Math.min(lite?1.5:2,window.devicePixelRatio||1);
            canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;
            canvas.style.left=`${unit*.5-margin-Math.max(0,-dx)*step}px`;
            canvas.style.top=`${r.height*.5-margin-Math.max(0,-dy)*step}px`;
            canvas.width=Math.ceil(w*dpr);canvas.height=Math.ceil(h*dpr);
            scale=unit/100*dpr;ox=(margin+Math.max(0,-dx)*step)*dpr;oy=(margin+Math.max(0,-dy)*step)*dpr;
            deltaX=dx*step/unit*100;deltaY=dy*step/unit*100;
        };
        const clear=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);};
        const started=performance.now();
        const draw=()=>{
            if(stopped)return;
            clear();
            if(document.hidden)return;
            const clock=canvas.getAnimations()[0]?.currentTime;
            const elapsed=typeof clock==='number'?clock:performance.now()-started;
            const time=media.matches?Math.min(duration*.38,420):elapsed-delay;
            ctx.setTransform(scale,0,0,scale,ox,oy);
            // Secondary victims receive smaller fragments, never a copied full whirlwind.
            const small=variant==='impact' && ['wind-vortex','particle-burst'].includes(theme);
            if(small)ctx.scale(.55,.55);
            drawCraftedFrame(ctx,{theme,variant:variant==='area' && theme==='abyss-ward'?'target':variant,
                time,duration,dx:deltaX,dy:deltaY,angle:event.angleDeg*Math.PI/180,lite,image});
            if(!media.matches && elapsed<clockDuration)frame=requestAnimationFrame(draw);
        };
        const resume=()=>{cancelAnimationFrame(frame);draw();};
        const observer=new ResizeObserver(()=>{resize();resume();});observer.observe(host);resize();draw();
        document.addEventListener('visibilitychange',resume);media.addEventListener('change',resume);
        return()=>{stopped=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',resume);media.removeEventListener('change',resume);clear();};
    },[event,theme,variant,row,col,visible,clockDuration]);
    if(!visible)return null;
    return <span className="crafted-fx-viewport">
        <canvas ref={ref} width={1} height={1} className="crafted-fx-canvas" data-crafted={theme} data-crafted-variant={variant}
            style={{'--crafted-clock':`${clockDuration}ms`} as CSSProperties} aria-hidden="true" />
    </span>;
}
