const RELAY_WSS = "wss://relay-lx0q.onrender.com/intercept";

(function(){
  if (window.__exitgames_ws_proxy_installed) return;
  window.__exitgames_ws_proxy_installed = true;

  const NativeWebSocket = window.WebSocket;
  const stubs = new Map();
  let nextConnId = 1;

  let relay = new NativeWebSocket(RELAY_WSS);
  relay.binaryType = "arraybuffer";

  relay.addEventListener("open", () => console.log("[proxy-client] relay connected"));
  relay.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch(e){ return; }
    const stub = stubs.get(msg.connId);
    if (!stub) return;

    if (msg.type === "message") {
      const evObj = { data: msg.isBinary ? Uint8Array.from(atob(msg.payload), c=>c.charCodeAt(0)).buffer : msg.payload };
      stub.onmessage && stub.onmessage(evObj);
    } else if (msg.type === "open") stub.onopen && stub.onopen({ target: stub });
    else if (msg.type === "close") stub.onclose && stub.onclose({ code: msg.code, reason: msg.reason });
    else if (msg.type === "error") stub.onerror && stub.onerror({ message: msg.message });
  });

  function genConnId(){ return "c"+(nextConnId++); }

  window.WebSocket = function(url, protocols){
    if (!/exitgames\.com/.test(url)) return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);

    const connId = genConnId();
    const stub = { _connId: connId, onopen:null, onmessage:null, onclose:null, onerror:null, send(msg){ 
      relay.send(JSON.stringify({ type:"send", connId, isBinary: msg instanceof ArrayBuffer, payload: msg instanceof ArrayBuffer ? btoa(String.fromCharCode(...new Uint8Array(msg))) : msg }));
    }};
    stubs.set(connId, stub);
    relay.addEventListener("open", ()=>relay.send(JSON.stringify({ type:"open", connId, target:url, protocols })));
    return stub;
  };

  console.log("[proxy-client] installed exitgames ws proxy. Relay:", RELAY_WSS);
})();
