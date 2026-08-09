from __future__ import annotations

import base64
import json
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from .projects_common import utc_now_iso
from .storage import read_json_object, safe_id, write_bytes_atomic, write_json_atomic


class PlaygroundRepository:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.playground_dir = root / "playground"
        self.playground_chats_dir = self.playground_dir / "chats"
        self.playground_index_file = self.playground_dir / "index.json"

    def list_playground_chats(self) -> dict[str, Any]:
        self.ensure_playground_root()
        chats: list[dict[str, Any]] = []
        for chat_file in self.playground_chats_dir.glob("*/chat.json"):
            try:
                chat = self.normalize_playground_chat(read_json_object(chat_file))
            except (OSError, json.JSONDecodeError, ValueError):
                continue
            chats.append(self.playground_chat_summary(chat))
        chats = sorted(chats, key=lambda item: item.get("updated_at", ""), reverse=True)
        index = self.read_playground_index()
        active_chat_id = index.get("active_chat_id")
        if active_chat_id and not any(item["id"] == active_chat_id for item in chats):
            active_chat_id = None
        if active_chat_id is None and chats:
            active_chat_id = str(chats[0]["id"])
        return {"chats": chats, "active_chat_id": active_chat_id}

    def create_playground_chat(self, provider_id: str | None = None, thinking_mode: str | None = None) -> dict[str, Any]:
        self.ensure_playground_root()
        chat_id = uuid4().hex
        now = utc_now_iso()
        chat = {
            "id": chat_id,
            "title": "New chat",
            "provider_id": provider_id,
            "thinking_mode": thinking_mode if thinking_mode in {"auto", "on", "off"} else "auto",
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        self.write_playground_chat(chat)
        self.set_active_playground_chat(chat_id)
        return chat

    def get_playground_chat(self, chat_id: str) -> dict[str, Any]:
        chat_file = self.playground_chat_file(chat_id)
        if not chat_file.exists():
            raise KeyError(chat_id)
        return self.normalize_playground_chat(read_json_object(chat_file))

    def set_active_playground_chat(self, chat_id: str) -> dict[str, Any]:
        self.get_playground_chat(chat_id)
        index = self.read_playground_index()
        index["active_chat_id"] = chat_id
        self.write_playground_index(index)
        return self.list_playground_chats()

    def rename_playground_chat(self, chat_id: str, title: str) -> dict[str, Any]:
        chat = self.get_playground_chat(chat_id)
        chat["title"] = title
        chat["updated_at"] = utc_now_iso()
        self.write_playground_chat(chat)
        return chat

    def update_playground_chat_settings(
        self,
        chat_id: str,
        *,
        provider_id: str | None = None,
        thinking_mode: str | None = None,
    ) -> dict[str, Any]:
        chat = self.get_playground_chat(chat_id)
        if provider_id is not None:
            chat["provider_id"] = provider_id
        if thinking_mode in {"auto", "on", "off"}:
            chat["thinking_mode"] = thinking_mode
        chat["updated_at"] = utc_now_iso()
        self.write_playground_chat(chat)
        return chat

    def delete_playground_chat(self, chat_id: str) -> dict[str, Any]:
        chat_dir = self.playground_chat_dir(chat_id)
        if not chat_dir.exists():
            raise KeyError(chat_id)
        shutil.rmtree(chat_dir)
        index = self.read_playground_index()
        if index.get("active_chat_id") == chat_id:
            index["active_chat_id"] = None
            self.write_playground_index(index)
        return self.list_playground_chats()

    def append_playground_exchange(
        self,
        chat_id: str,
        provider_id: str,
        thinking_mode: str,
        user_message: dict[str, Any],
        assistant_message: dict[str, Any],
    ) -> dict[str, Any]:
        chat = self.get_playground_chat(chat_id)
        now = utc_now_iso()
        chat["provider_id"] = provider_id
        chat["thinking_mode"] = thinking_mode if thinking_mode in {"auto", "on", "off"} else "auto"
        chat["updated_at"] = now
        if str(chat.get("title") or "") == "New chat":
            title = str(user_message.get("content") or "").strip().splitlines()[0][:48]
            if title:
                chat["title"] = title
        chat_messages = chat.setdefault("messages", [])
        chat_messages.append(user_message)
        chat_messages.append(assistant_message)
        self.write_playground_chat(chat)
        self.set_active_playground_chat(chat_id)
        return chat

    def save_playground_attachment(self, chat_id: str, attachment_id: str, data_url: str) -> str:
        prefix = "data:image/png;base64,"
        if not data_url.startswith(prefix):
            raise ValueError("Playground attachment must be a PNG data URL")
        safe_attachment_id = safe_id(attachment_id, "attachment_id")
        attachment_dir = self.playground_chat_dir(chat_id) / "attachments"
        image_path = attachment_dir / f"{safe_attachment_id}.png"
        write_bytes_atomic(image_path, base64.b64decode(data_url[len(prefix) :]))
        return f"/api/playground/chats/{safe_id(chat_id, 'chat_id')}/attachments/{safe_attachment_id}.png"

    def playground_attachment_path(self, chat_id: str, attachment_filename: str) -> Path:
        if not attachment_filename.endswith(".png"):
            raise KeyError(attachment_filename)
        attachment_id = attachment_filename[:-4]
        safe_attachment_id = safe_id(attachment_id, "attachment_id")
        path = self.playground_chat_dir(chat_id) / "attachments" / f"{safe_attachment_id}.png"
        if not path.exists():
            raise KeyError(attachment_filename)
        return path

    def ensure_playground_root(self) -> None:
        self.playground_chats_dir.mkdir(parents=True, exist_ok=True)

    def playground_chat_dir(self, chat_id: str) -> Path:
        return self.playground_chats_dir / safe_id(chat_id, "chat_id")

    def playground_chat_file(self, chat_id: str) -> Path:
        return self.playground_chat_dir(chat_id) / "chat.json"

    def read_playground_index(self) -> dict[str, Any]:
        if not self.playground_index_file.exists():
            return {"active_chat_id": None}
        try:
            return read_json_object(self.playground_index_file)
        except (OSError, json.JSONDecodeError, ValueError):
            return {"active_chat_id": None}

    def write_playground_index(self, index: dict[str, Any]) -> None:
        write_json_atomic(self.playground_index_file, index)

    def write_playground_chat(self, chat: dict[str, Any]) -> None:
        write_json_atomic(self.playground_chat_file(str(chat["id"])), chat)

    def normalize_playground_chat(self, chat: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(chat.get("id"), str):
            raise ValueError("Invalid playground chat")
        normalized = dict(chat)
        normalized["title"] = str(normalized.get("title") or "New chat")
        normalized["provider_id"] = normalized.get("provider_id") or None
        normalized["thinking_mode"] = normalized.get("thinking_mode") if normalized.get("thinking_mode") in {"auto", "on", "off"} else "auto"
        normalized["created_at"] = str(normalized.get("created_at") or "")
        normalized["updated_at"] = str(normalized.get("updated_at") or normalized["created_at"])
        messages = normalized.get("messages")
        normalized["messages"] = messages if isinstance(messages, list) else []
        return normalized

    def playground_chat_summary(self, chat: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": chat["id"],
            "title": chat["title"],
            "created_at": chat["created_at"],
            "updated_at": chat["updated_at"],
        }
