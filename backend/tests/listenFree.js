// A test server on a free local port that fetch() accepts. Windows hands out dynamic ports from 1024 up (this
// machine: 1024-15000), and undici refuses the "bad ports" of the Fetch standard: a server that lands on 5060, 6000,
// 10080 ... fails every request with "fetch failed: bad port" (seen 2 Nov 2026 in tests/s1/15_ticket_reply). Such a
// port is closed and another one taken. Works for an express app and for a plain http.Server.
const BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

const listenFree = async (appOrServer) => {
  for (;;) {
    const server = await new Promise((resolve) => { const s = appOrServer.listen(0, '127.0.0.1', () => resolve(s)); });
    if (!BAD_PORTS.has(server.address().port)) return server;
    await new Promise((resolve) => server.close(resolve));
  }
};

module.exports = { listenFree, BAD_PORTS };
