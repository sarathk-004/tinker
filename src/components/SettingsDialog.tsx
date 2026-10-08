import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Palette, Shield, SlidersHorizontal, Sun, User, X } from 'lucide-react';
import { changeEmail, changePassword, hasPasswordLogin, removeAvatar, signOutOtherSessions, updateDisplayName, uploadAvatar, MAX_NAME_LENGTH } from '../auth/account';
import { useAuthStore } from '../auth/auth';
import { passwordRules } from '../auth/passwordPolicy';
import { useTheme, type ThemeChoice } from '../theme/theme';
import { useSpeechSettings, type ReplyVoice } from '../voice/speech';
import { useSound } from '../sound/uiSound';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { Avatar } from '../shell/TopBar';
import { useUi } from '../shell/uiStore';

type Section = 'profile' | 'security' | 'appearance' | 'preferences';
const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal className="w-4 h-4" /> },
];

const FIELD = 'w-full h-9 px-3 rounded-lg border border-line bg-canvas text-[13.5px] text-ink placeholder:text-muted focus:outline-none focus:border-primary';
const BUTTON = 'h-9 px-3.5 rounded-lg text-[13px] font-medium bg-inverse text-on-inverse hover:opacity-90 disabled:opacity-40';
const GHOST = 'h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line text-ink hover:bg-canvas disabled:opacity-40';

type Result = { ok: boolean; text: string } | null;
const Note: React.FC<{ result: Result }> = ({ result }) =>
  result ? (
    <p role={result.ok ? 'status' : 'alert'} className={`text-[12.5px] ${result.ok ? 'text-body' : 'text-danger'}`}>
      {result.text}
    </p>
  ) : null;

/** Run an account change, showing its outcome in plain words. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await fn() });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

const Row: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="py-4 border-b border-line last:border-0">
    <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
    {hint && <p className="text-[12.5px] text-muted mt-0.5 mb-3">{hint}</p>}
    <div className={hint ? '' : 'mt-3'}>{children}</div>
  </section>
);

const Profile: React.FC<{ readOnly: boolean }> = ({ readOnly }) => {
  const user = useWorkspaceStore((s) => s.user);
  const email = useAuthStore((s) => s.email);
  const [name, setName] = useState(user?.displayName ?? '');
  const nameAction = useAction();
  const picture = useAction();
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Row title="Profile picture" hint="A PNG, JPEG or WebP picture. It is cropped to a square and shrunk before it is saved.">
        <div className="flex items-center gap-4">
          <Avatar size={64} />
          <div className="flex gap-2">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = '';
                if (chosen) void picture.run(async () => (await uploadAvatar(chosen), 'Picture saved.'));
              }}
            />
            <button className={GHOST} disabled={readOnly || picture.busy} onClick={() => file.current?.click()}>
              Upload
            </button>
            {user?.avatarUpdatedAt && (
              <button className={GHOST} disabled={readOnly || picture.busy} onClick={() => void picture.run(async () => (await removeAvatar(), 'Picture removed.'))}>
                Remove
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <Note result={picture.result} />
        </div>
      </Row>
      <Row title="Name" hint="Shown to you in the app and, later, to people you share with.">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void nameAction.run(async () => (await updateDisplayName(name), 'Name saved.'));
          }}
        >
          <input className={FIELD} value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Name" disabled={readOnly} />
          <button className={BUTTON} disabled={readOnly || nameAction.busy || !name.trim() || name.trim() === (user?.displayName ?? '')}>
            Save
          </button>
        </form>
        <div className="mt-2">
          <Note result={nameAction.result} />
        </div>
      </Row>
      <Row title="Email" hint="The address you sign in with.">
        <div className="text-[13.5px] text-ink">{email ?? 'Not available'}</div>
        {readOnly && <p className="text-[12.5px] text-muted mt-2">Profile changes are turned off in local development sign-in.</p>}
      </Row>
    </>
  );
};

const Security: React.FC<{ readOnly: boolean }> = ({ readOnly }) => {
  const [password, setPassword] = useState<boolean | null>(null);
  useEffect(() => {
    void hasPasswordLogin().then(setPassword, () => setPassword(false));
  }, []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const pw = useAction();
  const em = useAction();
  const others = useAction();
  const rules = passwordRules(next);

  if (readOnly) return <p className="py-4 text-[13px] text-muted">Security settings are turned off in local development sign-in.</p>;
  return (
    <>
      {password === false && <p className="py-4 text-[13px] text-body border-b border-line">You sign in with Google, so there is no password or email to change here. Manage them in your Google account.</p>}
      {password && (
        <>
          <Row title="Change password" hint="You will be asked for your current password first.">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void pw.run(async () => {
                  await changePassword(current, next);
                  setCurrent('');
                  setNext('');
                  return 'Password changed.';
                });
              }}
            >
              <input className={FIELD} type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <input className={FIELD} type="password" autoComplete="new-password" placeholder="New password" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
              {next && (
                <ul className="text-[12px] grid grid-cols-2 gap-x-3">
                  {rules.map((r) => (
                    <li key={r.id} className={r.ok ? 'text-body' : 'text-muted'}>
                      {r.ok ? '✓' : '•'} {r.label}
                    </li>
                  ))}
                </ul>
              )}
              <button className={BUTTON} disabled={pw.busy || !current || !next}>
                Change password
              </button>
              <Note result={pw.result} />
            </form>
          </Row>
          <Row title="Change email" hint="We send a confirmation link to the new address. Your email only changes after you follow it.">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void em.run(async () => {
                  const to = await changeEmail(emailPassword, newEmail);
                  setEmailPassword('');
                  return `Check ${to} for a confirmation link.`;
                });
              }}
            >
              <input className={FIELD} type="email" autoComplete="email" placeholder="New email address" aria-label="New email address" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <input className={FIELD} type="password" autoComplete="current-password" placeholder="Current password" aria-label="Password to confirm email change" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
              <button className={BUTTON} disabled={em.busy || !newEmail || !emailPassword}>
                Send confirmation
              </button>
              <Note result={em.result} />
            </form>
          </Row>
        </>
      )}
      <Row title="Other devices" hint="Sign out everywhere except this device, for example if you used a shared computer.">
        <button className={GHOST} disabled={others.busy} onClick={() => void others.run(async () => (await signOutOtherSessions(), 'Signed out of your other devices.'))}>
          Sign out other devices
        </button>
        <div className="mt-2">
          <Note result={others.result} />
        </div>
      </Row>
    </>
  );
};

const THEMES: Array<{ id: ThemeChoice; label: string; icon: React.ReactNode }> = [
  { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
  { id: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
  { id: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
];

const Appearance: React.FC = () => {
  const choice = useTheme((s) => s.choice);
  const setChoice = useTheme((s) => s.setChoice);
  return (
    <Row title="Theme" hint="System follows the light or dark setting of your device. Exported pictures always match what you see.">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={choice === t.id}
            onClick={() => setChoice(t.id)}
            className={`h-16 rounded-lg border text-[13px] flex flex-col items-center justify-center gap-1.5 ${choice === t.id ? 'border-primary bg-canvas text-ink font-medium' : 'border-line text-body hover:bg-canvas'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
    </Row>
  );
};

const VOICES: Array<{ id: ReplyVoice | 'auto'; label: string }> = [
  { id: 'auto', label: 'Automatic (best available voice)' },
  { id: 'browser', label: 'The voice built into this device' },
  { id: 'off', label: 'Off (replies are not read aloud)' },
];

const Preferences: React.FC = () => {
  const saved = useSpeechSettings((s) => s.saved);
  const choose = useSpeechSettings((s) => s.choose);
  const sounds = useSound((s) => s.enabled);
  const setSounds = useSound((s) => s.setEnabled);
  const current = saved === 'browser' || saved === 'off' ? saved : 'auto';
  return (
    <>
    <Row title="Interface sounds" hint="Soft taps and tones as you work: a pop when something is added, a thump when it goes, a tick when a component lines up.">
      <label className="flex items-center gap-2.5 text-[13.5px] text-ink cursor-pointer">
        <input type="checkbox" checked={sounds} onChange={(e) => setSounds(e.target.checked)} />
        Play interface sounds
      </label>
    </Row>
    <Row title="Spoken replies" hint="How tinker reads its answers aloud when you ask it to.">
      <div className="space-y-1.5" role="radiogroup" aria-label="Spoken replies">
        {VOICES.map((v) => (
          <label key={v.id} className="flex items-center gap-2.5 text-[13.5px] text-ink cursor-pointer">
            <input type="radio" name="voice" checked={current === v.id} onChange={() => choose(v.id === 'auto' ? null : v.id)} />
            {v.label}
          </label>
        ))}
      </div>
    </Row>
    </>
  );
};

/** Settings: profile, security, appearance and preferences. */
export const SettingsDialog: React.FC = () => {
  const open = useUi((s) => s.settingsOpen);
  const [section, setSection] = useState<Section>('profile');
  const readOnly = useAuthStore((s) => s.mode) !== 'supabase';
  const close = () => useUi.getState().set({ settingsOpen: false });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useUi.getState().set({ settingsOpen: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-2xl h-[min(560px,90vh)] rounded-xl bg-surface border border-line shadow-lg text-ink flex flex-col sm:flex-row overflow-hidden select-text">
        <nav className="sm:w-48 flex-shrink-0 flex sm:flex-col gap-1 p-2 sm:p-3 border-b sm:border-b-0 sm:border-r border-line overflow-x-auto" aria-label="Settings sections">
          <h2 id="settings-title" className="hidden sm:block px-2.5 pb-2 text-[15px] font-semibold">
            Settings
          </h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] whitespace-nowrap text-left ${section === s.id ? 'bg-canvas text-ink font-medium' : 'text-body hover:bg-canvas'}`}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-2 relative">
          <button onClick={close} aria-label="Close settings" className="absolute right-3 top-3 p-1 rounded text-muted hover:text-ink hover:bg-canvas">
            <X className="w-4 h-4" />
          </button>
          {section === 'profile' && <Profile readOnly={readOnly} />}
          {section === 'security' && <Security readOnly={readOnly} />}
          {section === 'appearance' && <Appearance />}
          {section === 'preferences' && <Preferences />}
        </div>
      </div>
    </div>
  );
};
