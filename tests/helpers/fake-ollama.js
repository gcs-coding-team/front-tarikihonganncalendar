// 本物の代わり。画像を受け取ったふりをして、決まった候補を返す。
const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/api/tags') { res.writeHead(200); res.end('{"models":[]}'); return; }
  let n = 0;
  req.on('data', c => n += c.length);
  req.on('end', () => {
    console.log('受信バイト数(JSON全体):', n);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({response: JSON.stringify({items:[
      {type:'task',  title:'数学プリント 応用問題 p.24', date:'2026-08-20'},
      {type:'event', title:'PTA全体保護者会', date:'2026-08-25', time:'10:00'},
    ]})}));
  });
}).listen(11434, () => console.log('fake ollama :11434'));
