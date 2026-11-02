// Where startup time goes (2 Nov 2026: every restart left the API 503 "starting" for ~90 s on Render). Named marks in
// milliseconds since the process started; /api/health?infra=1 reports them, so the next deploy shows which phase
// (database connect, schema check, migrations, ready) takes the time. Only the first mark of each name counts.
const marks = {};

const mark = (name) => {
  if (!(name in marks)) marks[name] = Math.round(process.uptime() * 1000);
  return marks[name];
};

const snapshot = () => ({ ...marks });

module.exports = { mark, snapshot };
