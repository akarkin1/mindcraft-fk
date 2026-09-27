// Spec S1: src/utils/safe_json.js -- writeJsonAtomic and readJsonSafe.
// Amendment 2, B2: failure paths of the temp file (open, write, flush, close), a failing cleanup
// unlink after a failed rename, and lstatSync errors while choosing the quarantine name.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { patchFs, fsError } from '../helpers/fs_patch.js';
import { importsOf, isBuiltin, importInCleanProcess } from '../helpers/hygiene.js';
import { describeRun } from '../helpers/child.js';

const MODULE = 'src/utils/safe_json.js';
const sj = await loadSrc(MODULE);

const RESULT_KEYS = ['data', 'error', 'quarantinedTo', 'status'];
const NON_ASCII = 'Hello ✓ Привет \u{1F389} é';
const SAMPLE = {
    name: 'Andy',
    turns: [{ role: 'user', content: 'steve: hi' }, { role: 'assistant', content: NON_ASCII }],
    count: 3,
    ratio: 0.5,
    flags: { a: true, b: false, c: null },
    empty: [],
};

// Resolves an export up front, so that a missing module or export fails every test with its
// real reason and is never mistaken for an expected throw inside assert.throws.
function api(name) {
    const fn = sj[name];
    assert.equal(typeof fn, 'function', `${name} must be an exported function`);
    return fn;
}

let dir;
let writeJsonAtomic;
let readJsonSafe;
beforeEach(() => {
    dir = makeTmpDir();
    writeJsonAtomic = api('writeJsonAtomic');
    readJsonSafe = api('readJsonSafe');
});
afterEach(() => {
    removeTmpDir(dir);
});

function writeRaw(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function assertShape(result) {
    assert.equal(typeof result, 'object');
    assert.notEqual(result, null);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS, 'result has exactly the keys status, data, error, quarantinedTo');
}

// Runs fn with process.env.TZ set to tz, restoring the previous value afterwards.
function withTZ(tz, fn) {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
        return fn();
    } finally {
        if (had) process.env.TZ = previous;
        else delete process.env.TZ;
    }
}

// Records every renameSync call; `behaviour(callIndex, from, to, original)` decides what happens.
function spyRename(behaviour) {
    const calls = [];
    const restore = patchFs('renameSync', (original) => function (from, to) {
        const index = calls.length;
        const record = { from: String(from), to: String(to), tempContent: null, error: null };
        try {
            record.tempContent = fs.readFileSync(from, 'utf8');
        } catch { /* ignore */ }
        calls.push(record);
        try {
            return behaviour(index, from, to, original);
        } catch (err) {
            record.error = err;
            throw err;
        }
    });
    return { calls, restore };
}

// Amendment 2, B2: watches the temp file of writeJsonAtomic through fs.openSync, writeFileSync,
// fsyncSync, closeSync and unlinkSync. The module calls these through the default export of
// node:fs (B2), which patchFs replaces. The temp file is recognised by its name
// <basename>.<pid>.<random>.tmp in the directory of the target (S1.3); every other call passes
// through untouched. `fail` maps a step to the error that the FIRST call of that step on the
// temp file throws:
//   open    throws before anything is created
//   write   writes the first half of the data, then throws (a partial temp file exists)
//   fsync   throws; the descriptor stays open
//   close   really closes the descriptor, then throws (like close(2): the descriptor is gone)
//   unlink  throws; the temp file stays
// Returns { steps, tempPath, existedAtFailure, unlinkErrors, restore }. restore() puts every fs
// method back and closes a descriptor that the code under test left open (so that the temp
// directory can be removed). Always call it in `finally`.
function watchTempFile(file, fail = {}) {
    const targetDir = path.resolve(path.dirname(file));
    const prefix = `${path.basename(file)}.${process.pid}.`;
    const isTemp = (p) => typeof p === 'string' && path.resolve(path.dirname(p)) === targetDir
        && path.basename(p).startsWith(prefix) && path.basename(p).endsWith('.tmp');
    const realClose = fs.closeSync;
    const watch = { steps: [], tempPath: null, existedAtFailure: null, unlinkErrors: [], fd: null, fdOpen: false };
    const onTempFd = (fd) => watch.fdOpen && fd === watch.fd;
    const failed = new Set();
    const shouldFail = (step) => Boolean(fail[step]) && !failed.has(step);
    const throwNow = (step) => {
        failed.add(step);
        watch.existedAtFailure = watch.tempPath !== null && fs.existsSync(watch.tempPath);
        throw fail[step];
    };
    const restores = [];
    const restore = () => {
        while (restores.length > 0) restores.pop()();
        if (watch.fdOpen) {
            watch.fdOpen = false;
            try {
                realClose(watch.fd);
            } catch { /* already closed */ }
        }
    };
    try {
        restores.push(patchFs('openSync', (original) => function openSync(p, ...rest) {
            if (!isTemp(p)) return original(p, ...rest);
            watch.steps.push('open');
            watch.tempPath = path.resolve(p);
            if (shouldFail('open')) throwNow('open');
            const fd = original(p, ...rest);
            watch.fd = fd;
            watch.fdOpen = true;
            return fd;
        }));
        restores.push(patchFs('writeFileSync', (original) => function writeFileSync(target, data, ...rest) {
            if (!onTempFd(target) && !isTemp(target)) return original(target, data, ...rest);
            watch.steps.push('write');
            if (isTemp(target)) watch.tempPath = path.resolve(target);
            if (shouldFail('write')) {
                const half = Math.floor(data.length / 2);
                original(target, typeof data === 'string' ? data.slice(0, half) : Buffer.from(data).subarray(0, half), ...rest);
                throwNow('write');
            }
            return original(target, data, ...rest);
        }));
        restores.push(patchFs('fsyncSync', (original) => function fsyncSync(fd, ...rest) {
            if (!onTempFd(fd)) return original(fd, ...rest);
            watch.steps.push('fsync');
            if (shouldFail('fsync')) throwNow('fsync');
            return original(fd, ...rest);
        }));
        restores.push(patchFs('closeSync', (original) => function closeSync(fd, ...rest) {
            if (!onTempFd(fd)) return original(fd, ...rest);
            watch.steps.push('close');
            const result = original(fd, ...rest);
            watch.fdOpen = false;
            if (shouldFail('close')) throwNow('close');
            return result;
        }));
        restores.push(patchFs('unlinkSync', (original) => function unlinkSync(p, ...rest) {
            if (!isTemp(p)) return original(p, ...rest);
            watch.steps.push('unlink');
            if (shouldFail('unlink')) throwNow('unlink');
            try {
                return original(p, ...rest);
            } catch (err) {
                watch.unlinkErrors.push(err && err.code);
                throw err;
            }
        }));
    } catch (err) {
        restore();
        throw err;
    }
    watch.restore = restore;
    return watch;
}

// B2 "throws that error": the very object, or an error with the same code and message.
function assertSameError(thrown, expected, label) {
    assert.ok(thrown !== undefined, `${label}: writeJsonAtomic must throw`);
    if (thrown === expected) return;
    assert.equal(thrown?.code, expected.code, `${label}: code of the thrown error (message: ${thrown?.message})`);
    assert.equal(thrown?.message, expected.message, `${label}: message of the thrown error`);
}

const tmpFilesIn = (d) => listDir(d).filter((name) => name.endsWith('.tmp'));

describe('writeJsonAtomic', () => {
    test('round trip: what is written parses back to the same data', () => {
        const file = path.join(dir, 'data.json');
        writeJsonAtomic(file, SAMPLE);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), SAMPLE);
    });

    test('file content is exactly JSON.stringify(data, null, 2) by default, no trailing newline', () => {
        const file = path.join(dir, 'data.json');
        writeJsonAtomic(file, SAMPLE);
        const bytes = fs.readFileSync(file);
        assert.deepEqual(bytes, Buffer.from(JSON.stringify(SAMPLE, null, 2), 'utf8'));
        assert.notEqual(bytes[bytes.length - 1], 0x0a, 'no trailing newline');
    });

    for (const indent of [0, 4, '\t']) {
        test(`option indent (${JSON.stringify(indent)}) is the third argument of JSON.stringify`, () => {
            const file = path.join(dir, 'data.json');
            writeJsonAtomic(file, SAMPLE, { indent });
            assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(SAMPLE, null, indent));
        });
    }

    test('text is written as UTF-8 without a byte order mark', () => {
        const file = path.join(dir, 'utf8.json');
        const data = { text: NON_ASCII };
        writeJsonAtomic(file, data);
        const bytes = fs.readFileSync(file);
        assert.deepEqual(bytes, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
        assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'no BOM');
    });

    test('top-level values that JSON.stringify accepts are written (null, 0, false, string, array)', () => {
        for (const [i, value] of [null, 0, false, 'text', [1, 2]].entries()) {
            const file = path.join(dir, `v${i}.json`);
            writeJsonAtomic(file, value);
            assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(value, null, 2));
        }
    });

    test('returns undefined on success', () => {
        assert.equal(writeJsonAtomic(path.join(dir, 'x.json'), { a: 1 }), undefined);
    });

    test('creates the parent directory recursively if it does not exist', () => {
        const file = path.join(dir, 'a', 'b', 'c', 'deep.json');
        writeJsonAtomic(file, { deep: true });
        assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ deep: true }, null, 2));
    });

    test('replaces an existing file completely (no leftover of longer old content)', () => {
        const file = path.join(dir, 'memory.json');
        writeRaw(file, JSON.stringify({ old: 'x'.repeat(5000) }, null, 2));
        writeJsonAtomic(file, { new: 1 });
        assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ new: 1 }, null, 2));
    });

    test('no *.tmp file remains in the directory after success', () => {
        const file = path.join(dir, 'memory.json');
        writeJsonAtomic(file, SAMPLE);
        writeJsonAtomic(file, { second: true });
        assert.deepEqual(listDir(dir), ['memory.json']);
    });

    test('temp file is in the SAME directory, named <basename>.<pid>.<random>.tmp, and holds the full text before the rename', () => {
        const file = path.join(dir, 'memory.json');
        const spy = spyRename((i, from, to, original) => original(from, to));
        try {
            writeJsonAtomic(file, SAMPLE);
        } finally {
            spy.restore();
        }
        assert.equal(spy.calls.length, 1, 'exactly one rename');
        const { from, to, tempContent } = spy.calls[0];
        assert.equal(path.resolve(to), path.resolve(file), 'renamed onto filePath');
        assert.equal(path.resolve(path.dirname(from)), path.resolve(dir), 'temp file in the same directory');
        const pattern = new RegExp(`^memory\\.json\\.${process.pid}\\.(.+)\\.tmp$`);
        assert.match(path.basename(from), pattern);
        assert.equal(tempContent, JSON.stringify(SAMPLE, null, 2), 'temp file is complete before the rename');
    });

    test('two calls use different temp file names (random part)', () => {
        const file = path.join(dir, 'memory.json');
        const spy = spyRename((i, from, to, original) => original(from, to));
        try {
            writeJsonAtomic(file, { n: 1 });
            writeJsonAtomic(file, { n: 2 });
        } finally {
            spy.restore();
        }
        assert.equal(spy.calls.length, 2);
        assert.notEqual(path.basename(spy.calls[0].from), path.basename(spy.calls[1].from));
    });

    describe('serialisation failure throws an Error BEFORE the disk is touched', () => {
        const circular = { a: 1 };
        circular.self = circular;
        const cases = [
            ['circular structure', circular],
            ['BigInt value', { n: 10n }],
            ['top-level BigInt', 10n],
            ['undefined data (JSON.stringify returns undefined)', undefined],
            ['a function as data (JSON.stringify returns undefined)', () => 1],
            ['a Symbol as data (JSON.stringify returns undefined)', Symbol('s')],
            ['toJSON that throws', { toJSON() { throw new Error('toJSON failed'); } }],
        ];
        for (const [label, data] of cases) {
            test(`${label}: throws, existing target stays byte-identical, no temp file`, () => {
                const file = path.join(dir, 'memory.json');
                const original = Buffer.from('{\r\n  "keep": "me ✓"\r\n}', 'utf8');
                writeRaw(file, original);
                const before = listDir(dir);
                assert.throws(() => writeJsonAtomic(file, data), (err) => err instanceof Error);
                assert.deepEqual(fs.readFileSync(file), original);
                assert.deepEqual(listDir(dir), before, 'no temp file created');
            });

            test(`${label}: throws and does not even create the missing parent directory`, () => {
                const parent = path.join(dir, 'not-yet');
                assert.throws(() => writeJsonAtomic(path.join(parent, 'x.json'), data), (err) => err instanceof Error);
                assert.equal(fs.existsSync(parent), false, 'parent directory must not be created');
            });
        }
    });

    describe('rename retries and failure handling (fs.renameSync is simulated)', () => {
        test('rename failing with EPERM 3 times, then succeeding: success, 4 attempts, no temp left', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'old');
            const spy = spyRename((i, from, to, original) => {
                if (i < 3) throw fsError('EPERM');
                return original(from, to);
            });
            try {
                assert.equal(writeJsonAtomic(file, SAMPLE, { retries: 5, retryDelayMs: 0 }), undefined);
            } finally {
                spy.restore();
            }
            assert.equal(spy.calls.length, 4);
            assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(SAMPLE, null, 2));
            assert.deepEqual(listDir(dir), ['memory.json']);
        });

        for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
            test(`rename always failing with ${code}: 1 + retries attempts, throws the LAST error, old content intact, temp deleted`, () => {
                const file = path.join(dir, 'memory.json');
                const original = Buffer.from('{"previous": true}', 'utf8');
                writeRaw(file, original);
                const errors = [];
                const spy = spyRename(() => {
                    const err = fsError(code, `${code} attempt ${errors.length + 1}`);
                    errors.push(err);
                    throw err;
                });
                let thrown;
                try {
                    writeJsonAtomic(file, SAMPLE, { retries: 3, retryDelayMs: 0 });
                } catch (err) {
                    thrown = err;
                } finally {
                    spy.restore();
                }
                assert.equal(spy.calls.length, 4, 'one attempt plus 3 retries');
                assert.ok(thrown, 'must throw');
                assert.equal(thrown, errors[errors.length - 1], 'the last error is thrown');
                assert.deepEqual(fs.readFileSync(file), original, 'previous content intact');
                assert.equal(fs.existsSync(spy.calls[0].from), false, 'temp file deleted');
                assert.deepEqual(listDir(dir), ['memory.json']);
            });
        }

        test('default retries is 5 (6 attempts in total)', () => {
            const file = path.join(dir, 'memory.json');
            const spy = spyRename(() => {
                throw fsError('EBUSY');
            });
            try {
                assert.throws(() => writeJsonAtomic(file, { a: 1 }, { retryDelayMs: 0 }), { code: 'EBUSY' });
            } finally {
                spy.restore();
            }
            assert.equal(spy.calls.length, 6);
            assert.deepEqual(listDir(dir), [], 'temp file deleted, nothing else created');
        });

        test('retries: 0 means exactly one rename attempt', () => {
            const file = path.join(dir, 'memory.json');
            const spy = spyRename(() => {
                throw fsError('EPERM');
            });
            try {
                assert.throws(() => writeJsonAtomic(file, { a: 1 }, { retries: 0, retryDelayMs: 0 }), { code: 'EPERM' });
            } finally {
                spy.restore();
            }
            assert.equal(spy.calls.length, 1);
        });

        test('a rename error with another code (EXDEV) is not retried; old content intact, temp deleted', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'previous');
            const err = fsError('EXDEV');
            const spy = spyRename(() => {
                throw err;
            });
            try {
                assert.throws(() => writeJsonAtomic(file, { a: 1 }, { retries: 5, retryDelayMs: 0 }), (e) => e === err);
            } finally {
                spy.restore();
            }
            assert.equal(spy.calls.length, 1, 'only EPERM, EBUSY and EACCES are retried');
            assert.equal(fs.readFileSync(file, 'utf8'), 'previous');
            assert.deepEqual(listDir(dir), ['memory.json']);
        });

        test('pauses retryDelayMs between rename attempts (lower bound only)', () => {
            const file = path.join(dir, 'memory.json');
            const spy = spyRename(() => {
                throw fsError('EPERM');
            });
            const start = performance.now();
            try {
                assert.throws(() => writeJsonAtomic(file, { a: 1 }, { retries: 2, retryDelayMs: 25 }));
            } finally {
                spy.restore();
            }
            const elapsed = performance.now() - start;
            assert.equal(spy.calls.length, 3);
            assert.ok(elapsed >= 40, `two pauses of 25 ms expected, elapsed ${elapsed.toFixed(1)} ms`);
        });

        test('B2: the cleanup unlinkSync fails too (EPERM): the LAST rename error is thrown, not the cleanup error; target byte-identical; nothing but the undeletable temp file is left', () => {
            const file = path.join(dir, 'memory.json');
            const original = Buffer.from('{"previous": true}', 'utf8');
            writeRaw(file, original);
            const renameErrors = [];
            const cleanupError = fsError('EPERM', 'EPERM: simulated failure of the cleanup unlink');
            const spy = spyRename(() => {
                const err = fsError('EBUSY', `EBUSY rename attempt ${renameErrors.length + 1}`);
                renameErrors.push(err);
                throw err;
            });
            let watch;
            let thrown;
            try {
                watch = watchTempFile(file, { unlink: cleanupError });
                writeJsonAtomic(file, SAMPLE, { retries: 2, retryDelayMs: 0 });
            } catch (err) {
                thrown = err;
            } finally {
                if (watch) watch.restore();
                spy.restore();
            }
            assert.ok(watch, `precondition: fs methods patched (${thrown && thrown.message})`);
            assert.equal(spy.calls.length, 3, 'precondition: one rename attempt plus 2 retries');
            assert.ok(watch.steps.includes('unlink'), `precondition: the temp file is deleted with fs.unlinkSync; steps seen: ${watch.steps.join(', ')}`);
            assert.notEqual(thrown, cleanupError, 'the cleanup error must not hide the rename error');
            assertSameError(thrown, renameErrors[2], 'the last rename error');
            assert.deepEqual(fs.readFileSync(file), original, 'the existing target is byte-identical');
            // Deleting the temp file is "best effort" (S1.5): the one temp file whose deletion
            // failed may stay behind (or be deleted by a retry); nothing else may.
            const tempName = path.basename(spy.calls[0].from);
            assert.deepEqual(listDir(dir).filter((name) => name !== tempName), ['memory.json']);
        });

        test('B2: the cleanup unlinkSync fails with ENOENT (the temp file vanished during the failed rename): the rename error is thrown, no *.tmp remains, target byte-identical', () => {
            const file = path.join(dir, 'memory.json');
            const original = Buffer.from('{"previous": true}', 'utf8');
            writeRaw(file, original);
            const renameError = fsError('EXDEV', 'EXDEV: simulated rename failure');
            // fs.rmSync is not patched: the temp file really disappears before the rename fails.
            const spy = spyRename((i, from) => {
                fs.rmSync(from);
                throw renameError;
            });
            let watch;
            let thrown;
            try {
                watch = watchTempFile(file);
                writeJsonAtomic(file, SAMPLE, { retries: 0, retryDelayMs: 0 });
            } catch (err) {
                thrown = err;
            } finally {
                if (watch) watch.restore();
                spy.restore();
            }
            assert.ok(watch, `precondition: fs methods patched (${thrown && thrown.message})`);
            assert.equal(spy.calls.length, 1, 'precondition: one rename attempt');
            if (watch.steps.includes('unlink')) assert.deepEqual(watch.unlinkErrors, ['ENOENT'], 'precondition: the cleanup unlink failed with ENOENT');
            assertSameError(thrown, renameError, 'the rename error');
            assert.deepEqual(tmpFilesIn(dir), [], 'no *.tmp file remains');
            assert.deepEqual(fs.readFileSync(file), original, 'the existing target is byte-identical');
            assert.deepEqual(listDir(dir), ['memory.json']);
        });
    });

    describe('rename failure on the real file system', () => {
        test('target path is a DIRECTORY: throws, the directory and its content stay, no temp file remains', () => {
            // Portable trick: renaming a file onto an existing directory fails on every
            // platform (EPERM on Windows, EISDIR on POSIX).
            const target = path.join(dir, 'memory.json');
            fs.mkdirSync(target);
            fs.writeFileSync(path.join(target, 'inner.txt'), 'keep');
            assert.throws(() => writeJsonAtomic(target, { a: 1 }, { retries: 1, retryDelayMs: 1 }), (err) => err instanceof Error);
            assert.ok(fs.statSync(target).isDirectory());
            assert.equal(fs.readFileSync(path.join(target, 'inner.txt'), 'utf8'), 'keep');
            assert.deepEqual(listDir(dir), ['memory.json'], 'no *.tmp left behind');
        });

        test('read-only target file (Windows): throws, previous content intact, no temp file remains',
            { skip: process.platform !== 'win32' ? 'renaming onto a read-only file only fails on Windows' : false },
            () => {
                const file = path.join(dir, 'memory.json');
                writeRaw(file, 'previous content');
                fs.chmodSync(file, 0o444);
                try {
                    assert.throws(() => writeJsonAtomic(file, { a: 1 }, { retries: 1, retryDelayMs: 1 }), (err) => err instanceof Error);
                    assert.equal(fs.readFileSync(file, 'utf8'), 'previous content');
                    assert.deepEqual(listDir(dir), ['memory.json']);
                } finally {
                    fs.chmodSync(file, 0o666);
                }
            });
    });

    describe('B2: a step of the temp file fails (fs.openSync, writeFileSync, fsyncSync, closeSync are simulated)', () => {
        const STEPS = [
            ['open', 'fs.openSync', 'EMFILE'],
            ['write', 'fs.writeFileSync', 'ENOSPC'],
            ['fsync', 'fs.fsyncSync', 'EIO'],
            ['close', 'fs.closeSync', 'EIO'],
        ];

        // writeJsonAtomic with default options while `step` fails once; every patch is restored
        // in `finally`. Returns { thrown, watch, simulated }.
        function writeWithFailingStep(file, step, code) {
            const simulated = fsError(code, `${code}: simulated failure of the ${step} step`);
            const watch = watchTempFile(file, { [step]: simulated });
            let thrown;
            try {
                writeJsonAtomic(file, SAMPLE);
            } catch (err) {
                thrown = err;
            } finally {
                watch.restore();
            }
            return { thrown, watch, simulated };
        }

        function assertStepReached(watch, step, fnName) {
            assert.ok(watch.steps.includes(step), `precondition: writeJsonAtomic reached the ${step} step through ${fnName}; steps seen: ${watch.steps.join(', ') || 'none'}`);
            assert.equal(watch.existedAtFailure, step !== 'open', 'precondition: a (partial) temp file existed when the step failed, except for open');
        }

        for (const [step, fnName, code] of STEPS) {
            test(`${fnName} fails (${code}): that error is thrown, no *.tmp file remains, the existing target is byte-identical`, () => {
                const file = path.join(dir, 'memory.json');
                const original = Buffer.from('{\r\n  "previous": "content ✓"\r\n}', 'utf8');
                writeRaw(file, original);
                const { thrown, watch, simulated } = writeWithFailingStep(file, step, code);
                assertStepReached(watch, step, fnName);
                assertSameError(thrown, simulated, fnName);
                assert.deepEqual(tmpFilesIn(dir), [], 'no *.tmp file remains');
                assert.deepEqual(fs.readFileSync(file), original, 'the existing target is byte-identical');
                assert.deepEqual(listDir(dir), ['memory.json']);
            });

            test(`${fnName} fails (${code}) and there is no target yet: that error is thrown, no *.tmp file and no target remain`, () => {
                const file = path.join(dir, 'memory.json');
                const { thrown, watch, simulated } = writeWithFailingStep(file, step, code);
                assertStepReached(watch, step, fnName);
                assertSameError(thrown, simulated, fnName);
                assert.deepEqual(listDir(dir), [], 'the directory is still empty');
            });
        }
    });
});

describe('readJsonSafe', () => {
    test('file does not exist: { status: "missing", data: null, error: null, quarantinedTo: null }', () => {
        const result = readJsonSafe(path.join(dir, 'nope.json'));
        assertShape(result);
        assert.deepEqual(result, { status: 'missing', data: null, error: null, quarantinedTo: null });
    });

    test('parent directory does not exist either: "missing"', () => {
        const result = readJsonSafe(path.join(dir, 'no-dir', 'nope.json'));
        assert.deepEqual(result, { status: 'missing', data: null, error: null, quarantinedTo: null });
    });

    test('valid JSON: { status: "ok", data: parsed, error: null, quarantinedTo: null } and the file is untouched', () => {
        const file = path.join(dir, 'memory.json');
        writeRaw(file, JSON.stringify(SAMPLE, null, 2));
        const result = readJsonSafe(file);
        assertShape(result);
        assert.deepEqual(result, { status: 'ok', data: SAMPLE, error: null, quarantinedTo: null });
        assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(SAMPLE, null, 2));
        assert.deepEqual(listDir(dir), ['memory.json']);
    });

    test('expect defaults to "any": null, array, number, string and boolean files are "ok"', () => {
        for (const [i, value] of [null, [1, 2], 42, 'text', true].entries()) {
            const file = path.join(dir, `v${i}.json`);
            writeRaw(file, JSON.stringify(value));
            const result = readJsonSafe(file);
            assert.deepEqual(result, { status: 'ok', data: value, error: null, quarantinedTo: null }, `value ${JSON.stringify(value)}`);
        }
    });

    test('a UTF-8 byte order mark at the start is tolerated', () => {
        const file = path.join(dir, 'bom.json');
        writeRaw(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{"memory":"ok ${NON_ASCII}"}`, 'utf8')]));
        const result = readJsonSafe(file, { expect: 'object' });
        assert.deepEqual(result, { status: 'ok', data: { memory: `ok ${NON_ASCII}` }, error: null, quarantinedTo: null });
    });

    test('CRLF line endings and surrounding whitespace in valid JSON are fine', () => {
        const file = path.join(dir, 'crlf.json');
        writeRaw(file, '\r\n  {\r\n  "a": 1\r\n}\r\n');
        assert.deepEqual(readJsonSafe(file), { status: 'ok', data: { a: 1 }, error: null, quarantinedTo: null });
    });

    describe('corrupt files', () => {
        const corruptCases = [
            ['empty file', ''],
            ['whitespace only', ' \r\n\t  \n'],
            ['invalid JSON', '{"memory": "abc", '],
            ['truncated write', '{"memory": "abc", "turns": [{"role": "us'],
            ['not JSON at all', 'hello world'],
            ['byte order mark only', Buffer.from([0xef, 0xbb, 0xbf])],
        ];
        for (const [label, content] of corruptCases) {
            test(`${label}: status "corrupt", data null, error is an Error, quarantined by default`, () => {
                const file = path.join(dir, 'memory.json');
                writeRaw(file, content);
                const originalBytes = fs.readFileSync(file);
                const result = readJsonSafe(file);
                assertShape(result);
                assert.equal(result.status, 'corrupt');
                assert.equal(result.data, null);
                assert.ok(result.error instanceof Error, 'error is an Error');
                assert.equal(typeof result.quarantinedTo, 'string', 'quarantine is on by default');
                assert.equal(fs.existsSync(file), false, 'original path no longer exists');
                assert.deepEqual(fs.readFileSync(result.quarantinedTo), originalBytes, 'quarantined file keeps the bytes');
            });
        }

        const notObjects = [['null', null], ['an array', [1, 2]], ['an empty array', []], ['a number', 42], ['a string', 'text'], ['a boolean', true]];
        for (const [label, value] of notObjects) {
            test(`expect: "object" and the file holds ${label}: "corrupt" and quarantined`, () => {
                const file = path.join(dir, 'memory.json');
                writeRaw(file, JSON.stringify(value));
                const result = readJsonSafe(file, { expect: 'object' });
                assertShape(result);
                assert.equal(result.status, 'corrupt');
                assert.equal(result.data, null);
                assert.ok(result.error instanceof Error);
                assert.equal(typeof result.quarantinedTo, 'string');
                assert.equal(fs.existsSync(file), false);
            });
        }

        test('expect: "object" accepts a plain object, also an empty one', () => {
            for (const [i, value] of [{}, { memory: 'x', turns: [] }].entries()) {
                const file = path.join(dir, `o${i}.json`);
                writeRaw(file, JSON.stringify(value));
                assert.deepEqual(readJsonSafe(file, { expect: 'object' }), { status: 'ok', data: value, error: null, quarantinedTo: null });
            }
        });

        test('quarantine: false leaves the corrupt file in place and quarantinedTo is null', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, '{broken');
            const result = readJsonSafe(file, { quarantine: false });
            assertShape(result);
            assert.equal(result.status, 'corrupt');
            assert.equal(result.quarantinedTo, null);
            assert.ok(result.error instanceof Error);
            assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
            assert.deepEqual(listDir(dir), ['memory.json']);
        });
    });

    describe('quarantine file name <dir>/<name>.corrupt.<YYYYMMDD-HHMMSS UTC><ext>', () => {
        const at = (iso) => () => new Date(iso);

        test('memory.json becomes memory.corrupt.20260927-141503.json (spec example) in the same directory', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'garbage');
            const result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            assert.equal(result.status, 'corrupt');
            const expected = path.join(dir, 'memory.corrupt.20260927-141503.json');
            assert.equal(path.resolve(result.quarantinedTo), path.resolve(expected));
            assert.deepEqual(listDir(dir), ['memory.corrupt.20260927-141503.json']);
            assert.equal(fs.readFileSync(expected, 'utf8'), 'garbage');
        });

        test('the stamp uses UTC, not local time (process TZ set to Asia/Kolkata, UTC+05:30)', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'garbage');
            const result = withTZ('Asia/Kolkata', () => readJsonSafe(file, { now: at('2026-12-31T23:59:59Z') }));
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20261231-235959.json');
        });

        test('all fields are zero padded: 2026-01-02T03:04:05Z gives 20260102-030405', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, '');
            const result = readJsonSafe(file, { now: at('2026-01-02T03:04:05Z') });
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260102-030405.json');
        });

        test('name collision: -1 is appended before the extension; the existing file is untouched', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'older quarantine');
            writeRaw(file, 'garbage');
            const result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260927-141503-1.json');
            assert.equal(fs.readFileSync(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'utf8'), 'older quarantine');
            assert.equal(fs.readFileSync(result.quarantinedTo, 'utf8'), 'garbage');
            assert.equal(fs.existsSync(file), false);
        });

        test('second collision: -2 when the plain name and -1 both exist', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'q0');
            writeRaw(path.join(dir, 'memory.corrupt.20260927-141503-1.json'), 'q1');
            writeRaw(file, 'garbage');
            const result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260927-141503-2.json');
            assert.equal(fs.readFileSync(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'utf8'), 'q0');
            assert.equal(fs.readFileSync(path.join(dir, 'memory.corrupt.20260927-141503-1.json'), 'utf8'), 'q1');
        });

        test('name and ext come from path.parse: "state.v2.json" -> "state.v2.corrupt.<stamp>.json"', () => {
            const file = path.join(dir, 'state.v2.json');
            writeRaw(file, '{');
            const result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            assert.equal(path.basename(result.quarantinedTo), 'state.v2.corrupt.20260927-141503.json');
        });

        test('a file without extension: "memory" -> "memory.corrupt.<stamp>"', () => {
            const file = path.join(dir, 'memory');
            writeRaw(file, '{');
            const result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260927-141503');
        });

        test('a failing quarantine rename gives quarantinedTo null, status stays "corrupt", nothing is thrown', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'garbage');
            const spy = spyRename(() => {
                throw fsError('EPERM');
            });
            let result;
            try {
                result = readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') });
            } finally {
                spy.restore();
            }
            assert.ok(spy.calls.length >= 1, 'precondition: the quarantine uses fs.renameSync');
            assertShape(result);
            assert.equal(result.status, 'corrupt');
            assert.equal(result.quarantinedTo, null);
            assert.equal(result.data, null);
            assert.ok(result.error instanceof Error);
            assert.equal(fs.readFileSync(file, 'utf8'), 'garbage', 'the file is still at its original path');
        });

        // B2: lstatSync reports a candidate as taken through an error other than "not found".
        // `failFor` maps a candidate file name (in the temp directory) to the error code that
        // lstatSync throws for it; every other call passes through. Restored in `finally`.
        function readWithFailingLstat(file, failFor) {
            const checked = [];
            const restore = patchFs('lstatSync', (original) => function lstatSync(p, ...rest) {
                const inDir = path.resolve(path.dirname(String(p))) === path.resolve(dir);
                const name = path.basename(String(p));
                if (inDir) checked.push(name);
                if (inDir && Object.hasOwn(failFor, name)) throw fsError(failFor[name]);
                return original(p, ...rest);
            });
            try {
                return { result: readJsonSafe(file, { now: at('2026-09-27T14:15:03Z') }), checked };
            } finally {
                restore();
            }
        }

        test('B2: lstatSync fails for the candidate name with EACCES (not "not found"): the name counts as taken, -1 is used', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(file, 'garbage');
            const { result, checked } = readWithFailingLstat(file, { 'memory.corrupt.20260927-141503.json': 'EACCES' });
            assert.ok(checked.includes('memory.corrupt.20260927-141503.json'), `precondition: the candidate name is checked with fs.lstatSync; checked: ${checked.join(', ')}`);
            assertShape(result);
            assert.equal(result.status, 'corrupt');
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260927-141503-1.json');
            assert.deepEqual(listDir(dir), ['memory.corrupt.20260927-141503-1.json']);
            assert.equal(fs.readFileSync(result.quarantinedTo, 'utf8'), 'garbage');
        });

        test('B2: a real file at the plain name and lstatSync failing with EPERM for -1: both count as taken, -2 is used', () => {
            const file = path.join(dir, 'memory.json');
            writeRaw(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'older quarantine');
            writeRaw(file, 'garbage');
            const { result, checked } = readWithFailingLstat(file, { 'memory.corrupt.20260927-141503-1.json': 'EPERM' });
            assert.ok(checked.includes('memory.corrupt.20260927-141503-1.json'), `precondition: the -1 name is checked with fs.lstatSync; checked: ${checked.join(', ')}`);
            assertShape(result);
            assert.equal(result.status, 'corrupt');
            assert.equal(path.basename(result.quarantinedTo), 'memory.corrupt.20260927-141503-2.json');
            assert.deepEqual(listDir(dir), ['memory.corrupt.20260927-141503-2.json', 'memory.corrupt.20260927-141503.json']);
            assert.equal(fs.readFileSync(path.join(dir, 'memory.corrupt.20260927-141503.json'), 'utf8'), 'older quarantine');
            assert.equal(fs.readFileSync(result.quarantinedTo, 'utf8'), 'garbage');
        });
    });

    test('path is a directory: status "error", data null, error is an Error, quarantinedTo null, directory untouched', () => {
        const target = path.join(dir, 'memory.json');
        fs.mkdirSync(target);
        const result = readJsonSafe(target);
        assertShape(result);
        assert.equal(result.status, 'error');
        assert.equal(result.data, null);
        assert.ok(result.error instanceof Error);
        assert.equal(result.quarantinedTo, null);
        assert.ok(fs.statSync(target).isDirectory(), 'a directory is never quarantined');
        assert.deepEqual(listDir(dir), ['memory.json']);
    });

    test('NEVER throws, also for arguments of the wrong type', () => {
        for (const bad of [undefined, null, {}, [], '', true]) {
            let result;
            assert.doesNotThrow(() => {
                result = readJsonSafe(bad);
            }, `readJsonSafe(${String(bad)})`);
            assertShape(result);
            assert.ok(['missing', 'error'].includes(result.status), `status for ${String(bad)} was ${result.status}`);
            assert.equal(result.data, null);
        }
    });

    test('NEVER throws, even when the injected clock throws during quarantine', () => {
        const file = path.join(dir, 'memory.json');
        writeRaw(file, 'garbage');
        let result;
        assert.doesNotThrow(() => {
            result = readJsonSafe(file, { now: () => { throw new Error('clock broken'); } });
        });
        assertShape(result);
        assert.equal(result.status, 'corrupt');
        if (result.quarantinedTo === null) assert.equal(fs.readFileSync(file, 'utf8'), 'garbage');
        else assert.equal(fs.readFileSync(result.quarantinedTo, 'utf8'), 'garbage');
    });
});

describe('module rules (S1: no project imports; S0: importable without side effects)', () => {
    test('imports only Node built-in modules', () => {
        const imports = importsOf(MODULE);
        for (const spec of imports.static) assert.ok(isBuiltin(spec), `non built-in import: ${spec}`);
        assert.equal(imports.dynamic, 0, 'no dynamic import()');
        assert.equal(imports.require, 0, 'no require()');
    });

    test('importing the module prints nothing and creates no files', () => {
        const { run, filesCreated } = importInCleanProcess(MODULE);
        assert.equal(run.status, 0, describeRun(run));
        assert.equal(run.stdout, '', describeRun(run));
        assert.equal(run.stderr, '', describeRun(run));
        assert.deepEqual(filesCreated, []);
    });
});
