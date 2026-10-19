// A5: tiny p-limit style concurrency limiter (no dependency) used by utils/push.js.
//   const q = createLimiter(10, { maxQueue: 10000 });
//   await q.run(() => sendSomething());     // at most 10 run at once, the rest wait in FIFO order
// run() rejects with code QUEUE_FULL (without calling fn) when maxQueue jobs are already waiting.

const createLimiter = (concurrency, { maxQueue = Infinity } = {}) => {
  let limit = Math.max(1, Number(concurrency) || 1);
  let active = 0;
  let peakActive = 0;
  const waiting = [];

  const pump = () => {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active++;
      if (active > peakActive) peakActive = active;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  };

  const run = (fn) => new Promise((resolve, reject) => {
    if (waiting.length >= maxQueue) {
      const err = new Error(`queue full (${maxQueue} waiting)`);
      err.code = 'QUEUE_FULL';
      reject(err);
      return;
    }
    waiting.push({ fn, resolve, reject });
    pump();
  });

  const idle = () => new Promise((resolve) => {
    const check = () => (active === 0 && waiting.length === 0 ? resolve() : setTimeout(check, 5));
    check();
  });

  return {
    run,
    idle,
    stats: () => ({ active, pending: waiting.length, concurrency: limit, peakActive }),
    setConcurrency: (n) => { limit = Math.max(1, Number(n) || 1); pump(); },
    resetPeak: () => { peakActive = active; },
  };
};

module.exports = { createLimiter };
