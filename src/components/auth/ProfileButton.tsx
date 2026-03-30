import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { isSupabaseAuthEnabled } from '../../lib/supabaseClient'

export function ProfileButton() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!isSupabaseAuthEnabled() || !user?.email) return null

  const initial = user.email.slice(0, 2).toUpperCase()

  return (
    <div className="profile-btn-wrap" ref={wrapRef}>
      <button
        type="button"
        className="profile-btn"
        aria-label="Профиль"
        title={user.email}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="profile-btn__avatar">{initial}</span>
      </button>
      {open ? (
        <>
          <div className="profile-backdrop" aria-hidden onClick={() => setOpen(false)} />
          <div className="profile-dropdown" role="menu">
            <div className="profile-dropdown__info">
              <p className="profile-dropdown__name">Аккаунт</p>
              <p className="profile-dropdown__email">{user.email}</p>
            </div>
            <hr className="profile-dropdown__hr" />
            <button
              type="button"
              className="profile-dropdown__signout"
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
            >
              Выйти
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
