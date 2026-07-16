"""실행 진입점.

    python -m audio_stimulus_player
"""
from __future__ import annotations

import sys


def main() -> int:
    try:
        from PySide6.QtWidgets import QApplication
    except ImportError:
        sys.stderr.write(
            "PySide6 가 설치되어 있지 않습니다.\n"
            "  pip install -r audio_stimulus_player/requirements.txt\n"
            "또는\n"
            "  pip install PySide6\n"
        )
        return 1

    from .ui import MainWindow

    app = QApplication(sys.argv)
    app.setApplicationName("청각 자극 재생기")
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
