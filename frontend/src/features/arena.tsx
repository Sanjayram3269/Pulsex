import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Expand, Plus, Radio, Timer, Users } from 'lucide-react'
import { Badge, Empty, ErrorBox, Heading, Loading } from '../components/ui'
import { Share } from '../components/share'
import { ThemeSelect } from '../components/themes'
import { useStream } from '../hooks/live'
import { toggleFullscreen, usePresentationShortcut } from '../hooks/presentation'
import { api } from '../services/api'
import type { AudienceRoom as AudienceData, Page, Poll, Room } from '../types/types'
import { PollAudience } from './audience'
import { QAWall } from './qa-wall'
import { PublicFrame } from '../components/public-frame'

const useRoom = (id: string) => useQuery({queryKey:['room',id],queryFn:()=>api<Room>('/rooms/'+id)})
export function Arena() {
  const [page,setPage] = useState(1)
  const rooms = useQuery({queryKey:['rooms',page],queryFn:()=>api<Page<Room>>('/rooms?page='+page)})
  return <><Heading eyebrow="PULSE ARENA" title="Live rooms" action={<Link className="btn primary" to="/studio/rooms/new"><Plus size={18}/> New room</Link>}>Run several questions in one session with a single audience link.</Heading>
    {rooms.isPending ? <Loading/> : rooms.isError ? <ErrorBox error={rooms.error} retry={()=>void rooms.refetch()}/> : rooms.data.items.length ? <div className="panel rows">
      {rooms.data.items.map(room=><Link className="data-row" key={room.id} to={'/studio/rooms/'+room.id}><span className="feature-icon"><Radio size={20}/></span><div><strong>{room.title}</strong><small>{room.polls.length} questions · {room.code.toUpperCase()}</small></div><Badge state={room.state}/><ArrowRight className="row-arrow" size={18}/></Link>)}
    </div> : <Empty title="Host your first room" description="Pick the polls you want to run and invite your audience with one link." to="/studio/rooms/new" action="Create a room"/>}
    {(page>1 || rooms.data?.hasMore) && <div className="actions pagination"><button className="btn secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><button className="btn secondary" disabled={!rooms.data?.hasMore} onClick={()=>setPage(page+1)}>Next</button></div>}
  </>
}
function RoomForm({ room }: { room?: Room }) {
  const [page,setPage] = useState(1)
  const [known,setKnown] = useState<Record<string,string>>({})
  const list = useQuery({queryKey:['roomPollChoices',page],queryFn:()=>api<Page<Poll>>('/polls?limit=30&page='+page)})
  const [theme,setTheme] = useState(room?.theme ?? 'obsidian')
  const [title,setTitle] = useState(room?.title ?? '')
  const [polls,setPolls] = useState<string[]>(room?.polls ?? [])
  const [error,setError] = useState<unknown>()
  const [busy,setBusy] = useState(false)
  const client = useQueryClient()
  const navigate = useNavigate()
  useEffect(()=>{
    if (list.data) setKnown(previous=>({...previous,...Object.fromEntries(list.data.items.map(p=>[p.slug,p.title]))}))
  },[list.data])
  const choices = (list.data?.items ?? []).filter(p=>p.state==='draft' || p.state==='scheduled' || p.state==='live')
  return <><Heading eyebrow="PULSE ARENA" title={room ? 'Edit room' : 'Create a room'}>Select polls in the order you want to run them.</Heading>
    <form className="panel narrow form-stack" onSubmit={async e=>{
      e.preventDefault();setError(undefined);setBusy(true)
      try {
        const result = await api<Room>(room ? '/rooms/'+room.id : '/rooms',room ? 'PUT' : 'POST',{title,polls,theme})
        client.setQueryData(['room',result.id],result)
        void client.invalidateQueries({queryKey:['rooms']})
        navigate('/studio/rooms/'+result.id)
      } catch (err) { setError(err) } finally {setBusy(false)}
    }}>
      <label>Room name<input required minLength={3} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Friday workshop"/></label>
      <ThemeSelect value={theme} onChange={setTheme}/>
      {list.isPending ? <Loading/> : list.isError ? <ErrorBox error={list.error}/> : <fieldset className="form-stack">
        <legend>Available polls</legend>
        {choices.length===0 && <p className="muted">No available polls on this page. <Link to="/studio/polls/new">Create a poll</Link></p>}
        {choices.map(p=><label className="check" key={p.slug}><input type="checkbox" checked={polls.includes(p.slug)} disabled={polls.length>=20 && !polls.includes(p.slug)} onChange={e=>setPolls(e.target.checked?[...polls,p.slug]:polls.filter(x=>x!==p.slug))}/>{p.title}</label>)}
        {(page>1 || list.data.hasMore) && <div className="actions"><button type="button" className="btn secondary compact" disabled={page===1} onClick={()=>setPage(page-1)}>Previous polls</button><button type="button" className="btn secondary compact" disabled={!list.data.hasMore} onClick={()=>setPage(page+1)}>More polls</button></div>}
      </fieldset>}
      {polls.length>0 && <><h2>Question order</h2><ol className="question-order">{polls.map((slug,i)=><li key={slug}><span>{i+1}. {known[slug] ?? slug}</span><button className="btn secondary compact" type="button" onClick={()=>setPolls(polls.filter(x=>x!==slug))}>Remove</button></li>)}</ol></>}
      {error !== undefined && <ErrorBox error={error}/>}
      <button className="btn primary align-start" disabled={!polls.length || busy}>Save room</button>
    </form></>
}
function RoomEdit({ id }: { id: string }) {
  const room = useRoom(id)
  if (room.isPending) return <Loading/>
  if (room.isError) return <ErrorBox error={room.error}/>
  if (room.data.state!=='waiting') return <ErrorBox error={new Error('The room has already started.')}/>
  return <RoomForm key={id} room={room.data}/>
}
export function RoomEditor() {
  const id = useParams().id
  return id ? <RoomEdit id={id}/> : <RoomForm/>
}
function TimerDisplay({ ends }: { ends: string | null }) {
  const [now,setNow] = useState(Date.now())
  useEffect(()=>{ const id = window.setInterval(()=>setNow(Date.now()),500);return ()=>window.clearInterval(id) },[])
  if (!ends) return null
  const seconds = Math.max(0,Math.ceil((new Date(ends).getTime()-now)/1000))
  return <span className="timer"><Timer size={16}/> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>
}
export function HostRoom() {
  const id = useParams().id ?? ''
  const room = useRoom(id)
  const client = useQueryClient()
  const [seconds,setSeconds] = useState(0)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState<unknown>()
  const code = room.data?.code ?? ''
  const stream = useStream<AudienceData>('/public/rooms/'+code+'/events',!!code)
  const names = useQuery({queryKey:['roomQuestions',room.data?.polls],enabled:!!room.data,queryFn:()=>fetchQuestionNames(room.data!.polls)})
  useEffect(()=>{
    if (stream.value && room.data && stream.value.version>room.data.version) void room.refetch()
  },[stream.value?.version,room.data?.version])
  if (room.isPending) return <Loading/>
  if (room.isError) return <ErrorBox error={room.error} retry={()=>void room.refetch()}/>
  const data = room.data
  const live = stream.value?.version===data.version ? stream.value : undefined
  async function action(action: string,index?: number) {
    setError(undefined);setBusy(true)
    try {
      const result = await api<Room>('/rooms/'+id+'/action','POST',{action,index,seconds,version:data.version})
      client.setQueryData(['room',id],result)
      void client.invalidateQueries({queryKey:['rooms']})
      void client.invalidateQueries({queryKey:['polls']})
    } catch (err) {setError(err);void room.refetch()} finally {setBusy(false)}
  }
  return <><Heading eyebrow="HOST CONTROL" title={data.title} action={<Badge state={live?.state ?? data.state}/>}>Room code {code.toUpperCase()} · {live?.present ?? 0} present</Heading>
    <div className="actions toolbar"><Link className="btn secondary" to="insights">Session insights</Link><Link className="btn secondary" target="_blank" to={'/room/'+code+'/present'}><Expand size={17}/> Presentation</Link>
      {data.state==='waiting' && <Link className="btn secondary" to="edit">Edit room</Link>}
      {data.state==='live' && <button className="btn secondary" disabled={busy} onClick={()=>void action('close')}>Close question</button>}
      {data.state!=='ended' && <button className="btn secondary" disabled={busy} onClick={()=>void action('finish')}>End room</button>}
      {data.state==='live' && <TimerDisplay ends={data.ends}/>}
    </div>
    {error !== undefined && <ErrorBox error={error}/>}
    <div className="content-grid"><section className="panel form-stack"><h2>Questions</h2><label>Timer in seconds (0 for no timer)<input type="number" min="0" max="3600" value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label>
      <ol className="question-order">{data.polls.map((slug,i)=><li key={slug}><span>{i+1}. {names.data?.[slug] ?? 'Question '+(i+1)}</span>
        {i===data.active ? <Badge state={data.state==='live' ? live?.state ?? 'live' : 'closed'}/> : i>data.active && data.state!=='ended' && <button className="btn secondary compact" disabled={busy || !Number.isInteger(seconds) || seconds<0 || seconds>3600} onClick={()=>void action('open',i)}>Open question {i+1}</button>}</li>)}</ol>
    </section><Share path={'/room/'+code} label="Invite the audience"/></div>
    <QAWall code={code} roomId={id}/>
  </>
}
async function fetchQuestionNames(slugs: string[]) {
  const result: Record<string,string> = {}
  for (let page=1;page<=10;page++) {
    const list = await api<Page<Poll>>('/polls?limit=100&page='+page)
    for (const poll of list.items) if (slugs.includes(poll.slug)) result[poll.slug]=poll.title
    if (!list.hasMore || Object.keys(result).length===slugs.length) break
  }
  return result
}
export function AudienceRoom({ presentation = false }: { presentation?: boolean }) {
  usePresentationShortcut(presentation)
  const code = useParams().code ?? ''
  const path = '/public/rooms/'+code.toLowerCase()
  const query = useQuery({queryKey:['audienceRoom',code],queryFn:()=>api<AudienceData>(path)})
  const stream = useStream<AudienceData>(path+'/events',!!query.data)
  useEffect(()=>{
    if (!query.data || presentation) return
    const ping = () => { void api(path+'/presence','POST').catch(()=>undefined) }
    ping()
    const interval = window.setInterval(ping,15000)
    return ()=>window.clearInterval(interval)
  },[!!query.data,path,presentation])
  const room = stream.value ?? query.data
  return <PublicFrame theme={room?.theme}>{query.isError ? <ErrorBox error={query.error} retry={()=>void query.refetch()}/> : !room ? <Loading/> : <>
    <div className="room-banner panel"><div><p className="eyebrow">{presentation ? 'PRESENTATION' : 'LIVE ROOM'}</p><h2>{room.title}</h2><span className="muted">Code {code.toUpperCase()}{room.active>=0 && ' · Question '+(room.active+1)+' of '+room.total}</span></div>
      <div className="actions"><Badge state={room.state}/><span className="timer"><Users size={16}/> {room.present}</span>{room.state==='live' && <TimerDisplay ends={room.ends}/>}
        {presentation && <button className="btn secondary compact" title="Full screen (F)" onClick={toggleFullscreen}><Expand size={16}/> Full screen</button>}</div></div>
    {room.slug && room.state!=='ended' ? <PollAudience key={room.slug+presentation} slug={room.slug} presentation={presentation}/> :
      <Empty title={room.state==='ended' ? 'This session has ended' : 'Waiting for the host'} description={room.state==='ended' ? 'Thanks for joining.' : 'The next question will appear when your host opens it.'}/>}
    {room.qaEnabled && <QAWall code={code} presentation={presentation} revision={room.qaVersion+'/'+room.state}/>}
  </>}</PublicFrame>
}
