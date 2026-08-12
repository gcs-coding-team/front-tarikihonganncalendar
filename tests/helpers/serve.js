// フロントとAPIを同じオリジンに載せる薄い配信サーバー。
// /v1 と /healthz は Go の API に回し、それ以外は index.html を返す。
const http = require('http'), fs = require('fs');
const API = 'http://127.0.0.1:8080';

http.createServer((req, res) => {
  if (req.url.startsWith('/v1') || req.url.startsWith('/healthz')) {
    const p = http.request(API + req.url, {method: req.method, headers: req.headers}, up => {
      res.writeHead(up.statusCode, up.headers); up.pipe(res);
    });
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    req.pipe(p);
    return;
  }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(fs.readFileSync(require('path').resolve(__dirname, '../../index.html')));
}).listen(3000, () => console.log('http://localhost:3000'));
