/**
 * lib/projectPermissions.ts — Server-side project access helpers.
 *
 * All functions take server-derived IDs (never client-supplied).
 * Import only in Route Handlers / Server Actions — never in client components.
 */

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Project from '@/models/Project'
import ProjectMembership from '@/models/ProjectMembership'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectRole =
  | 'owner'           // project creator
  | 'member'          // accepted collaborator
  | 'none'            // no relationship

export interface ProjectAccessResult {
  role: ProjectRole
  /** The raw project document (lean) if found */
  project: {
    _id: mongoose.Types.ObjectId
    userId: mongoose.Types.ObjectId
    lifeFlowId: string
    title: string
    description?: string
    status: string
    dueDate?: string
    color?: string
    collaborationEnabled: boolean
    serverRevision: number
  } | null
}

// ─── Core access resolver ─────────────────────────────────────────────────────

/**
 * Resolve the calling user's role on a project.
 *
 * Returns:
 *   role='owner'  — caller is the project owner
 *   role='member' — caller is an accepted collaborator
 *   role='none'   — caller has no access
 *   project=null  — project does not exist
 *
 * NEVER trust a role supplied by the client — always call this and use the
 * returned role for authorization decisions.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccessResult> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return { role: 'none', project: null }
  }

  await connectDB()

  const project = await Project.findById(projectId).lean<{
    _id: mongoose.Types.ObjectId
    userId: mongoose.Types.ObjectId
    lifeFlowId: string
    title: string
    description?: string
    status: string
    dueDate?: string
    color?: string
    collaborationEnabled: boolean
    serverRevision: number
  }>()

  if (!project) return { role: 'none', project: null }

  // Owner check
  if (project.userId.toString() === userId) {
    return { role: 'owner', project }
  }

  // Member check (accepted membership)
  const membership = await ProjectMembership.findOne({
    projectId: project._id,
    userId,
  }).lean()

  if (membership) return { role: 'member', project }

  return { role: 'none', project }
}

// ─── Guard helpers ────────────────────────────────────────────────────────────

/** Returns true only for project owners */
export function isOwner(role: ProjectRole): boolean {
  return role === 'owner'
}

/** Returns true for any accepted participant (owner or member) */
export function isMember(role: ProjectRole): boolean {
  return role === 'owner' || role === 'member'
}

/**
 * Require that collaboration is enabled on a project.
 * Returns false when role='none' even if collaborationEnabled=true
 * (prevents leaking collaboration status to non-members).
 */
export function canAccessCollaboration(
  role: ProjectRole,
  collaborationEnabled: boolean,
): boolean {
  if (role === 'none') return false
  if (role === 'owner') return true          // owner always has access
  return collaborationEnabled                // member needs feature enabled
}
