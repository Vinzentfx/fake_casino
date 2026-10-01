"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { protectSocket, validPayload } = require("../game/socketSafety");

// Modules with disk storage always run in a fresh copy, never the real data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-safety-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(key = "alice") {
  const handlers = new Map(), middleware = [], emitted = [];
  const socket = { data: { account: key }, rooms: new Set(), on(e,f) { handlers.set(e,f); return this; }, use(f) { middleware.push(f); }, emit(...args) { emitted.push(args); } };
  const io = { on(e,f) { if (e === "connection") f(socket); }, emit(){}, of(){return {sockets:new Map([["test", socket]])};}, to(){return {emit(){}};} };
  function call(e, payload) {
    let result;
    const ack = r => { result = r; };
    const args = payload === undefined ? [ack] : [payload, ack];
    let at = 0;
    const next = () => { if (at < middleware.length) middleware[at++]([e, ...args], next); else handlers.get(e)?.(...args); };
    next(); return result;
  }
  return { socket, io, call, emitted };
}

test("socket envelopes reject null, scalar, arrays, deep and prototype payloads", () => {
  for (const payload of [null, [], "text", 1, { bad: Infinity }, JSON.parse('{"__proto__":{}}')]) assert.equal(validPayload(payload), false);
  let deep = {}; for (let i=0;i<15;i++) deep={value:deep};
  assert.equal(validPayload(deep), false);
  const f = fixture(null); protectSocket(f.socket, {error(){}});
  let calls=0; f.socket.on("auth", () => calls++);
  assert.equal(f.call("auth", null).ok, false);
  assert.equal(f.call("auth", {token:42}).ok, false);
  f.call("auth", {token:"signed-token"}); assert.equal(calls,1);
  f.socket.on("example:state", ack => ack({ok:true}));
  assert.equal(f.call("example:state").ok,true);
});

test("handler exceptions are contained and do not expose private inputs", () => {
  const f=fixture();const logs=[];protectSocket(f.socket,{error(...x){logs.push(x);}});
  f.socket.on("example:action",()=>{throw new Error("private-token");});
  assert.equal(f.call("example:action",{}).ok,false);
  assert.equal(JSON.stringify(logs).includes("private-token"),false);
});

test("password change revokes tokens, including tokens refreshed before the change", () => {
  const r=accounts.login("SessionTest","Password2026");assert.equal(r.ok,true);
  const refresh=accounts.resumeSession(r.token);assert.equal(refresh.ok,true);
  let notified=null;const remove=accounts.onSessionRevoked(k=>notified=k);
  assert.equal(accounts.changePin("SessionTest","Password2026","NewPassword2026").ok,true);
  assert.equal(accounts.verifyToken(r.token),null);assert.equal(accounts.verifyToken(refresh.token),null);
  assert.equal(notified,"sessiontest");remove();
  const fresh=accounts.login("SessionTest","NewPassword2026");assert.equal(accounts.verifyToken(fresh.token),"sessiontest");
  assert.equal(accounts.rename("SessionTest","RenamedTest").ok,true);
  assert.equal(accounts.verifyToken(fresh.token),"sessiontest");
});

test("recreating a deleted name does not revive its old sessions", () => {
  const r=accounts.login("RecreateTest","Password2026");assert.equal(r.ok,true);
  assert.equal(accounts.deleteAccount("RecreateTest").ok,true);
  const fresh=accounts.login("RecreateTest","Different2026");assert.equal(fresh.ok,true);
  assert.equal(accounts.verifyToken(r.token),null);assert.equal(accounts.verifyToken(fresh.token),"recreatetest");
});

test("private chat history checks both authentication and room membership", () => {
  const {setupChat}=require(path.join(root,"game/chat"));
  const a={get:k=>k?{name:k}:null};const writer=fixture("writer");setupChat(writer.io,a);writer.socket.rooms.add("PRIVATE");
  assert.equal(writer.call("chat:send",{room:"PRIVATE",text:"private message"}).ok,true);
  const stranger=fixture(null);setupChat(stranger.io,a);
  assert.equal(stranger.call("chat:history",{room:"PRIVATE"}).ok,false);
  stranger.socket.data.account="other";
  assert.equal(stranger.call("chat:history",{room:"PRIVATE"}).ok,false);
  stranger.socket.rooms.add("PRIVATE");
  assert.equal(stranger.call("chat:history",{room:"PRIVATE"}).messages[0].text,"private message");
  stranger.socket.rooms.delete("PRIVATE");
  assert.equal(stranger.call("chat:history",{room:"PRIVATE"}).ok,false);
});

test("outfit save/load is persistent and never restores sold pieces or partially applies", () => {
  const r=accounts.login("OutfitTest","Password2026");assert.equal(r.ok,true);
  const cosmetics=require(path.join(root,"game/cosmetics"));const f=fixture("outfittest");cosmetics.setupCosmetics(f.io,accounts);
  const acc=accounts.get("outfittest");
  cosmetics.grant(acc,"style","sonne","outfittest");
  assert.equal(f.call("cos:equip",{type:"style",id:"sonne"}).ok,true);
  assert.equal(f.call("cos:outfitSave",{slot:0}).ok,true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root,"data/accounts.json"))).outfittest.outfits[0]);
  assert.equal(f.call("cos:equip",{type:"style",id:"standard"}).ok,true);
  assert.equal(f.call("cos:outfitWear",{slot:0}).ok,true);assert.equal(acc.nameStyle,"sonne");
  cosmetics.besitzNehmen(acc,"style","sonne");
  const before=JSON.stringify(acc);
  assert.equal(f.call("cos:outfitWear",{slot:0}).ok,false);assert.equal(JSON.stringify(acc),before);
  assert.equal(f.call("cos:outfitSave",{slot:3}).ok,false);
  assert.equal(f.call("cos:outfitWear",{slot:-1}).ok,false);
});

test("bank polling preserves fractional interest", () => {
  const {setupBank}=require(path.join(root,"game/bank"));const acc={name:"alice",chips:10000};
  const a={get:()=>acc,faucetFactor:()=>1,publicAccount:()=>acc,save(){},adjustChips(k,n){acc.chips+=n;return {ok:true,account:acc};}};
  const f=fixture();setupBank(f.io,a);const original=Date.now;let now=1e9;Date.now=()=>now;
  try {f.call("savings:deposit",{amount:10000});for(let i=0;i<24;i++){now+=3600000;f.call("bank:state");}assert.equal(acc.savings.amount,10008);} finally {Date.now=original;}
});

for(const kind of ["mines","towers"]) test(`${kind} idle and displayed cashout use the same cap`,()=>{
  const file=path.join(root,"game",kind+".js"), mod={exports:{}}, intervals=[];let now=1e9;
  const req=createRequire(file);
  vm.runInNewContext(fs.readFileSync(file,"utf8"),{module:mod,exports:mod.exports,require:n=>n==="crypto"?{randomInt:n=>n-1}:req(n),Date:{now:()=>now},setInterval:f=>(intervals.push(f),{unref(){}}),console});
  const acc={name:"alice",chips:1e7};const a={get:()=>acc,pechTrifft:()=>false,recordHand(){},adjustChips(k,n){acc.chips+=n;return{ok:true,account:acc};}};
  const f=fixture();mod.exports[kind==="mines"?"setupMines":"setupTowers"](f.io,a);
  f.call(kind+":start",kind==="mines"?{bet:50000,mines:15}:{bet:50000,difficulty:"master"});
  let result;for(let i=0;i<(kind==="mines"?4:3);i++)result=f.call(kind==="mines"?"mines:reveal":"towers:pick",{tile:kind==="mines"?24-i:3});
  const before=acc.chips;now+=31*60000;intervals.forEach(f=>f());
  assert.equal(result.cashout,2000000);assert.equal(acc.chips-before,result.cashout);
});

test("listed cosmetics count as duplicates and cannot be bought twice", () => {
  const c=require(path.join(root,"game/cosmetics")),p=require(path.join(root,"game/praegung")),m=require(path.join(root,"game/market"));
  accounts.login("SellerTest","Password2026");accounts.login("BuyerTest","Password2026");
  const seller=accounts.get("sellertest"),buyer=accounts.get("buyertest");
  const a=fixture("sellertest"),b=fixture("buyertest");m.setupMarket(a.io,accounts);m.setupMarket(b.io,accounts);
  assert.equal(c.grant(seller,"style","sonne","sellertest"),true);
  const item=p.stueckVon("sellertest","style","sonne");
  assert.equal(a.call("market:anbieten",{uid:item.uid,preis:1000}).ok,true);
  assert.equal(c.grant(seller,"style","sonne","sellertest"),false);
  assert.equal(c.hatStueck(seller,"style","sonne"),false);
  const offer=m.oeffentlich(accounts,"sellertest").angebote[0];
  assert.equal(b.call("market:buy",{id:offer.id}).ok,true);
  assert.equal(c.hatStueck(seller,"style","sonne"),false);
  assert.equal(c.hatStueck(buyer,"style","sonne"),true);
  assert.equal(p.stueckVon("buyertest","style","sonne").uid,item.uid);
  assert.equal(b.call("market:buy",{id:offer.id}).ok,false);
});

test("Fortuna issuance includes listed and destroyed copies", () => {
  const c=require(path.join(root,"game/cosmetics")),p=require(path.join(root,"game/praegung"));
  accounts.login("FortunaTest","Password2026");const acc=accounts.get("fortunatest");
  const before=c.fortunaVergeben(accounts);c.gibFortuna(acc);
  assert.equal(c.fortunaVergeben(accounts),before+1);
  c.besitzNehmen(acc,"style","rad_fortuna");
  assert.equal(c.fortunaVergeben(accounts),before+1);
  const piece=p.stueckVon("fortunatest","style","rad_fortuna");p.entpraegen(piece.uid);
  assert.equal(c.fortunaVergeben(accounts),before+1);
});

test("slot bonus survives a new connection and fresh process without extra payment", () => {
  const slots=require(path.join(root,"game/slots"));accounts.login("BonusTest","Password2026");
  const f=fixture("bonustest");slots.setupSlots(f.io,accounts);
  const machine=slots.MACHINES.find(x=>x.buyBonus);
  const purchase=f.call("slots:buyBonus",{machineId:machine.id,bet:machine.bets[0]});assert.equal(purchase.ok,true);
  const chips=accounts.get("bonustest").chips;
  const reconnect=fixture("bonustest");slots.setupSlots(reconnect.io,accounts);
  assert.equal(reconnect.call("slots:state").bonus.remaining,machine.freeSpins.count);
  assert.equal(reconnect.call("slots:buyBonus",{machineId:machine.id,bet:machine.bets[0]}).ok,false);
  assert.equal(reconnect.call("slots:spin",{machineId:"lucky7",bet:50}).ok,false);
  assert.equal(accounts.get("bonustest").chips,chips);
  const {execFileSync}=require("node:child_process");
  const code=`const a=require(${JSON.stringify(path.join(root,"game/accounts"))});process.stdout.write(JSON.stringify(a.get('bonustest').slotBonus));`;
  const loaded=JSON.parse(execFileSync(process.execPath,["-e",code],{encoding:"utf8"}));
  assert.equal(loaded.remaining,machine.freeSpins.count);
  accounts.get("bonustest").slotBonus=null;
  assert.equal(reconnect.call("slots:spin",{machineId:machine.id,bet:machine.bets[0],expectedFree:true}).ok,false);
  assert.equal(accounts.get("bonustest").chips,chips);
});

test("rejected stock order never creates a position on disk", () => {
  const file=path.join(root,"game/stocks.js"),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,"utf8"),{module:mod,exports:mod.exports,__dirname:path.dirname(file),require:createRequire(file),Date,Math,console,setInterval:()=>({unref(){}})});
  const acc={name:"alice",chips:0};const f=fixture();mod.exports.setupStocks(f.io,{get:()=>acc});
  const symbol=mod.exports.publicStocks()[0].sym;
  assert.equal(f.call("stocks:open",{sym:symbol,dir:1,margin:1000000,lev:1}).ok,false);
  assert.equal(mod.exports.positionsFor("alice").length,0);
  const fileOnDisk=path.join(root,"data/stocks.json");
  if(fs.existsSync(fileOnDisk)) assert.equal(Object.keys(JSON.parse(fs.readFileSync(fileOnDisk)).positions).length,0);
});
