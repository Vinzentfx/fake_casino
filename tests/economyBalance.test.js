"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _intern: dice } = require("../game/wuerfel");

// Exact recurrence over every kept multiset and every one-die continuation.
function exactDice() {
  const table = dice.ZAHLT, cache = new Map(), factorial = [1,1,2,6,24,120];
  const hand = c => c.flatMap((n,i)=>Array(n).fill(i+1));
  function value(c) {
    const key=c.join(""); if(cache.has(key))return cache.get(key);
    const n=c.reduce((a,b)=>a+b,0);
    let v;
    if(n===5)v=table[dice.kategorie(hand(c))]||0;
    else {v=0;for(let i=0;i<6;i++){c[i]++;v+=value(c)/6;c[i]--;}}
    cache.set(key,v);return v;
  }
  let optimal=0, states=0;
  function enumerate(c,i,left) {
    if(i===5){c[5]=left;states++;
      const w=hand(c),weight=120/c.reduce((v,n)=>v*factorial[n],1)/7776;
      let best=-1;
      function held(h,j){if(j===6){best=Math.max(best,value(h));return}for(let n=0;n<=c[j];n++){h[j]=n;held(h,j+1);}}
      held(Array(6).fill(0),0);
      optimal+=weight*best;
      const suggested=dice.vorschlag(w,100), chosen=Array(6).fill(0);
      w.forEach((x,i)=>{if(suggested[i])chosen[x-1]++;});
      assert.ok(Math.abs(value(chosen)-best)<1e-8,`bad tip: ${w.join(',')}`);
      return;
    }
    for(let n=0;n<=left;n++){c[i]=n;enumerate(c,i+1,left-n);}
  }
  enumerate(Array(6).fill(0),0,5);
  return {optimal,states};
}

test("dice payouts stay below 100% with every optimal initial hold",()=>{
  const {optimal,states}=exactDice();
  assert.equal(states,252);
  assert.ok(optimal>0.9584 && optimal<0.9587,`RTP ${optimal}`);
  assert.equal(dice.vorschlag([6,6,6,6,6],50).every(Boolean),true);
  assert.equal(dice.auszahlung(100,"full"),230);
  assert.equal(dice.auszahlung(100,"vier"),215);
});

const root=fs.mkdtempSync(path.join(os.tmpdir(),"casino-cashback-test-"));
fs.cpSync(path.join(__dirname,"../game"),path.join(root,"game"),{recursive:true});
fs.symlinkSync(path.join(__dirname,"../node_modules"),path.join(root,"node_modules"));
const accounts=require(path.join(root,"game/accounts"));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

function account(name){const r=accounts.login(name,"LocalTest2026");assert.equal(r.ok,true);return accounts.get(name);}
function claim(name){const a=accounts.get(name);a.lastBonusAt=0;return accounts.claimDailyBonus(name);}

test("cashback uses net house losses and never re-pays an earlier loss",()=>{
  const a=account("CashbackNet");
  accounts.recordHand(a.name,-1000,true,"mines");
  accounts.recordHand(a.name,1000,true,"mines");
  assert.equal(claim(a.name).cashback,0);
  accounts.recordHand(a.name,-1000,true,"mines");
  assert.equal(claim(a.name).cashback,100);
  assert.equal(claim(a.name).cashback,0);
  accounts.recordHand(a.name,1000,true,"mines");
  accounts.recordHand(a.name,-1000,true,"mines");
  assert.equal(claim(a.name).cashback,0);
  accounts.recordHand(a.name,-1000,true,"mines");
  assert.equal(claim(a.name).cashback,100);
});

test("player-vs-player results do not change cashback",()=>{
  const a=account("CashbackPvp");
  accounts.recordHand(a.name,-1000,false,"poker");
  assert.equal(claim(a.name).cashback,0);
  accounts.recordHand(a.name,-1000,true,"towers");
  assert.equal(claim(a.name).cashback,100);
  accounts.recordHand(a.name,1000,false,"poker");
  assert.equal(claim(a.name).cashback,0);
});

test("legacy pending losses migrate once without changing real data",()=>{
  const a=account("CashbackLegacy");
  a.lossSince=500;
  assert.equal(claim(a.name).cashback,50);
  assert.equal(claim(a.name).cashback,0);
  assert.equal(a.lossSince,undefined);
});
