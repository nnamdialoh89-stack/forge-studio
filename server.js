// Forge Studio server: serves the pages, pairs phones (WebRTC signaling), relays the program feed to RTMP via FFmpeg.
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000, PASS=process.env.FORGE_PASSWORD||'', TRANSCODE=process.env.FORGE_TRANSCODE==='1';
const pages={'/':'studio.html','/cam':'cam.html'};
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/ice'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(process.env.FORGE_ICE_JSON||'[]')}
  const f=pages[req.url.split('?')[0]];
  if(!f){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  fs.createReadStream(path.join(__dirname,f)).pipe(res);
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,sock,head)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname!=='/ws'&&u.pathname!=='/out')return sock.destroy();
  wss.handleUpgrade(req,sock,head,ws=>{ws.q=u.searchParams;u.pathname==='/ws'?signal(ws):out(ws)});
});
const rooms={};
const send=(w,o)=>w&&w.readyState===1&&w.send(JSON.stringify(o));
function signal(ws){
  const room=ws.q.get('room'),role=ws.q.get('role');
  if(!room||room.length<8||room.length>64)return ws.close();
  const r=rooms[room]||(rooms[room]={cams:new Map()});
  if(role==='studio'){
    if(PASS&&ws.q.get('key')!==PASS){send(ws,{type:'error',text:'Wrong server password'});return ws.close()}
    r.studio=ws;
    ws.on('message',m=>{try{const o=JSON.parse(m);send(r.cams.get(o.to),o)}catch{}});
    ws.on('close',()=>{if(r.studio===ws)r.studio=null});
  }else{
    const id=Math.random().toString(36).slice(2,8);
    if(!r.studio)return send(ws,{type:'error',text:'Studio is not open. Open Forge Studio first.'});
    r.cams.set(id,ws);
    ws.on('message',m=>{try{const o=JSON.parse(m);o.from=id;send(r.studio,o)}catch{}});
    ws.on('close',()=>{r.cams.delete(id);send(r.studio,{type:'left',from:id});if(!r.studio&&!r.cams.size)delete rooms[room]});
    send(r.studio,{type:'joined',from:id});
  }
}
function out(ws){
  let ff=null;
  ws.on('message',m=>{
    if(!ff){
      try{
        const o=JSON.parse(m.toString());
        if(PASS&&o.key!==PASS)throw 0;
        const d=(o.dests||[]).filter(u=>/^rtmps?:\/\/[^\s|\[\]'"]+$/.test(u)).slice(0,6);
        if(!d.length)throw 0;
        const v=TRANSCODE?['-c:v','libx264','-preset','veryfast','-b:v','4000k','-maxrate','4000k','-bufsize','8000k','-g','60','-pix_fmt','yuv420p']:['-c:v','copy'];
        ff=spawn('ffmpeg',['-loglevel','error','-i','pipe:0',...v,'-c:a','aac','-b:a','128k','-ar','44100','-map','0:v','-map','0:a?','-f','tee',d.map(u=>'[f=flv]'+u).join('|')]);
        ff.stderr.on('data',x=>send(ws,{log:x.toString()}));
        ff.stdin.on('error',()=>{});
        ff.on('close',()=>ws.close());
        send(ws,{ok:true});
      }catch{ws.close()}
      return;
    }
    ff.stdin.write(m);
  });
  ws.on('close',()=>{if(ff){ff.stdin.end();setTimeout(()=>ff.kill('SIGKILL'),2000)}});
}
server.listen(PORT,()=>console.log('Forge Studio on port '+PORT));
