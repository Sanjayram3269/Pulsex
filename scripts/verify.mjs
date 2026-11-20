import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const origin = process.env.BASE_URL ?? 'http://localhost:8080'
const root = origin+'/api/v1'
const streamRoot = (process.env.SPECTATOR_URL ?? origin)+'/api/v1'
const recovery = process.argv.includes('--recovery')
const spectators = Number(process.env.SPECTATORS ?? 24)
const votePath = slug => '/public/polls/'+slug
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms))

async function call(path,{method='GET',body,cookie,expected=200,remoteOrigin=origin}={}) {
  const result = await fetch(root+path,{
    method,headers:{Origin:remoteOrigin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),
  })
  const data = result.status===204 ? null : await result.json()
  assert.equal(result.status,expected,JSON.stringify(data))
  return {data,cookie:result.headers.get('set-cookie')?.split(';')[0]}
}
async function createUser() {
  const answer = await call('/auth/register',{method:'POST',body:{email:randomUUID()+'@example.com',name:'Integration tester',password:'integration test password'}})
  return answer.cookie
}
async function eventClient(path){
  const controller = new AbortController()
  const r = await fetch(streamRoot+path,{signal:controller.signal})
  assert.equal(r.status,200)
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  return {
    async next(test) {
      while(true) {
        for (let end; (end=buffer.indexOf('\n\n'))>=0;) {
          const frame=buffer.slice(0,end)
          buffer=buffer.slice(end+2)
          for (const line of frame.split('\n')) if(line.startsWith('data: ')){
            const data=JSON.parse(line.slice(6))
            if(test(data)) return data
          }
        }
        const part=await reader.read()
        assert.ok(!part.done,'SSE ended before expected event')
        buffer+=part.value
      }
    },
    stop() { controller.abort() },
  }
}
async function expectEventually(path, predicate) {
  for(let i=0;i<30;i++){
    try { const result=await call(path); if(predicate(result.data)) return result.data }
    catch (error) { if(i===29) throw error }
    await wait(500)
  }
  throw Error('Snapshot failed to converge')
}
const ready='/ready'
await call(ready)
const owner=await createUser()
const stranger=await createUser()
const setup={title:'Which topic should we discuss?',description:'Integration fixture',choices:['Architecture','Design'],visibility:'after_close',guests:true,opens:null,closes:null}
await call('/polls',{method:'POST',body:setup,expected:401})
await call('/polls',{method:'POST',body:setup,cookie:owner,remoteOrigin:'https://untrusted.invalid',expected:403})
await call('/polls',{method:'POST',body:{...setup,choices:['same','SAME']},cookie:owner,expected:400})
const {data:poll}=await call('/polls',{method:'POST',body:setup,cookie:owner,expected:201})
const publicPath=votePath(poll.slug)
await call(publicPath,{expected:404})
await call('/polls/'+poll.id,{cookie:stranger,expected:404})
await call('/polls/'+poll.id+'/analytics',{cookie:stranger,expected:404})
await call('/polls/'+poll.id+'/action',{method:'POST',body:{action:'publish'},cookie:owner})
await call(publicPath+'/results',{expected:403})
const guest=await call(publicPath)
await call(publicPath+'/votes',{method:'POST',body:{choice:0},expected:428})
await call(publicPath+'/votes',{method:'POST',body:{choice:7},cookie:guest.cookie,expected:400})
const send=(cookie,expected)=>call(publicPath+'/votes',{method:'POST',cookie,body:{choice:0},expected})
const duplicateTrials=Array.from({length:12},()=>fetch(root+publicPath+'/votes',{method:'POST',headers:{Origin:origin,Cookie:guest.cookie,'Content-Type':'application/json'},body:'{"choice":0}'}).then(async r=>{await r.arrayBuffer();return r.status}))
assert.deepEqual((await Promise.all(duplicateTrials)).sort(),[201,...Array(11).fill(409)])
await call(publicPath+'/results',{expected:403})
await call('/polls/'+poll.id+'/action',{method:'POST',body:{action:'close'},cookie:owner})
await send(guest.cookie,409)
assert.deepEqual((await call(publicPath+'/results')).data.counts,[1,0])
console.log('Authorization, origin, validation, hidden results, closure and duplicate race passed.')

const live=(await call('/polls',{method:'POST',body:{...setup,visibility:'live'},cookie:owner,expected:201})).data
await call('/polls/'+live.id+'/action',{method:'POST',body:{action:'publish'},cookie:owner})
const livePath=votePath(live.slug)
const clientList=[]
const deadline=setTimeout(()=>clientList.forEach(c=>c.stop()),30000)
try {
  await Promise.all(Array.from({length:spectators},async()=>{ const c=await eventClient(livePath+'/events');clientList.push(c);await c.next(e=>e.counts?.[0]===0) }))
  const cookies=await Promise.all(Array.from({length:24},()=>call(livePath).then(r=>r.cookie)))
  const started=performance.now()
  await Promise.all(cookies.map(cookie=>call(livePath+'/votes',{method:'POST',cookie,body:{choice:0},expected:201})))
  const accepted=performance.now()
  await Promise.all(clientList.map(c=>c.next(e=>e.counts?.[0]===24)))
  console.log(`24 unique votes accepted in ${Math.round(accepted-started)} ms; ${spectators} SSE spectators converged in ${Math.round(performance.now()-started)} ms.`)
} finally {
  clearTimeout(deadline)
  for(const c of clientList) c.stop()
}
if(recovery){
  function compose(args) {
    const result=spawnSync('docker',['compose',...args],{encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
    return result.stdout.trim()
  }
  function redisCount() {
    const raw=compose(['exec','-T','redis','redis-cli','GET','pulsex:results:'+live.slug])
    return raw ? JSON.parse(raw.slice(19)).counts[0] : null
  }
  compose(['stop','worker'])
  try {
    const oneMore=await call(livePath)
    await call(livePath+'/votes',{method:'POST',cookie:oneMore.cookie,body:{choice:0},expected:201})
    assert.equal(redisCount(),24,'Only the durable vote should change while the worker is stopped')
  } finally {
    compose(['start','worker'])
  }
  for(let i=0;i<30 && redisCount()!==25;i++) await wait(350)
  assert.equal(redisCount(),25,'Worker should repair the stale Redis key before any result endpoint reads it')
  console.log('Stopped and restarted the worker; Redis projected the pending vote from MongoDB.')
  const restart = spawnSync('docker',['compose','restart','redis','worker','app'],{stdio:'inherit'})
  assert.equal(restart.status,0)
  await expectEventually(livePath+'/results', d=>d.counts[0]===25)
  const fresh=await eventClient(livePath+'/events')
  const timer=setTimeout(()=>fresh.stop(),15000)
  try { await fresh.next(e=>e.counts?.[0]===25) } finally {clearTimeout(timer);fresh.stop()}
  console.log('Cold Redis projection rebuilt and a reconnecting spectator received 25 persisted votes.')
}

const contested = (await call('/polls',{method:'POST',body:{...setup,visibility:'live'},cookie:owner,expected:201})).data
await call('/polls/'+contested.id+'/action',{method:'POST',body:{action:'publish'},cookie:owner})
const contestedPath = votePath(contested.slug)
const distinct = await Promise.all(Array.from({length:16},()=>call(contestedPath).then(r=>r.cookie)))
const attempt = async cookie => {
  const r=await fetch(root+contestedPath+'/votes',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{"choice":1}'})
  await r.arrayBuffer()
  assert.ok(r.status===201 || r.status===409, 'Unexpected vote/close response '+r.status)
  return r.status
}
const [statuses] = await Promise.all([
  Promise.all(distinct.map(attempt)),
  call('/polls/'+contested.id+'/action',{method:'POST',body:{action:'close'},cookie:owner}),
])
const count = statuses.filter(status=>status===201).length
assert.deepEqual((await call(contestedPath+'/results')).data.counts,[0,count])
assert.equal(await attempt(distinct[0]),409)
console.log('Vote/close race preserved all and only committed ballots.')

const scheduled = (await call('/polls',{method:'POST',body:{...setup,guests:false,opens:new Date(Date.now()+2500),closes:new Date(Date.now()+5000)},cookie:owner,expected:201})).data
const scheduledPath = votePath(scheduled.slug)
await call('/polls/'+scheduled.id+'/action',{method:'POST',body:{action:'publish'},cookie:owner})
assert.equal((await call(scheduledPath)).data.state,'scheduled')
await call(scheduledPath+'/votes',{method:'POST',body:{choice:0},expected:401})
await expectEventually(scheduledPath,p=>p.state==='live')
await call(scheduledPath+'/votes',{method:'POST',body:{choice:0},cookie:stranger,expected:201})
await expectEventually(scheduledPath,p=>p.state==='closed')
await call(scheduledPath+'/votes',{method:'POST',body:{choice:1},cookie:owner,expected:409})
assert.deepEqual((await call(scheduledPath+'/results')).data.counts,[1,0])
console.log('Scheduled opening, account-required voting and expiry passed.')

if (!process.argv.includes('--rate-limit')) process.exit(0)
const second = await call(livePath)
for(let i=0;i<310;i++){
  const r=await fetch(root+livePath+'/votes',{method:'POST',headers:{Origin:origin,Cookie:second.cookie,'Content-Type':'application/json'},body:'{"choice":99}'})
  await r.arrayBuffer()
  if(r.status===429){ console.log('Redis voting limiter returned HTTP 429.');break }
  assert.equal(r.status,400)
  assert.ok(i<309,'Expected the Redis voting limit to engage')
}
