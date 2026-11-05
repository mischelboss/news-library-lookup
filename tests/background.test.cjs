const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../extension');
const match = require(path.join(root, 'matching.js'));
const title = 'Diese Swing Districts entscheiden über die Macht im Repräsentantenhaus';
const document = (id, name = title, publication = 'SPIEGEL Plus') => ({documentId: id, fields:{ARTIKELTITEL:name,QUELLENNAME:publication,ERSCHEINUNGSDATUM:'2026-11-03'}});
assert.equal(match.rank(title, [document('SPPL__a')]).kind, 'match');
assert.equal(match.rank(title, [document('SPPL__a'), document('SPPL__b')]).kind, 'search');
assert.equal(match.rank('Die neue Welt', [document('SPPL__a', 'Die neue Welt')]).kind, 'search');
assert.equal(match.rank(title, [document('OTHER__a', title, 'WELT ONLINE')]).kind, 'search');
assert.equal(match.rank(title, [document('../unsafe')]).kind, 'search');
assert.equal(match.rank(title, [document('SPPL__a', 'So gelingt der Urlaub an der Ostsee')]).kind, 'search');
assert.equal(match.normalize('»Äpfel & Straße!«'), 'apfel strasse');
assert.equal(match.query(title).includes('TITEL:'), false);

let listener, calls=0, mode='ok', permission=true;
const saved=[];
const context={VoebbMatch:match, URL,URLSearchParams,TextEncoder,crypto:webcrypto,AbortController,Date,
 setTimeout:(fn,ms)=>setTimeout(fn,ms===800?0:ms),clearTimeout,
 browser:{permissions:{contains:async()=>permission},storage:{local:{get:async()=>({enabled:true,cache:{}}),set:async state=>saved.push(JSON.parse(JSON.stringify(state)))}},runtime:{id:'test',getURL:()=> 'moz-extension://test/',onMessage:{addListener:fn=>listener=fn}}},
 fetch:async(url, options)=>{calls++;assert.equal(url.hostname,'bib-voebb.genios.de');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');if(mode==='network')throw Error('network');return {ok:true,headers:{get:()=>mode==='html'?'text/html':'application/json'},json:async()=>({errorOccurred:false,documents:[document('SPPL__a')]})}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
const sender={id:'test',url:'https://www.spiegel.de/',frameId:0};
const popup={id:'test',url:'moz-extension://test/popup.html'};
const send=message=>listener(message,sender);
test('matching and background search regression checks', async()=>{
 const [a,b]=await Promise.all([send({type:'lookup',title}),send({type:'lookup',title})]);
 assert.equal(a.kind,'match');assert.equal(b.kind,'match');assert.equal(calls,1);
 assert.equal((await send({type:'lookup',title})).cached,true);assert.equal(calls,1);
 assert.equal(listener({type:'lookup',title},{...sender,url:'https://evil.test/'}),undefined);
 assert.equal(listener({type:'lookup',title},{...sender,url:'https://www.spiegel.de/politik/article'}),undefined);
 assert.equal(listener({type:'lookup',title},{...sender,frameId:1}),undefined);
 assert.equal(listener({type:'reset'},sender),undefined);
 mode='html';assert.equal((await send({type:'lookup',title:'Eine andere lange Schlagzeile für diesen Test'})).kind,'unavailable');
 const before=calls;await send({type:'lookup',title:'Noch eine längere Schlagzeile für diesen Test'});assert.equal(calls,before);
 await listener({type:'reset'},popup);mode='ok';permission=false;
 assert.equal((await send({type:'lookup',title})).kind,'unavailable');assert.equal(calls,before);
 await listener({type:'toggle'},popup);assert.equal((await send({type:'lookup',title})).kind,'disabled');
 assert(saved.length>0);
 console.log('PASS: title matching, ambiguity, short titles, source validation, unsafe IDs, queue deduplication, cache, sender/frame controls, non-JSON handling, failure cooldown, missing permissions, pause.');
});
