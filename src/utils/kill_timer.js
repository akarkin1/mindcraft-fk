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
