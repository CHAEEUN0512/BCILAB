"""애플리케이션 설정 로드/저장.

설정과 재생목록은 사용자 홈 폴더 아래 숨김 폴더에 JSON으로 저장된다.
따라서 프로그램을 다시 실행해도 이전에 로드한 음악 목록과
트리거(증폭기) 연결 설정이 그대로 유지된다.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

# 설정/재생목록이 저장되는 위치 (다음 실행 시에도 유지됨)
APP_DIR = Path.home() / ".audio_stimulus_player"
CONFIG_PATH = APP_DIR / "config.json"
PLAYLIST_PATH = APP_DIR / "playlist.json"

# 기본 설정값
DEFAULT_CONFIG = {
    "trigger": {
        # parallel: 패러렐 포트(LPT) 8bit TTL — 우리 앰프가 이 방식 (기본값)
        # mock  : 하드웨어 없이 화면 로그로만 확인 (테스트용)
        # serial: USB/시리얼 TTL 트리거 박스 (pyserial 필요)
        # lsl   : Lab Streaming Layer 마커 스트림 (pylsl 필요)
        # 참고: 드라이버 미설치/주소 불일치 시 자동으로 테스트 모드로 폴백된다.
        "type": "parallel",
        "serial_port": "COM3",
        "serial_baudrate": 115200,
        "parallel_address": "0x378",
        "lsl_stream_name": "AudioStimMarkers",
        # 재생 이벤트별로 증폭기에 보낼 트리거 코드
        "codes": {
            "start": 1,   # 재생 시작(각 트랙 시작 시점)
            "stop": 2,    # 사용자가 정지
            "end": 3,     # 재생목록 끝까지 재생 완료
        },
        # serial/parallel 방식에서 TTL 신호를 유지할 시간(ms) 후 0으로 리셋
        "pulse_ms": 10,
    },
}


def ensure_app_dir() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)


def _deep_merge(base: dict, override: dict) -> dict:
    """override 값으로 base를 재귀적으로 덮어쓴 새 dict 반환."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config() -> dict:
    """저장된 설정을 읽되, 누락된 키는 기본값으로 채운다."""
    if CONFIG_PATH.exists():
        try:
            saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            return _deep_merge(DEFAULT_CONFIG, saved)
        except (json.JSONDecodeError, OSError):
            # 설정 파일이 깨졌으면 기본값으로 되돌린다.
            pass
    return copy.deepcopy(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    ensure_app_dir()
    CONFIG_PATH.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )
