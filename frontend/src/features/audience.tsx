import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Radio } from 'lucide-react'
import { Badge, ErrorBox, Loading } from '../components/ui'
import { PollResults } from '../components/results'
import { BallotForm } from '../components/ballot'
import { PublicFrame } from '../components/public-frame'
import { useStream } from '../hooks/live'
import { api, ApiError, useUser } from '../services/api'
import type { Poll, PollEvent } from '../types/types'

export function PollAudience({ slug, presentation = false }: { slug: string; presentation?: boolean }) {
  const path = '/public/polls/'+slug
  const query = useQuery({queryKey:['publicPoll',slug],queryFn:()=>api<Poll>(path)})
  const client = useQueryClient()
  const stream = useStream<PollEvent>(path+'/events', !!query.data)
  const [sent,setSent] = useState(false)
  const user = useUser()
  if (query.isPending) return <Loading/>
  if (query.isError) return <ErrorBox error={query.error} retry={()=>void query.refetch()}/>
  if (stream.state==='unavailable') return <ErrorBox error={new Error('This poll is no longer available.')}/>
  const p = query.data
  const event = stream.value && stream.value.version >= p.revision ? stream.value : undefined
  const state = event?.state ?? p.state
  const counts = event?.counts
  const didVote = sent || p.voted
  const canVote = state==='live' && !didVote && (p.guests || !!user.data)
  return <section className={'panel audience-card '+(presentation?'present-poll':'')}>
    <div className="audience-state"><Badge state={state}/><Badge state={stream.state==='live' ? 'connected' : stream.state}/></div>
    <p className="eyebrow audience-label"><Radio size={15}/> {presentation?'LIVE RESULTS':'AUDIENCE POLL'}</p>
    <h1>{p.title}</h1>{p.description && <p className="muted lead">{p.description}</p>}
    {!presentation && <>
      {didVote ? <div className="notice success" role="status"><CheckCircle2 size={19}/> {p.question?.type === 'word_cloud' ? 'Response received. The host reviews submissions before publishing them.' : 'Vote received. Thanks for taking part.'}</div> :
      state==='scheduled' ? <p className="notice">Voting opens {p.opens ? new Date(p.opens).toLocaleString() : 'soon'}.</p> :
      state==='closed' ? <p className="notice">Voting has closed.</p> :
      !p.guests && !user.data ? <Link className="btn primary" to={'/login?next='+encodeURIComponent(location.pathname)}>Sign in to vote <ArrowRight size={16}/></Link> :
      <BallotForm poll={p} canVote={canVote} submit={async ballot => {
        try { await api(path+'/votes','POST',ballot) }
        catch (err) {
          if (!(err instanceof ApiError && err.code==='already_voted')) { void query.refetch(); throw err }
        }
        setSent(true)
        client.setQueryData<Poll>(['publicPoll',slug], current => current && {...current,voted:true})
      }}/>}
    </>}
    {counts ? <PollResults poll={p} result={{...event, counts}}/> : (didVote || presentation || state==='closed') && <p className="muted">{p.visibility==='private' ? 'Results are visible to the creator.' : p.visibility==='after_close' && state!=='closed' ? 'Results will appear when voting closes.' : 'Connecting to live results…'}</p>}
  </section>
}
export function GuestPoll() {
  const slug = useParams().slug ?? ''
  return <PublicFrame><PollAudience key={slug} slug={slug}/></PublicFrame>
}
