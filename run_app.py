"""exe 빌드/실행용 진입점 스크립트.

PyInstaller 는 패키지(`python -m ...`)보다 단일 스크립트를 진입점으로
받는 것이 안정적이라 이 파일을 둔다.
"""
import sys

from audio_stimulus_player.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
