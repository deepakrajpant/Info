'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const {bankRows,grade}=require('./domain');
initializeApp();const db=getFirestore();
const ADMIN='deepakrajpant978@gmail.com', BANK='jftoctnovset/QORwII8D7qLZ7wuCDW36';
const opts={region:'us-central1',maxInstances:10};
function uid(r){if(!r.auth)throw new HttpsError('unauthenticated','Sign in first');return r.auth.uid;}
function isAdmin(r){return r.auth?.token.email===ADMIN&&r.auth.token.email_verified===true;}
function deviceHash(r){const d=r.data?.deviceId;if(typeof d!=='string'||d.length<32||d.length>200)throw new HttpsError('invalid-argument','Browser storage is required for premium device binding');return createHash('sha256').update(d).digest('hex');}
function assertUser(s){if(!s.exists||s.data().status==='blocked')throw new HttpsError('permission-denied','Account is unavailable');}
function assertPremium(s){assertUser(s);if(!s.data().premium?.expiry||s.data().premium.expiry.toMillis()<=Date.now())throw new HttpsError('permission-denied','An active premium plan is required');}
async function access(r){
 const id=uid(r),hash=deviceHash(r);if(isAdmin(r))return id;
 await db.runTransaction(async t=>{const uref=db.doc(`users/${id}`),bref=db.doc(`deviceBindings/${id}`);const [u,b]=await Promise.all([t.get(uref),t.get(bref)]);assertPremium(u);if(b.exists&&b.data().hash!==hash)throw new HttpsError('permission-denied','Premium is bound to another browser. Contact admin for a device reset.');if(!b.exists)t.set(bref,{hash,boundAt:FieldValue.serverTimestamp()});});return id;
}
exports.checkAccess=onCall(opts,async r=>{await access(r);return {ok:true};});
exports.getQuestionBank=onCall(opts,async r=>{await access(r);const bank=await db.doc(BANK).get();if(!bank.exists)throw new HttpsError('not-found','Question bank not found');return {questions:bankRows(bank.data())};});
exports.requestPremium=onCall(opts,async r=>{
 const id=uid(r),hash=deviceHash(r),{planId,paymentRef}=r.data;
 if(typeof planId!=='string'||planId.includes('/')||typeof paymentRef!=='string'||!paymentRef.trim()||paymentRef.length>120)throw new HttpsError('invalid-argument','Choose a plan and enter a transaction reference');
 const ref=db.doc(`accessRequests/${id}`);
 await db.runTransaction(async t=>{
  const [u,p,req,binding,legacy]=await Promise.all([t.get(db.doc(`users/${id}`)),t.get(db.doc(`plans/${planId}`)),t.get(ref),t.get(db.doc(`deviceBindings/${id}`)),t.get(db.collection('accessRequests').where('uid','==',id).where('status','==','pending'))]);assertUser(u);
  if((req.exists&&req.data().status==='pending')||!legacy.empty)throw new HttpsError('already-exists','A payment request is already pending');
  if(!p.exists||p.data().active===false)throw new HttpsError('not-found','This plan is unavailable');
  if(binding.exists&&binding.data().hash!==hash)throw new HttpsError('permission-denied','Use your bound browser or request an admin device reset');
  const plan=p.data();if(!Number.isInteger(plan.days)||plan.days<1||plan.days>3650||!Number.isFinite(plan.price)||plan.price<0)throw new HttpsError('failed-precondition','Admin must fix plan settings');
  t.set(ref,{uid:id,email:r.auth.token.email||'',name:u.data().name||'Student',type:'premium',planId,planName:plan.name,planPrice:plan.price,days:plan.days,paymentRef:paymentRef.trim(),deviceHash:hash,status:'pending',createdAt:FieldValue.serverTimestamp()});
 });return {requestId:ref.id};
});
exports.adminMembership=onCall(opts,async r=>{
 uid(r);if(!isAdmin(r))throw new HttpsError('permission-denied','Verified admin required');
 const {uid:id,action,rid,planId,note}=r.data;
 if(typeof id!=='string'||id.includes('/'))throw new HttpsError('invalid-argument','Invalid student');
 if(!['approve','grant','revoke','resetDevice'].includes(action))throw new HttpsError('invalid-argument','Invalid action');
 if(action==='approve'&&(typeof rid!=='string'||rid.includes('/')))throw new HttpsError('invalid-argument','Invalid request');
 const audit=db.collection('adminAuditLogs').doc();
 await db.runTransaction(async t=>{
  const userRef=db.doc(`users/${id}`),bindingRef=db.doc(`deviceBindings/${id}`),reqRef=action==='approve'?db.doc(`accessRequests/${rid}`):null;
  const u=await t.get(userRef);if(!u.exists)throw new HttpsError('not-found','Student not found');
  const request=reqRef?await t.get(reqRef):null;
  if(action==='revoke'){t.update(userRef,{premium:null,practiceAccess:false});}
  else if(action==='resetDevice'){t.delete(bindingRef);}
  else {
   let plan,days,hash;
   if(action==='approve'){
    if(!request.exists||request.data().uid!==id||request.data().status!=='pending'||request.data().type!=='premium')throw new HttpsError('failed-precondition','Request is no longer pending');
    const req=request.data();if(!req.deviceHash)throw new HttpsError('failed-precondition','Legacy request has no device. Reject it and ask the student to request again.');
    plan={name:req.planName};days=req.days;hash=req.deviceHash;
   }else{
    if(typeof planId!=='string'||planId.includes('/'))throw new HttpsError('invalid-argument','Select a plan');
    const p=await t.get(db.doc(`plans/${planId}`));if(!p.exists)throw new HttpsError('not-found','Plan not found');plan=p.data();days=Number(r.data.days);
   }
   if(!Number.isInteger(days)||days<1||days>3650)throw new HttpsError('invalid-argument','Days must be 1 to 3650');
   const now=Date.now(),existing=u.data().premium?.expiry?.toMillis()||0;
   t.update(userRef,{premium:{plan:plan.name,planId:action==='approve'?request.data().planId:planId,start:Timestamp.fromMillis(now),expiry:Timestamp.fromMillis(Math.max(now,existing)+days*86400000),note:String(note||'Payment verified').slice(0,1000)},practiceAccess:false});
   if(hash)t.set(bindingRef,{hash,boundAt:FieldValue.serverTimestamp()});
   if(reqRef)t.update(reqRef,{status:'approved',resolvedAt:FieldValue.serverTimestamp()});
  }
  t.create(audit,{admin:r.auth.uid,uid:id,action,createdAt:FieldValue.serverTimestamp()});
 });return {ok:true};
});
exports.startAttempt=onCall(opts,async r=>{
 const id=await access(r),setIdx=Number(r.data.setIdx);if(!Number.isInteger(setIdx)||setIdx<1||setIdx>6)throw new HttpsError('invalid-argument','Invalid set');
 const snap=await db.doc(BANK).get();if(!snap.exists)throw new HttpsError('not-found','Question bank not found');
 const rows=bankRows(snap.data()).filter(q=>q.set===setIdx&&['sv','ce','lc','rc'].includes(q.section));
 if(!rows.length)throw new HttpsError('not-found','This set has no questions');
 const ref=db.collection('serverAttempts').doc();await ref.set({uid:id,setIdx,deviceHash:deviceHash(r),questions:rows,createdAt:Timestamp.now(),status:'preparing'});
 return {attemptId:ref.id,questions:rows};
});
exports.activateAttempt=onCall(opts,async r=>{
 const id=await access(r);const aid=r.data.attemptId;if(typeof aid!=='string'||aid.includes('/'))throw new HttpsError('invalid-argument','Invalid attempt');
 let startedAt;await db.runTransaction(async t=>{const ref=db.doc(`serverAttempts/${aid}`),s=await t.get(ref);if(!s.exists||s.data().uid!==id||s.data().deviceHash!==deviceHash(r))throw new HttpsError('permission-denied','Invalid attempt');
 if(s.data().status==='finished')throw new HttpsError('failed-precondition','Attempt already finished');startedAt=s.data().startedAt||Timestamp.now();if(!s.data().startedAt)t.update(ref,{status:'started',startedAt});});return {startedAt:startedAt.toMillis()};
});
exports.submitAttempt=onCall(opts,async r=>{
 const id=await access(r),aid=r.data.attemptId;if(typeof aid!=='string'||aid.includes('/'))throw new HttpsError('invalid-argument','Invalid attempt');
 const aref=db.doc(`serverAttempts/${aid}`),resultRef=db.doc(`users/${id}/results/${aid}`),lref=db.doc(`leaderboard/${id}`);
 return db.runTransaction(async t=>{
  const [a,previous,user,lb]=await Promise.all([t.get(aref),t.get(resultRef),t.get(db.doc(`users/${id}`)),t.get(lref)]);
  if(!a.exists||a.data().uid!==id||a.data().deviceHash!==deviceHash(r))throw new HttpsError('permission-denied','Invalid attempt');
  if(previous.exists){const out=previous.data();return {...out,submittedAt:out.submittedAt.toDate().toISOString()};}
  const attempt=a.data();if(!attempt.startedAt)throw new HttpsError('failed-precondition','Attempt has not started');
  // A short grace window lets auto-submit finish after a temporary network interruption.
  if(Date.now()>attempt.startedAt.toMillis()+75*60000)throw new HttpsError('deadline-exceeded','Attempt expired; local result is still available');
  let g;try{g=grade(attempt.questions,r.data.answers);}catch(e){throw new HttpsError('invalid-argument',e.message);}
  const result={...g,setIdx:attempt.setIdx,setName:['SHIMEMASU','HARE','GAKUSEI','ORIMASU','KONPYUTA','MAGARIMASU'][attempt.setIdx-1],attemptId:aid,timeUsed:Math.min(3600,Math.round((Date.now()-attempt.startedAt.toMillis())/1000)),startedAt:attempt.startedAt.toDate().toISOString(),submittedAt:Timestamp.now()};
  t.set(resultRef,result);t.update(aref,{status:'finished'});
  const best=Math.max(lb.exists?lb.data().bestScore||0:0,g.percentage);
  t.set(lref,{name:String(user.data()?.name||'Student').slice(0,80),bestScore:best,streak:user.data()?.streak?.count||0,updatedAt:FieldValue.serverTimestamp()});
  t.update(db.doc(`users/${id}`),{bestScore:best});return {...result,submittedAt:result.submittedAt.toDate().toISOString()};
 });
});
