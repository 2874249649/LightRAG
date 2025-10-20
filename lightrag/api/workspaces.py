from __future__ import annotations

import contextvars
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)


_current_workspace: contextvars.ContextVar["WorkspaceContext | None"] = (
    contextvars.ContextVar("lightrag_current_workspace", default=None)
)


@dataclass
class WorkspaceConfig:
    """Static configuration for a workspace."""

    id: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    enabled: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkspaceContext:
    """Runtime objects associated with a workspace."""

    config: WorkspaceConfig
    rag: Any  # LightRAG instance
    document_manager: Any  # DocumentManager instance
    initialized: bool = False
    error: Optional[str] = None

    @property
    def id(self) -> str:  # Convenience accessor
        return self.config.id

    def as_dict(self) -> Dict[str, Any]:
        """Serialize minimal workspace metadata for API responses."""
        return {
            "id": self.config.id,
            "display_name": self.config.display_name or self.config.id,
            "description": self.config.description,
            "enabled": self.config.enabled and self.error is None,
            "error": self.error,
            "metadata": self.config.metadata,
        }


class WorkspaceRegistry:
    """In-memory registry for workspace contexts."""

    def __init__(self) -> None:
        self._contexts: Dict[str, WorkspaceContext] = {}

    def register(self, ctx: WorkspaceContext) -> None:
        if ctx.id in self._contexts:
            logger.warning("Workspace %s already registered, overriding", ctx.id)
        self._contexts[ctx.id] = ctx
        logger.info("Registered workspace: %s", ctx.id)

    def get(self, workspace_id: str) -> Optional[WorkspaceContext]:
        return self._contexts.get(workspace_id)

    def list(self) -> List[WorkspaceContext]:
        return list(self._contexts.values())

    def dependency(self):
        """Return a FastAPI dependency that sets the current workspace context."""

        async def _apply(workspace_id: str):
            ctx = self.get(workspace_id)
            if ctx is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Workspace '{workspace_id}' not found",
                )
            if not ctx.config.enabled or ctx.error:
                raise HTTPException(
                    status_code=404,
                    detail=ctx.error
                    or f"Workspace '{workspace_id}' is disabled",
                )
            token = _current_workspace.set(ctx)
            try:
                yield ctx
            finally:
                _current_workspace.reset(token)

        return _apply

    async def shutdown_all(self) -> None:
        """Call finalize_storages for all initialized workspaces."""
        for ctx in self.list():
            if ctx.initialized:
                try:
                    await ctx.rag.finalize_storages()
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "Failed to finalize workspace %s: %s", ctx.id, exc, exc_info=True
                    )


def get_current_workspace() -> WorkspaceContext:
    ctx = _current_workspace.get(None)
    if ctx is None:
        raise RuntimeError("Workspace context not found in the current request scope")
    return ctx


def _parse_workspace_ids(raw_ids: str) -> Iterable[str]:
    for item in raw_ids.split(","):
        workspace_id = item.strip()
        if workspace_id:
            yield workspace_id


def load_workspace_configs(args) -> List[WorkspaceConfig]:
    """
    Derive workspace configurations from environment variables.

    Priority:
        1. WORKSPACES environment variable (comma-separated ids)
        2. Fallback to args.workspace / WORKSPACE env / 'default'
    """
    configs: List[WorkspaceConfig] = []

    env_value = os.getenv("WORKSPACES")
    if env_value:
        configs = [
            WorkspaceConfig(id=workspace_id)
            for workspace_id in _parse_workspace_ids(env_value)
        ]
        if not configs:
            logger.warning(
                "WORKSPACES is set but no valid workspace ids were parsed: %s",
                env_value,
            )

    if not configs:
        fallback = args.workspace or os.getenv("WORKSPACE", "")
        workspace_id = fallback.strip() or "default"
        configs = [WorkspaceConfig(id=workspace_id)]

    # Ensure unique ids
    seen = set()
    unique_configs: List[WorkspaceConfig] = []
    for cfg in configs:
        if cfg.id in seen:
            logger.warning("Duplicate workspace id detected: %s", cfg.id)
            continue
        seen.add(cfg.id)
        unique_configs.append(cfg)

    return unique_configs
