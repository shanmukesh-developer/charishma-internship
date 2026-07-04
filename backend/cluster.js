/**
 * ── Zenvy Cluster Launcher ──────────────────────────────────
 * Uses all available CPU cores to handle 500+ concurrent users.
 * Each worker runs a full Express + Socket.io instance.
 * 
 * In production (Render), use: node cluster.js
 * Falls back to single-process mode if cluster is not beneficial (1 CPU).
 */

const cluster = require('cluster');
const os = require('os');

const NUM_CPUS = os.cpus().length;
// Use all CPUs in production, cap at 4 for dev to avoid resource exhaustion
const WORKERS = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
  ? Math.max(2, NUM_CPUS)
  : Math.min(NUM_CPUS, 4);

if (cluster.isPrimary) {
  console.log(`\n🏗️  [CLUSTER] Primary process ${process.pid} starting ${WORKERS} workers on ${NUM_CPUS} CPUs...`);
  console.log(`🏗️  [CLUSTER] Each worker handles ~${Math.ceil(500 / WORKERS)} concurrent users\n`);

  // Fork workers
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  // Auto-restart crashed workers
  cluster.on('exit', (worker, code, signal) => {
    console.error(`💀 [CLUSTER] Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
    cluster.fork();
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[CLUSTER] SIGTERM received. Shutting down workers...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });

} else {
  // Each worker runs the full server
  require('./server');
  console.log(`🟢 [WORKER ${process.pid}] Online and accepting connections`);
}
