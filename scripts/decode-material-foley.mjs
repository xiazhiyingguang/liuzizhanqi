/** Decode source MP3s with the same Web Audio decoder used by the game; no codec dependency. */
import { createServer } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { launchBrowser } from './e2e/browser-harness.mjs';
import { encodeWav } from './generate-skill-sounds.mjs';

const dir = resolve('assets/audio-source/materials');
const sources = JSON.parse(await readFile(join(dir, 'sources.json'), 'utf8'));
const server = createServer(async (req, res) => {
    if (req.url === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script>window.foleyReady=true</script>'); return; }
    const file = resolve(dir, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(dir + sep)) { res.writeHead(403).end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }).end(data); }
    catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let session;
try {
    session = await launchBrowser({ baseUrl: 'data:text/html,<script>window.__SIX_CHESS_E2E__={}</script>', label: 'foley-source-decode' });
    await session.page.send('Page.navigate', { url: origin + '/blank.html' });
    await session.page.waitForExpression('window.foleyReady', 'source decoder loaded');
    await session.page.evaluate('window.sourceContext = new AudioContext({sampleRate:44100})');
    for (const source of sources) {
        if (await access(join(dir, source.key + '.wav')).then(() => true, () => false)) continue;
        const result = await session.page.evaluate(`(async()=>{
            const decoded=await sourceContext.decodeAudioData(await (await fetch('/${source.key}.mp3')).arrayBuffer());
            const n=Math.min(decoded.length,44100*30),mono=new Float32Array(n);
            for(let c=0;c<decoded.numberOfChannels;c++){const data=decoded.getChannelData(c);for(let i=0;i<n;i++)mono[i]+=data[i]/decoded.numberOfChannels;}
            const bytes=new Uint8Array(mono.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
            return {duration:decoded.duration,sampleRate:decoded.sampleRate,base64:btoa(binary)};
        })()`);
        const bytes = Buffer.from(result.base64, 'base64');
        const floats = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        await writeFile(join(dir, source.key + '.wav'), encodeWav(floats));
        console.log(source.key, result.duration.toFixed(3), 'seconds; decoded at', result.sampleRate);
    }
} finally {
    await session?.close();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
}
