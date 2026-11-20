import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'

const origin = __ENV.BASE_URL || 'http://localhost:8080'
const slug = __ENV.POLL_SLUG
const latency = new Trend('vote_latency',true)
export const options = {
  scenarios: { burst: { executor:'shared-iterations', vus:12, iterations:60, maxDuration:'30s' } },
  thresholds: { checks:['rate==1'], vote_latency:['p(95)<2500'] },
}
export default function () {
  const url = origin+'/api/v1/public/polls/'+slug
  const jar = new http.CookieJar()
  const read = http.get(url,{jar})
  check(read, {'poll and guest cookie available': r=>r.status===200 && !!r.cookies.pulsex_guest})
  const r = http.post(url+'/votes',JSON.stringify({choice:0}),{jar,headers:{'Content-Type':'application/json',Origin:__ENV.CLIENT_ORIGIN || origin}})
  latency.add(r.timings.duration)
  check(r,{'vote committed':x=>x.status===201})
}
