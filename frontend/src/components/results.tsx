import { motion, useReducedMotion } from 'motion/react'
import type { Poll, Snapshot } from '../types/types'

function Results({ choices, counts, ballots, unit = 'vote', points }: {
  choices: string[]; counts: number[]; ballots?: number; unit?: string; points?: number[]
}) {
  const reduced = useReducedMotion()
  const total = ballots ?? counts.reduce((sum, n) => sum + n, 0)
  return <div className="results"><div className="results-head"><h2>Results</h2><output aria-live="polite">{total} {unit}{total === 1 ? '' : 's'}</output></div>
    {choices.map((label, i) => {
      const n = counts[i] ?? 0
      const percent = total ? Math.round(n / total * 100) : 0
      return <div className="result-row" key={i}>
        <div><span>{label}</span><span>{percent}% <small>· {n}{points && ' · '+(points[i] ?? 0)+' pts'}</small></span></div>
        <div className="meter"><motion.div className={'fill fill-'+(i%4)} initial={false} animate={{width: percent+'%'}} transition={{duration: reduced ? 0 : .35}}/></div>
      </div>
    })}
  </div>
}

export function PollResults({ poll, result }: { poll: Poll; result: Omit<Snapshot,'version'> }) {
  const reduced = useReducedMotion()
  const total = result.ballots ?? result.counts.reduce((a,b)=>a+b,0)
  switch (poll.question?.type) {
    case 'word_cloud': {
      const terms = result.terms ?? []
      return <div className="results">
        <div className="results-head"><h2>Word cloud</h2><output aria-live="polite">{total} approved {total === 1 ? 'response' : 'responses'}</output></div>
        {terms.length ? <ul className="word-cloud">{terms.map(term => <motion.li key={term.text} initial={false}
          animate={{fontSize:(1 + 1.65 * Math.sqrt(term.count / terms[0].count))+'rem'}} transition={{duration:reduced ? 0 : .3}}>
          {term.text} <small>{term.count}</small>
        </motion.li>)}</ul> : <p className="muted">Approved words will appear here.</p>}
      </div>
    }
    case 'rating': {
      const sum = result.counts.reduce((n,count,index)=>n+count*Number(poll.choices[index]),0)
      return <div className="form-stack">
        <p className="muted">{total ? 'Average '+(sum / total).toFixed(2)+' out of '+poll.question.max : 'No ratings yet'}</p>
        <Results choices={poll.choices} counts={result.counts} ballots={total} unit="rating"/>
      </div>
    }
    case 'multiple_choice':
      return <div className="form-stack">
        <p className="muted">{result.counts.reduce((a,b)=>a+b,0)} selections · option percentages use submitted ballots</p>
        <Results choices={poll.choices} counts={result.counts} ballots={total} unit="ballot"/>
      </div>
    case 'ranked_choice': {
      const points = result.rankPoints ?? []
      const leader = points.length ? Math.max(...points) : 0
      const leaders = poll.choices.filter((_,i)=>points[i] === leader)
      return <div className="form-stack">
        <p className="muted">Bars show first preferences. Borda awards {poll.choices.length - 1} points for first place, down to zero for last.</p>
        {total > 0 && <p className="muted">{leaders.length > 1 ? 'Tied lead' : 'Borda lead'} · {leaders.join(', ')}</p>}
        <Results choices={poll.choices} counts={result.counts} ballots={total} unit="ballot" points={points}/>
      </div>
    }
    default: return <Results choices={poll.choices} counts={result.counts} ballots={total}/>
  }
}
