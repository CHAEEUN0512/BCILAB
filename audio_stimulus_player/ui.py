"""메인 화면 (의사용 단순 UI).

레이아웃 (위 → 아래):
  1) 상단 바 : 증폭기(트리거) 연결 상태 + [설정] [트리거 테스트]
  2) 재생목록 : 로드한 음악이 순서대로 표시 (다음 실행 시 자동 복원)
                [+ 음악 추가] [선택 삭제] [전체 삭제] [▲][▼]
  3) 현재 재생 정보 + 진행 막대
  4) 큰 버튼   : [▶ 재생 시작]  [■ 정지]
  5) 하단 로그 : 실제로 발사된 트리거 코드가 시간과 함께 표시
"""
from __future__ import annotations

from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from . import config
from .player import AudioPlayer
from .playlist import Playlist
from .triggers import TriggerService

AUDIO_FILTER = "오디오 파일 (*.wav *.mp3 *.ogg *.flac *.m4a *.aac);;모든 파일 (*.*)"


class SettingsDialog(QDialog):
    """트리거(증폭기) 연결 설정."""

    def __init__(self, cfg: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("트리거(증폭기) 설정")
        self.setMinimumWidth(420)
        self._cfg = cfg
        trig = cfg["trigger"]

        form = QFormLayout()

        self.type_box = QComboBox()
        self.type_box.addItem("테스트 모드 (하드웨어 없음)", "mock")
        self.type_box.addItem("시리얼 / USB TTL 트리거 박스", "serial")
        self.type_box.addItem("LSL 마커 스트림", "lsl")
        self.type_box.addItem("패러렐 포트 (LPT)", "parallel")
        idx = max(0, self.type_box.findData(trig.get("type", "mock")))
        self.type_box.setCurrentIndex(idx)
        form.addRow("연결 방식", self.type_box)

        self.serial_port = QLineEdit(str(trig.get("serial_port", "COM3")))
        form.addRow("시리얼 포트", self.serial_port)

        self.serial_baud = QSpinBox()
        self.serial_baud.setRange(300, 1_000_000)
        self.serial_baud.setValue(int(trig.get("serial_baudrate", 115200)))
        form.addRow("보드레이트", self.serial_baud)

        self.parallel_addr = QLineEdit(str(trig.get("parallel_address", "0x378")))
        form.addRow("패러렐 주소", self.parallel_addr)

        self.lsl_name = QLineEdit(str(trig.get("lsl_stream_name", "AudioStimMarkers")))
        form.addRow("LSL 스트림 이름", self.lsl_name)

        codes = trig.get("codes", {})
        self.code_start = QSpinBox(); self.code_start.setRange(0, 255)
        self.code_start.setValue(int(codes.get("start", 1)))
        self.code_stop = QSpinBox(); self.code_stop.setRange(0, 255)
        self.code_stop.setValue(int(codes.get("stop", 2)))
        self.code_end = QSpinBox(); self.code_end.setRange(0, 255)
        self.code_end.setValue(int(codes.get("end", 3)))
        form.addRow("코드 · 재생 시작", self.code_start)
        form.addRow("코드 · 정지", self.code_stop)
        form.addRow("코드 · 종료", self.code_end)

        self.pulse = QSpinBox(); self.pulse.setRange(0, 1000)
        self.pulse.setValue(int(trig.get("pulse_ms", 10)))
        self.pulse.setSuffix(" ms")
        form.addRow("TTL 펄스 폭", self.pulse)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        hint = QLabel(
            "장비 연결에 실패하면 자동으로 테스트 모드로 전환됩니다.\n"
            "실제 장비가 정해지면 연결 방식과 코드만 맞춰주세요."
        )
        hint.setStyleSheet("color: #666;")
        layout.addWidget(hint)
        layout.addWidget(buttons)

    def result_config(self) -> dict:
        trig = self._cfg["trigger"]
        trig["type"] = self.type_box.currentData()
        trig["serial_port"] = self.serial_port.text().strip()
        trig["serial_baudrate"] = self.serial_baud.value()
        trig["parallel_address"] = self.parallel_addr.text().strip()
        trig["lsl_stream_name"] = self.lsl_name.text().strip()
        trig["codes"] = {
            "start": self.code_start.value(),
            "stop": self.code_stop.value(),
            "end": self.code_end.value(),
        }
        trig["pulse_ms"] = self.pulse.value()
        return self._cfg


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("청각 자극 재생기")
        self.resize(720, 640)

        self.cfg = config.load_config()
        self.playlist = Playlist.load()
        self.player = AudioPlayer(self)
        self.trigger = TriggerService(self.cfg["trigger"], on_event=self._on_trigger_event)

        self._build_ui()
        self._connect_signals()
        self._refresh_playlist_widget()
        self._update_trigger_status()

    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        # 1) 상단 바 : 트리거 상태 + 설정/테스트
        top = QHBoxLayout()
        self.status_label = QLabel()
        self.status_label.setStyleSheet("font-weight: bold;")
        top.addWidget(self.status_label, stretch=1)
        self.test_btn = QPushButton("트리거 테스트")
        self.settings_btn = QPushButton("설정")
        top.addWidget(self.test_btn)
        top.addWidget(self.settings_btn)
        root.addLayout(top)

        # 2) 재생목록
        root.addWidget(self._section_label("재생 목록 (위에서 아래 순서로 재생)"))
        self.list_widget = QListWidget()
        self.list_widget.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        self.list_widget.setStyleSheet("QListWidget::item { padding: 6px; }")
        root.addWidget(self.list_widget, stretch=1)

        list_btns = QHBoxLayout()
        self.add_btn = QPushButton("+ 음악 추가")
        self.remove_btn = QPushButton("선택 삭제")
        self.clear_btn = QPushButton("전체 삭제")
        self.up_btn = QPushButton("▲")
        self.down_btn = QPushButton("▼")
        for b in (self.add_btn, self.remove_btn, self.clear_btn):
            list_btns.addWidget(b)
        list_btns.addStretch(1)
        list_btns.addWidget(self.up_btn)
        list_btns.addWidget(self.down_btn)
        root.addLayout(list_btns)

        # 3) 현재 재생 정보
        self.now_label = QLabel("대기 중")
        self.now_label.setStyleSheet("color: #333;")
        root.addWidget(self.now_label)
        self.progress = QProgressBar()
        self.progress.setTextVisible(False)
        root.addWidget(self.progress)

        # 4) 큰 재생 버튼
        controls = QHBoxLayout()
        self.play_btn = QPushButton("▶  재생 시작")
        self.stop_btn = QPushButton("■  정지")
        big = QFont(); big.setPointSize(16); big.setBold(True)
        for b in (self.play_btn, self.stop_btn):
            b.setFont(big)
            b.setMinimumHeight(64)
        self.play_btn.setStyleSheet("background:#2e7d32; color:white; border-radius:8px;")
        self.stop_btn.setStyleSheet("background:#c62828; color:white; border-radius:8px;")
        self.stop_btn.setEnabled(False)
        controls.addWidget(self.play_btn, stretch=2)
        controls.addWidget(self.stop_btn, stretch=1)
        root.addLayout(controls)

        # 5) 트리거 로그
        root.addWidget(self._section_label("트리거 로그"))
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumHeight(120)
        root.addWidget(self.log)

    @staticmethod
    def _section_label(text: str) -> QLabel:
        label = QLabel(text)
        label.setStyleSheet("color:#555; font-size: 12px;")
        return label

    def _connect_signals(self) -> None:
        self.add_btn.clicked.connect(self._on_add)
        self.remove_btn.clicked.connect(self._on_remove)
        self.clear_btn.clicked.connect(self._on_clear)
        self.up_btn.clicked.connect(lambda: self._on_move(-1))
        self.down_btn.clicked.connect(lambda: self._on_move(1))
        self.play_btn.clicked.connect(self._on_play)
        self.stop_btn.clicked.connect(self._on_stop)
        self.settings_btn.clicked.connect(self._on_settings)
        self.test_btn.clicked.connect(self._on_test)

        self.player.trackStarted.connect(self._on_track_started)
        self.player.playlistFinished.connect(self._on_playlist_finished)
        self.player.stopped.connect(self._on_player_stopped)
        self.player.positionChanged.connect(self._on_position)

    # --- 재생목록 편집 -------------------------------------------------
    def _refresh_playlist_widget(self) -> None:
        self.list_widget.clear()
        for i, track in enumerate(self.playlist.tracks):
            item = QListWidgetItem(f"{i + 1}.  {track.name}")
            item.setToolTip(track.path)
            self.list_widget.addItem(item)

    def _on_add(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(self, "음악 파일 선택", "", AUDIO_FILTER)
        if not paths:
            return
        added = self.playlist.add_files(paths)
        self._refresh_playlist_widget()
        self._log(f"음악 {added}개 추가됨 (저장됨)")

    def _on_remove(self) -> None:
        rows = sorted({self.list_widget.row(i) for i in self.list_widget.selectedItems()})
        if not rows:
            QMessageBox.information(self, "안내", "삭제할 음악을 먼저 선택하세요.")
            return
        self.playlist.remove_indices(rows)
        self._refresh_playlist_widget()
        self._log(f"음악 {len(rows)}개 삭제됨")

    def _on_clear(self) -> None:
        if not self.playlist.tracks:
            return
        ok = QMessageBox.question(self, "전체 삭제", "재생목록을 모두 비울까요?")
        if ok == QMessageBox.StandardButton.Yes:
            self.playlist.clear()
            self._refresh_playlist_widget()
            self._log("재생목록 전체 삭제됨")

    def _on_move(self, delta: int) -> None:
        rows = [self.list_widget.row(i) for i in self.list_widget.selectedItems()]
        if len(rows) != 1:
            return
        src = rows[0]
        self.playlist.move(src, src + delta)
        self._refresh_playlist_widget()
        new_row = max(0, min(src + delta, self.list_widget.count() - 1))
        self.list_widget.setCurrentRow(new_row)

    # --- 재생 제어 -----------------------------------------------------
    def _on_play(self) -> None:
        if not self.playlist.tracks:
            QMessageBox.information(self, "안내", "재생할 음악을 먼저 추가하세요.")
            return
        selected = self.list_widget.currentRow()
        start_index = selected if selected >= 0 else 0
        self.player.set_tracks(self.playlist.paths())
        self.play_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.player.start(from_index=start_index)

    def _on_stop(self) -> None:
        self.player.stop()

    def _on_track_started(self, index: int) -> None:
        track = self.playlist.tracks[index]
        code = track.code  # 곡별 코드가 있으면 그것을, 없으면 전역 start 코드 사용
        self.trigger.start(code=code)
        self.now_label.setText(f"재생 중 ▶  {index + 1}. {track.name}")
        self.list_widget.setCurrentRow(index)

    def _on_playlist_finished(self) -> None:
        self.trigger.end()
        self.now_label.setText("재생 완료")
        self.progress.setValue(0)
        self.play_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def _on_player_stopped(self) -> None:
        self.trigger.stop()
        self.now_label.setText("정지됨")
        self.progress.setValue(0)
        self.play_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def _on_position(self, pos: int, dur: int) -> None:
        if dur > 0:
            self.progress.setMaximum(dur)
            self.progress.setValue(pos)
        else:
            self.progress.setMaximum(0)  # 미확정 → 진행 애니메이션

    # --- 트리거 / 설정 -------------------------------------------------
    def _on_settings(self) -> None:
        dialog = SettingsDialog(self.cfg, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.cfg = dialog.result_config()
            config.save_config(self.cfg)
            # 백엔드 재생성
            self.trigger.close()
            self.trigger = TriggerService(self.cfg["trigger"], on_event=self._on_trigger_event)
            self._update_trigger_status()
            self._log("트리거 설정이 저장되었습니다.")

    def _on_test(self) -> None:
        self.trigger.test(255)
        self._log("트리거 테스트 신호(255) 전송")

    def _update_trigger_status(self) -> None:
        desc = self.trigger.describe()
        if self.trigger.init_error:
            self.status_label.setText(f"⚠ 증폭기: {desc} — {self.trigger.init_error}")
            self.status_label.setStyleSheet("color:#b26a00; font-weight:bold;")
        else:
            self.status_label.setText(f"● 증폭기 연결: {desc}")
            self.status_label.setStyleSheet("color:#2e7d32; font-weight:bold;")

    def _on_trigger_event(self, event: str, code: int, detail: str) -> None:
        self._log(f"[트리거] {event} → 코드 {code}  ({detail})")

    # --- 공통 ----------------------------------------------------------
    def _log(self, message: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log.append(f"{stamp}  {message}")

    def closeEvent(self, event) -> None:
        try:
            if self.player.is_playing:
                self.player.stop()
            self.trigger.close()
        finally:
            super().closeEvent(event)
