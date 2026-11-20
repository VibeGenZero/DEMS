/**
 * Debounced draft saver for the official „Design anpassen“ plugin.
 *
 * `schedule(source)` debounces rapid edits into a single `save(source)` call;
 * `flush()` cancels any waiting timer, waits for an in-flight save if one is
 * running, and saves the latest scheduled source right away.
 */

export function createDraftSaver({
    save,
    delay = 800,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
} = {}) {
    let timer = null;
    let queuedSource = null;
    let runningPromise = null;

    function runLoop() {
        if (runningPromise) return runningPromise;
        if (queuedSource === null) return Promise.resolve(null);

        const nextSource = queuedSource;
        queuedSource = null;

        let call;
        try {
            call = Promise.resolve(save(nextSource));
        } catch (err) {
            call = Promise.reject(err);
        }

        const step = call.finally(() => {
            runningPromise = null;
        });

        runningPromise = step.then(
            (res) => (queuedSource !== null ? runLoop() : res),
            (err) => {
                if (queuedSource !== null) return runLoop();
                throw err;
            }
        );

        return runningPromise;
    }

    function schedule(source) {
        queuedSource = source;
        if (timer !== null) {
            clearTimer(timer);
        }
        timer = setTimer(() => {
            timer = null;
            runLoop().catch(() => {});
        }, delay);
    }

    async function flush() {
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
        if (runningPromise) {
            return runningPromise;
        }
        if (queuedSource === null) {
            return null;
        }
        return runLoop();
    }

    function cancel() {
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
        queuedSource = null;
    }

    function pending() {
        return timer !== null || queuedSource !== null || runningPromise !== null;
    }

    return {
        schedule,
        flush,
        cancel,
        pending,
    };
}
