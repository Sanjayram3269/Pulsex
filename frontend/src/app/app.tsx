import { lazy, Suspense, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { CircleDot, LayoutGrid, LogOut, Plus, Radio, Settings as SettingsIcon } from 'lucide-react'
import { Brand, Empty, ErrorBox, Loading } from '../components/ui'
import { api, useUser } from '../services/api'
import { Landing } from '../features/landing'
import { PublicFrame } from '../components/public-frame'
const Studio = lazy(() => import('../features/studio').then(m => ({default:m.Studio})))
const PollDetails = lazy(() => import('../features/studio').then(m => ({default:m.PollDetails})))
const Editor = lazy(() => import('../features/editor').then(m => ({default:m.Editor})))
const GuestPoll = lazy(() => import('../features/audience').then(m => ({default:m.GuestPoll})))
const Arena = lazy(() => import('../features/arena').then(m => ({default:m.Arena})))
const AudienceRoom = lazy(() => import('../features/arena').then(m => ({default:m.AudienceRoom})))
const HostRoom = lazy(() => import('../features/arena').then(m => ({default:m.HostRoom})))
const RoomEditor = lazy(() => import('../features/arena').then(m => ({default:m.RoomEditor})))
const Insights = lazy(() => import('../features/insights').then(m => ({default:m.Insights})))
const Identity = lazy(() => import('../features/identity').then(m => ({default:m.Identity})))
const Settings = lazy(() => import('../features/identity').then(m => ({default:m.Settings})))

function Workspace() {
  const user = useUser()
  const location = useLocation()
  const [error,setError] = useState<unknown>()
  const [signingOut,setSigningOut] = useState(false)
  if (user.isPending) return <PublicFrame><Loading/></PublicFrame>
  if (user.isError) return <PublicFrame><ErrorBox error={user.error} retry={()=>void user.refetch()}/></PublicFrame>
  if (!user.data) return <Navigate replace to={'/login?next='+encodeURIComponent(location.pathname)}/>
  return <div className="workspace"><aside className="sidebar">
    <Brand/><div className="sidebar-label">WORKSPACE</div>
    <nav aria-label="Workspace navigation">
      <NavLink end to="/studio"><LayoutGrid size={19}/> Studio</NavLink><NavLink to="/studio/polls"><CircleDot size={19}/> Polls</NavLink><NavLink to="/studio/rooms"><Radio size={19}/> Live rooms</NavLink>
      <NavLink to="/studio/settings"><SettingsIcon size={19}/> Settings</NavLink>
    </nav>
    <div className="identity-chip"><span className="avatar">{Array.from(user.data.name)[0].toUpperCase()}</span><div><strong>{user.data.name}</strong><small>Creator</small></div>
      <button className="btn icon quiet" aria-label="Sign out" disabled={signingOut} onClick={async()=>{
        setSigningOut(true)
        try { await api('/auth/logout','POST'); window.location.replace('/') }
        catch (err) {setError(err)} finally {setSigningOut(false)}
      }}><LogOut size={18}/></button>
    </div>
  </aside><div className="workspace-content">
    <header className="workspace-top"><span><span className="live-point"/> Creator workspace</span><Link to="/studio/polls/new" className="btn secondary compact"><Plus size={15}/> New poll</Link></header>
    <main id="main" tabIndex={-1} className="studio-main">{error !== undefined && <ErrorBox error={error}/>}<Suspense fallback={<Loading/>}><Outlet/></Suspense></main>
  </div></div>
}
export function App() {
  return <><a href="#main" className="skip-link">Skip to content</a><Suspense fallback={<PublicFrame><Loading/></PublicFrame>}><Routes>
    <Route path="/" element={<Landing/>}/><Route path="/login" element={<Identity key="login" register={false}/>}/><Route path="/register" element={<Identity key="register" register/>}/>
    <Route path="/p/:slug" element={<GuestPoll/>}/><Route path="/room/:code" element={<AudienceRoom/>}/><Route path="/room/:code/present" element={<AudienceRoom presentation/>}/>
    <Route path="/studio" element={<Workspace/>}>
      <Route index element={<Studio/>}/><Route path="polls" element={<Studio/>}/>
      <Route path="polls/new" element={<Editor/>}/><Route path="polls/:id" element={<PollDetails/>}/><Route path="polls/:id/edit" element={<Editor/>}/><Route path="polls/:id/analytics" element={<Insights/>}/>
      <Route path="rooms" element={<Arena/>}/><Route path="rooms/new" element={<RoomEditor/>}/><Route path="rooms/:id" element={<HostRoom/>}/><Route path="rooms/:id/edit" element={<RoomEditor/>}/>
      <Route path="settings" element={<Settings/>}/>
    </Route>
    <Route path="*" element={<PublicFrame><Empty title="Page not found" description="This link may have moved or been entered incorrectly." to="/" action="Back to PULSEX"/></PublicFrame>}/>
  </Routes></Suspense></>
}
