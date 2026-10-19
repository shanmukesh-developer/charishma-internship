const { isProduction, FRIENDLY_SERVER_ERROR } = require('../utils/env');

// Client mistakes that reach the global handler carry their own status (body-parser: 400 bad JSON,
// 413 too large, 415 charset; CORS refusal: 403). They used to be answered as 500
// INTERNAL_SERVER_ERROR (and in production with the generic "something went wrong" text).
const CLIENT_ERRORS = {
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large. Please send a smaller photo or less text.' },
  'request.size.invalid': { code: 'INVALID_BODY', message: 'The request body was incomplete. Please try again.' },
  'request.aborted': { code: 'REQUEST_ABORTED', message: 'The request was interrupted. Please try again.' },
  'charset.unsupported': { code: 'UNSUPPORTED_CHARSET', message: 'Unsupported request encoding.' },
  'encoding.unsupported': { code: 'UNSUPPORTED_ENCODING', message: 'Unsupported request encoding.' },
};

const errorHandler = (err, req, res, _next) => {
  const errStatus = Number(err && (err.status || err.statusCode));
  const clientStatus = Number.isInteger(errStatus) && errStatus >= 400 && errStatus < 500 ? errStatus : null;
  const statusCode = clientStatus || (res.statusCode === 200 || res.statusCode < 400 ? 500 : res.statusCode);
  const known = err && err.type ? CLIENT_ERRORS[err.type] : null;
  // A6: logged with the request id, redacted (no phones / emails / tokens / OTPs from messages or URLs);
  // 5xx are counted and sent to the optional error webhook (utils/errorReporter, off by default).
  const reqId = (req._perf && req._perf.reqId) || req.id || undefined;
  const logger = require('../utils/logger');
  if (statusCode >= 500) {
    logger.logError('[UNHANDLED_ROUTE_ERROR]', err, { method: req.method, url: logger.redactUrl(req.originalUrl), reqId });
    try {
      const reporter = require('../utils/errorReporter');
      reporter.countServerError();
      let route = null;
      try { route = require('../utils/perfMetrics').routeKey(req).replace(/^[A-Z]+ /, ''); } catch { route = null; }
      reporter.report('route', err, { reqId, method: req.method, route, status: statusCode });
    } catch { /* reporting never breaks the response */ }
  } else {
    logger.logWarn('[CLIENT_ERROR]', (err && (err.type || err.message)) || '', { status: statusCode, method: req.method, url: logger.redactUrl(req.originalUrl), reqId });
  }
  if (res.headersSent) return undefined;
  res.status(statusCode);
  const prod = isProduction();
  const code = (known && known.code) || (err && typeof err.code === 'string' && err.code) || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  const message = known ? known.message
    : (prod && statusCode >= 500 ? FRIENDLY_SERVER_ERROR : ((err && err.message) || FRIENDLY_SERVER_ERROR));
  return res.json({
    success: false,
    message,
    code,
    // Never a stack for client errors; dev-only for server errors.
    stack: prod || statusCode < 500 ? null : (err && err.stack),
  });
};

module.exports = { errorHandler };
