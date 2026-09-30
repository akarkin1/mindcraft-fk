// Spec v0.1.4.8, part F: F1 (the chat kick, S12) -- the checksum of the last seen messages that
// minecraft-protocol 1.62.0 sends with every chat of Minecraft 1.21.5 and later, and the patch
// patches/minecraft-protocol+1.62.0.patch.
//
// The client keeps the last seen signatures in a ring of 20 (LastSeenMessagesWithInvalidation of
// src/client/chat.js): message n goes to index (n - 1) % 20. getAcknowledgements() walks the ring
// from `offset`, which is the order of the window, oldest first, and so does the server. The old
// code computed the checksum with computeChatChecksum(client._lastSeenMessages), which walks the
// array in index order. Up to 20 messages both orders are the same; from message 21 on the newest
// signature sits at index 0 and the orders differ. The patch computes the checksum over the list of
// acknowledged signatures that getAcknowledgements() returns.
//
// Verified here: the real chat plugin of the installed package (patched) with a fake client; the
// packet `chat_message` and the command packet carry the checksum of the reference after every one
// of 25 messages; the old code matches the reference up to message 20 and not after it.
// Not verifiable here: the check of a real server. The test server runs in offline mode and does
// not sign chat, so its ring stays empty. The reference is written from the rule of the game
// (LastSeenMessages.computeChecksum of 1.21.5 and later), not taken from the server.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(repoPath('package.json'));
const chatPlugin = require('minecraft-protocol/src/client/chat.js');
const { computeChatChecksum } = require('minecraft-protocol/src/datatypes/checksums.js');

const VERSION = '1.21.8';
const RING = 20;
const MESSAGES = 25;

// ---- reference: the rule of the game ------------------------------------------------------

// java.util.Arrays.hashCode(byte[]): bytes are signed, int arithmetic wraps at 32 bits.
function javaArraysHashCode(bytes) {
    let hash = 1;
    for (const b of bytes)
        hash = (Math.imul(31, hash) + ((b << 24) >> 24)) | 0;
    return hash;
}

// LastSeenMessages.computeChecksum(): start 1; for each signature of the window, oldest first,
// 31 * value + the checksum of the signature; the low byte; 0 becomes 1. Returned as the unsigned
// byte that goes on the wire (the field is u8 in minecraft-data 1.21.8).
function referenceChecksum(windowOldestFirst) {
    let value = 1;
    for (const signature of windowOldestFirst)
        value = (Math.imul(31, value) + javaArraysHashCode(signature)) | 0;
    const b = (value << 24) >> 24;
    return (b === 0 ? 1 : b) & 0xff;
}

// ---- fixture: the old code of minecraft-protocol 1.62.0 -----------------------------------

// src/datatypes/checksums.js of 1.62.0, unchanged by the patch. Before the patch chat.js called it
// with the ring itself: computeChatChecksum(client._lastSeenMessages).
function oldComputeChatChecksum(lastSeenMessages) {
    if (!lastSeenMessages || lastSeenMessages.length === 0) return 1;
    let checksum = 1;
    for (const message of lastSeenMessages) {
        if (message.signature) {
            let sigHash = 1;
            for (let i = 0; i < message.signature.length; i++)
                sigHash = (31 * sigHash + message.signature[i]) & 0xffffffff;
            checksum = (31 * checksum + sigHash) & 0xffffffff;
        }
    }
    const result = checksum & 0xff;
    return result === 0 ? 1 : result;
}

// ---- the client ---------------------------------------------------------------------------

// Signatures of 256 bytes like RSA signatures. The seed is chosen so that the old code has no
// chance match in 21 to 25: after the wrap its sum differs from the right one by a multiple of
// 2, 64 or 128 (31 has the order 8 modulo 256), so at message 24 a chance match has odds of 1/2.
function signature(n) {
    const parts = [];
    for (let k = 0; k < 8; k++)
        parts.push(crypto.createHash('sha256').update(`player-1:${n}:${k}`).digest());
    return Buffer.concat(parts);
}

// The real chat plugin on a fake client of 1.21.8: it records what the client writes.
function newClient() {
    const client = new EventEmitter();
    client.version = VERSION;
    client.written = [];
    client.write = (name, params) => client.written.push({ name, params });
    chatPlugin(client, {});
    return client;
}

// A signed chat message of a player, as the server sends it.
function playerChat(client, n, sig) {
    client.emit('player_chat', {
        globalIndex: n,
        senderUuid: '00000000-0000-0000-0000-000000000001',
        index: n,
        signature: sig,
        plainMessage: `message ${n}`,
        timestamp: BigInt(Date.now()),
        salt: 0n,
        previousMessages: [],
        unsignedChatContent: undefined,
        filterType: 0,
        type: 1,
        networkName: '"MartyByrde2"',
    });
}

function lastPacket(client, name) {
    const found = client.written.filter((w) => w.name === name);
    assert.ok(found.length > 0, `the client wrote a ${name} packet`);
    return found[found.length - 1].params;
}

// The bitset of the acknowledged window positions (3 bytes, little end first), as a number.
const bits = (buffer) => buffer[0] | (buffer[1] << 8) | (buffer[2] << 16);

// Feeds MESSAGES signatures; after each one the bot chats. One row per message.
function run(count = MESSAGES) {
    const client = newClient();
    const sigs = [];
    const rows = [];
    for (let n = 1; n <= count; n++) {
        const sig = signature(n);
        sigs.push(sig);
        playerChat(client, n, sig);
        client._signedChat('hello');
        const packet = lastPacket(client, 'chat_message');
        const window = sigs.slice(-RING);
        rows.push({
            n,
            sent: packet.checksum,
            reference: referenceChecksum(window),
            old: oldComputeChatChecksum(client._lastSeenMessages),
            ringOrder: referenceChecksum([...client._lastSeenMessages].filter(Boolean).map((e) => e.signature)),
            acknowledged: bits(packet.acknowledged),
            expectedBits: ((1 << window.length) - 1) << (RING - window.length),
            offset: packet.offset,
        });
    }
    return { client, sigs, rows };
}

describe('the reference against the library for one signature', () => {
    test('the library reads bytes unsigned where Java reads them signed; the low byte is the same', () => {
        // a signature with every byte value, so bytes of 0x80 and more are in it
        const sig = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 97 + 13) & 0xff));
        let unsignedHash = 1;
        for (const b of sig)
            unsignedHash = (31 * unsignedHash + b) & 0xffffffff;
        assert.notEqual(unsignedHash, javaArraysHashCode(sig), 'the full hashes differ');
        assert.equal(unsignedHash & 0xff, javaArraysHashCode(sig) & 0xff, 'the low bytes do not');
        assert.equal(computeChatChecksum([{ signature: sig }]), referenceChecksum([sig]));
    });

    test('200 signatures of 256 bytes, one at a time: the library equals the reference', () => {
        for (let n = 1; n <= 200; n++) {
            const sig = signature(1000 + n);
            assert.equal(computeChatChecksum([{ signature: sig }]), referenceChecksum([sig]), `signature ${n}`);
        }
    });

    test('an empty window gives 1 in both', () => {
        assert.equal(computeChatChecksum([]), 1);
        assert.equal(referenceChecksum([]), 1);
    });
});

describe('the client with the patch: 25 messages of a player, the bot chats after each', () => {
    const { rows } = run();

    test('the checksum of every chat_message equals the reference over the window, oldest first', () => {
        const wrong = rows.filter((r) => r.sent !== r.reference).map((r) => `${r.n}: sent ${r.sent}, reference ${r.reference}`);
        assert.deepEqual(wrong, []);
        assert.equal(rows.length, MESSAGES);
    });

    test('the acknowledgements are right before and after the wrap: bits and offset', () => {
        for (const r of rows) {
            assert.equal(r.acknowledged, r.expectedBits, `message ${r.n}`);
            assert.equal(r.offset, 1, `message ${r.n}: one new message since the last chat`);
        }
    });

    test('the old code matched up to message 20 and not after it', () => {
        const oldMatches = rows.filter((r) => r.old === r.reference).map((r) => r.n);
        assert.deepEqual(oldMatches, Array.from({ length: RING }, (_, i) => i + 1));
    });

    test('the cause: the old code computed the checksum of the ring in index order', () => {
        for (const r of rows)
            assert.equal(r.old, r.ringOrder, `message ${r.n}`);
    });

    test('a command after 25 messages carries the same checksum as a chat', () => {
        const client = newClient();
        const sigs = [];
        for (let n = 1; n <= MESSAGES; n++) {
            sigs.push(signature(n));
            playerChat(client, n, sigs[n - 1]);
        }
        client._signedChat('/help');
        const packet = lastPacket(client, 'chat_command');
        assert.equal(packet.checksum, referenceChecksum(sigs.slice(-RING)));
        assert.equal(packet.messageCount, MESSAGES);
    });
});

describe('after 40 messages the ring is in window order again', () => {
    test('message 40: the old code and the reference agree, as the offset is 0 again', () => {
        const { client, rows } = run(40);
        assert.equal(client._lastSeenMessages.offset, 0);
        const last = rows[rows.length - 1];
        assert.equal(last.old, last.reference);
        assert.equal(last.sent, last.reference);
    });
});

describe('the patch file', () => {
    const patch = fs.readFileSync(repoPath('patches/minecraft-protocol+1.62.0.patch'), 'utf8');

    test('changes only src/client/chat.js of minecraft-protocol, in two places', () => {
        const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
        assert.deepEqual(files, ['node_modules/minecraft-protocol/src/client/chat.js']);
        const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
        const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
        assert.equal(removed.length, 2);
        assert.ok(removed.every((l) => l.includes('computeChatChecksum(client._lastSeenMessages)')));
        assert.equal(added.filter((l) => l.includes('computeChatChecksum(acknowledgements.map(')).length, 2);
    });

    test('npm install applies it: postinstall runs patch-package', () => {
        const pkg = JSON.parse(fs.readFileSync(repoPath('package.json'), 'utf8'));
        assert.equal(pkg.scripts.postinstall, 'patch-package');
        assert.equal(pkg.dependencies['minecraft-protocol'], '1.62.0');
    });
});
