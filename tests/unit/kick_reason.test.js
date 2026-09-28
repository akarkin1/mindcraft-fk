// Play test fix F4: kick reasons were printed as "[LoginGuard] Disconnected: [object Object]".
//
// Minecraft 1.21 sends the reason as NBT, every value wrapped as { type, value }. The fallback of
// parseKickReason (src/agent/connection_handler.js) took obj.value.translate, which is an object.
// The fallback must turn a plain string, a JSON string, a chat component ({ translate, text, with,
// extra }) and the same in NBT form into readable text, else the JSON of the reason. It never
// returns "[object Object]" and never throws. The keyword search for the known error types is
// unchanged.
//
// The module is imported with an empty temp directory as working directory.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importHandler() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/connection_handler.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const CH = await importHandler();

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
});

// NBT helpers, in the shape minecraft-protocol gives for 1.21 (prismarine-nbt).
const nStr = (value) => ({ type: 'string', value });
const nCompound = (value) => ({ type: 'compound', value });
const nList = (type, value) => ({ type: 'list', value: { type, value } });

// The reason of the play test log.
const PLAY_TEST_REASON = nCompound({ translate: nStr('multiplayer.disconnect.invalid_player_movement') });

function fallbackText(reason) {
    const result = CH.parseKickReason(reason);
    assert.equal(result.type, 'other', `type of ${JSON.stringify(result)}`);
    assert.equal(result.isFatal, true);
    assert.ok(result.msg.startsWith('Disconnected: '), result.msg);
    return result.msg.slice('Disconnected: '.length);
}

describe('parseKickReason: NBT (Minecraft 1.21)', () => {
    test('the reason of the play test log gives its translate key', () => {
        assert.equal(fallbackText(PLAY_TEST_REASON), 'multiplayer.disconnect.invalid_player_movement');
    });

    test('handleDisconnection prints and returns "[LoginGuard] Disconnected: <key>"', () => {
        const { type, msg } = CH.handleDisconnection('andy', PLAY_TEST_REASON);
        assert.equal(type, 'other');
        assert.equal(msg, '[LoginGuard] Disconnected: multiplayer.disconnect.invalid_player_movement');
        assert.ok(cap.allText().includes(msg), cap.allText());
        assert.ok(!cap.allText().includes('[object Object]'), cap.allText());
    });

    test('root compound with a name, text', () => {
        assert.equal(fallbackText({ type: 'compound', name: '', value: { text: nStr('Kicked by an operator') } }), 'Kicked by an operator');
    });

    test('a bare NBT string', () => {
        assert.equal(fallbackText(nStr('Goodbye')), 'Goodbye');
    });

    test('translate with a list of strings', () => {
        const reason = nCompound({
            translate: nStr('multiplayer.disconnect.kicked_by'),
            with: nList('string', ['Steve', 'Alex']),
        });
        assert.equal(fallbackText(reason), 'multiplayer.disconnect.kicked_by Steve Alex');
    });

    test('translate with a list of compounds', () => {
        const reason = nCompound({
            translate: nStr('chat.type.announcement'),
            with: nList('compound', [{ text: nStr('Server') }, { translate: nStr('gui.none') }]),
        });
        assert.equal(fallbackText(reason), 'chat.type.announcement Server gui.none');
    });

    test('text with extra (compounds, and the "" key of mixed lists)', () => {
        const reason = nCompound({
            text: nStr('You were kicked: '),
            extra: nList('compound', [{ text: nStr('AFK') }, { '': nStr(' for 10 minutes') }]),
        });
        assert.equal(fallbackText(reason), 'You were kicked: AFK for 10 minutes');
    });

    test('nested: an argument with its own extra', () => {
        const reason = nCompound({
            translate: nStr('multiplayer.disconnect.generic'),
            with: nList('compound', [{ text: nStr('Bye'), extra: nList('string', ['!', '!']) }]),
        });
        assert.equal(fallbackText(reason), 'multiplayer.disconnect.generic Bye!!');
    });
});

describe('parseKickReason: strings, JSON strings and chat components', () => {
    test('a plain string', () => {
        assert.equal(fallbackText('Goodbye'), 'Goodbye');
    });

    test('a JSON string with translate', () => {
        assert.equal(fallbackText('{"translate":"multiplayer.disconnect.idling"}'), 'multiplayer.disconnect.idling');
    });

    test('a JSON string with text and extra', () => {
        assert.equal(fallbackText('{"text":"Bye","extra":[{"text":" for now"}]}'), 'Bye for now');
    });

    test('a JSON string that is a string, and a JSON array', () => {
        assert.equal(fallbackText('"hello"'), 'hello');
        assert.equal(fallbackText('[{"text":"a"},"b",{"text":"c"}]'), 'abc');
    });

    test('a component with translate and with (strings and components)', () => {
        const reason = { translate: 'chat.type.announcement', with: ['Server', { text: 'Bye', extra: [{ text: '!' }] }] };
        assert.equal(fallbackText(reason), 'chat.type.announcement Server Bye!');
    });

    test('a component with text and extra', () => {
        assert.equal(fallbackText({ text: 'Kicked', extra: ['!', { text: ' Go away' }] }), 'Kicked! Go away');
    });

    test('a component with the type field of 1.20.3+ is not taken for NBT', () => {
        assert.equal(fallbackText({ type: 'translatable', translate: 'multiplayer.disconnect.idling' }), 'multiplayer.disconnect.idling');
    });

    test('line breaks become one line', () => {
        assert.equal(fallbackText({ text: 'Line one\nLine two' }), 'Line one Line two');
    });
});

describe('parseKickReason: nothing readable gives the JSON of the reason', () => {
    test('an object without text', () => {
        assert.equal(fallbackText({ foo: 1 }), '{"foo":1}');
    });

    test('translate that is an object (the old [object Object] case)', () => {
        assert.equal(fallbackText({ translate: { foo: 1 } }), '{"translate":{"foo":1}}');
    });

    test('an NBT compound without text', () => {
        const reason = nCompound({ color: nStr('red') });
        assert.equal(fallbackText(reason), JSON.stringify(reason));
    });

    test('an empty text', () => {
        assert.equal(fallbackText({ text: '' }), '{"text":""}');
    });
});

describe('parseKickReason: never throws, never [object Object]', () => {
    const cyclic = { foo: 1 };
    cyclic.self = cyclic;
    const cyclicWithText = { text: 'hi' };
    cyclicWithText.self = cyclicWithText;
    let deep = { text: 'bottom' };
    for (let i = 0; i < 20000; i++) deep = { extra: [deep] };
    const throwingProxy = new Proxy({}, {
        get() { throw new Error('no access'); },
        has() { throw new Error('no access'); },
        ownKeys() { throw new Error('no access'); },
        getOwnPropertyDescriptor() { throw new Error('no access'); },
        getPrototypeOf() { throw new Error('no access'); },
    });
    const throwingToJson = { toJSON() { throw new Error('no json'); } };
    const throwingGetter = Object.defineProperty({}, 'translate', { enumerable: true, get() { throw new Error('getter'); } });

    const inputs = [
        ['undefined', undefined], ['null', null], ['empty string', ''], ['0', 0], ['42', 42], ['true', true],
        ['NaN', NaN], ['a bigint', 10n], ['a symbol', Symbol('s')], ['a function', function named() {}],
        ['an Error', new Error('boom')], ['a cycle', cyclic], ['a cycle with text', cyclicWithText],
        ['20000 levels deep', deep], ['a proxy that throws', throwingProxy], ['toJSON throws', throwingToJson],
        ['a getter that throws', throwingGetter], ['an empty array', []], ['an empty object', {}],
        ['NBT list with nulls', nCompound({ extra: nList('compound', [null, undefined]) })],
        ['[object Object] as translate value', nCompound({ translate: { type: 'compound', value: {} } })],
    ];
    for (const [label, input] of inputs) {
        test(`${label}: a result with a string msg, no [object Object]`, () => {
            let result;
            assert.doesNotThrow(() => { result = CH.parseKickReason(input); });
            assert.equal(typeof result.type, 'string');
            assert.equal(typeof result.msg, 'string');
            assert.equal(typeof result.isFatal, 'boolean');
            assert.ok(!result.msg.includes('[object Object]'), result.msg);
            assert.ok(!cap.allText().includes('[object Object]'), cap.allText());
            let handled;
            assert.doesNotThrow(() => { handled = CH.handleDisconnection('andy', input); });
            assert.ok(!handled.msg.includes('[object Object]'), handled.msg);
        });
    }

    test('empty reasons keep the old answer', () => {
        for (const input of [undefined, null, '', 0]) {
            assert.deepEqual(CH.parseKickReason(input), { type: 'unknown', msg: 'Unknown reason (Empty)', isFatal: true });
        }
    });

    test('readable parts are used when there are any', () => {
        assert.equal(fallbackText(42), '42');
        assert.equal(fallbackText(cyclicWithText), 'hi');
        assert.ok(fallbackText(new Error('boom')).includes('boom'));
        assert.equal(fallbackText(deep).includes('[object Object]'), false);
    });
});

describe('parseKickReason: keyword search unchanged', () => {
    test('a string with a keyword', () => {
        assert.deepEqual(CH.parseKickReason('You are banned from this server'),
            { type: 'access_denied', msg: 'Access Denied: You are not whitelisted or banned.', isFatal: true });
        assert.equal(CH.parseKickReason('socketClosed').type, 'maintenance');
        assert.equal(CH.parseKickReason('keepAliveError').type, 'network_error');
    });

    test('NBT with a keyword', () => {
        assert.deepEqual(CH.parseKickReason(nCompound({ text: nStr('The server is full!') })),
            { type: 'server_full', msg: 'Connection Failed: The server is full.', isFatal: false });
        assert.equal(CH.parseKickReason(nCompound({ translate: nStr('multiplayer.disconnect.duplicate_login') })).type, 'name_conflict');
    });

    test('a component object with a keyword', () => {
        assert.equal(CH.parseKickReason({ text: 'You are sending too fast (spam)' }).type, 'behavior');
    });
});
