import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react'
import { ErrorBox, Heading, Loading } from '../components/ui'
import { api } from '../services/api'
import { ThemeSelect } from '../components/themes'
import type { QuizConfig, QuizOwner, QuizQuestion } from './quiz-types'

const starter = (boolean = false): QuizQuestion => ({prompt:'',choices:boolean ? ['True','False'] : ['',''],correct:0,seconds:30,points:100})
function QuizEditorForm({ quiz }: { quiz?: QuizOwner }) {
  const [theme,setTheme] = useState(quiz?.theme ?? 'obsidian')
  const [title,setTitle] = useState(quiz?.title ?? '')
  const [config,setConfig] = useState<QuizConfig>(quiz?.config ?? {questions:[starter()],reveal:'each',participation:'named',speedBonus:false})
  const [error,setError] = useState<unknown>()
  const [busy,setBusy] = useState(false)
  const navigate=useNavigate()
  const dragged = useRef<number | null>(null)
  function changeQuestion(i: number, value: QuizQuestion) {
    setConfig(c=>({...c,questions:c.questions.map((q,j)=>j===i ? value : q)}))
  }
  function reorder(i: number, delta: number) {
    setConfig(c=>{
      const questions=[...c.questions]
      const [item]=questions.splice(i,1)
      questions.splice(i+delta,0,item)
      return {...c,questions}
    })
  }
  return <><Heading eyebrow="QUIZ ARENA" title={quiz ? 'Edit quiz' : 'Create a quiz'}>Set the answer, timer, and scoring for each question.</Heading>
    <form className="form-stack quiz-form" onSubmit={async e => {
      e.preventDefault()
      setBusy(true);setError(undefined)
      try {
        const saved=await api<QuizOwner>(quiz ? '/quizzes/'+quiz.id : '/quizzes',quiz ? 'PUT' : 'POST',{title,theme,...config})
        navigate('/studio/quizzes/'+saved.id)
      } catch (failure) {setError(failure)} finally {setBusy(false)}
    }}>
      <section className="panel form-stack">
        <label>Quiz title<input required minLength={3} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <div className="field-grid">
          <label>Reveal answers<select value={config.reveal} onChange={e=>setConfig({...config,reveal:e.target.value as QuizConfig['reveal']})}><option value="each">After each question</option><option value="final">After finishing</option></select></label>
          <label>Participation<select value={config.participation} onChange={e=>setConfig({...config,participation:e.target.value as QuizConfig['participation']})}><option value="named">Participant display name</option><option value="anonymous">Automatic alias</option></select></label>
        </div>
        <ThemeSelect value={theme} onChange={setTheme}/>
        <label className="check"><input type="checkbox" checked={config.speedBonus} onChange={e=>setConfig({...config,speedBonus:e.target.checked})}/> Bonus for fast correct answers</label>
      </section>
      {config.questions.map((question,i)=><section key={i} className="panel form-stack">
        <div className="section-heading quiz-question-heading"
          onDragOver={e=>{if (dragged.current!==null) e.preventDefault()}}
          onDrop={e=>{
            e.preventDefault()
            const from=dragged.current
            dragged.current=null
            if (from!==null && from!==i) reorder(from,i-from)
          }}>
          <h2>Question {i+1}</h2><div className="actions">
            <span className="quiz-drag" draggable aria-hidden="true" title="Drag to reorder"
              onDragStart={e=>{dragged.current=i;e.dataTransfer.setData('text/plain','Question '+(i+1))}}
              onDragEnd={()=>{dragged.current=null}}><GripVertical size={17}/></span>
            <button className="btn icon secondary" type="button" aria-label={'Move question '+(i+1)+' up'} disabled={i===0} onClick={()=>reorder(i,-1)}><ArrowUp size={16}/></button>
            <button className="btn icon secondary" type="button" aria-label={'Move question '+(i+1)+' down'} disabled={i===config.questions.length-1} onClick={()=>reorder(i,1)}><ArrowDown size={16}/></button>
            <button className="btn secondary compact" type="button" disabled={config.questions.length===1} onClick={()=>setConfig({...config,questions:config.questions.filter((_,j)=>j!==i)})}>Remove</button>
          </div>
        </div>
        <label>Prompt {i+1}<input required minLength={3} maxLength={140} value={question.prompt} onChange={e=>changeQuestion(i,{...question,prompt:e.target.value})}/></label>
        {question.choices.map((label,j)=><label key={j}>Question {i+1} choice {j+1}
          <input required maxLength={80} value={label} onChange={e=>changeQuestion(i,{...question,choices:question.choices.map((v,k)=>k===j ? e.target.value : v)})}/>
        </label>)}
        {question.choices.length < 8 && <button type="button" className="btn secondary compact align-start" onClick={()=>changeQuestion(i,{...question,choices:[...question.choices,'']})}>Add choice</button>}
        {question.choices.length > 2 && <button type="button" className="btn secondary compact align-start" onClick={()=>changeQuestion(i,{...question,choices:question.choices.slice(0,-1),correct:Math.min(question.correct,question.choices.length-2)})}>Remove last choice</button>}
        <label>Correct answer<select value={question.correct} onChange={e=>changeQuestion(i,{...question,correct:Number(e.target.value)})}>
          {question.choices.map((label,j)=><option value={j} key={j}>{label || 'Choice '+(j+1)}</option>)}
        </select></label>
        <div className="field-grid">
          <label>Time in seconds<input required type="number" min={5} max={180} value={question.seconds || ''} onChange={e=>changeQuestion(i,{...question,seconds:Number(e.target.value)})}/></label>
          <label>Base points<input required type="number" min={1} max={10000} value={question.points || ''} onChange={e=>changeQuestion(i,{...question,points:Number(e.target.value)})}/></label>
        </div>
      </section>)}
      {error !== undefined && <ErrorBox error={error}/>}
      <div className="actions">
        <button type="button" className="btn secondary" disabled={config.questions.length===20} onClick={()=>setConfig({...config,questions:[...config.questions,starter()]})}><Plus size={16}/> Add question</button>
        <button type="button" className="btn secondary" disabled={config.questions.length===20} onClick={()=>setConfig({...config,questions:[...config.questions,starter(true)]})}>Add true/false template</button>
        <button className="btn primary" disabled={busy}>Save quiz</button>
      </div>
    </form></>
}
function Edit({ id }: {id:string}) {
  const quiz=useQuery({queryKey:['quiz',id],queryFn:()=>api<QuizOwner>('/quizzes/'+id)})
  if (quiz.isPending) return <Loading/>
  if (quiz.isError) return <ErrorBox error={quiz.error}/>
  if (quiz.data.state!=='waiting') return <ErrorBox error={new Error('Only waiting quizzes can be edited.')}/>
  return <QuizEditorForm quiz={quiz.data}/>
}
export function QuizEditor() {
  const id=useParams().id
  return id ? <Edit key={id} id={id}/> : <QuizEditorForm/>
}
