import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Pin, ThumbsUp } from 'lucide-react'
import { useStream } from '../hooks/live'
import { api } from '../services/api'
import { ErrorBox, Loading } from '../components/ui'

interface Question {
  id: string; text: string; votes: number; pinned: boolean; answered: boolean; upvoted?: boolean
}
interface Wall { version: number; enabled: boolean; open: boolean; items: Question[]; pending?: Question[] }

export function QAWall({ code, roomId, revision, presentation = false }: {code: string; roomId?: string; revision?: string; presentation?: boolean}) {
  const [sort,setSort]=useState('top')
  const [text,setText]=useState('')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [error,setError]=useState<unknown>()
  const host=roomId!==undefined
  const path=host ? '/rooms/'+roomId+'/qa' : '/public/rooms/'+code+'/qa'
  const query=useQuery({queryKey:['qa',path,sort,revision],queryFn:()=>api<Wall>(path+'?sort='+sort)})
  const stream=useStream<Wall>(path+'/events?sort='+sort,host && !!query.data)
  const wall=stream.value && stream.value.version>=(query.data?.version ?? 0) ? stream.value : query.data
  if (query.isError) return <ErrorBox error={query.error} retry={()=>void query.refetch()}/>
  if (!wall) return host ? <Loading/> : null
  if (!host && !wall.enabled) return null
  const visible=presentation ? wall.items.filter(x=>x.pinned) : wall.items
  if (presentation && !visible.length) return null
  async function change(url: string, method: string, data: unknown): Promise<boolean> {
    setBusy(true);setError(undefined);setNotice('')
    try { await api(url,method,data);await query.refetch();return true }
    catch (failure) {setError(failure);return false} finally {setBusy(false)}
  }
  const moderate=(id: string,action: string)=>void change(path+'/'+id,'POST',{action})
  return <section className="panel form-stack qa-panel">
    <div className="section-heading qa-heading"><h2><MessageCircle size={19}/> {presentation?'Pinned audience questions':'Audience Q&A'}</h2>
      {host && <button className="btn secondary compact" disabled={busy} onClick={()=>void change(path,'PUT',{enabled:!wall.enabled})}>{wall.enabled?'Disable Q&A':'Enable Q&A'}</button>}
    </div>
    {!presentation && <label>Sort questions<select value={sort} onChange={e=>setSort(e.target.value)}><option value="top">Most upvoted</option><option value="recent">Most recent</option></select></label>}
    {error !== undefined && <ErrorBox error={error}/>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {host && !!wall.pending?.length && <div className="form-stack"><h3>Pending review</h3><ul className="question-order">{wall.pending.map(q=><li key={q.id}>
      <span>{q.text}</span><div className="actions">
        <button className="btn secondary compact" disabled={busy} onClick={()=>moderate(q.id,'approve')}>Approve</button>
        <button className="btn secondary compact" disabled={busy} onClick={()=>moderate(q.id,'reject')}>Reject</button>
      </div>
    </li>)}</ul></div>}
    {!host && !presentation && wall.open && <form className="form-stack" onSubmit={async e=>{
      e.preventDefault()
      if (await change(path,'POST',{text})) {
        setText('');setNotice('Question submitted for host review.')
      }
    }}>
      <label>Your question<textarea required minLength={8} maxLength={240} rows={2} value={text} onChange={e=>setText(e.target.value)}/></label>
      <button className="btn primary align-start" disabled={busy}>Submit question</button>
    </form>}
    {!visible.length ? <p className="muted">No approved questions yet.</p> : <ul className="question-order qa-list">{visible.map(q=><li key={q.id}>
      <div>{q.pinned && <span className="qa-flag"><Pin size={15}/> Pinned</span>}<span>{q.text}</span>{q.answered && <span className="qa-flag">Answered</span>}</div>
      <div className="actions">
        {host ? <>
          <span className="muted">{q.votes} upvotes</span>
          <button className="btn secondary compact" disabled={busy} onClick={()=>moderate(q.id,q.pinned?'unpin':'pin')}>{q.pinned?'Unpin':'Pin'}</button>
          <button className="btn secondary compact" disabled={busy} onClick={()=>moderate(q.id,q.answered?'reopen':'answer')}>{q.answered?'Reopen':'Mark answered'}</button>
          <button className="btn secondary compact" disabled={busy} onClick={()=>moderate(q.id,'hide')}>Hide</button>
        </> : !presentation && <button className="btn secondary compact" disabled={!wall.open || busy} aria-pressed={!!q.upvoted}
          aria-label={q.upvoted?'Remove upvote':'Upvote question'} onClick={()=>void change(path+'/'+q.id+'/vote','PUT',{active:!q.upvoted})}><ThumbsUp size={16}/> {q.votes}</button>}
      </div>
    </li>)}</ul>}
  </section>
}
