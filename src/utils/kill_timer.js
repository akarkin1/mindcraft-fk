// Runs fn() with a timer that calls onTimeout() when fn has not settled within ms milliseconds.
// The timer is cleared in every case: when fn returns, resolves, throws or rejects. The value
// or the error of fn is passed on unchanged.
export async function withKillTimer(onTimeout, ms, fn) {
    const timer = setTimeout(onTimeout, ms);
    try {
        return await fn();
    } finally {
        clearTimeout(timer);
    }
}

// v0.1.4.8, A2: runs fn() and waits for it at most ms milliseconds. Never rejects and never kills.
// Resolves { done: true, value } or { done: true, error } when fn settled in time, { done: false }
// when the time was over first. With options.until, a function that is read at the start and every
// options.pollMs milliseconds (default 200): { done: false, stopped: true } as soon as it returns
// true; when it is true at the start, fn is not called. ms of 0 or less, or not finite: no time
// limit. A late value or error of fn is dropped. Every timer is cleared when the result is known.
export function withTimeLimit(ms, fn, options = {}) {
    const until = typeof options?.until === 'function' ? options.until : null;
    const pollMs = Number.isFinite(options?.pollMs) && options.pollMs > 0 ? options.pollMs : 200;
    const stopNow = () => {
        try {
            return Boolean(until());
        } catch {
            return false;
        }
    };
    return new Promise((resolve) => {
        if (until && stopNow()) {
            resolve({ done: false, stopped: true });
            return;
        }
        let finished = false;
        let timer = null;
        let poll = null;
        const finish = (result) => {
            if (finished)
                return;
            finished = true;
            if (timer !== null)
                clearTimeout(timer);
            if (poll !== null)
                clearInterval(poll);
            resolve(result);
        };
        if (Number.isFinite(ms) && ms > 0)
            timer = setTimeout(() => finish({ done: false }), ms);
        if (until) {
            poll = setInterval(() => {
                if (stopNow())
                    finish({ done: false, stopped: true });
            }, pollMs);
        }
        let running;
        try {
            running = Promise.resolve(fn());
        } catch (error) {
            finish({ done: true, error });
            return;
        }
        running.then((value) => finish({ done: true, value }), (error) => finish({ done: true, error }));
    });
}
