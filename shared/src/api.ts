import { z } from 'zod';
import { aiKeyModeSchema, aiKeySourceSchema } from './ai-key.ts';
import { LIMITS } from './limits.ts';
import { graphSchema, uuidSchema } from './graph.ts';
import {
  findPresentationIntegrityIssues,
  layoutDirectionSchema,
  nodePositionsSchema,
  noteSchema,
  presentationSchema,
  viewportSchema,
} from './presentation.ts';
import { COMMAND_TYPES, versionSchema } from './commands.ts';

export const diagramNameSchema = z.string().trim().min(1).max(LIMITS.maxDiagramNameLength);

/** Complete canonical document returned by durable mutations (D05). */
export const diagramDocumentSchema = z
  .strictObject({
    diagramId: uuidSchema,
    version: versionSchema,
    graph: graphSchema,
    presentation: presentationSchema,
  })
  .superRefine((doc, ctx) => {
    for (const issue of findPresentationIntegrityIssues(doc.graph, doc.presentation)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['presentation', ...issue.path] });
    }
  });
export type DiagramDocument = z.infer<typeof diagramDocumentSchema>;

/** A diagram icon: a name from the app's icon list and a colour, joined by a dot ("Rocket.violet"). The list lives in the web app. */
export const diagramIconSchema = z.string().regex(/^[A-Za-z0-9]{2,32}\.[a-z]{3,12}$/, 'not an icon');
export const setDiagramIconRequestSchema = z.strictObject({ icon: diagramIconSchema.nullable() });

export const diagramSummarySchema = z.strictObject({
  id: uuidSchema,
  workspaceId: uuidSchema,
  projectId: uuidSchema,
  icon: diagramIconSchema.nullable(),
  name: diagramNameSchema,
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DiagramSummary = z.infer<typeof diagramSummarySchema>;

/** `projectId` omitted: the workspace's first project. */
export const createDiagramRequestSchema = z.strictObject({ name: diagramNameSchema, projectId: uuidSchema.optional() });
export const moveDiagramRequestSchema = z.strictObject({ projectId: uuidSchema });
export const renameDiagramRequestSchema = z.strictObject({ expectedVersion: versionSchema, name: diagramNameSchema });

/** PATCH /v1/diagrams/{id}/presentation: provided positions merge by node id; absent entries are unchanged. */
export const presentationPatchRequestSchema = z
  .strictObject({
    expectedVersion: versionSchema,
    nodePositions: nodePositionsSchema.optional(),
    viewport: viewportSchema.optional(),
    /** Replaces ALL notes (the list is small and edited as a whole). */
    notes: z.array(noteSchema).max(LIMITS.maxNotes).optional(),
    layoutDir: layoutDirectionSchema.optional(),
    /** Replaces the remembered arrangements. */
    layouts: presentationSchema.shape.layouts,
  })
  .refine((p) => p.nodePositions !== undefined || p.viewport !== undefined || p.notes !== undefined || p.layoutDir !== undefined || p.layouts !== undefined, {
    message: 'provide nodePositions, viewport, notes, layoutDir or layouts',
  });
export type PresentationPatchRequest = z.infer<typeof presentationPatchRequestSchema>;

export const commandResponseSchema = z.strictObject({
  diagramId: uuidSchema,
  version: versionSchema,
  appliedCommand: z.strictObject({ type: z.enum(COMMAND_TYPES) }),
  graph: graphSchema,
  presentation: presentationSchema,
  /** True when this is a stored replay of an earlier identical request (D01). */
  replayed: z.boolean().optional(),
});
export type CommandResponse = z.infer<typeof commandResponseSchema>;

export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('tinker-api'),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const workspaceRoleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** The covers a project can have: the drawing of its latest diagram, or one of the dithered covers the app draws itself. */
export const PROJECT_COVERS = ['preview', 'dusk', 'ember', 'meadow', 'rose', 'ocean', 'sunrise', 'slate', 'mint'] as const;
export const projectCoverSchema = z.enum(PROJECT_COVERS);
export type ProjectCover = z.infer<typeof projectCoverSchema>;

export const workspaceVisibilitySchema = z.enum(['PRIVATE', 'PUBLIC']);
export type WorkspaceVisibility = z.infer<typeof workspaceVisibilitySchema>;

/** One workspace as the dashboard and the switcher show it. */
export const workspaceSummarySchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  role: workspaceRoleSchema,
  personal: z.boolean(),
  description: z.string().nullable(),
  /** PRIVATE: only members. PUBLIC: anyone signed in who has the link can look (read-only). */
  visibility: workspaceVisibilitySchema,
  diagramCount: z.number().int().min(0),
  memberCount: z.number().int().min(1),
  projectCount: z.number().int().min(0),
  /** null: automatic (a dithered cover picked from the workspace's id). */
  cover: projectCoverSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const workspaceMemberSchema = z.strictObject({ userId: uuidSchema, email: z.string().nullable(), displayName: z.string().nullable(), role: workspaceRoleSchema });
export const workspaceInviteSchema = z.strictObject({ email: z.string(), role: z.enum(['EDITOR', 'VIEWER']) });
/** GET /v1/workspaces/{id}: the summary plus who is in it. Non-members of a public workspace see no member list. */
export const workspaceDetailSchema = workspaceSummarySchema.extend({
  /** false: this person is only looking at a public workspace. */
  member: z.boolean(),
  members: z.array(workspaceMemberSchema),
  invites: z.array(workspaceInviteSchema),
});
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>;

/** PATCH /v1/workspaces/{id} (owner only). */
export const updateWorkspaceRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(LIMITS.maxWorkspaceNameLength).optional(),
    description: z.string().trim().max(LIMITS.maxWorkspaceDescriptionLength).nullable().optional(),
    visibility: workspaceVisibilitySchema.optional(),
    cover: projectCoverSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** DELETE /v1/workspaces/{id} (owner only): the name must be typed again, so a stray click cannot delete a workspace. */
export const deleteWorkspaceRequestSchema = z.strictObject({ confirmName: z.string() });

/** POST /v1/workspaces/{id}/members: add a person by email. Someone without an account yet is invited and joins when they sign in. */
export const addMemberRequestSchema = z.strictObject({ email: z.string().trim().toLowerCase().max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'not an email address'), role: z.enum(['EDITOR', 'VIEWER']) });
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;
export const deletedResponseSchema = z.strictObject({ deleted: z.literal(true) });
export const updatedResponseSchema = z.strictObject({ updated: z.literal(true) });
export const removedResponseSchema = z.strictObject({ removed: z.literal(true) });
export const addMemberResponseSchema = z.strictObject({ status: z.enum(['ADDED', 'INVITED']) });
export const changeMemberRoleRequestSchema = z.strictObject({ role: z.enum(['EDITOR', 'VIEWER']) });
export const removeInviteRequestSchema = z.strictObject({ email: z.string().trim().toLowerCase().max(320) });

/** A project groups related diagrams inside a workspace (workspace -> project -> diagram). */
export const projectSummarySchema = z.strictObject({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** null: automatic (the latest diagram's drawing, or a dithered cover when the project is empty). */
  cover: projectCoverSchema.nullable(),
  diagramCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  /** The diagram worked on most recently, with a tiny drawing of it. */
  latestDiagram: z
    .strictObject({
      id: uuidSchema,
      name: z.string(),
      preview: z.strictObject({ nodes: z.array(z.tuple([z.number(), z.number()])), edges: z.array(z.tuple([z.number().int(), z.number().int()])) }),
    })
    .nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export const projectListResponseSchema = z.strictObject({ projects: z.array(projectSummarySchema) });
export const createProjectRequestSchema = z.strictObject({ name: z.string().trim().min(1).max(LIMITS.maxProjectNameLength), description: z.string().trim().max(LIMITS.maxWorkspaceDescriptionLength).optional() });
export const updateProjectRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(LIMITS.maxProjectNameLength).optional(),
    description: z.string().trim().max(LIMITS.maxWorkspaceDescriptionLength).nullable().optional(),
    cover: projectCoverSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });

/** A diagram as a card: counts and a tiny drawing of its layout, with where it lives. */
export const diagramCardSchema = z.strictObject({
  id: uuidSchema,
  workspaceId: uuidSchema,
  projectId: uuidSchema,
  workspaceName: z.string(),
  projectName: z.string(),
  /** The cover chosen for the project this diagram is in (null: automatic). */
  projectCover: projectCoverSchema.nullable(),
  icon: diagramIconSchema.nullable(),
  name: z.string(),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  /** Up to 40 component positions and the connections between them (indexes into `nodes`), enough to draw a thumbnail. */
  preview: z.strictObject({ nodes: z.array(z.tuple([z.number(), z.number()])), edges: z.array(z.tuple([z.number().int(), z.number().int()])) }),
});
export type DiagramCard = z.infer<typeof diagramCardSchema>;
/** What is in all of a person's diagrams together: the dashboard's "at a glance". */
export const overviewSchema = z.strictObject({
  diagrams: z.number().int().min(0),
  components: z.number().int().min(0),
  connections: z.number().int().min(0),
  /** Components by kind, most first. */
  byKind: z.array(z.strictObject({ kind: z.string(), count: z.number().int().min(1) })),
  /** The components used most often. `key` is the icon key when the component has one (else its name). */
  topComponents: z.array(z.strictObject({ key: z.string(), label: z.string(), count: z.number().int().min(1) })),
  /** The diagram with the most components. */
  largest: z.strictObject({ id: uuidSchema, name: z.string(), components: z.number().int().min(0) }).nullable(),
});
export type Overview = z.infer<typeof overviewSchema>;

export const diagramCardsResponseSchema = z.strictObject({ diagrams: z.array(diagramCardSchema) });

/** POST /v1/workspaces: start a team workspace (the caller becomes its owner). */
export const createWorkspaceRequestSchema = z.strictObject({ name: z.string().trim().min(1).max(LIMITS.maxWorkspaceNameLength) });
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

const usageSchema = z.strictObject({ used: z.number().int().min(0), limit: z.number().int().min(0) });
/** The day's AI allowance (resets at `resetsAt`, midnight UTC). `ai` counts every request that needs the model; `voice` counts voice sessions. */
export const quotaSchema = z.strictObject({ resetsAt: z.iso.datetime(), ai: usageSchema, voice: usageSchema });
export type Quota = z.infer<typeof quotaSchema>;

/** PUT /v1/me/avatar: a small picture, base64 in JSON. The server checks the real bytes (PNG, JPEG or WebP, at most 256 KB and 1024 px a side). */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const putAvatarRequestSchema = z.strictObject({ contentType: z.enum(AVATAR_TYPES), data: z.string().min(8).max(360_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'not base64') });
export type PutAvatarRequest = z.infer<typeof putAvatarRequestSchema>;
export const avatarResponseSchema = z.strictObject({ contentType: z.enum(AVATAR_TYPES), data: z.string(), updatedAt: z.iso.datetime() });
export type AvatarResponse = z.infer<typeof avatarResponseSchema>;
export const deleteAvatarResponseSchema = z.strictObject({ deleted: z.literal(true) });

export const meResponseSchema = z.strictObject({
  user: z.strictObject({ id: uuidSchema, email: z.string().nullable(), displayName: z.string().nullable(), avatarUpdatedAt: z.iso.datetime().nullable() }),
  workspaces: z.array(workspaceSummarySchema),
  /** What this server can do right now; the UI enables features from this, never from guesses. */
  /**
   * aiCommands: typed commands are offered (the deterministic parser needs no model).
   * aiModel: a model is configured, so free-form requests can be interpreted; without it only plain commands work.
   * aiKey: whose model key this person's AI runs on (see ai-key.ts). voice: spoken requests are possible. speech: the server can synthesize spoken replies (otherwise the browser's own voice is used).
   */
  features: z.strictObject({ aiCommands: z.boolean(), aiModel: z.boolean(), voice: z.boolean(), speech: z.boolean(), aiKey: z.strictObject({ mode: aiKeyModeSchema, source: aiKeySourceSchema }) }),
  quota: quotaSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const workspacesResponseSchema = z.strictObject({ workspaces: z.array(workspaceSummarySchema) });

/** Newest first; capped (no pagination yet). */
export const diagramListResponseSchema = z.strictObject({ diagrams: z.array(diagramSummarySchema) });
export type DiagramListResponse = z.infer<typeof diagramListResponseSchema>;

/** Full diagram: metadata plus the canonical document. Returned by create, load, rename and presentation saves. */
export const diagramDetailSchema = z
  .strictObject({
    diagramId: uuidSchema,
    workspaceId: uuidSchema,
    projectId: uuidSchema,
    icon: diagramIconSchema.nullable(),
    name: diagramNameSchema,
    version: versionSchema,
    graph: graphSchema,
    presentation: presentationSchema,
    updatedAt: z.iso.datetime(),
    replayed: z.boolean().optional(),
  })
  .superRefine((doc, ctx) => {
    for (const issue of findPresentationIntegrityIssues(doc.graph, doc.presentation)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['presentation', ...issue.path] });
    }
  });
export type DiagramDetail = z.infer<typeof diagramDetailSchema>;

export const deleteDiagramResponseSchema = z.strictObject({
  diagramId: uuidSchema,
  version: versionSchema,
  deleted: z.literal(true),
  replayed: z.boolean().optional(),
});
export type DeleteDiagramResponse = z.infer<typeof deleteDiagramResponseSchema>;

/** DELETE /v1/diagrams/{id}?expectedVersion=n (deletion participates in the version counter, D05). */
export const expectedVersionQuerySchema = z.strictObject({ expectedVersion: z.coerce.number().int().min(1) });
