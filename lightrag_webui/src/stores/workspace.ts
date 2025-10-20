import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSelectors, errorMessage } from '@/lib/utils'
import { getWorkspaces as fetchWorkspacesApi } from '@/api/lightrag'

declare global {
  interface Window {
    __LIGHTRAG_CURRENT_WORKSPACE__?: string | null
  }
}

export type WorkspaceInfo = {
  id: string
  displayName: string
  description?: string | null
  enabled: boolean
  error?: string | null
  pipelineBusy?: boolean | null
  metadata?: Record<string, unknown> | null
}

type FetchOptions = {
  refresh?: boolean
}

interface WorkspaceState {
  workspaces: WorkspaceInfo[]
  currentWorkspace: string | null
  loading: boolean
  error: string | null
  fetchWorkspaces: (options?: FetchOptions) => Promise<WorkspaceInfo[]>
  setWorkspace: (workspaceId: string | null) => void
  resetCurrentWorkspace: () => void
  updateWorkspaceStatus: (workspaceId: string, partial: Partial<WorkspaceInfo>) => void
  hydrateFromHealth: (workspaces: any[] | undefined) => void
}

const normalizeWorkspace = (input: any): WorkspaceInfo => ({
  id: input?.id ?? '',
  displayName: input?.display_name ?? input?.id ?? '',
  description: input?.description ?? null,
  enabled: Boolean(input?.enabled ?? true),
  error: input?.error ?? null,
  pipelineBusy:
    typeof input?.pipeline_busy === 'boolean' ? input.pipeline_busy : null,
  metadata: input?.metadata ?? null
})

const ensureWorkspaceSelection = (
  workspaces: WorkspaceInfo[],
  preferredId: string | null
): string | null => {
  if (preferredId) {
    const candidate = workspaces.find(
      (ws) => ws.id === preferredId && ws.enabled && !ws.error
    )
    if (candidate) {
      return candidate.id
    }
  }

  const firstAvailable = workspaces.find(
    (ws) => ws.enabled && !ws.error
  )
  return firstAvailable ? firstAvailable.id : null
}

const syncWorkspaceId = (workspaceId: string | null) => {
  if (typeof window !== 'undefined') {
    window.__LIGHTRAG_CURRENT_WORKSPACE__ = workspaceId
  }
}

const useWorkspaceStoreBase = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,
      loading: false,
      error: null,

      fetchWorkspaces: async (options?: FetchOptions) => {
        set({ loading: true, error: null })
        try {
          const response = await fetchWorkspacesApi(options)
          const normalized = response.map(normalizeWorkspace).sort((a, b) => a.displayName.localeCompare(b.displayName))
          const current = ensureWorkspaceSelection(
            normalized,
            get().currentWorkspace
          )
          set({
            workspaces: normalized,
            currentWorkspace: current,
            loading: false,
            error: null
          })
          syncWorkspaceId(current)
          return normalized
        } catch (err) {
          set({
            loading: false,
            error: errorMessage(err)
          })
          throw err
        }
      },

      setWorkspace: (workspaceId: string | null) => {
        if (workspaceId === null) {
          set({ currentWorkspace: null })
          syncWorkspaceId(null)
          return
        }

        const { workspaces } = get()
        const target = workspaces.find((ws) => ws.id === workspaceId)
        if (!target) {
          set({ error: `Workspace '${workspaceId}' not found` })
          return
        }
        if (!target.enabled || target.error) {
          set({
            error: target.error ?? `Workspace '${workspaceId}' is disabled`
          })
          return
        }
        set({ currentWorkspace: workspaceId, error: null })
        syncWorkspaceId(workspaceId)
      },

      resetCurrentWorkspace: () => {
        set({ currentWorkspace: null })
        syncWorkspaceId(null)
      },

      updateWorkspaceStatus: (
        workspaceId: string,
        partial: Partial<WorkspaceInfo>
      ) => {
        set((state) => ({
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, ...partial }
              : workspace
          )
        }))
      },

      hydrateFromHealth: (workspaces) => {
        if (!Array.isArray(workspaces)) {
          return
        }

        const normalized = workspaces.map(normalizeWorkspace)
        set((state) => {
          const currentMap = new Map(state.workspaces.map((ws) => [ws.id, ws]))
          normalized.forEach((ws) => {
            const existing = currentMap.get(ws.id)
            currentMap.set(ws.id, existing ? { ...existing, ...ws } : ws)
          })

          const merged = Array.from(currentMap.values()).sort((a, b) =>
            a.displayName.localeCompare(b.displayName)
          )

          const current = ensureWorkspaceSelection(
            merged,
            state.currentWorkspace
          )

          syncWorkspaceId(current)

          return {
            workspaces: merged,
            currentWorkspace: current
          }
        })
      }
    }),
    {
      name: 'lightrag-workspaces',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentWorkspace: state.currentWorkspace
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          syncWorkspaceId(state.currentWorkspace ?? null)
        }
      }
    }
  )
)

const useWorkspaceStore = createSelectors(useWorkspaceStoreBase)

export { useWorkspaceStore }
