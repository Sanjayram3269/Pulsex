import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorBox, Heading, Loading } from '../components/ui'
import { Results } from '../components/results'
import { api, base } from '../services/api'
import type { Analytics } from '../types/types'

export function Insights() {
  const id = useParams().id ?? ''
  const query = useQuery({queryKey:['analytics',id],queryFn:()=>api<Analytics>('/polls/'+id+'/analytics'),refetchInterval:5000})
  if (query.isPending) return <Loading/>
  if (query.isError) return <ErrorBox error={query.error} retry={()=>void query.refetch()}/>
  const { poll,snapshot,series } = query.data
  const buckets = new Map(series.map(x=>[new Date(x.at).getTime(),x.votes]))
  const last = new Date(query.data.since).getTime()+167*3600000
  const first = Math.max(new Date(query.data.since).getTime(), last - 23*3600000)
  const chart = Array.from({length:24},(_,i)=>{
    const at = first+i*3600000
    return {hour:new Date(at).toLocaleTimeString([],{hour:'numeric'}),votes:buckets.get(at) ?? 0}
  })
  return <><Heading eyebrow="PULSE INSIGHTS" title={poll.title} action={<a className="btn secondary" href={base+'/polls/'+id+'/export'}><Download size={17}/> Export CSV</a>}>Results and participation over time.</Heading>
    <div className="content-grid"><section className="panel"><Results choices={poll.choices} counts={snapshot.counts}/></section>
      <section className="panel analytics"><h2>Votes by hour</h2><p className="muted">Last 24 hours · local time</p>
        <div className="chart"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{top:12,right:12,left:-22,bottom:0}} accessibilityLayer>
            <CartesianGrid stroke="#302b3e" vertical={false}/><XAxis dataKey="hour" minTickGap={35} tick={{fill:'#b4a9c5',fontSize:11}}/><YAxis allowDecimals={false} tick={{fill:'#b4a9c5',fontSize:11}}/>
            <Tooltip contentStyle={{background:'#1b1724',border:'1px solid #3a304f'}} itemStyle={{color:'#c2a9ff'}}/>
            <Area type="monotone" dataKey="votes" stroke="#b29bff" strokeWidth={2} fill="#b29bff" fillOpacity={0.15} isAnimationActive={false}/>
          </AreaChart>
        </ResponsiveContainer></div>
      </section></div></>
}
