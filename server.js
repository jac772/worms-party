"use strict";
/* =========================================================================
   WORMS PARTY — relay server.
   - Serves the host screen (/host), phone controllers (/play) and assets.
   - Generates the join QR code and reports the LAN address.
   - Relays WebSocket messages between the single host screen and the phones.
     The host browser runs the authoritative game; phones are thin controllers.
   ========================================================================= */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function lanIP(){
  const ifaces = os.networkInterfaces();
  for(const name of Object.keys(ifaces))
    for(const ni of ifaces[name])
      if(ni.family==='IPv4' && !ni.internal) return ni.address;
  return '127.0.0.1';
}

function serveFile(res, file, type){
  fs.readFile(file,(err,data)=>{
    if(err){ res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200,{'Content-Type':type||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
}

const server = http.createServer((req,res)=>{
  const u = new URL(req.url, 'http://'+(req.headers.host||'localhost'));
  let p = decodeURIComponent(u.pathname);

  if(p==='/'  ) return serveFile(res, path.join(ROOT,'index.html'), MIME['.html']);
  if(p==='/host' || p==='/host.html') return serveFile(res, path.join(ROOT,'host.html'), MIME['.html']);
  if(p==='/play' || p==='/controller.html' || p==='/join') return serveFile(res, path.join(ROOT,'controller.html'), MIME['.html']);

  if(p==='/api/netinfo'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ lan:`http://${lanIP()}:${PORT}`, port:PORT }));
  }
  if(p==='/api/qr'){
    const text = u.searchParams.get('text') || '';
    QRCode.toString(text, { type:'svg', margin:1, color:{ dark:'#0c1226', light:'#ffffff' } }, (err,svg)=>{
      if(err){ res.writeHead(500); return res.end('qr error'); }
      res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-cache'});
      res.end(svg);
    });
    return;
  }

  // static assets within ROOT (no traversal)
  const safe = path.normalize(path.join(ROOT, p));
  if(!safe.startsWith(ROOT)){ res.writeHead(403); return res.end('forbidden'); }
  if(fs.existsSync(safe) && fs.statSync(safe).isFile())
    return serveFile(res, safe, MIME[path.extname(safe)] || 'application/octet-stream');

  res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found');
});

/* ----------------------------- WebSocket relay ------------------------- */
const wss = new WebSocketServer({ server });
let host = null;                       // the single host-screen socket
const players = new Map();             // id -> { ws, name }
let nextId = 1;

const send = (ws,obj)=>{ try{ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }catch(e){} };

wss.on('connection',(ws,req)=>{
  const role = new URL(req.url,'http://x').searchParams.get('role') || 'player';
  ws.isAlive = true;
  ws.on('pong', ()=>{ ws.isAlive = true; });

  if(role==='host'){
    if(host && host!==ws){ try{ host.removeAllListeners(); host.close(); }catch(e){} }
    host = ws;
    // give the new host the current roster so it can rebuild the lobby
    send(host, { t:'roster', players:[...players.entries()].map(([id,p])=>({id,name:p.name})) });
    ws.on('message', raw=>{
      let m; try{ m=JSON.parse(raw); }catch(e){ return; }
      if(m.t==='to' && players.has(m.id)) send(players.get(m.id).ws, m.msg);
      else if(m.t==='all') for(const p of players.values()) send(p.ws, m.msg);
    });
    ws.on('close',()=>{ if(host===ws){ host=null; for(const p of players.values()) send(p.ws,{t:'hostGone'}); } });
    return;
  }

  // player
  const id = nextId++;
  players.set(id, { ws, name:'Player '+id });
  send(ws, { t:'welcome', id });
  if(host) send(host, { t:'join', id, name:players.get(id).name });

  ws.on('message', raw=>{
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    if(m.t==='name'){ const nm=(typeof m.name==='string' && m.name.trim()) ? m.name.trim().slice(0,16) : ('Player '+id);
      players.get(id).name=nm; if(host) send(host,{ t:'name', id, name:nm }); return; }
    // everything else (inputs) is relayed to the host tagged with this player id
    if(host && typeof m.t==='string') send(host, { t:'p', id, msg:m });
  });
  ws.on('close',()=>{ players.delete(id); if(host) send(host,{ t:'leave', id }); });
});

// drop dead/zombie sockets (e.g. a phone that went to sleep without closing cleanly)
const heartbeat = setInterval(()=>{
  wss.clients.forEach(ws=>{ if(ws.isAlive===false){ try{ ws.terminate(); }catch(e){} return; }
    ws.isAlive=false; try{ ws.ping(); }catch(e){} });
}, 30000);
wss.on('close', ()=> clearInterval(heartbeat));

server.listen(PORT, ()=>{
  const url = `http://${lanIP()}:${PORT}`;
  console.log('\n  🪱  WORMS PARTY server running');
  console.log('  ───────────────────────────────────────────');
  console.log('  Host screen (open this on your big screen):');
  console.log('     '+url+'/host');
  console.log('  Players join at:  '+url+'/play');
  console.log('  (same-WiFi works out of the box — see README for internet play)\n');
});
