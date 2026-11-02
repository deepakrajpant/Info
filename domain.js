'use strict';
const SECTIONS=[{key:'sv',name:'Script & Vocabulary',marks:3},{key:'ce',name:'Conversation & Expression',marks:4},{key:'lc',name:'Listening Comprehension',marks:6},{key:'rc',name:'Reading Comprehension',marks:7}];
function clean(v){const s=String(v??'').trim();return /^(NA|null|undefined)$/i.test(s)?'':s;}
function normalize(r,i){
 if(Array.isArray(r)) r={set:r[0],section:r[1],question:r[2],passage:r[3],image:r[4],audio:r[5],answer:r[6],A:r[7],B:r[8],C:r[9],D:r[10]};
 if(!r || typeof r!=='object')throw new Error('Invalid question row');
 if(clean(r.image)&&! /^(https?:|data:|scene:|photos\/)/.test(r.image))r={...r,image:'photos/'+clean(r.image)};
 if(clean(r.audio)&&! /^(https?:|tts:|audio\/)/.test(r.audio))r={...r,audio:'audio/'+clean(r.audio)};
 return {...r,id:clean(r.id)||`legacy_${i}`,set:Number(r.set)||1,section:clean(r.section||'sv').toLowerCase(),answer:clean(r.answer||'A').toUpperCase()};
}
function bankRows(data){const rows=Array.isArray(data.questions)?data.questions:Object.values(data).find(Array.isArray)||[];return rows.map(normalize);}
function grade(rows,input){
 if(!Array.isArray(input))throw new Error('Answers must be an array');
 const mapped=new Map(input.map(s=>[s.key,s.answers]));let raw=0,rawMax=0,correct=0,unanswered=0;
 const sections=SECTIONS.map(s=>{
  const qs=rows.filter(r=>r.section===s.key), answers=mapped.get(s.key)||[];
  if(!Array.isArray(answers)||answers.length!==qs.length)throw new Error('Question and answer counts differ');
  let count=0;const items=qs.map((q,i)=>{const v=answers[i];if(v!==null&&(!Number.isInteger(v)||v<0||v>3||!clean(q['ABCD'[v]])))throw new Error('Invalid answer');const a=q.answer.charCodeAt(0)-65;if(a<0||a>3)throw new Error('Invalid answer key');if(v===null)unanswered++;else if(v===a)count++;return {idx:i,q:clean(q.question),p:clean(q.passage)||null,img:clean(q.image)||null,au:clean(q.audio)||null,o:['A','B','C','D'].map(k=>clean(q[k])),correctAns:a,yourAns:v};});
  const score=count*s.marks,max=qs.length*s.marks;correct+=count;raw+=score;rawMax+=max;return {name:s.name,short:s.name,marks:s.marks,score,max,items};
 }).filter(s=>s.items.length);
 if(!rawMax)throw new Error('Empty set');
 const scale=v=>Math.round(v*250/rawMax*100)/100;
 return {score:scale(raw),maxScore:250,percentage:Math.round(raw/rawMax*100),correct,unanswered,wrong:rows.length-correct-unanswered,sections:sections.map(s=>({...s,score:scale(s.score),max:scale(s.max)}))};
}
module.exports={SECTIONS,bankRows,grade};
