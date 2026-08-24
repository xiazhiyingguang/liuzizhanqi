import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function isReadable(filePath) {
    if (!filePath) return false;
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function findBrowserExecutable() {
    const pathEntries = (process.env.PATH || '').split(path.delimiter);
    const pathNames = process.platform === 'win32'
        ? ['chrome.exe', 'msedge.exe']
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
    const candidates = [
        process.env.E2E_BROWSER_PATH,
        process.env.CHROME_PATH,
        process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
        process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : null,
        process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
        process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
        process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
        ...pathEntries.flatMap(entry => pathNames.map(name => path.join(entry, name))),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (await isReadable(candidate)) return candidate;
    }
    throw new Error('未找到 Chrome 或 Edge。请通过 E2E_BROWSER_PATH 指定 Chromium 浏览器可执行文件。');
}

export async function waitForHttp(url, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await delay(100);
    }
    throw new Error(`等待服务超时：${url}${lastError ? `（${lastError.message}）` : ''}`);
}

export function runCommand(command, args, { cwd, env = process.env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            shell: process.platform === 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk.toString(); });
        child.stderr.on('data', chunk => { output += chunk.toString(); });
        child.once('error', reject);
        child.once('exit', code => {
            if (code === 0) resolve(output);
            else reject(new Error(`${command} ${args.join(' ')} 失败（${code}）\n${output}`));
        });
    });
}

export async function startGameServer(projectRoot) {
    await runCommand('npm', ['run', 'build'], {
        cwd: projectRoot,
        env: { ...process.env, VITE_E2E: 'true' },
    });

    const port = await getFreePort();
    const output = [];
    const processHandle = spawn(process.execPath, ['server/server.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    processHandle.stdout.on('data', chunk => output.push(chunk.toString()));
    processHandle.stderr.on('data', chunk => output.push(chunk.toString()));

    try {
        await waitForHttp(`http://127.0.0.1:${port}/`, 20_000);
    } catch (error) {
        processHandle.kill();
        throw new Error(`${error.message}\n${output.join('')}`);
    }

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
            if (processHandle.exitCode === null) {
                processHandle.kill();
                await Promise.race([
                    new Promise(resolve => processHandle.once('exit', resolve)),
                    delay(2_000),
                ]);
            }
        },
    };
}

class CdpPage {
    constructor(webSocketUrl, label) {
        this.webSocketUrl = webSocketUrl;
        this.label = label;
        this.sequence = 0;
        this.pending = new Map();
        this.errors = [];
    }

    async connect() {
        this.socket = new WebSocket(this.webSocketUrl);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`${this.label} 浏览器连接超时`)), 10_000);
            this.socket.addEventListener('open', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            this.socket.addEventListener('error', event => {
                clearTimeout(timeout);
                reject(new Error(`${this.label} 浏览器连接失败：${event.message || 'WebSocket error'}`));
            }, { once: true });
        });
        this.socket.addEventListener('message', event => {
            if (process.env.E2E_DEBUG) console.log(`[E2E CDP ${this.label}] message`, typeof event.data, String(event.data).slice(0, 500));
            this.onMessage(event.data).catch(error => this.errors.push(`CDP 消息解析失败：${error.message}`));
        });
        await this.send('Runtime.enable');
        await this.send('Page.enable');
    }

    async onMessage(raw) {
        if (typeof raw !== 'string') {
            if (raw instanceof Blob) raw = await raw.text();
            else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString('utf8');
            else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
            else raw = String(raw);
        }
        const message = JSON.parse(raw);
        if (message.id) {
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            clearTimeout(request.timeout);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            this.errors.push(message.params?.exceptionDetails?.text || '页面发生未捕获异常');
        }
    }

    send(method, params = {}) {
        const id = ++this.sequence;
        if (process.env.E2E_DEBUG) console.log(`[E2E CDP ${this.label}] send`, id, method, this.socket.readyState);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${this.label} 执行 ${method} 超时`));
            }, 15_000);
            this.pending.set(id, { resolve, reject, timeout });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        });
        if (response.exceptionDetails) {
            const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
            throw new Error(`${this.label} 页面脚本失败：${description}`);
        }
        return response.result?.value;
    }

    async waitForExpression(expression, description, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        let lastError;
        while (Date.now() < deadline) {
            try {
                if (await this.evaluate(`Boolean(${expression})`)) return;
            } catch (error) {
                lastError = error;
            }
            await delay(75);
        }
        const body = await this.bodyText().catch(() => '');
        throw new Error(`${this.label} 等待“${description}”超时${lastError ? `：${lastError.message}` : ''}\n当前页面：${body.slice(0, 800)}`);
    }

    async waitForTestId(testId, timeoutMs = 15_000) {
        const id = JSON.stringify(testId);
        await this.waitForExpression(
            `[...document.querySelectorAll('[data-testid]')].some(element => element.getAttribute('data-testid') === ${id})`,
            `测试节点 ${testId}`,
            timeoutMs
        );
    }

    async click(testId) {
        const id = JSON.stringify(testId);
        await this.evaluate(`(() => {
            const testId = ${id};
            const element = [...document.querySelectorAll('[data-testid]')]
                .find(candidate => candidate.getAttribute('data-testid') === testId);
            if (!element) throw new Error('找不到测试节点：' + testId);
            if ('disabled' in element && element.disabled) throw new Error('测试节点当前不可点击：' + testId);
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.click();
            return true;
        })()`);
    }

    async clickByText(text) {
        const expected = JSON.stringify(text);
        await this.evaluate(`(() => {
            const text = ${expected};
            const element = [...document.querySelectorAll('button')]
                .find(candidate => candidate.textContent && candidate.textContent.includes(text));
            if (!element) throw new Error('找不到按钮文本：' + text);
            if (element.disabled) throw new Error('按钮当前不可点击：' + text);
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.click();
            return true;
        })()`);
    }

    async setInput(testId, value) {
        const id = JSON.stringify(testId);
        const nextValue = JSON.stringify(value);
        await this.evaluate(`(() => {
            const testId = ${id};
            const input = [...document.querySelectorAll('[data-testid]')]
                .find(candidate => candidate.getAttribute('data-testid') === testId);
            if (!(input instanceof HTMLInputElement)) throw new Error('找不到输入框：' + testId);
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${nextValue});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return input.value;
        })()`);
    }

    bodyText() {
        return this.evaluate('document.body?.innerText || ""');
    }

    snapshot() {
        return this.evaluate('window.__SIX_CHESS_E2E__?.snapshot()');
    }

    async screenshot() {
        const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        return result.data;
    }

    async close() {
        try {
            this.socket?.close();
        } catch {
            // 浏览器进程关闭时连接可能已经结束。
        }
    }
}

export async function launchBrowser({ baseUrl, label, headed = false }) {
    const executable = await findBrowserExecutable();
    const debugPort = await getFreePort();
    const profileDir = await mkdtemp(path.join(os.tmpdir(), 'six-chess-e2e-'));
    const args = [
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-extensions',
        '--disable-sync',
        '--disable-features=Translate,MediaRouter',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--window-size=1440,960',
    ];
    if (!headed) args.push('--headless=new', '--disable-gpu');

    const processHandle = spawn(executable, [...args, 'about:blank'], { stdio: 'ignore' });
    const debugOrigin = `http://127.0.0.1:${debugPort}`;
    await waitForHttp(`${debugOrigin}/json/version`, 15_000);
    const targetResponse = await fetch(`${debugOrigin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`${label} 无法创建浏览器页面`);
    const target = await targetResponse.json();
    const page = new CdpPage(target.webSocketDebuggerUrl, label);
    await page.connect();
    await page.waitForExpression(
        `document.readyState === 'complete' && Boolean(window.__SIX_CHESS_E2E__)`,
        '游戏页面和 E2E 桥接器加载',
        20_000
    );

    return {
        page,
        async close() {
            await page.close();
            if (processHandle.exitCode === null) {
                processHandle.kill();
                await Promise.race([
                    new Promise(resolve => processHandle.once('exit', resolve)),
                    delay(2_000),
                ]);
            }
            const resolvedProfile = path.resolve(profileDir);
            const resolvedTemp = path.resolve(os.tmpdir()) + path.sep;
            if (resolvedProfile.startsWith(resolvedTemp) && path.basename(resolvedProfile).startsWith('six-chess-e2e-')) {
                await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
            }
        },
    };
}
