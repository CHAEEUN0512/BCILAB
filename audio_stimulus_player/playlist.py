"""재생목록 모델 + 영구 저장.

한 번 로드한 음악은 JSON 파일로 저장되어, 다음에 프로그램을 다시
실행할 때 자동으로 복원된다. 사용자가 원하면 개별/전체 삭제도 가능하다.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from . import config


@dataclass
class Track:
    """재생목록의 한 곡."""

    path: str                      # 오디오 파일 절대경로
    name: str                      # 화면에 표시할 이름
    code: Optional[int] = None     # 이 곡 전용 시작 트리거 코드(없으면 전역 start 코드 사용)

    @staticmethod
    def from_file(path: str) -> "Track":
        p = Path(path)
        return Track(path=str(p.resolve()), name=p.name)


class Playlist:
    """트랙 목록을 관리하고 파일로 저장/복원한다."""

    def __init__(self, tracks: Optional[list[Track]] = None):
        self.tracks: list[Track] = tracks or []

    # --- 편집 ---------------------------------------------------------
    def add_files(self, paths: list[str]) -> int:
        """존재하고 아직 없는 파일만 추가. 추가된 개수를 반환."""
        existing = {t.path for t in self.tracks}
        added = 0
        for path in paths:
            track = Track.from_file(path)
            if track.path in existing:
                continue
            if not Path(track.path).exists():
                continue
            self.tracks.append(track)
            existing.add(track.path)
            added += 1
        if added:
            self.save()
        return added

    def remove_indices(self, indices: list[int]) -> None:
        """주어진 인덱스의 곡들을 삭제."""
        keep = [t for i, t in enumerate(self.tracks) if i not in set(indices)]
        self.tracks = keep
        self.save()

    def clear(self) -> None:
        self.tracks = []
        self.save()

    def move(self, from_index: int, to_index: int) -> None:
        """순서 변경(위/아래 이동)."""
        if not (0 <= from_index < len(self.tracks)):
            return
        to_index = max(0, min(to_index, len(self.tracks) - 1))
        track = self.tracks.pop(from_index)
        self.tracks.insert(to_index, track)
        self.save()

    def paths(self) -> list[str]:
        return [t.path for t in self.tracks]

    # --- 영구 저장 ----------------------------------------------------
    def save(self) -> None:
        config.ensure_app_dir()
        data = [asdict(t) for t in self.tracks]
        config.PLAYLIST_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @classmethod
    def load(cls) -> "Playlist":
        if not config.PLAYLIST_PATH.exists():
            return cls()
        try:
            data = json.loads(config.PLAYLIST_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return cls()
        tracks: list[Track] = []
        for item in data:
            try:
                track = Track(
                    path=item["path"],
                    name=item.get("name") or Path(item["path"]).name,
                    code=item.get("code"),
                )
            except (KeyError, TypeError):
                continue
            tracks.append(track)
        return cls(tracks)
