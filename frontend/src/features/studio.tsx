import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Activity, ArrowRight, BarChart3, CircleDot, Plus, Radio, Users } from 'lucide-react'
import { Badge, Empty, ErrorBox, Heading, Loading } from '../components/ui'
import { Results } from '../components/results'
import { Share } from '../components/share'
import { useStream } from '../hooks/live'
import { api, useUser } from '../services/api'
import type { Page, Poll, PollEvent } from '../types/types'

export function usePoll(id: string) {
  return useQuery({queryKey:['poll',id],queryFn: () => api<Poll>('/polls/'+id)})
}
export function Studio() {
  const [page,setPage] = useState(1)
  const user = useUser()
  const list = useQuery({queryKey:['polls',page],queryFn: () => api<Page<Poll>>('/polls?page='+page)})
  const polls = list.data?.items ?? []
  return <><Heading eyebrow="CREATOR STUDIO" title={'Welcome, '+(user.data?.name.split(' ')[0] ?? 'creator')+'.'} action={<Link className="btn primary" to="/studio/polls/new"><Plus size={18}/> New poll</Link>}>Create questions, invite your audience, and follow the response live.</Heading>
    <div className="stats">
      <div className="panel stat"><span className="feature-icon"><CircleDot/></span><div><span className="muted">Polls on this page</span><strong>{list.isPending ? '…' : polls.length}</strong></div></div>
      <div className="panel stat"><span className="feature-icon cyan"><Radio/></span><div><span className="muted">Accepting votes</span><strong>{list.isPending ? '…' : polls.filter(p=>p.state==='live').length}</strong></div></div>
      <div className="panel stat"><span className="feature-icon"><Users/></span><div><span className="muted">Votes on these polls</span><strong>{list.isPending ? '…' : polls.reduce((n,p)=>n+(p.total ?? 0),0)}</strong></div></div>
    </div>
    <div className="section-heading"><h2>Your polls</h2><span className="muted">{page > 1 ? 'Page '+page : 'Latest first'}</span></div>
    {list.isPending ? <Loading/> : list.isError ? <ErrorBox error={list.error} retry={()=>void list.refetch()}/> : !polls.length ?
      <Empty title="Ask your first question" description="Start with a question and two choices. You can preview it before sharing." to="/studio/polls/new" action="Create a poll"/> :
      <div className="panel rows">{polls.map(p => <Link className="data-row" to={'/studio/polls/'+p.id} key={p.id}>
        <span className="feature-icon"><Activity size={19}/></span><div><strong>{p.title}</strong><small>{p.choices.length} choices · {p.total} votes</small></div><Badge state={p.state}/><ArrowRight className="row-arrow" size={17}/></Link>)}</div>}
    {(page>1 || list.data?.hasMore) && <div className="actions pagination"><button className="btn secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><button className="btn secondary" disabled={!list.data?.hasMore} onClick={()=>setPage(page+1)}>Next</button></div>}
  </>
}

export function PollDetails() {
  const id = useParams().id ?? ''
  const poll = usePoll(id)
  const stream = useStream<PollEvent>('/polls/'+id+'/events', !!poll.data)
  const client = useQueryClient()
  const navigate = useNavigate()
  const [error,setError] = useState<unknown>()
  const [busy,setBusy] = useState(false)
  useEffect(() => {
    if (stream.value && poll.data && stream.value.version > poll.data.revision && poll.data.state !== stream.value.state) void poll.refetch()
  }, [stream.value?.version, poll.data?.revision])
  if (poll.isPending) return <Loading/>
  if (poll.isError) return <ErrorBox error={poll.error} retry={()=>void poll.refetch()}/>
  const p = poll.data
  const event = stream.value && stream.value.version >= p.revision ? stream.value : undefined
  const state = event?.state ?? p.state
  const counts = event?.counts
  async function run(action: string) {
    setBusy(true);setError(undefined)
    try {
      const updated = await api<Poll>('/polls/'+id+'/action','POST',{action})
      client.setQueryData(['poll',updated.id],updated)
      void client.invalidateQueries({queryKey:['polls']})
      if (action==='duplicate') navigate('/studio/polls/'+updated.id+'/edit')
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return <><Heading eyebrow="POLL DETAILS" title={p.title} action={<Badge state={state}/>}>{p.description || 'Manage this poll and watch votes come in.'}</Heading>
    <div className="actions toolbar">
      {state==='draft' && <><button className="btn primary" disabled={busy} onClick={()=>void run('publish')}>Publish poll</button><Link className="btn secondary" to="edit">Edit draft</Link></>}
      {(state==='live' || state==='scheduled') && <button className="btn secondary" disabled={busy} onClick={()=>void run('close')}>Close poll</button>}
      {(state==='closed' || state==='draft') && <button className="btn secondary" disabled={busy} onClick={()=>void run('archive')}>Archive poll</button>}
      <button className="btn secondary" disabled={busy} onClick={()=>void run('duplicate')}>Duplicate</button>
      <Link className="btn secondary" to="analytics"><BarChart3 size={17}/> Analytics</Link>
    </div>
    {error !== undefined && <ErrorBox error={error}/>}
    <div className="content-grid">
      <section className="panel"><div className="connection"><Badge state={stream.state}/></div>{counts ? <Results choices={p.choices} counts={counts}/> : <Loading/>}</section>
      {state!=='draft' && state!=='archived' ? <Share path={'/p/'+p.slug} label="Share poll"/> :
        <section className="panel"><h2>{state==='draft' ? 'Ready to go live?' : 'Poll archived'}</h2><p className="muted">{state==='draft' ? 'Publish the poll to enable the audience link and QR code.' : 'You can still review or export results for this poll.'}</p></section>}
    </div>
  </>
}
