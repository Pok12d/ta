const RELAY_WSS = "wss://relay-lx0q.onrender.com/intercept";

(function(){
  if (window.__exitgames_ws_proxy_installed) return;
  window.__exitgames_ws_proxy_installed = true;

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i]=binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Relay connection
  let relay;
  let readyResolve;
  let ready = new Promise(r=>readyResolve=r);
  let queue = [];

  function connectRelay() {
    relay = new WebSocket(RELAY_WSS);
    relay.binaryType="arraybuffer";

    relay.onopen = () => {
      console.log("[proxy] relay connected");
      readyResolve();
      while(queue.length) relay.send(JSON.stringify(queue.shift()));
    };

    relay.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data instanceof ArrayBuffer ? new TextDecoder().decode(ev.data) : ev.data); } catch(e){console.error(e); return;}
      const stub = stubs.get(msg.connId);
      if(!stub) return;

      if(msg.type==="open") { stub._readyState=1; stub.onopen?.({target:stub}); stub.dispatchEvent?.(new Event("open")); }
      else if(msg.type==="message") {
        let data = msg.isBinary ? base64ToArrayBuffer(msg.payload) : msg.payload;
        stub.onmessage?.({data}); stub.dispatchEvent?.(Object.assign(new Event("message"), {data}));
      } else if(msg.type==="close") {
        stub._readyState=3; stub.onclose?.({code:msg.code, reason:msg.reason}); stub.dispatchEvent?.(Object.assign(new Event("close"), {code:msg.code, reason:msg.reason}));
        stubs.delete(msg.connId);
      } else if(msg.type==="error") {
        stub.onerror?.({message:msg.message}); stub.dispatchEvent?.(Object.assign(new Event("error"), {message:msg.message}));
      }
    };

    relay.onclose = ()=>{ console.warn("[proxy] relay closed, reconnecting in 2s"); setTimeout(connectRelay,2000); ready=new Promise(r=>readyResolve=r); };
    relay.onerror = e=>{ console.error("[proxy] relay error", e); relay.close(); };
  }
  connectRelay();

  function sendCtrl(obj) {
    const s=JSON.stringify(obj);
    if(relay && relay.readyState===WebSocket.OPEN) relay.send(s);
    else queue.push(obj);
  }

  const stubs = new Map();
  let nextId=1;
  function genId(){return "c"+(nextId++);}

  const NativeWS = window.WebSocket;
  function ProxyWS(url, protocols){
    if(!/\.?exitgames\.com$/i.test(new URL(url,location.href).hostname))
      return protocols===undefined?new NativeWS(url):new NativeWS(url,protocols);

    const connId=genId();
    const stub=new EventTarget();
    stub._connId=connId; stub._url=url; stub._protocols=protocols; stub._readyState=0;
    stub.onopen=stub.onmessage=stub.onclose=stub.onerror=null;

    stub.send = data=>{
      if(stub._readyState===3) throw new Error("WS closed");
      if(typeof data==="string") sendCtrl({type:"send", connId, isBinary:false, payload:data});
      else if(data instanceof ArrayBuffer || ArrayBuffer.isView(data)) sendCtrl({type:"send", connId, isBinary:true, payload:arrayBufferToBase64(data instanceof ArrayBuffer?data:data.buffer)});
      else if(data instanceof Blob){ const r=new FileReader(); r.onload=()=>sendCtrl({type:"send", connId,isBinary:true,payload:arrayBufferToBase64(r.result)}); r.readAsArrayBuffer(data); }
      else sendCtrl({type:"send", connId,isBinary:false,payload:JSON.stringify(data)});
    };

    stub.close = (code,reason)=>{
      if(stub._readyState===3) return;
      stub._readyState=3;
      sendCtrl({type:"close",connId,code:code||1000,reason:reason||"client close"});
      stub.onclose?.({code:code||1000,reason:reason||"client close"});
      stub.dispatchEvent?.(Object.assign(new Event("close"),{code:code||1000,reason:reason||"client close"}));
      stubs.delete(connId);
    };

    stubs.set(connId,stub);
    ready.then(()=>sendCtrl({type:"open",connId,target:url,protocols}));

    Object.defineProperty(stub,"readyState",{get:()=>stub._readyState});
    Object.defineProperty(stub,"url",{get:()=>stub._url});
    Object.defineProperty(stub,"protocol",{get:()=>stub._protocols});

    return stub;
  }
  ProxyWS.prototype=NativeWS.prototype;
  window.WebSocket=ProxyWS;
  console.log("[proxy] exitgames WS proxy installed", RELAY_WSS);
})();
