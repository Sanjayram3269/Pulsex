import { motion, useReducedMotion } from 'motion/react'

export function Results({ choices, counts }: { choices: string[]; counts: number[] }) {
  const reduced = useReducedMotion()
  const total = counts.reduce((sum, n) => sum + n, 0)
  return <div className="results"><div className="results-head"><h2>Results</h2><output aria-live="polite">{total} {total === 1 ? 'vote' : 'votes'}</output></div>
    {choices.map((label, i) => {
      const n = counts[i] ?? 0
      const percent = total ? Math.round(n / total * 100) : 0
      return <div className="result-row" key={i}>
        <div><span>{label}</span><span>{percent}% <small>· {n}</small></span></div>
        <div className="meter"><motion.div className={'fill fill-'+(i%4)} initial={false} animate={{width: percent+'%'}} transition={{duration: reduced ? 0 : .35}}/></div>
      </div>
    })}
  </div>
}
