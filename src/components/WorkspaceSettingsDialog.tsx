import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Globe, Loader2, Lock, Trash2, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { LIMITS, type WorkspaceDetail } from '../contracts';
import { CoverPicker } from './CoverPicker';
import { api } from '../document/instance';
import { useUi } from '../shell/uiStore';
import { useWorkspaceStore } from '../workspace/workspaceStore';

const FIELD = 'w-full h-9 px-3 rounded-lg border border-line bg-canvas text-[13.5px] text-ink placeholder:text-muted focus:outline-none focus:border-primary disabled:opacity-60';
const BUTTON = 'h-9 px-3.5 rounded-lg text-[13px] font-medium bg-inverse text-on-inverse hover:opacity-90 disabled:opacity-40';
const GHOST = 'h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line text-ink hover:bg-canvas disabled:opacity-40';

const say = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');

type Tab = 'general' | 'people';

/** The link that opens this workspace for anyone who can see it. */
export const workspaceLink = (id: string): string => `${window.location.origin}/?workspace=${id}`;

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode; danger?: boolean }> = ({ title, hint, children, danger }) => (
  <section className={`py-4 border-b border-line last:border-0 ${danger ? 'text-ink' : ''}`}>
    <h3 className={`text-[13.5px] font-semibold ${danger ? 'text-danger' : 'text-ink'}`}>{title}</h3>
    {hint && <p className="text-[12.5px] text-muted mt-0.5">{hint}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

const General: React.FC<{ detail: WorkspaceDetail; onChange: (d: WorkspaceDetail) => void; onDeleted: () => void }> = ({ detail, onChange, onDeleted }) => {
  const owner = detail.role === 'OWNER';
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async (patch: Parameters<typeof api.updateWorkspace>[1], done: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const next = await api.updateWorkspace(detail.id, patch);
      onChange(next);
      setMessage({ ok: true, text: done });
    } catch (e) {
      setMessage({ ok: false, text: say(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setMessage(null);
    try {
      await api.deleteWorkspace(detail.id, confirm);
      onDeleted();
    } catch (e) {
      setMessage({ ok: false, text: say(e) });
      setDeleting(false);
    }
  };

  const dirty = name.trim() !== detail.name || description.trim() !== (detail.description ?? '');
  return (
    <>
      <Section title="Details">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name: name.trim(), description: description.trim() || null }, 'Saved.');
          }}
        >
          <input className={FIELD} value={name} maxLength={LIMITS.maxWorkspaceNameLength} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" disabled={!owner} />
          <textarea
            className={`${FIELD} h-20 py-2 resize-none`}
            value={description}
            maxLength={LIMITS.maxWorkspaceDescriptionLength}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this workspace for?"
            aria-label="Description"
            disabled={!owner}
          />
          {owner && (
            <button className={BUTTON} disabled={saving || !dirty || !name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </form>
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`mt-2 text-[12.5px] ${message.ok ? 'text-body' : 'text-danger'}`}>
            {message.text}
          </p>
        )}
      </Section>

      <Section title="Cover" hint="Shown on the dashboard card and the top of the workspace page.">
        <CoverPicker value={detail.cover} onChange={(cover) => void save({ cover }, 'Cover saved.')} disabled={!owner || saving} />
      </Section>

      <Section title="Who can see it" hint="People you add below can always open it. This decides what everyone else sees.">
        <div role="radiogroup" aria-label="Visibility" className="grid sm:grid-cols-2 gap-2">
          {(
            [
              ['PRIVATE', 'Private', 'Only the people you add.', <Lock key="l" className="w-4 h-4" />],
              ['PUBLIC', 'Anyone with the link', 'Signed-in people with the link can look, not change.', <Globe key="g" className="w-4 h-4" />],
            ] as const
          ).map(([value, title, hint, icon]) => (
            <button
              key={value}
              role="radio"
              aria-checked={detail.visibility === value}
              disabled={!owner || saving}
              onClick={() => detail.visibility !== value && void save({ visibility: value }, value === 'PUBLIC' ? 'Anyone with the link can now look.' : 'Now private.')}
              className={`text-left p-3 rounded-lg border ${detail.visibility === value ? 'border-primary bg-canvas' : 'border-line hover:bg-canvas'} disabled:opacity-60`}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                {icon}
                {title}
              </span>
              <span className="block mt-0.5 text-[12px] text-muted">{hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input readOnly value={workspaceLink(detail.id)} aria-label="Link to this workspace" onFocus={(e) => e.currentTarget.select()} className={`${FIELD} font-mono text-[12px]`} />
          <button
            className={GHOST}
            onClick={() => {
              void navigator.clipboard?.writeText(workspaceLink(detail.id)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <span className="flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </span>
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">{detail.visibility === 'PUBLIC' ? 'Everyone who signs in and opens this link can look at the diagrams.' : 'Only people you add can open this link.'}</p>
      </Section>

      {owner && !detail.personal && (
        <Section title="Delete this workspace" hint="Its diagrams are removed with it. Type the workspace name to confirm." danger>
          <div className="flex gap-2">
            <input className={FIELD} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={detail.name} aria-label="Type the workspace name to delete it" />
            <button
              onClick={() => void remove()}
              disabled={deleting || confirm.trim() !== detail.name}
              className="h-9 px-3.5 rounded-lg text-[13px] font-medium bg-danger text-white hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
            </button>
          </div>
        </Section>
      )}
      {detail.personal && <p className="py-4 text-[12.5px] text-muted">Your personal workspace cannot be deleted.</p>}
    </>
  );
};

const People: React.FC<{ detail: WorkspaceDetail; onChange: () => Promise<void>; onLeft: () => void; meId: string | undefined }> = ({ detail, onChange, onLeft, meId }) => {
  const owner = detail.role === 'OWNER';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      await onChange();
      if (text) setMessage({ ok: true, text });
    } catch (e) {
      setMessage({ ok: false, text: say(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {owner && (
        <Section title="Add people" hint="Use the email they sign in with. If they have no account yet, they join as soon as they sign up with that address.">
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api.addMember(detail.id, { email, role });
                setEmail('');
                return result.status === 'ADDED' ? 'Added. They can open it now.' : 'Invited. They will see this workspace when they sign in. Send them the link from the General tab.';
              });
            }}
          >
            <input className={FIELD} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-label="Email address" />
            <select value={role} onChange={(e) => setRole(e.target.value as 'EDITOR' | 'VIEWER')} aria-label="Role" className="h-9 px-2 rounded-lg border border-line bg-canvas text-[13px] text-ink">
              <option value="EDITOR">Can edit</option>
              <option value="VIEWER">Can view</option>
            </select>
            <button className={BUTTON} disabled={busy || !email.trim()}>
              Add
            </button>
          </form>
        </Section>
      )}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`pt-3 text-[12.5px] ${message.ok ? 'text-body' : 'text-danger'}`}>
          {message.text}
        </p>
      )}

      <Section title={`People (${detail.members.length})`}>
        <ul className="divide-y divide-line">
          {detail.members.map((m) => {
            const you = m.userId === meId;
            return (
              <li key={m.userId} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink truncate">
                    {m.displayName || m.email || 'Someone'} {you && <span className="text-muted font-normal">(you)</span>}
                  </div>
                  {m.displayName && m.email && <div className="text-[12px] text-muted truncate">{m.email}</div>}
                </div>
                {m.role === 'OWNER' || !owner ? (
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{m.role.toLowerCase()}</span>
                ) : (
                  <select
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => void run(() => api.changeMemberRole(detail.id, m.userId, e.target.value as 'EDITOR' | 'VIEWER').then(() => undefined))}
                    aria-label={`Role of ${m.email ?? 'member'}`}
                    className="h-8 px-2 rounded-lg border border-line bg-canvas text-[12.5px] text-ink"
                  >
                    <option value="EDITOR">Can edit</option>
                    <option value="VIEWER">Can view</option>
                  </select>
                )}
                {m.role !== 'OWNER' && (owner || you) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.removeMember(detail.id, m.userId);
                        if (you) onLeft();
                      })
                    }
                    className="text-[12.5px] text-body hover:text-danger px-2 py-1 rounded-lg hover:bg-canvas disabled:opacity-40"
                  >
                    {you ? 'Leave' : 'Remove'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {detail.invites.length > 0 && (
          <>
            <h4 className="mt-4 mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Invited, not signed in yet</h4>
            <ul className="divide-y divide-line">
              {detail.invites.map((i) => (
                <li key={i.email} className="py-2.5 flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-[13.5px] text-ink">{i.email}</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{i.role.toLowerCase()}</span>
                  <button disabled={busy} onClick={() => void run(() => api.removeInvite(detail.id, i.email).then(() => undefined))} className="text-[12.5px] text-body hover:text-danger px-2 py-1 rounded-lg hover:bg-canvas">
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
};

/** Settings of one workspace: its name, who can see it, who is in it, and deleting it. Opened from the dashboard or the workspace menu. */
export const WorkspaceSettingsDialog: React.FC = () => {
  const id = useUi((s) => s.workspaceSettingsId);
  const meId = useWorkspaceStore((s) => s.user?.id);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  const close = useCallback(() => useUi.getState().set({ workspaceSettingsId: null }), []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.workspace(id);
      setDetail(d);
      useWorkspaceStore.getState().workspaceChanged(d);
      setError(null);
    } catch (e) {
      setError(say(e));
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setTab('general');
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, close]);

  if (!id) return null;
  const gonePage = () => {
    close();
    void useWorkspaceStore.getState().workspaceGone(id);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="ws-settings-title" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-xl h-[min(600px,90vh)] rounded-xl bg-surface border border-line shadow-lg text-ink flex flex-col overflow-hidden select-text">
        <div className="flex items-center gap-3 px-5 pt-4 pb-0 flex-shrink-0">
          <h2 id="ws-settings-title" className="text-[16px] font-semibold truncate flex-1">
            {detail ? `${detail.name} settings` : 'Workspace settings'}
          </h2>
          <button onClick={close} aria-label="Close settings" className="p-1 rounded text-muted hover:text-ink hover:bg-canvas">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div role="tablist" className="flex gap-1 px-4 pt-3 border-b border-line flex-shrink-0">
          {(['general', 'people'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-2 text-[13px] -mb-px border-b-2 ${tab === t ? 'border-primary text-ink font-medium' : 'border-transparent text-body hover:text-ink'}`}>
              {t === 'general' ? 'General' : 'People'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {error && <p className="py-4 text-[13px] text-danger">{error}</p>}
          {!detail && !error && (
            <div className="py-10 flex justify-center text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {detail && tab === 'general' && <General key={detail.id} detail={detail} onChange={(d) => { setDetail(d); useWorkspaceStore.getState().workspaceChanged(d); }} onDeleted={gonePage} />}
          {detail && tab === 'people' && <People detail={detail} onChange={load} onLeft={gonePage} meId={meId} />}
        </div>
      </div>
    </div>
  );
};

