import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg-orb login-bg-orb--lime" aria-hidden />
      <div className="login-bg-orb login-bg-orb--blue" aria-hidden />
      <div className="login-shell login-shell--centered">
        <div className="login-card">
          <div className="login-logo" aria-hidden>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="rgba(206,246,0,0.7)" strokeWidth="1.6" />
              <path d="M8 12h8M12 8v8" stroke="rgba(206,246,0,0.9)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="login-title">Sign in</h1>
          <p className="login-subtitle">
            Accounts are created in Supabase (Authentication → Users). Self-service sign-up is disabled.
          </p>
          <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
            <div className="login-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="login-error">{error}</p> : null}
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="login-hint">Need access? Ask an admin to create a user in the Supabase dashboard.</p>
        </div>
      </div>
    </div>
  )
}
