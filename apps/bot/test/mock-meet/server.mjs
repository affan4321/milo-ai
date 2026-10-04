// A stand-in for the parts of Google Meet the bot touches, driven over HTTP so tests can script a meeting.
// It validates the bot's LOGIC (join flow, waiting room, chat, captions, end/removal), not Meet's real markup.
//   node server.mjs [port]        env MOCK_AUDIO=<file> plays that audio inside the "call"
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] ?? 8801);
const rooms = new Map(); // code -> state
const room = (c) => { if (!rooms.has(c)) rooms.set(c, { state: "prejoin", others: 1, people: ["Ada", "Bob"], captions: [], messages: [], joinedAs: null, mode: "normal" }); return rooms.get(c); };
const json = (res, o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b ? JSON.parse(b) : {})); });

const PAGE = (code) => `<!doctype html><meta charset="utf-8"><title>Meet (mock)</title>
<style>body{margin:0;background:#202124;color:#e8eaed;font:16px sans-serif;height:100vh;overflow:hidden}#root{padding:24px}button{font:inherit;padding:8px 14px;margin:4px;border-radius:18px;border:0;cursor:pointer}
canvas{position:fixed;inset:80px 0 120px 0;margin:auto;width:640px;height:360px;background:#000}#panel{position:fixed;right:0;top:0;bottom:0;width:300px;background:#303134;padding:12px}
[aria-label="Captions"]{position:fixed;left:200px;right:320px;bottom:90px;background:#000a;padding:8px}</style>
<div id="root"></div><audio id="a" src="/audio" loop></audio>
<script>
const code=${JSON.stringify(code)}; let s={state:"prejoin"}, chatOpen=false, capsOn=false, started=false;
const el=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild};
async function post(path,b){return fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})})}
function draw(){
  const r=document.getElementById('root'); const sig=JSON.stringify([s.state,s.others,chatOpen,capsOn,s.messages.length]);
  if(draw.sig!==sig){ draw.sig=sig; r.innerHTML='';
    if(s.state==='prejoin'){ r.append(el('<div><h2>Ready to join?</h2><input aria-label="Your name" placeholder="Your name"><br><button role="button" aria-label="Turn off microphone">Mic</button><button role="button" aria-label="Turn off camera">Cam</button><br><button id="join">'+(s.mode==='nowait'?'Join now':'Ask to join')+'</button></div>'));
      r.querySelector('#join').onclick=async()=>{await post('/m/'+code+'/join',{name:r.querySelector('input')?.value||''})}; }
    else if(s.state==='waiting'){ r.append(el('<div><h2>Please wait until a meeting host brings you into the call</h2><div style="position:fixed;bottom:20px;left:20px"><button role="button" aria-label="Leave call">Leave</button></div></div>')); }  /* real Meet's lobby also has a Leave call button */
    else if(s.state==='denied'){ r.append(el('<div><h2>Someone in the meeting denied your request to join</h2></div>')); }
    else if(s.state==='blocked'){ r.append(el("<div><h2>You can't join this video call</h2></div>")); }
    else if(s.state==='captcha'){ r.append(el('<div><h2>Confirm you are not a robot</h2></div>')); }
    else if(s.state==='ended'){ r.append(el('<div><h2>You left the meeting</h2><button>Return to home screen</button></div>')); }
    else if(s.state==='removed'){ r.append(el("<div><h2>You've been removed from the meeting</h2></div>")); }
    else if(s.state==='in_call'){
      if(!started){started=true; document.getElementById('a').play().catch(()=>{});}
      r.append(el('<div>'+(s.people||[]).slice(0,s.others).map((n,i)=>'<div data-participant-id="p'+i+'" style="position:fixed;left:'+(20+i*140)+'px;top:20px;width:120px;height:60px;background:#444">'+n+'</div>').join('')+'<canvas id="cv" width="640" height="360"></canvas><div style="position:fixed;bottom:20px;left:20px"><button aria-label="People">'+(1+s.others)+'</button>'+(s.others===0?'<div style="position:fixed;top:60px;left:40%">No one else is in this meeting</div>':'')+'<button role="button" aria-label="Chat with everyone">Chat</button>'+(capsOn?'':'<button role="button" aria-label="Turn on captions">CC</button>')+'<button role="button" aria-label="Leave call">Leave</button></div></div>'));
      r.querySelector('[aria-label="Leave call"]').onclick=()=>post('/m/'+code+'/leave');
      const cc=r.querySelector('[aria-label="Turn on captions"]'); if(cc) cc.onclick=()=>{capsOn=true;draw.sig=null;draw()};
      r.querySelector('[aria-label="Chat with everyone"]').onclick=()=>{chatOpen=!chatOpen;draw.sig=null;draw()};
      if(chatOpen){ const p=el('<div id="panel"><div id="msgs"></div><textarea aria-label="Send a message" placeholder="Send a message" rows="2" style="width:100%"></textarea></div>'); r.append(p);
        const m=p.querySelector('#msgs'); s.messages.forEach((x,i)=>m.append(el('<div data-message-id="m'+i+'" data-sender-name="'+x.from+'"><b>'+x.from+'</b><div>'+x.text.replace(/</g,'&lt;')+'</div></div>')));
        const t=p.querySelector('textarea'); t.onkeydown=(e)=>{ if(e.key==='Enter'){e.preventDefault(); post('/m/'+code+'/chat',{from:'Milo AI Notetaker',text:t.value}); t.value='';} }; }
    }
  }
  // captions are re-rendered every poll the way a live caption strip grows
  let cap=document.querySelector('[aria-label="Captions"]');
  if(s.state==='in_call'&&capsOn){ if(!cap){cap=el('<div aria-label="Captions" role="region"></div>');document.body.append(cap);}
    const html=s.captions.slice(-2).map(c=>'<div><div><span>'+c.name+'</span></div><div>'+c.text+'</div></div>').join(''); if(cap.dataset.h!==html){cap.dataset.h=html;cap.innerHTML=html;} }
  const cv=document.getElementById('cv'); if(cv){const g=cv.getContext('2d'),t=Date.now()/1000;g.fillStyle='hsl('+((t*40)%360)+',60%,40%)';g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='48px sans-serif';g.fillText('mock call '+t.toFixed(1),60,190);}
}
async function poll(){ try{ s=await (await fetch('/state/'+code)).json(); }catch{} draw(); }
setInterval(poll,300); setInterval(draw,100); poll();
</script>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "audio") {
    const f = process.env.MOCK_AUDIO; if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "audio/mp4" }); return fs.createReadStream(f).pipe(res);
  }
  if (parts[0] === "m" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE(parts[1])); }
  if (parts[0] === "state") return json(res, room(parts[1]));
  if (parts[0] === "m" && req.method === "POST") {
    const r = room(parts[1]), b = await body(req);
    if (parts[2] === "join") { r.joinedAs = b.name; r.state = r.mode === "nowait" ? "in_call" : "waiting"; if (r.mode === "denied") r.state = "denied"; if (r.mode === "blocked") r.state = "blocked"; if (r.mode === "captcha") r.state = "captcha"; }
    if (parts[2] === "leave") r.state = "ended";
    if (parts[2] === "chat") r.messages.push({ from: b.from, text: b.text });
    return json(res, { ok: true });
  }
  if (parts[0] === "control" && req.method === "POST") {
    const r = room(parts[1]), b = await body(req);
    switch (b.do) {
      case "mode": r.mode = b.mode; break;           // nowait | denied | blocked | captcha
      case "admit": r.state = "in_call"; break;
      case "end": r.state = "ended"; break;
      case "remove": r.state = "removed"; break;
      case "others": r.others = b.count; break;
      case "caption": r.captions.push({ name: b.name, text: b.text }); break;
      case "chat": r.messages.push({ from: b.from, text: b.text }); break;
      case "reset": rooms.delete(parts[1]); break;
    }
    return json(res, room(parts[1]));
  }
  res.writeHead(404); res.end();
}).listen(port, "0.0.0.0", () => console.log(`mock meet on :${port}`));
