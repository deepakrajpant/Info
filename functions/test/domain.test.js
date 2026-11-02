const test=require('node:test');const assert=require('node:assert/strict');const {grade,bankRows}=require('../domain');
const row=(section,answer='A')=>({set:1,section,question:'Q',A:'A',B:'B',C:'C',D:'NA',answer});
test('different sized sets both normalize to 250',()=>{for(const n of [1,7,50,53,101]){const rows=Array.from({length:n},(_,i)=>row(['sv','ce','lc','rc'][i%4]));const input=['sv','ce','lc','rc'].map(key=>({key,answers:rows.filter(r=>r.section===key).map(()=>0)}));assert.equal(grade(rows,input).score,250);}});
test('section weights are preserved and partial marks are scaled',()=>{const g=grade([row('sv'),row('rc')],[{key:'sv',answers:[0]},{key:'rc',answers:[1]}]);assert.equal(g.score,75);assert.equal(g.wrong,1);assert.equal(g.percentage,30);});
test('skipped questions count separately',()=>{const g=grade([row('lc'),row('lc')],[{key:'lc',answers:[0,null]}]);assert.equal(g.score,125);assert.equal(g.correct,1);assert.equal(g.unanswered,1);assert.equal(g.wrong,0);});
test('invalid option and missing answers are rejected',()=>{assert.throws(()=>grade([row('sv')],[{key:'sv',answers:[3]}]),/Invalid answer/);assert.throws(()=>grade([row('sv')],[]),/counts differ/);assert.throws(()=>grade([row('sv')],[{key:'sv',answers:[100]}]),/Invalid answer/);});
test('legacy arrays normalize and keep stable ids',()=>{const r=bankRows({questions:[[1,'sv','Q','NA','NA','NA','B','A','B','C','NA']]});assert.equal(r[0].id,'legacy_0');assert.equal(r[0].answer,'B');});
test('empty sets cannot divide by zero',()=>{assert.throws(()=>grade([],[]),/Empty set/);});
