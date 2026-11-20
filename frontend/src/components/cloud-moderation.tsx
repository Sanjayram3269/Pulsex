import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import type { Page } from '../types/types'
import { ErrorBox, Loading } from './ui'

interface PendingTerm { id: string; term: string; timestamp: string }
export function CloudModeration({ id }: { id: string }) {
  const [processing, setProcessing] = useState<string>()
  const [error, setError] = useState<unknown>()
  const path = '/polls/'+id+'/terms'
  const queue = useQuery({queryKey:['terms',id],queryFn:() => api<Page<PendingTerm>>(path),refetchInterval:4000})
  async function decide(term: PendingTerm, action: 'approve' | 'reject') {
    setProcessing(term.id)
    setError(undefined)
    try {
      await api(path+'/'+term.id,'POST',{action})
      await queue.refetch()
    } catch (failure) { setError(failure) } finally { setProcessing(undefined) }
  }
  return <section className="panel form-stack moderation">
    <h2>Review word-cloud responses</h2><p className="muted">Approved responses appear in the cloud. Rejected responses remain private.</p>
    {error !== undefined && <ErrorBox error={error}/>}
    {queue.isPending ? <Loading/> : queue.isError ? <ErrorBox error={queue.error}/> :
      queue.data.items.length ? <ul className="question-order">{queue.data.items.map(item => <li key={item.id}>
        <span>{item.term}</span><div className="actions">
          <button className="btn secondary compact" disabled={!!processing} onClick={() => void decide(item,'approve')} aria-label={'Approve '+item.term}>Approve</button>
          <button className="btn secondary compact" disabled={!!processing} onClick={() => void decide(item,'reject')} aria-label={'Reject '+item.term}>Reject</button>
        </div>
      </li>)}</ul> : <p className="muted">No submissions are waiting for review.</p>}
    {queue.data?.hasMore && <p className="muted">Review these submissions to see the next group.</p>}
  </section>
}
