"""증폭기(amplifier)로 트리거 신호를 보내는 백엔드.

EEG 증폭기마다 트리거 수신 방식이 다르기 때문에 백엔드를 교체할 수
있도록 설계했다. 나중에 실제 장비가 정해지면 해당 백엔드의 설정만
바꾸거나 새 백엔드를 하나 추가하면 된다.

지원(예정) 방식:
  - mock     : 하드웨어 없이 콜백/로그로만 확인 (테스트용)
  - serial   : USB/시리얼 TTL 트리거 박스 (pyserial)
  - lsl      : Lab Streaming Layer 마커 스트림 (pylsl)
  - parallel : 패러렐 포트(LPT) 8bit TTL (pyparallel)

모든 백엔드는 send(code:int) 로 정수 코드를 보내고 close() 로 정리한다.
외부 라이브러리는 해당 백엔드를 실제로 쓸 때만 import 하므로,
라이브러리가 없어도 프로그램 자체는 실행된다.
"""
from __future__ import annotations

import time
from typing import Callable, Optional


class TriggerError(RuntimeError):
    """트리거 백엔드 초기화/전송 실패."""


class TriggerBackend:
    """모든 트리거 백엔드의 공통 인터페이스."""

    name = "base"

    def send(self, code: int) -> None:  # pragma: no cover - 인터페이스
        raise NotImplementedError

    def close(self) -> None:
        pass

    def describe(self) -> str:
        return self.name


class MockTrigger(TriggerBackend):
    """실제 장비 없이 동작 확인용. 보낸 코드를 콜백으로 알려준다."""

    name = "mock"

    def __init__(self, on_send: Optional[Callable[[int], None]] = None):
        self._on_send = on_send

    def send(self, code: int) -> None:
        if self._on_send:
            self._on_send(code)

    def describe(self) -> str:
        return "테스트 모드 (하드웨어 미연결)"


class SerialTrigger(TriggerBackend):
    """USB/시리얼 TTL 트리거 박스로 1바이트 코드를 전송한다."""

    name = "serial"

    def __init__(self, port: str, baudrate: int = 115200, pulse_ms: int = 10):
        try:
            import serial  # pyserial
        except ImportError as exc:  # pragma: no cover
            raise TriggerError(
                "시리얼 트리거를 쓰려면 'pyserial'을 설치하세요: pip install pyserial"
            ) from exc
        self._pulse_s = max(0, pulse_ms) / 1000.0
        self._port = port
        try:
            self._ser = serial.Serial(port, baudrate, timeout=0)
        except Exception as exc:  # serial.SerialException 등
            raise TriggerError(f"시리얼 포트 '{port}' 열기 실패: {exc}") from exc

    def send(self, code: int) -> None:
        self._ser.write(bytes([code & 0xFF]))
        self._ser.flush()
        if self._pulse_s:
            # 일부 트리거 박스는 라인을 0으로 되돌려줘야 다음 트리거가 구분된다.
            time.sleep(self._pulse_s)
            self._ser.write(bytes([0]))
            self._ser.flush()

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass

    def describe(self) -> str:
        return f"시리얼 {self._port}"


class LSLTrigger(TriggerBackend):
    """Lab Streaming Layer 마커 스트림으로 코드를 내보낸다.

    LabRecorder 같은 도구가 EEG 스트림과 함께 이 마커를 같은
    타임라인에 기록한다.
    """

    name = "lsl"

    def __init__(self, stream_name: str = "AudioStimMarkers"):
        try:
            from pylsl import StreamInfo, StreamOutlet
        except ImportError as exc:  # pragma: no cover
            raise TriggerError(
                "LSL 트리거를 쓰려면 'pylsl'을 설치하세요: pip install pylsl"
            ) from exc
        info = StreamInfo(
            name=stream_name,
            type="Markers",
            channel_count=1,
            nominal_srate=0,          # 불규칙(이벤트) 스트림
            channel_format="int32",
            source_id=f"audio_stim_{stream_name}",
        )
        self._outlet = StreamOutlet(info)
        self._stream_name = stream_name

    def send(self, code: int) -> None:
        self._outlet.push_sample([int(code)])

    def describe(self) -> str:
        return f"LSL 마커 '{self._stream_name}'"


class ParallelTrigger(TriggerBackend):
    """패러렐 포트(LPT)의 데이터 핀(D0~D7)으로 8bit TTL 트리거를 보낸다.

    EEG 증폭기의 트리거 입력이 패러렐 포트일 때 사용한다. 8개 데이터
    핀에 코드(0~255)를 실어 보내고, pulse_ms 후 0으로 리셋한다.

    구현 방식 (자동 선택):
      - Windows : InpOut 드라이버(inpoutx64.dll / inpout32.dll)를 ctypes 로
                  직접 호출. 실무 EEG 환경에서 가장 안정적으로 동작한다.
                  드라이버는 http://www.highrez.co.uk/downloads/inpout32/
                  에서 받아 설치(InstallDriver.exe)해야 한다.
      - Linux   : pyparallel(/dev/parport)로 대체.

    주소(address)는 장치 관리자에서 확인한 포트 I/O 주소(예: 0x378, 0x278,
    또는 PCIe 카드가 할당한 0xDC00 등)를 그대로 넣으면 된다.
    """

    name = "parallel"

    def __init__(self, address: int = 0x378, pulse_ms: int = 10):
        self._pulse_s = max(0, pulse_ms) / 1000.0
        self._address = address
        self._impl = ""          # "inpout" | "pyparallel"
        self._out = None         # code(int) -> None
        self._close = lambda: None

        errors: list[str] = []
        import sys

        if sys.platform.startswith("win"):
            try:
                self._init_inpout(address)
                return
            except Exception as exc:  # noqa: BLE001 - 다음 방식으로 폴백
                errors.append(f"InpOut 드라이버: {exc}")

        try:
            self._init_pyparallel(address)
            return
        except Exception as exc:  # noqa: BLE001
            errors.append(f"pyparallel: {exc}")

        raise TriggerError(
            f"패러렐 포트(0x{address:X}) 열기 실패 — " + " / ".join(errors)
        )

    def _init_inpout(self, address: int) -> None:
        import ctypes

        dll = None
        last_err = None
        for name in ("inpoutx64", "inpout32"):
            try:
                dll = ctypes.WinDLL(name)
                break
            except OSError as exc:
                last_err = exc
        if dll is None:
            raise OSError(
                "inpoutx64.dll / inpout32.dll 을 찾을 수 없습니다. "
                "InpOut 드라이버를 설치하고 DLL을 프로그램 폴더나 시스템 경로에 두세요."
            ) from last_err

        # 드라이버가 실제로 열렸는지 확인(설치는 됐지만 미실행이면 여기서 걸림)
        if hasattr(dll, "IsInpOutDriverOpen") and dll.IsInpOutDriverOpen() == 0:
            raise OSError("InpOut 커널 드라이버가 열리지 않았습니다. 관리자 권한으로 설치했는지 확인하세요.")

        out32 = dll.Out32
        out32.argtypes = [ctypes.c_short, ctypes.c_short]
        out32.restype = None
        self._out = lambda val: out32(ctypes.c_short(address), ctypes.c_short(val & 0xFF))
        self._impl = "inpout"

    def _init_pyparallel(self, address: int) -> None:
        try:
            import parallel  # pyparallel
        except ImportError as exc:
            raise OSError(
                "pyparallel 미설치 (pip install pyparallel)"
            ) from exc
        port = parallel.Parallel(address)
        self._out = lambda val: port.setData(val & 0xFF)
        self._close = port.setData and (lambda: None)  # pyparallel엔 명시적 close 없음
        self._impl = "pyparallel"

    def send(self, code: int) -> None:
        self._out(code)
        if self._pulse_s:
            # 다음 트리거와 구분되도록 잠깐 유지 후 0으로 리셋
            time.sleep(self._pulse_s)
            self._out(0)

    def close(self) -> None:
        try:
            self._out(0)  # 라인을 깨끗하게 0으로 남긴다
        except Exception:
            pass

    def describe(self) -> str:
        via = {"inpout": "InpOut", "pyparallel": "pyparallel"}.get(self._impl, "")
        return f"패러렐 포트 0x{self._address:X}" + (f" ({via})" if via else "")


def create_backend(
    trigger_cfg: dict,
    on_mock_send: Optional[Callable[[int], None]] = None,
) -> TriggerBackend:
    """설정 dict를 보고 알맞은 백엔드를 생성한다.

    초기화에 실패하면 TriggerError를 던진다. 호출 측에서 잡아
    자동으로 mock 으로 되돌리도록 처리한다.
    """
    kind = (trigger_cfg.get("type") or "mock").lower()
    if kind == "mock":
        return MockTrigger(on_send=on_mock_send)
    if kind == "serial":
        return SerialTrigger(
            port=trigger_cfg.get("serial_port", "COM3"),
            baudrate=int(trigger_cfg.get("serial_baudrate", 115200)),
            pulse_ms=int(trigger_cfg.get("pulse_ms", 10)),
        )
    if kind == "lsl":
        return LSLTrigger(stream_name=trigger_cfg.get("lsl_stream_name", "AudioStimMarkers"))
    if kind == "parallel":
        addr = trigger_cfg.get("parallel_address", "0x378")
        if isinstance(addr, str):
            addr = int(addr, 16) if addr.lower().startswith("0x") else int(addr)
        return ParallelTrigger(address=addr, pulse_ms=int(trigger_cfg.get("pulse_ms", 10)))
    raise TriggerError(f"알 수 없는 트리거 방식: {kind}")


class TriggerService:
    """재생 이벤트(start/stop/end)를 트리거 코드로 변환해 백엔드로 보낸다.

    - 백엔드 초기화에 실패해도 프로그램이 죽지 않고 자동으로 테스트
      모드(mock)로 되돌아간다.
    - 실제 전송된 코드는 on_event 콜백으로 화면 로그에 표시할 수 있다.
    """

    def __init__(self, trigger_cfg: dict, on_event: Optional[Callable[[str, int, str], None]] = None):
        self._cfg = trigger_cfg
        self._on_event = on_event
        self._codes = trigger_cfg.get("codes", {"start": 1, "stop": 2, "end": 3})
        self._backend: TriggerBackend
        self._init_error: Optional[str] = None
        self._make_backend()

    def _mock_notify(self, code: int) -> None:
        # mock 백엔드가 코드를 보낼 때 화면 로그로도 전달
        if self._on_event:
            self._on_event("mock", code, "테스트")

    def _make_backend(self) -> None:
        try:
            self._backend = create_backend(self._cfg, on_mock_send=self._mock_notify)
            self._init_error = None
        except TriggerError as exc:
            # 장비 연결 실패 → 테스트 모드로 자동 전환 (실험이 중단되지 않도록)
            self._init_error = str(exc)
            self._backend = MockTrigger(on_send=self._mock_notify)

    # --- 상태 ---------------------------------------------------------
    @property
    def init_error(self) -> Optional[str]:
        return self._init_error

    def describe(self) -> str:
        return self._backend.describe()

    # --- 이벤트 전송 --------------------------------------------------
    def _fire(self, event: str, code: int) -> None:
        try:
            self._backend.send(code)
            ok = True
        except Exception as exc:  # 전송 실패도 실험을 막지 않는다
            ok = False
            if self._on_event:
                self._on_event(event, code, f"전송 실패: {exc}")
            return
        if ok and self._on_event and not isinstance(self._backend, MockTrigger):
            self._on_event(event, code, self._backend.describe())

    def start(self, code: Optional[int] = None) -> None:
        self._fire("start", code if code is not None else int(self._codes.get("start", 1)))

    def stop(self) -> None:
        self._fire("stop", int(self._codes.get("stop", 2)))

    def end(self) -> None:
        self._fire("end", int(self._codes.get("end", 3)))

    def test(self, code: int = 255) -> None:
        """장비 연결 확인용 임의 트리거."""
        self._fire("test", code)

    def close(self) -> None:
        self._backend.close()
