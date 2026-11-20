import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Badge, ErrorBox, Heading, Loading } from '../components/ui'
import { api, base } from '../services/api'
import type { Page, Room } from '../types/types'
import type { QuizPlayer } from './quiz-types'

interface SessionReport {
  title: string; state: string; active: number; present?: number; joined?: number; completed?: number; averageScore?: number
  questions: {label: string; ballots: number; correct?: number}[]; leaders?: QuizPlayer[]
}
const percentage=(part: number | undefined, total: number | undefined) =>
  part === undefined || !total ? '—' : (part/total*100).toFixed(0)+'%'

function Summary({ report }: {report: SessionReport}) {
  if (report.joined===undefined) return <p className="muted">{report.present ?? 0} recently active browsers. Ballots include votes from direct poll links.</p>
  return <div className="stats">
    <div className="panel stat"><div>Joined identities<strong>{report.joined}</strong></div></div>
    <div className="panel stat"><div>Quiz completion<strong>{percentage(report.completed,report.joined)}</strong></div></div>
    <div className="panel stat"><div>Mean score<strong>{report.averageScore?.toFixed(1) ?? '—'}</strong></div></div>
  </div>
}
export function SessionInsights({ quiz = false }: {quiz?: boolean}) {
  const id=useParams().id ?? ''
  const prefix=quiz ? '/quizzes' : '/rooms'
  const path=prefix+'/'+id+'/insights'
  const report=useQuery({queryKey:['sessionInsights',path],queryFn:()=>api<SessionReport>(path),refetchInterval:10000})
  const list=useQuery({queryKey:['compareSessions',prefix],queryFn:()=>api<Page<Room>>(prefix+'?limit=50')})
  const [compare,setCompare]=useState('')
  const comparison=useQuery({queryKey:['sessionInsights',prefix,compare],queryFn:()=>api<SessionReport>(prefix+'/'+compare+'/insights'),enabled:!!compare})
  if (report.isPending) return <Loading/>
  if (report.isError) return <ErrorBox error={report.error} retry={()=>void report.refetch()}/>
  const data=report.data
  const ballots=data.questions.reduce((n,x)=>n+x.ballots,0)
  const correct=data.questions.reduce((n,x)=>n+(x.correct ?? 0),0)
  const max=Math.max(1,...data.questions.map(x=>x.ballots))
  return <><Heading eyebrow="SESSION INSIGHTS" title={data.title} action={<a className="btn secondary" href={base+path+'?format=csv'}><Download size={17}/> Export CSV</a>}>
    {ballots} submitted ballots{quiz && ' · '+percentage(correct,ballots)+' overall accuracy'}
  </Heading>
    <div className="form-stack">
      <Summary report={data}/>
      <section className="panel form-stack"><div className="section-heading quiz-question-heading"><h2>Responses by question</h2><Badge state={data.state}/></div>
        {quiz && <p className="muted">Participation uses all joined identities, including late arrivals. Completion requires an answer to each configured question in a finished quiz.</p>}
        <div className="table-scroll"><table><thead><tr><th>Question</th><th>Ballots</th>{quiz && <><th>Accuracy</th><th>Share joined</th></>}</tr></thead>
          <tbody>{data.questions.map((q,i)=><tr key={i}><th scope="row">{i+1}. {q.label}
            <div className="meter" aria-hidden="true"><div className="fill" style={{width:(q.ballots/max*100)+'%'}}/></div>
          </th><td>{q.ballots}</td>{quiz && <><td>{percentage(q.correct,q.ballots)}</td><td>{percentage(q.ballots,data.joined)}</td></>}</tr>)}</tbody></table></div>
      </section>
      {!!data.leaders?.length && <section className="panel form-stack"><h2>Leading scores</h2><ol className="question-order">{data.leaders.map((leader,i)=>
        <li key={leader.id}><span>{i+1}. {leader.alias}</span><span>{leader.points} pts · {leader.correct} correct</span></li>)}</ol></section>}
      <section className="panel form-stack"><h2>Compare sessions</h2>
        <label>Compare with<select value={compare} onChange={e=>setCompare(e.target.value)}><option value="">Select a session</option>
          {list.data?.items.filter(room=>room.id!==id).map(room=><option value={room.id} key={room.id}>{room.title}</option>)}
        </select></label>
        {comparison.isError && <ErrorBox error={comparison.error}/>}
        {comparison.data && <div className="table-scroll"><table><thead><tr><th>Metric</th><th>{data.title}</th><th>{comparison.data.title}</th></tr></thead>
          <tbody><tr><th scope="row">Submitted ballots</th><td>{ballots}</td><td>{comparison.data.questions.reduce((n,x)=>n+x.ballots,0)}</td></tr>
          <tr><th scope="row">Configured questions</th><td>{data.questions.length}</td><td>{comparison.data.questions.length}</td></tr>
          {quiz && <tr><th scope="row">Quiz completion</th><td>{percentage(data.completed,data.joined)}</td><td>{percentage(comparison.data.completed,comparison.data.joined)}</td></tr>}</tbody>
        </table></div>}
      </section>
    </div>
  </>
}
