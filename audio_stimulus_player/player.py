"""오디오 재생 엔진 (Qt Multimedia 기반).

재생목록을 순서대로 이어서 재생하고, 각 트랙의 시작/종료 시점을
신호(Signal)로 알려준다. UI 는 이 신호에 맞춰 트리거를 발사한다.

트리거 타이밍 주의:
    trackStarted 는 play() 호출 직후에 발생하며, 실제 소리가 스피커로
    나가는 순간과는 수 ms~수십 ms 차이가 날 수 있다(운영체제/코덱 지연).
    밀리초 단위 정밀도가 필요하면 나중에 저수준 오디오 콜백 방식으로
    교체할 수 있다(하드웨어 확정 후 협의).
"""
from __future__ import annotations

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer


class AudioPlayer(QObject):
    trackStarted = Signal(int)        # 트랙 인덱스 (재생 시작)
    trackFinished = Signal(int)       # 트랙 인덱스 (자연 종료)
    playlistFinished = Signal()       # 목록 끝까지 재생 완료
    stopped = Signal()                # 사용자가 정지
    positionChanged = Signal(int, int)  # (현재 ms, 전체 ms)

    def __init__(self, parent: QObject | None = None):
        super().__init__(parent)
        self._player = QMediaPlayer(self)
        self._audio = QAudioOutput(self)
        self._player.setAudioOutput(self._audio)
        self._player.mediaStatusChanged.connect(self._on_status)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)

        self._paths: list[str] = []
        self._index: int = -1
        self._playing: bool = False
        self._duration: int = 0

    # --- 설정 ---------------------------------------------------------
    def set_tracks(self, paths: list[str]) -> None:
        self._paths = list(paths)

    def set_volume(self, value_0_1: float) -> None:
        self._audio.setVolume(max(0.0, min(1.0, value_0_1)))

    @property
    def is_playing(self) -> bool:
        return self._playing

    @property
    def current_index(self) -> int:
        return self._index

    # --- 재생 제어 ----------------------------------------------------
    def start(self, from_index: int = 0) -> None:
        if not self._paths:
            return
        from_index = max(0, min(from_index, len(self._paths) - 1))
        self._playing = True
        self._play_index(from_index)

    def _play_index(self, index: int) -> None:
        self._index = index
        self._duration = 0
        self._player.setSource(QUrl.fromLocalFile(self._paths[index]))
        self._player.play()
        # trackStarted 를 먼저 알린 뒤(→ 트리거 발사) 재생을 이어간다.
        self.trackStarted.emit(index)

    def stop(self) -> None:
        was_playing = self._playing
        self._playing = False
        self._player.stop()
        if was_playing:
            self.stopped.emit()

    # --- Qt 콜백 ------------------------------------------------------
    def _on_status(self, status: QMediaPlayer.MediaStatus) -> None:
        if status == QMediaPlayer.MediaStatus.EndOfMedia and self._playing:
            self.trackFinished.emit(self._index)
            next_index = self._index + 1
            if next_index < len(self._paths):
                self._play_index(next_index)
            else:
                self._playing = False
                self.playlistFinished.emit()

    def _on_position(self, pos: int) -> None:
        self.positionChanged.emit(pos, self._duration)

    def _on_duration(self, duration: int) -> None:
        self._duration = duration
        self.positionChanged.emit(self._player.position(), duration)
