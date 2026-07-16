"""GUI 없이 실행 가능한 핵심 로직 스모크 테스트.

    python -m audio_stimulus_player.tests.test_core

config / playlist / triggers 는 PySide6 에 의존하지 않으므로
이 테스트는 GUI 라이브러리 없이도 통과해야 한다.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from audio_stimulus_player import config, playlist, triggers


def _redirect_storage(tmp: Path) -> None:
    """저장 경로를 임시 폴더로 바꿔 실제 홈 폴더를 건드리지 않는다."""
    config.APP_DIR = tmp
    config.CONFIG_PATH = tmp / "config.json"
    config.PLAYLIST_PATH = tmp / "playlist.json"


def test_config_roundtrip(tmp: Path) -> None:
    cfg = config.load_config()
    assert cfg["trigger"]["type"] == "parallel"
    cfg["trigger"]["type"] = "serial"
    cfg["trigger"]["codes"]["start"] = 42
    config.save_config(cfg)

    reloaded = config.load_config()
    assert reloaded["trigger"]["type"] == "serial"
    assert reloaded["trigger"]["codes"]["start"] == 42
    # 누락 키는 기본값으로 채워지는지 확인
    assert "pulse_ms" in reloaded["trigger"]
    print("  ✓ config 저장/복원")


def test_playlist_persistence(tmp: Path) -> None:
    # 실제 파일 2개 생성
    files = []
    for name in ("a.wav", "b.wav"):
        p = tmp / name
        p.write_bytes(b"RIFF....")
        files.append(str(p))

    pl = playlist.Playlist.load()
    assert pl.tracks == []
    added = pl.add_files(files + files)  # 중복은 무시되어야 함
    assert added == 2, f"기대 2, 실제 {added}"

    # 존재하지 않는 파일은 추가되지 않음
    assert pl.add_files([str(tmp / "nope.wav")]) == 0

    # 재로드 시 유지되는지
    pl2 = playlist.Playlist.load()
    assert len(pl2.tracks) == 2
    assert pl2.tracks[0].name == "a.wav"

    # 순서 변경
    pl2.move(0, 1)
    assert playlist.Playlist.load().tracks[0].name == "b.wav"

    # 개별 삭제
    pl2.remove_indices([0])
    assert len(playlist.Playlist.load().tracks) == 1

    # 전체 삭제
    pl2.clear()
    assert playlist.Playlist.load().tracks == []
    print("  ✓ playlist 저장/복원/삭제/순서변경")


def test_trigger_mock_and_fallback(tmp: Path) -> None:
    events: list[tuple[str, int]] = []

    # mock 백엔드: 보낸 코드가 콜백으로 전달돼야 함
    svc = triggers.TriggerService(
        {"type": "mock", "codes": {"start": 1, "stop": 2, "end": 3}},
        on_event=lambda ev, code, detail: events.append((ev, code)),
    )
    svc.start(); svc.stop(); svc.end(); svc.test(255)
    codes = [c for _, c in events]
    assert codes == [1, 2, 3, 255], f"실제 {codes}"

    # 곡별 코드 우선 적용
    events.clear()
    svc.start(code=77)
    assert events[-1][1] == 77

    # 잘못된 시리얼 포트 → 자동으로 mock 으로 폴백(예외로 죽지 않음)
    svc2 = triggers.TriggerService(
        {"type": "serial", "serial_port": "/dev/does-not-exist-xyz",
         "serial_baudrate": 115200, "codes": {"start": 1, "stop": 2, "end": 3},
         "pulse_ms": 0}
    )
    assert svc2.init_error is not None
    svc2.start()  # 예외 없이 동작해야 함

    # 패러렐 포트도 드라이버/포트가 없으면 자동 폴백돼야 함
    svc3 = triggers.TriggerService(
        {"type": "parallel", "parallel_address": "0x378",
         "codes": {"start": 1, "stop": 2, "end": 3}, "pulse_ms": 0}
    )
    assert svc3.init_error is not None
    svc3.start(); svc3.end()  # 예외 없이 동작
    print("  ✓ trigger mock 전송 + 시리얼/패러렐 실패 시 자동 폴백")


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        _redirect_storage(tmp)
        test_config_roundtrip(tmp)
        # 각 테스트가 깨끗한 상태에서 돌도록 저장 파일 정리
        config.PLAYLIST_PATH.unlink(missing_ok=True)
        test_playlist_persistence(tmp)
        test_trigger_mock_and_fallback(tmp)
    print("\n모든 핵심 로직 테스트 통과 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
