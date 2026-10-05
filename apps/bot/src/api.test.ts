// The bot's web client against a local server that misbehaves the way a recompiling / restarting web app does.
import http from "node:http";
let hits = 0, mode = "flaky";
const server = http.createServer((req, res) => {
  hits++;
  if (mode === "flaky" && hits <= 2) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html>404 page</html>"); }   // framework error page, twice
  if (mode === "missing") { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }              // our API: really unknown
  if (mode === "down") { res.writeHead(502, { "content-type": "text/html" }); return res.end("bad gateway"); }
  res.writeHead(200, { "content-type": "application/json" }); res.end('{"state":"scheduled"}');
}).listen(0);
const port = (server.address() as any).port;
process.env.WEB_URL = `http://localhost:${port}`; process.env.BOT_TOKEN = "t";
const { api } = await import("./api");
let fails = 0; const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

let t = Date.now(); let r = await api.getState("abc");
check(r?.state === "scheduled" && hits === 3, `HTML 404s during a recompile are retried, then the real answer is used (hits ${hits}, ${Date.now() - t}ms)`);
mode = "missing"; hits = 0; t = Date.now(); r = await api.getState("abc");
check(r?.state === "unknown" && hits === 1 && Date.now() - t < 1500, "a JSON 404 means the session really doesn't exist: answered at once, no retries");
console.log(fails ? `${fails} FAILED` : "ok"); server.close(); process.exit(fails ? 1 : 0);
