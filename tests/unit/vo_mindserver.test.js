// v0.1.4.13, the live voice (docs/releases/0.1.4.13/HANDOFF-voice.md, 1, 4 and 5): the mindserver with voice_ui off
// and on. Off: nothing of the voice is imported or served, the page learns that the voice is off. On with an empty
// voice folder: no child is started, the page gets the setup texts, the bot plays on. A real mindserver on a free port
// of localhost and a socket.io client; no bot, no whisper, no audio.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { readRepoFile } from '../helpers/source_ast.js';

const M = await loadSrc('src/mindcraft/mindserver.js');

function waitFor(socket, event, check = () => true, ms = 20000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, on);
            reject(new Error(`no ${event} in ${ms} ms`));
        }, ms);
        const on = (data) => {
            if (!check(data)) return;
            clearTimeout(timer);
            socket.off(event, on);
            resolve(data);
        };
        socket.on(event, on);
    });
}

async function start(voiceOptions) {
    const server = M.createMindServer(false, 0, voiceOptions);
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://localhost:${server.address().port}`;
    const client = connect(url, { transports: ['websocket'], reconnection: false });
    await waitFor(client, 'connect');
    return { server, url, client };
}

async function stop({ client }) {
    client.disconnect();
    M.getVoice()?.close();
    await new Promise((resolve) => M.getIO().close(() => resolve()));
}

describe('mindserver.js source: the voice only behind voice_ui', () => {
    test('no static import of the voice; the dynamic one is inside if (voice_options?.voice_ui)', () => {
        const source = readRepoFile('src/mindcraft/mindserver.js').replace(/\r\n/g, '\n');
        assert.doesNotMatch(source, /^import .*voice/m);
        const at = source.indexOf("import('./voice/voice_server.js')");
        assert.ok(at > 0);
        const guard = source.lastIndexOf('if (voice_options?.voice_ui) {', at);
        assert.ok(guard > 0 && at - guard < 200, 'the import sits right inside the switch');
    });
});

describe('voice_ui off', () => {
    let ctx;
    let cap;
    before(async () => {
        cap = captureConsole();
        ctx = await start({});
    });
    after(async () => {
        await stop(ctx);
        cap.restore();
    });

    test('voice-join: the page learns that the voice is off', async () => {
        const answer = waitFor(ctx.client, 'voice-config');
        ctx.client.emit('voice-join');
        assert.deepEqual(await answer, { enabled: false });
        assert.equal(M.getVoice(), null);
    });

    test('the page and its files are served; the vendor files of the voice are not', async () => {
        for (const [file, type] of [['/', /html/], ['/app.js', /javascript/], ['/chat_logic.js', /javascript/], ['/style.css', /css/], ['/settings_spec.json', /json/]]) {
            const res = await fetch(ctx.url + file);
            assert.equal(res.status, 200, file);
            assert.match(res.headers.get('content-type'), type, file);
            await res.arrayBuffer();
        }
        const vad = await fetch(`${ctx.url}/vendor/vad/bundle.min.js`);
        assert.equal(vad.status, 404);
        await vad.arrayBuffer();
    });
});

describe('voice_ui on, the engines not installed', () => {
    let ctx;
    let cap;
    let dir;
    const saved = {};
    before(async () => {
        cap = captureConsole();
        dir = makeTmpDir();
        for (const k of ['MC_VOICE_DIR', 'WHISPER_PORT']) saved[k] = process.env[k];
        process.env.MC_VOICE_DIR = dir;
        process.env.WHISPER_PORT = '1'; // never probed: the binary is missing first
        ctx = await start({ voice_ui: true, voice_voice: 'supertonic:F1', voice_language: 'en' });
    });
    after(async () => {
        await stop(ctx);
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        removeTmpDir(dir);
        cap.restore();
    });

    test('voice-join: both engines fail with the setup command, no child is started', async () => {
        const failed = waitFor(ctx.client, 'voice-config', (c) => c.stt?.state === 'failed' && c.tts?.state === 'failed');
        ctx.client.emit('voice-join');
        const cfg = await failed;
        assert.equal(cfg.enabled, true);
        assert.equal(cfg.stt.message, 'whisper is not installed: run npm run voice:setup (about 1.6 GB).');
        assert.equal(cfg.tts.message, 'Supertonic is not installed: run npm run voice:setup (about 1.6 GB).');
        assert.equal(M.getVoice().config.dir, dir);
    });

    test('an utterance while whisper is missing: the page gets the text, the turn ends idle', async () => {
        ctx.client.emit('settings', { agent: 'Claude', from: 'MartyByrde2' });
        const error = waitFor(ctx.client, 'error_msg');
        const idle = waitFor(ctx.client, 'status', (s) => s.stage === 'idle');
        ctx.client.emit('utterance', new Float32Array(1600).buffer);
        assert.equal((await error).message, 'whisper is not installed: run npm run voice:setup (about 1.6 GB).');
        await idle;
    });

    test('the vendor files of the VAD are served from node_modules when they are installed', async (t) => {
        const res = await fetch(`${ctx.url}/vendor/vad/bundle.min.js`);
        await res.arrayBuffer();
        if (res.status === 404) t.skip('npm install has not installed @ricky0123/vad-web');
        else assert.equal(res.status, 200);
    });
});
