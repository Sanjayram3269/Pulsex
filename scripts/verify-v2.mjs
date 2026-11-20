import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const origin = process.env.BASE_URL ?? 'http://localhost:8080'
const root = origin + '/api/v1'
const streamRoot = (process.env.SPECTATOR_URL ?? origin) + '/api/v1'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function request(path, method = 'GET', body, cookie) {
  const res = await fetch(root+path,{
    method,
    headers:{Origin:origin,...(body ? {'Content-Type':'application/json'} : {}),...(cookie ? {Cookie:cookie} : {})},
    body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(12000),
  })
  return {status:res.status, data:res.status===204 ? null : await res.json(), cookie:res.headers.get('set-cookie')?.split(';')[0]}
}
async function ok(path, method, body, cookie, status = 200) {
  const res = await request(path,method,body,cookie)
  assert.equal(res.status,status,JSON.stringify(res.data))
  return res
}
async function spectator(path, signal, ready, final) {
  const res = await fetch(streamRoot+path,{signal})
  assert.equal(res.status,200)
  let buffer=''
  for await (const text of res.body.pipeThrough(new TextDecoderStream())) {
    buffer+=text
    for (let end;(end=buffer.indexOf('\n\n'))!==-1;) {
      const frame=buffer.slice(0,end)
      buffer=buffer.slice(end+2)
      if (!frame.includes('data: ')) continue
      const value=JSON.parse(frame.split('\n').find(line=>line.startsWith('data: ')).slice(6))
      if (value.ballots===0) ready()
      if (value.ballots===30) {
        assert.deepEqual(value.counts,[20,20,20])
        final()
        return
      }
    }
  }
  throw Error('Stream closed before final typed result')
}

const demo=(await ok('/public/demo','POST',{},undefined,201)).data
const room=(await ok('/public/rooms/'+demo.code)).data
const path='/public/polls/'+room.slug
const controller=new AbortController()
const limit=setTimeout(()=>controller.abort(),20000)
try {
  const listeners=Array.from({length:24},()=>{
    const initial=Promise.withResolvers()
    const done=Promise.withResolvers()
    const active=spectator(path+'/events',controller.signal,initial.resolve,done.resolve)
    active.catch(error=>{initial.reject(error);done.reject(error)})
    done.promise.catch(()=>undefined)
    return {initial:initial.promise,final:done.promise}
  })
  await Promise.all(listeners.map(listener=>listener.initial))
  const browserCookies=await Promise.all(Array.from({length:30},()=>ok(path).then(r=>r.cookie)))
  const started=performance.now()
  const latencies=await Promise.all(browserCookies.map(async(cookie,i)=>{
    const at=performance.now()
    await ok(path+'/votes','POST',{choices:[i%3,(i+1)%3]},cookie,201)
    return performance.now()-at
  }))
  await Promise.all(listeners.map(listener=>listener.final))
  const elapsed=Math.round(performance.now()-started)
  assert.equal((await request(path+'/votes','POST',{choices:[0,1]},browserCookies[0])).status,409)
  latencies.sort((a,b)=>a-b)
  console.log(`30 typed ballots, 60 selections; 24 spectators converged in ${elapsed} ms. Vote p95 ${Math.round(latencies[28])} ms, 0 failed unique ballots.`)
} finally {clearTimeout(limit);controller.abort()}

const account=async()=>ok('/auth/register','POST',{name:'Fixture owner',email:crypto.randomUUID()+'@example.com',password:'v2 verification password only'})
const owner=(await account()).cookie
const stranger=(await account()).cookie
const quiz=(await ok('/quizzes','POST',{
  title:'Durability drill',reveal:'each',participation:'anonymous',speedBonus:false,
  questions:[
    {prompt:'Which option is correct?',choices:['A','B'],correct:0,seconds:30,points:100},
    {prompt:'Can you answer before time runs out?',choices:['A','B'],correct:0,seconds:5,points:100},
  ],
},owner,201)).data
assert.equal((await request('/quizzes/'+quiz.id,'GET',undefined,stranger)).status,404)
assert.equal((await request('/quizzes/'+quiz.id+'/insights','GET',undefined,stranger)).status,404)
const qp='/public/quizzes/'+quiz.code
const identities=await Promise.all([ok(qp),ok(qp)])
await Promise.all(identities.map(({cookie})=>ok(qp+'/join','POST',{},cookie,201)))
const running=(await ok('/quizzes/'+quiz.id+'/action','POST',{action:'next',control:quiz.control},owner)).data
const duplicate=await Promise.all(Array.from({length:8},()=>request(qp+'/answers','POST',{round:0,choice:0},identities[0].cookie)))
assert.deepEqual(duplicate.map(x=>x.status).sort(),[201,...Array(7).fill(409)])
await ok(qp+'/answers','POST',{round:0,choice:0},identities[1].cookie,201)
assert.equal((await ok(qp)).data.leaderboard,undefined)
await ok('/rooms/'+quiz.id+'/qa','PUT',{enabled:true},owner,204)
const qa='/public/rooms/'+quiz.code+'/qa'
await ok(qa,'POST',{text:'Can we see this pending question?'},identities[0].cookie,201)
assert.equal((await ok(qa)).data.items.length,0)
assert.equal((await request('/rooms/'+quiz.id+'/qa','GET',undefined,stranger)).status,404)
const pending=(await ok('/rooms/'+quiz.id+'/qa','GET',undefined,owner)).data.pending[0]
assert.equal((await request(qa+'/'+pending.id+'/vote','PUT',{active:true},identities[1].cookie)).status,404)
await ok('/rooms/'+quiz.id+'/qa/'+pending.id,'POST',{action:'approve'},owner,204)
await Promise.all(Array.from({length:8},()=>ok(qa+'/'+pending.id+'/vote','PUT',{active:true},identities[1].cookie,204)))
assert.equal((await ok(qa)).data.items[0].votes,1)
const paused=(await ok('/quizzes/'+quiz.id+'/action','POST',{action:'pause',control:running.control},owner)).data
const timed=(await ok('/quizzes/'+quiz.id+'/action','POST',{action:'next',control:paused.control},owner)).data
await sleep(Math.max(0,Date.parse(timed.ends)-Date.now())+125)
assert.equal((await request(qp+'/answers','POST',{round:1,choice:0},identities[0].cookie)).status,409)
const expired=(await ok(qp)).data
assert.equal(expired.state,'paused')
assert.equal(expired.responses,0)
await ok('/quizzes/'+quiz.id+'/action','POST',{action:'finish',control:timed.control},owner)
const score=(await ok(qp)).data
assert.deepEqual(score.leaderboard.map(p=>p.points),[100,100])
assert.deepEqual(score.leaderboard.map(p=>p.id),score.leaderboard.map(p=>p.id).sort())
const csv=await fetch(root+'/quizzes/'+quiz.id+'/export',{headers:{Cookie:owner}})
assert.equal(csv.status,200)
const exportText=await csv.text()
assert.match(exportText,/rank,points,correct_answers,submitted_answers\r?\n1,100,1,1/)
for (const player of score.leaderboard) assert.ok(!exportText.includes(player.alias))
assert.equal((await request('/quizzes/'+quiz.id+'/export','GET',undefined,stranger)).status,404)
console.log('Quiz replay, deadline expiry, zero-answer round, answer secrecy, tied rankings, cross-owner access and concurrent Q&A upvotes passed.')

if(process.argv.includes('--recovery')){
  const res=spawnSync('docker',['compose','restart','redis','app','worker'],{stdio:'inherit'})
  assert.equal(res.status,0)
  let ready=false
  for(let i=0;i<30;i++){
    try { await ok('/ready'); ready=true;break } catch { await sleep(500) }
  }
  assert.ok(ready,'Stack failed to become ready after restart')
  const poll=(await ok(path+'/results')).data
  assert.equal(poll.ballots,30)
  assert.deepEqual(poll.counts,[20,20,20])
  assert.deepEqual((await ok(qp)).data.leaderboard,score.leaderboard)
  assert.equal((await ok(qa)).data.items[0].votes,1)
  console.log('Cold Redis, API and worker restart recovered typed results, scoreboard and Q&A.')
}
