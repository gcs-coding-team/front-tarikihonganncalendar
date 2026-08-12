// 開発用: フロントと API を同じオリジンに載せる。
//
//   node dev-server.js          → http://localhost:3000
//   API_ORIGIN=... node dev-server.js
//
// バックエンド（github.com/gcs-coding-team/tarikihonganncalendar）は CORS
// ヘッダーを返さないので、別オリジンから叩くとプリフライトが 401 で落ちる。
// /v1 と /healthz を API に中継して同一オリジンに見せることで、それを避ける。
// 本番でも同じ形（リバースプロキシで /v1 を API に回す）で置くこと。

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = process.env.PORT || 3000;
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:8080';
const INDEX      = path.join(__dirname, 'index.html');

const api = new URL(API_ORIGIN);

http.createServer((req, res) => {
  if (req.url.startsWith('/v1') || req.url.startsWith('/healthz') || req.url.startsWith('/readyz')) {
    const upstream = http.request({
      hostname: api.hostname,
      port: api.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: api.host },
    }, up => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', err => {
      res.writeHead(502, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: {code: 'BACKEND_UNREACHABLE', detail: String(err.message)}}));
    });
    req.pipe(upstream);
    return;
  }

  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(fs.readFileSync(INDEX));
}).listen(PORT, () => {
  console.log(`front  http://localhost:${PORT}`);
  console.log(`api    ${API_ORIGIN} (/v1, /healthz を中継)`);
});
