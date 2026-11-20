import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Expand, Plus, Radio, Timer, Trophy } from 'lucide-react'
import { Badge, Empty, ErrorBox, Heading, Loading } from '../components/ui'
import { PublicFrame } from '../components/public-frame'
import { Share } from '../components/share'
import { QAWall } from './qa-wall'
import { api, ApiError, base } from '../services/api'
import { useStream } from '../hooks/live'
import { toggleFullscreen, usePresentationShortcut } from '../hooks/presentation'
import type { Page, Room } from '../types/types'
import type { PublicQuiz, QuizOwner, QuizPlayer } from './quiz-types'

export function Quizzes() {
  const [page,setPage]=useState(1)
  const list=useQuery({queryKey:['quizzes',page],queryFn:()=>api<Page<Room>>('/quizzes?page='+page)})
  return <><Heading eyebrow="QUIZ ARENA" title="Quizzes" action={<Link className="btn primary" to="new"><Plus size={17}/> New quiz</Link>}>Host timed questions and reveal scores when you're ready.</Heading>
    {list.isPending ? <Loading/> : list.isError ? <ErrorBox error={list.error}/> : !list.data.items.length ?
      <Empty title="Create your first quiz" description="Add a question and invite players with a room link." to="/studio/quizzes/new" action="Create a quiz"/> :
      <div className="panel rows">{list.data.items.map(room=><Link className="data-row" key={room.id} to={room.id}>
        <span className="feature-icon"><Trophy size={18}/></span><strong>{room.title}</strong><Badge state={room.state}/></Link>)}</div>}
    {(page>1 || list.data?.hasMore) && <div className="actions pagination">
      <button className="btn secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button>
      <button className="btn secondary" disabled={!list.data?.hasMore} onClick={()=>setPage(page+1)}>Next</button>
    </div>}
  </>
}

const quizPath = (code: string) => '/public/quizzes/'+code
function Countdown({ ends }: { ends: string | null }) {
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{
    if (!ends) return
    const interval=window.setInterval(()=>setNow(Date.now()),250)
    return ()=>window.clearInterval(interval)
  },[ends])
  if (!ends) return null
  const seconds=Math.max(0,Math.ceil((Date.parse(ends)-now)/1000))
  return <span className="timer"><Timer size={16}/>{seconds}s</span>
}
function Board({ players, own, finished }: { players: QuizPlayer[]; own?: string; finished?: boolean }) {
  if (!players.length) return <p className="muted">No players joined this quiz.</p>
  return <section className="quiz-board form-stack"><h2>{finished ? 'Final leaderboard' : 'Leaderboard'}</h2>
    <p className="muted">Ties break by correct-answer count, then player ID.</p>
    <ol className="question-order">{players.map((player,i)=><li key={player.id} className={finished && i<3 ? 'podium podium-'+(i+1) : ''}>
      <span><b>#{i+1}</b> {player.alias}{own===player.id && ' (you)'}</span>
      <span>{player.points} pts · {player.correct} correct</span>
    </li>)}</ol>
  </section>
}
export function QuizHost() {
  const id=useParams().id ?? ''
  const quiz=useQuery({queryKey:['quiz',id],queryFn:()=>api<QuizOwner>('/quizzes/'+id)})
  const code=quiz.data?.code ?? ''
  const stream=useStream<PublicQuiz>(quizPath(code)+'/events',!!code)
  const client=useQueryClient()
  const navigate=useNavigate()
  const [error,setError]=useState<unknown>()
  const [busy,setBusy]=useState(false)
  if (quiz.isPending) return <Loading/>
  if (quiz.isError) return <ErrorBox error={quiz.error}/>
  const room=quiz.data
  const live=stream.value && stream.value.version>=room.version ? stream.value : undefined
  const state=live?.state ?? room.state
  const index=live?.active ?? room.active
  async function action(action: string) {
    setBusy(true);setError(undefined)
    try {
      const updated=await api<QuizOwner>('/quizzes/'+id+'/action','POST',{action,control:room.control})
      client.setQueryData(['quiz',updated.id],updated)
      void client.invalidateQueries({queryKey:['quizzes']})
      if (updated.id!==id) navigate('/studio/quizzes/'+updated.id+'/edit')
    } catch (failure) {setError(failure);void quiz.refetch()} finally {setBusy(false)}
  }
  return <><Heading eyebrow="QUIZ HOST" title={room.title} action={<Badge state={state}/>}>Code {code.toUpperCase()} · {live?.joined ?? room.joined} joined · {live?.responses ?? room.responses} answered this round</Heading>
    <div className="actions toolbar">
      {(state==='waiting' || state==='paused') && index+1<room.config.questions.length && <button className="btn primary" disabled={busy} onClick={()=>void action('next')}>{index<0 ? 'Start quiz' : 'Next question'}</button>}
      {state==='live' && <button className="btn secondary" disabled={busy} onClick={()=>void action('pause')}>Close question</button>}
      {index>=0 && state!=='ended' && <button className="btn secondary" disabled={busy} onClick={()=>void action('finish')}>Finish quiz</button>}
      {state==='waiting' && <Link className="btn secondary" to="edit">Edit quiz</Link>}
      <button className="btn secondary" disabled={busy} onClick={()=>void action('duplicate')}>Duplicate quiz</button>
      <Link className="btn secondary" to={'/quiz/'+code+'/present'} target="_blank"><Expand size={16}/> Presentation</Link>
      <Link className="btn secondary" to="insights">Session insights</Link>
      <a className="btn secondary" href={base+'/quizzes/'+id+'/export'}>Export scores CSV</a>
      {state==='live' && <Countdown ends={live?.ends ?? room.ends}/>}
    </div>
    {error !== undefined && <ErrorBox error={error}/>}
    <div className="content-grid">
      <section className="panel form-stack"><h2>Question preview</h2>
        <ol className="question-order">{room.config.questions.map((q,i)=><li key={i}><div><strong>{i+1}. {q.prompt}</strong><p className="muted">Answer: {q.choices[q.correct]} · {q.seconds}s · {q.points} pts</p></div>{index===i && <Badge state={state}/>}</li>)}</ol>
        {live?.leaderboard && <Board players={live.leaderboard} finished={state==='ended'}/>}
      </section>
      <Share path={'/quiz/'+code} label="Invite players"/>
    </div>
    <QAWall code={code} roomId={id}/>
  </>
}
function QuizBallot({ live, submit }: { live: PublicQuiz; submit: (choice:number)=>Promise<void> }) {
  const [choice,setChoice]=useState<number>()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<unknown>()
  return <form className="form-stack" onSubmit={async e=>{
    e.preventDefault()
    if (choice===undefined || busy) return
    setBusy(true);setError(undefined)
    try {await submit(choice)} catch(failure) {setError(failure)} finally {setBusy(false)}
  }}>
    <fieldset className="option-stack"><legend>Pick an answer</legend>
      {live.question?.choices.map((name,i)=><label key={i} className={'option '+(choice===i?'selected':'')}><input type="radio" name="quizChoice" checked={choice===i} onChange={()=>setChoice(i)}/>{name}</label>)}
    </fieldset>
    {error !== undefined && <ErrorBox error={error}/>}
    <button className="btn primary" disabled={choice===undefined || busy}>Submit answer</button>
  </form>
}
export function QuizAudience({ presentation=false }: {presentation?:boolean}) {
  usePresentationShortcut(presentation)
  const code=(useParams().code ?? '').toLowerCase()
  const path=quizPath(code)
  const query=useQuery({queryKey:['publicQuiz',code],queryFn:()=>api<PublicQuiz>(path)})
  const stream=useStream<PublicQuiz>(path+'/events',!!query.data)
  const [name,setName]=useState('')
  const [joined,setJoined]=useState('')
  const [answered,setAnswered]=useState(-1)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<unknown>()
  const live=stream.value && stream.value.version>=(query.data?.version ?? 0) ? stream.value : query.data
  return <PublicFrame theme={live?.theme}>{query.isError ? <ErrorBox error={query.error} retry={()=>void query.refetch()}/> : !live ? <Loading/> :
    <section className="panel audience-card">
      <div className="audience-state"><Badge state={stream.state==='live' ? 'connected' : stream.state}/><Badge state={live.state}/></div>
      <p className="eyebrow"><Radio size={15}/> {presentation?'QUIZ PRESENTATION':'QUIZ ARENA'}</p>
      <h1>{live.title}</h1>
      <div className="actions"><span className="muted">{live.joined} joined{live.active>=0 && ' · Question '+(live.active+1)+' of '+live.total}</span>{live.state==='live' && <Countdown ends={live.ends}/>}
        {presentation && <button className="btn secondary compact" title="Full screen (F)" onClick={toggleFullscreen}><Expand size={16}/> Full screen</button>}
      </div>
      {error !== undefined && <ErrorBox error={error}/>}
      {!presentation && !joined && !live.player && live.state!=='ended' && <form className="form-stack" onSubmit={async e=>{
        e.preventDefault();setBusy(true);setError(undefined)
        try {const player=await api<Pick<QuizPlayer,'id'|'alias'>>(path+'/join','POST',{name});setJoined(player.id);void query.refetch()}
        catch (failure) {setError(failure)} finally {setBusy(false)}
      }}>
        {live.participation==='named' && <label>Display name<input required maxLength={32} value={name} onChange={e=>setName(e.target.value)}/><small className="muted">This name appears in the room leaderboard.</small></label>}
        <button className="btn primary" disabled={busy}>Join quiz</button>
      </form>}
      {live.state==='waiting' ? <p className="notice">Waiting for the host to start.</p> : live.question && <>
        <h2 className={presentation?'presentation-enter':undefined} key={live.active}>{live.question.prompt}</h2>
        {live.state==='live' && !presentation && (live.player || joined) && (live.answered || answered===live.active ?
          <p className="notice success" role="status">Answer received.</p> :
          <QuizBallot key={live.active} live={live} submit={async choice=>{
            try {await api(path+'/answers','POST',{round:live.active,choice})}
            catch (failure) {if (!(failure instanceof ApiError && failure.code==='already_answered')) throw failure}
            setAnswered(live.active)
          }}/>)}
        {presentation && live.state==='live' && <ol className="question-order">{live.question.choices.map((choice,i)=><li key={i}>{choice}</li>)}</ol>}
        {live.state==='paused' && live.question.correct===undefined && <p className="notice">Answers will be revealed when the quiz ends.</p>}
        {live.question.correct!==undefined && <p className="notice success">Correct answer · {live.question.choices[live.question.correct]}</p>}
      </>}
      {live.state==='ended' && <p className="notice">Quiz finished.</p>}
      {live.leaderboard && <Board players={live.leaderboard} own={live.player ?? joined} finished={live.state==='ended'}/>}
      {!presentation && live.review && <section className="form-stack"><h2>Answer review</h2><ol className="question-order">{live.review.map((q,i)=><li key={i}><span>{q.prompt}</span><strong>{q.correct===undefined ? '' : q.choices[q.correct]}</strong></li>)}</ol></section>}
    </section>}
    {live?.qaEnabled && <QAWall code={code} presentation={presentation} revision={live.qaVersion+'/'+live.state}/>}

  </PublicFrame>
}

export function JoinByCode() {
  const code=(useParams().code ?? '').toLowerCase()
  const lookup=useQuery({queryKey:['join',code],retry:false,queryFn:async()=>{
    try {await api('/public/rooms/'+code);return 'room'}
    catch (failure) { if (!(failure instanceof ApiError && failure.status===404)) throw failure }
    await api(quizPath(code));return 'quiz'
  }})
  if (lookup.isPending) return <PublicFrame><Loading/></PublicFrame>
  if (lookup.isError) return <PublicFrame><ErrorBox error={lookup.error}/></PublicFrame>
  return <Navigate replace to={'/'+lookup.data+'/'+code}/>
}
