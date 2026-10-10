import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Globe,
  Lightbulb,
  LoaderCircle,
  Lock,
  MessageSquare,
  Network,
} from 'lucide-react';
import { BrandMark } from '../workspace/BrandMark';
import { navigate } from '../router';
import { AuthError, logIn, passwordStrength, signUp, type User } from './session';
import './auth.css';

export type AuthMode = 'login' | 'signup';
const STRENGTH = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

/**
 * Log in and sign up on one page: switching modes slides the name field and the copy rather
 * than loading another page, and a successful sign-in plays out before the workspace appears.
 */
export function AuthPage({
  mode,
  signup,
  onSignedIn,
}: {
  mode: AuthMode;
  /** False on a server whose operator creates the accounts: only logging in is offered. */
  signup: boolean;
  onSignedIn: (user: User) => void;
}) {
  const signingUp = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<AuthError | null>(null);
  // Bumped on every failure so the shake replays even for the same message.
  const [attempt, setAttempt] = useState(0);
  const ids = { name: useId(), email: useId(), password: useId(), error: useId() };
  const first = useRef<HTMLInputElement>(null);
  const strength = passwordStrength(password);

  useEffect(() => {
    document.title = signingUp ? 'Create your account · Opsis' : 'Log in · Opsis';
  }, [signingUp]);
  useEffect(() => {
    first.current?.focus();
  }, [mode]);

  const switchTo = (next: AuthMode) => {
    if (next === mode || state !== 'idle') return;
    setError(null);
    // Keep any return path (?next=) when switching between the two forms.
    navigate(`/${next}${location.search}`, true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state !== 'idle') return;
    setState('busy');
    setError(null);
    try {
      const user = signingUp
        ? await signUp(name.trim(), email.trim(), password)
        : await logIn(email.trim(), password);
      setState('done');
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Let the confirmation and the exit play before the workspace replaces this page.
      setTimeout(() => onSignedIn(user), still ? 0 : 650);
    } catch (caught) {
      setError(caught instanceof AuthError ? caught : new AuthError('Something went wrong.'));
      setAttempt((count) => count + 1);
      setState('idle');
    }
  }

  const invalid = (field: 'name' | 'email' | 'password') => error?.field === field || undefined;
  return (
    <div className={`auth ${state === 'done' ? 'is-leaving' : ''}`}>
      <section className="auth-visual" aria-hidden>
        <div className="auth-brand">
          <span className="brand-symbol">
            <BrandMark />
          </span>
          <span>
            opsis<span className="brand-dot">.</span>
          </span>
        </div>
        <svg className="auth-diagram" viewBox="0 0 420 300" fill="none">
          <path className="auth-edge e1" d="M110 70 H 210 Q 230 70 230 90 V 130" />
          <path className="auth-edge e2" d="M230 196 V 200 Q 230 220 250 220 H 320" />
          <path className="auth-edge e3" d="M230 196 V 200 Q 230 220 210 220 H 110" />
          <circle className="auth-packet" r="4">
            <animateMotion
              dur="3.2s"
              repeatCount="indefinite"
              path="M110 70 H 210 Q 230 70 230 90 V 124 M230 196 V 200 Q 230 220 250 220 H 320"
            />
          </circle>
        </svg>
        <div className="auth-node n1">
          <span>
            <MessageSquare size={22} />
          </span>
          A question
        </div>
        <div className="auth-node n2">
          <span>
            <Lightbulb size={22} />
          </span>
          The idea
        </div>
        <div className="auth-node n3">
          <span>
            <Network size={22} />
          </span>
          How it connects
        </div>
        <div className="auth-node n4">
          <span>
            <Globe size={22} />
          </span>
          Shared
        </div>
        <div className="auth-tagline">
          <h2>See what you mean.</h2>
          <p>
            Your canvases stay private until you choose to share them. Make one public and your
            friends can open it, play it and save their own copy.
          </p>
          <ul>
            <li>
              <Lock size={14} /> Private by default
            </li>
            <li>
              <Globe size={14} /> Public with one switch
            </li>
          </ul>
        </div>
      </section>

      <main className="auth-panel">
        <div className="auth-card">
          {signup && (
            <div className="auth-switch" role="tablist" aria-label="Account">
              <span className="auth-switch-thumb" data-mode={mode} aria-hidden />
              {(['login', 'signup'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={mode === option}
                  onClick={() => switchTo(option)}
                >
                  {option === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>
          )}

          <header className="auth-head" key={mode}>
            <h1>{signingUp ? 'Create your account' : 'Welcome back'}</h1>
            <p>
              {signingUp
                ? 'Keep your canvases together and share the ones you choose.'
                : 'Log in to pick up your canvases where you left them.'}
            </p>
          </header>

          <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
            <div
              className={`auth-reveal ${signingUp ? 'is-open' : ''}`}
              // React 18 has no typed `inert`; it keeps the hidden name field out of tab order.
              {...(signingUp ? {} : { inert: '' })}
            >
              <div>
                <label className="auth-field" htmlFor={ids.name}>
                  <span>Name</span>
                  <input
                    ref={signingUp ? first : undefined}
                    id={ids.name}
                    value={name}
                    autoComplete="name"
                    maxLength={60}
                    required={signingUp}
                    aria-invalid={invalid('name')}
                    aria-describedby={invalid('name') ? ids.error : undefined}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ada Lovelace"
                  />
                </label>
              </div>
            </div>
            <label className="auth-field" htmlFor={ids.email}>
              <span>Email</span>
              <input
                ref={signingUp ? undefined : first}
                id={ids.email}
                type="email"
                value={email}
                autoComplete="email"
                inputMode="email"
                required
                aria-invalid={invalid('email')}
                aria-describedby={invalid('email') ? ids.error : undefined}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="auth-field" htmlFor={ids.password}>
              <span>Password</span>
              <span className="auth-password">
                <input
                  id={ids.password}
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  autoComplete={signingUp ? 'new-password' : 'current-password'}
                  required
                  minLength={signingUp ? 8 : undefined}
                  aria-invalid={invalid('password')}
                  aria-describedby={invalid('password') ? ids.error : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={signingUp ? 'At least 8 characters' : 'Your password'}
                />
                <button
                  type="button"
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  aria-pressed={reveal}
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <div className={`auth-reveal ${signingUp && password ? 'is-open' : ''}`}>
              <div>
                <div className="auth-strength" data-score={strength}>
                  <span className="auth-strength-bars" aria-hidden>
                    {[1, 2, 3, 4].map((bar) => (
                      <i key={bar} className={bar <= strength ? 'is-on' : ''} />
                    ))}
                  </span>
                  <span>{STRENGTH[strength]}</span>
                </div>
              </div>
            </div>

            <p
              id={ids.error}
              key={attempt}
              className={`auth-error ${error ? 'is-shown' : ''}`}
              role="alert"
            >
              {error?.message}
            </p>

            <button className="auth-submit" disabled={state !== 'idle'} data-state={state}>
              <span className="auth-submit-label">
                {state === 'done' ? (
                  <>
                    <Check size={17} /> {signingUp ? 'Account created' : 'Signed in'}
                  </>
                ) : state === 'busy' ? (
                  <>
                    <LoaderCircle size={17} className="spin" />
                    {signingUp ? 'Creating your account…' : 'Logging in…'}
                  </>
                ) : (
                  <>
                    {signingUp ? 'Create account' : 'Log in'} <ArrowRight size={16} />
                  </>
                )}
              </span>
            </button>
          </form>

          {signup ? (
            <p className="auth-alt">
              {signingUp ? 'Already have an account?' : 'New to Opsis?'}{' '}
              <button type="button" onClick={() => switchTo(signingUp ? 'login' : 'signup')}>
                {signingUp ? 'Log in' : 'Create an account'}
              </button>
            </p>
          ) : (
            <p className="auth-alt">
              New here? Ask the person who runs this Opsis server for an account.
            </p>
          )}
        </div>
        <p className="auth-footnote">
          <Lock size={12} /> Passwords are stored as salted hashes on your Opsis server.
        </p>
      </main>
    </div>
  );
}
