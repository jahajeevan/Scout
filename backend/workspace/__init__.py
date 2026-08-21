"""Workspace (spec §48) — the connected project Code mode operates inside.

A workspace is a single root directory the user connects. Every file/git tool
resolves its paths through ``service.resolve``, which refuses anything outside the
root — so Code mode can never read or write the wider Mac filesystem, only the
project the user opened. There is no "whole disk is the workspace" mode.
"""

from backend.workspace import service

__all__ = ["service"]
