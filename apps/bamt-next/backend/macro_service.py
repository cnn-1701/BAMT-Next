import ctypes
import json
import os
import sys
import threading
import time
from ctypes import POINTER, Structure, Union, byref, c_long, c_ulong, sizeof, wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

try:
    import keyboard
except Exception as exc:
    keyboard = None
    KEYBOARD_IMPORT_ERROR = exc
else:
    KEYBOARD_IMPORT_ERROR = None

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000
KEYEVENTF_KEYUP = 0x0002
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
WM_QUIT = 0x0012
PT_TOUCH = 0x00000002
POINTER_FLAG_INRANGE = 0x00000002
POINTER_FLAG_INCONTACT = 0x00000004
POINTER_FLAG_DOWN = 0x00010000
POINTER_FLAG_UPDATE = 0x00020000
POINTER_FLAG_UP = 0x00040000
TOUCH_MASK_CONTACTAREA = 0x00000001
TOUCH_MASK_ORIENTATION = 0x00000002
TOUCH_MASK_PRESSURE = 0x00000004
TOUCH_FEEDBACK_DEFAULT = 0x00000001
TOUCH_FEEDBACK_INDIRECT = 0x00000002
SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
EMERGENCY_EXIT_KEY = "x"
TAKEOVER_KEYS = list("abcdefghijklmnopqrstuvwxyz0123456789") + ["space", "tab", "enter", "esc", "up", "down", "left", "right", "shift", "ctrl", "alt"] + ["f" + str(i) for i in range(1, 12)]
DEFAULT_SKILL_SLOT_X_OFFSETS = [0.200, 0.280, 0.362]
DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO = 0.071
DEFAULT_SMOOTH_MOVE_MIN_STEPS = 2
DEFAULT_SMOOTH_MOVE_STEP_RATE = 80


class POINT(Structure):
    _fields_ = [("x", c_long), ("y", c_long)]


class RECT(Structure):
    _fields_ = [("left", c_long), ("top", c_long), ("right", c_long), ("bottom", c_long)]


class POINTER_INFO(Structure):
    _fields_ = [
        ("pointerType", ctypes.c_uint32),
        ("pointerId", ctypes.c_uint32),
        ("frameId", ctypes.c_uint32),
        ("pointerFlags", ctypes.c_uint32),
        ("sourceDevice", ctypes.c_void_p),
        ("hwndTarget", ctypes.c_void_p),
        ("ptPixelLocation", POINT),
        ("ptHimetricLocation", POINT),
        ("ptPixelLocationRaw", POINT),
        ("ptHimetricLocationRaw", POINT),
        ("dwTime", ctypes.c_uint32),
        ("historyCount", ctypes.c_uint32),
        ("inputData", ctypes.c_int32),
        ("dwKeyStates", ctypes.c_uint32),
        ("PerformanceCount", ctypes.c_uint64),
        ("ButtonChangeType", ctypes.c_int32),
    ]


class POINTER_TOUCH_INFO(Structure):
    _fields_ = [
        ("pointerInfo", POINTER_INFO),
        ("touchFlags", ctypes.c_uint32),
        ("touchMask", ctypes.c_uint32),
        ("rcContact", RECT),
        ("rcContactRaw", RECT),
        ("orientation", ctypes.c_uint32),
        ("pressure", ctypes.c_uint32),
    ]


class MOUSEINPUT(Structure):
    _fields_ = [
        ("dx", c_long),
        ("dy", c_long),
        ("mouseData", c_ulong),
        ("dwFlags", c_ulong),
        ("time", c_ulong),
        ("dwExtraInfo", POINTER(c_ulong)),
    ]


class INPUT_UNION(Union):
    _fields_ = [("mi", MOUSEINPUT)]


class INPUT(Structure):
    _fields_ = [("type", c_ulong), ("ii", INPUT_UNION)]


@dataclass
class Resolution:
    width: int
    height: int


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit(event_type: str, payload: Any) -> None:
    send({"event": {"type": event_type, "payload": payload}})



def is_process_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def foreground_window_title() -> str:
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        buffer = ctypes.create_unicode_buffer(260)
        ctypes.windll.user32.GetWindowTextW(hwnd, buffer, 260)
        return buffer.value or f"hwnd={hwnd}"
    except Exception as exc:
        return "unknown foreground: " + str(exc)

class InputDriver:
    def __init__(self, resolution: Resolution) -> None:
        self.resolution = resolution
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        try:
            self.user32.SetProcessDPIAware()
        except Exception:
            pass
        self.left_is_down = False
        self.mode = "cursor"
        self.virtual_pos = (0, 0)
        self.message_hwnd = 0
        self.touch_initialized = False
        self.touch_id = 0
        self.last_touch_update_pos = self.virtual_pos
        self.touch_in_hover = False
        self.user32.InitializeTouchInjection.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
        self.user32.InitializeTouchInjection.restype = ctypes.c_int
        self.user32.InjectTouchInput.argtypes = [ctypes.c_uint32, POINTER(POINTER_TOUCH_INFO)]
        self.user32.InjectTouchInput.restype = ctypes.c_int
        self.user32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_uint32, ctypes.c_ulong]
        self.user32.MapVirtualKeyW.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
        self.user32.MapVirtualKeyW.restype = ctypes.c_uint32

    def update_resolution(self, resolution: Resolution) -> None:
        self.resolution = resolution

    def update_mode(self, mode: str) -> None:
        self.mode = mode if mode in {"cursor", "windowMessage", "touch"} else "windowMessage"

    def position(self) -> tuple[int, int]:
        point = POINT()
        if not self.user32.GetCursorPos(byref(point)):
            raise ctypes.WinError()
        if self.mode in {"touch", "windowMessage"}:
            return self.screen_to_logical(int(point.x), int(point.y))
        return int(point.x), int(point.y)

    def virtual_screen_bounds(self) -> tuple[int, int, int, int]:
        left = int(self.user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
        top = int(self.user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
        width = max(1, int(self.user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)))
        height = max(1, int(self.user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)))
        return left, top, width, height

    def logical_to_screen(self, x: int, y: int) -> tuple[int, int]:
        left, top, screen_width, screen_height = self.virtual_screen_bounds()
        logical_width = max(1, int(self.resolution.width) - 1)
        logical_height = max(1, int(self.resolution.height) - 1)
        lx = clamp(int(x), 0, logical_width)
        ly = clamp(int(y), 0, logical_height)
        sx = left + round(lx * (screen_width - 1) / logical_width)
        sy = top + round(ly * (screen_height - 1) / logical_height)
        return clamp(sx, left, left + screen_width - 1), clamp(sy, top, top + screen_height - 1)

    def screen_to_logical(self, x: int, y: int) -> tuple[int, int]:
        left, top, screen_width, screen_height = self.virtual_screen_bounds()
        logical_width = max(1, int(self.resolution.width) - 1)
        logical_height = max(1, int(self.resolution.height) - 1)
        sx = clamp(int(x), left, left + screen_width - 1)
        sy = clamp(int(y), top, top + screen_height - 1)
        lx = round((sx - left) * logical_width / max(1, screen_width - 1))
        ly = round((sy - top) * logical_height / max(1, screen_height - 1))
        return clamp(lx, 0, logical_width), clamp(ly, 0, logical_height)

    def move_to(self, x: int, y: int) -> None:
        width = max(1, self.resolution.width - 1)
        height = max(1, self.resolution.height - 1)
        x = clamp(int(x), 0, width)
        y = clamp(int(y), 0, height)
        if self.mode == "touch":
            self.virtual_pos = (x, y)
            sx, sy = self.logical_to_screen(x, y)
            if self.left_is_down:
                self.inject_touch(sx, sy, POINTER_FLAG_UPDATE | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT)
            return
        if self.mode == "windowMessage":
            self.virtual_pos = (x, y)
            sx, sy = self.logical_to_screen(x, y)
            hwnd = self.message_hwnd or self.window_from_point(sx, sy)
            if hwnd:
                self.post_mouse(hwnd, WM_MOUSEMOVE, MK_LBUTTON if self.left_is_down else 0, sx, sy)
            return
        abs_x = int(x * 65535 / width)
        abs_y = int(y * 65535 / height)
        self.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, abs_x, abs_y)

    def left_down(self) -> None:
        if self.mode == "touch":
            x, y = self.virtual_pos
            sx, sy = self.logical_to_screen(x, y)
            self.inject_touch(sx, sy, POINTER_FLAG_DOWN | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT)
            self.last_touch_update_pos = (sx, sy)
            self.touch_in_hover = False
            self.left_is_down = True
            return
        if self.mode == "windowMessage":
            x, y = self.virtual_pos
            sx, sy = self.logical_to_screen(x, y)
            self.message_hwnd = self.window_from_point(sx, sy)
            if self.message_hwnd:
                self.post_mouse(self.message_hwnd, WM_LBUTTONDOWN, MK_LBUTTON, sx, sy)
            self.left_is_down = True
            return
        self.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0)
        self.left_is_down = True

    def left_up(self) -> None:
        if self.mode == "touch":
            if not self.left_is_down:
                return
            x, y = self.virtual_pos
            sx, sy = self.logical_to_screen(x, y)
            self.inject_touch(sx, sy, POINTER_FLAG_UPDATE | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT)
            self.last_touch_update_pos = (sx, sy)
            time.sleep(0.001)
            up_x, up_y = self.last_touch_update_pos
            try:
                self.inject_touch(up_x, up_y, POINTER_FLAG_UP)
            finally:
                self.left_is_down = False
                self.touch_in_hover = False
                self.touch_id = 0
            return
        if self.mode == "windowMessage":
            x, y = self.virtual_pos
            sx, sy = self.logical_to_screen(x, y)
            hwnd = self.message_hwnd or self.window_from_point(sx, sy)
            if hwnd:
                self.post_mouse(hwnd, WM_LBUTTONUP, 0, sx, sy)
            self.left_is_down = False
            self.message_hwnd = 0
            return
        self.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0)
        self.left_is_down = False

    def click(self, delay: float = 0.035) -> None:
        self.left_down()
        time.sleep(delay)
        self.left_up()

    def click_current(self, delay: float = 0.02) -> None:
        self.virtual_pos = self.position()
        self.click(delay)

    def tap_key(self, key_name: str, delay: float = 0.01) -> None:
        vk = VK_MAP.get(normalize_key(key_name))
        if vk is None:
            raise ValueError(f"Unsupported card key: {key_name}")
        scan = int(self.user32.MapVirtualKeyW(int(vk), 0))
        self.user32.keybd_event(int(vk), scan, 0, 0)
        time.sleep(delay)
        self.user32.keybd_event(int(vk), scan, KEYEVENTF_KEYUP, 0)


    def release_all(self) -> None:
        if self.left_is_down:
            self.left_up()

    def mouse_event(self, flags: int, dx: int, dy: int) -> None:
        extra = c_ulong(0)
        packet = INPUT(type=0, ii=INPUT_UNION(mi=MOUSEINPUT(dx, dy, 0, flags, 0, ctypes.pointer(extra))))
        if self.user32.SendInput(1, byref(packet), sizeof(INPUT)) != 1:
            raise ctypes.WinError()


    def ensure_touch(self) -> None:
        if self.touch_initialized:
            return
        if not self.user32.InitializeTouchInjection(1, TOUCH_FEEDBACK_INDIRECT):
            raise ctypes.WinError()
        self.touch_initialized = True

    def inject_touch(self, x: int, y: int, flags: int) -> None:
        self.ensure_touch()
        info = POINTER_TOUCH_INFO()
        info.pointerInfo.pointerType = PT_TOUCH
        info.pointerInfo.pointerId = self.touch_id
        info.pointerInfo.pointerFlags = flags
        info.pointerInfo.ptPixelLocation = POINT(int(x), int(y))
        info.pointerInfo.ptPixelLocationRaw = POINT(int(x), int(y))
        info.touchFlags = 0
        info.touchMask = TOUCH_MASK_CONTACTAREA | TOUCH_MASK_ORIENTATION | TOUCH_MASK_PRESSURE
        contact = RECT(int(x) - 2, int(y) - 2, int(x) + 2, int(y) + 2)
        info.rcContact = contact
        info.rcContactRaw = contact
        info.orientation = 90
        info.pressure = 32000
        ctypes.set_last_error(0)
        if not self.user32.InjectTouchInput(1, byref(info)):
            error = ctypes.get_last_error()
            left, top, width, height = self.virtual_screen_bounds()
            raise OSError(error, f"InjectTouchInput failed at ({int(x)}, {int(y)}) flags={flags} pointerId={self.touch_id} screen=({left},{top},{width},{height})")
        if flags & POINTER_FLAG_UPDATE:
            self.last_touch_update_pos = (int(x), int(y))

    def window_from_point(self, x: int, y: int) -> int:
        point = POINT(int(x), int(y))
        hwnd = self.user32.WindowFromPoint(point)
        return int(hwnd or 0)

    def post_mouse(self, hwnd: int, message: int, wparam: int, x: int, y: int) -> None:
        point = POINT(int(x), int(y))
        self.user32.ScreenToClient(hwnd, byref(point))
        lparam = ((int(point.y) & 0xFFFF) << 16) | (int(point.x) & 0xFFFF)
        self.user32.PostMessageW(hwnd, message, wparam, lparam)


VK_MAP = {
    "backspace": 0x08, "tab": 0x09, "enter": 0x0D, "pause": 0x13, "capslock": 0x14, "esc": 0x1B,
    "space": 0x20, "pageup": 0x21, "pagedown": 0x22, "end": 0x23, "home": 0x24, "left": 0x25,
    "up": 0x26, "right": 0x27, "down": 0x28, "insert": 0x2D, "delete": 0x2E, "mouse4": 0x05,
    "x1": 0x05, "mouse5": 0x06, "x2": 0x06,
}
for code in range(10):
    VK_MAP[str(code)] = 0x30 + code
    VK_MAP[f"num{code}"] = 0x60 + code
for index, letter in enumerate("abcdefghijklmnopqrstuvwxyz"):
    VK_MAP[letter] = 0x41 + index
for index in range(1, 25):
    VK_MAP[f"f{index}"] = 0x6F + index




class LowLevelKeyboardState:
    def __init__(self) -> None:
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.lock = threading.RLock()
        self.pressed_vks: set[int] = set()
        self.hook = None
        self.thread: threading.Thread | None = None
        self.thread_id = 0
        self.ready = threading.Event()
        self.running = False
        self._proc = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.ready.clear()
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self.ready.wait(timeout=0.8)

    def stop(self) -> None:
        self.running = False
        with self.lock:
            self.pressed_vks.clear()
            hook = self.hook
            thread_id = self.thread_id
            self.hook = None
        if hook:
            try:
                self.user32.UnhookWindowsHookEx(hook)
            except Exception:
                pass
        if thread_id:
            try:
                self.user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)
            except Exception:
                pass

    def is_pressed_vk(self, vk: int) -> bool:
        with self.lock:
            return int(vk) in self.pressed_vks

    def _run(self) -> None:
        self.thread_id = int(self.kernel32.GetCurrentThreadId())
        HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)

        def callback(n_code: int, w_param: int, l_param: int) -> int:
            if n_code >= 0:
                info = ctypes.cast(l_param, POINTER(KBDLLHOOKSTRUCT)).contents
                vk = int(info.vkCode)
                with self.lock:
                    if int(w_param) in {WM_KEYDOWN, WM_SYSKEYDOWN}:
                        self.pressed_vks.add(vk)
                    elif int(w_param) in {WM_KEYUP, WM_SYSKEYUP}:
                        self.pressed_vks.discard(vk)
            return int(self.user32.CallNextHookEx(None, n_code, w_param, l_param))

        self._proc = HOOKPROC(callback)
        self.user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, ctypes.c_void_p, wintypes.DWORD]
        self.user32.SetWindowsHookExW.restype = ctypes.c_void_p
        self.user32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.CallNextHookEx.restype = ctypes.c_long
        self.user32.GetMessageW.argtypes = [POINTER(MSG), ctypes.c_void_p, wintypes.UINT, wintypes.UINT]
        self.user32.GetMessageW.restype = ctypes.c_int
        self.user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.PostThreadMessageW.restype = ctypes.c_int

        hook = self.user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._proc, self.kernel32.GetModuleHandleW(None), 0)
        with self.lock:
            self.hook = hook
        if not hook:
            emit("log", {"level": "warn", "message": "低层键盘 Hook 启动失败：" + str(ctypes.get_last_error())})
            self.ready.set()
            return
        emit("log", {"level": "info", "message": "低层键盘 Hook 已启动"})
        self.ready.set()
        msg = MSG()
        while self.running and self.user32.GetMessageW(byref(msg), None, 0, 0) > 0:
            pass
        with self.lock:
            self.pressed_vks.clear()
            if self.hook:
                try:
                    self.user32.UnhookWindowsHookEx(self.hook)
                except Exception:
                    pass
                self.hook = None

class MacroService:
    def __init__(self) -> None:
        self.config_path = Path(os.environ.get("BAMT_CONFIG_PATH", "blue_archive_config.json"))
        legacy = os.environ.get("BAMT_LEGACY_CONFIG_PATH", "")
        self.legacy_config_path = Path(legacy) if legacy else None
        self.config = self.load_config()
        self.driver = InputDriver(Resolution(**self.config["resolution"]))
        self.driver.update_mode(self.config.get("inputBackend", "cursor"))
        self.lock = threading.RLock()
        self.mouse_lock = threading.RLock()
        self.stop_event = threading.Event()
        self.listen_thread: threading.Thread | None = None
        self.worker_threads: list[threading.Thread] = []
        self.blocked_keys: set[str] = set()
        self.active_points: dict[str, tuple[int, int]] = {}
        self.keyboard_state = LowLevelKeyboardState()

    def handle(self, command: str, payload: Any) -> Any:
        if command == "get_initial_config":
            return self.config
        if command == "load_config":
            self.config = self.load_config()
            self.driver.update_resolution(Resolution(**self.config["resolution"]))
            self.driver.update_mode(self.config.get("inputBackend", "cursor"))
            return self.config
        if command == "save_config":
            self.config = normalize_config(payload)
            validate_config(self.config)
            self.save_config(self.config)
            return self.config
        if command == "start_listening":
            return self.start_listening(payload)
        if command == "stop_listening":
            return self.stop_listening()
        if command == "test_macro":
            return self.test_macro(payload)
        if command == "capture_position":
            time.sleep(max(0, int((payload or {}).get("delayMs", 2000))) / 1000)
            x, y = self.driver.position()
            emit("capture", {"x": x, "y": y})
            return {"x": x, "y": y}
        if command == "shutdown":
            return self.stop_listening()
        raise ValueError(f"未知命令：{command}")

    def start_listening(self, payload: Any) -> dict[str, str]:
        with self.lock:
            self.stop_listening(emit_status=False)
            self.config = normalize_config(payload)
            validate_config(self.config)
            self.driver.update_resolution(Resolution(**self.config["resolution"]))
            self.driver.update_mode(self.config.get("inputBackend", "cursor"))
            emit("log", {"level": "info", "message": f"监听诊断：backend={self.driver.mode}, admin={is_process_admin()}, foreground={foreground_window_title()}"})
            if self.driver.mode == "windowMessage":
                emit("log", {"level": "warn", "message": "窗口消息模式不会移动鼠标，但很多 DirectX/原生游戏聚焦后会忽略窗口消息；日服不响应时请切系统光标模式。"})
            if not is_process_admin():
                emit("log", {"level": "warn", "message": "BAMT 当前不是管理员。若游戏以管理员或更高权限运行，热键或输入注入可能会被 Windows 拦截。"})
            self.stop_event.clear()
            self.keyboard_state.start()
            self.block_keys()
            self.listen_thread = threading.Thread(target=self.listen_loop, daemon=True)
            self.listen_thread.start()
        emit("status", {"status": "listening", "message": "监听已启动"})
        return {"status": "listening", "message": "监听已启动"}

    def stop_listening(self, emit_status: bool = True) -> dict[str, str]:
        self.stop_event.set()
        if self.listen_thread and self.listen_thread.is_alive() and threading.current_thread() is not self.listen_thread:
            self.listen_thread.join(timeout=0.6)
        self.release_points()
        self.driver.release_all()
        self.unblock_keys()
        self.worker_threads = [thread for thread in self.worker_threads if thread.is_alive()]
        if emit_status:
            emit("status", {"status": "stopped", "message": "监听已停止"})
        return {"status": "stopped", "message": "监听已停止"}

    def test_macro(self, payload: Any) -> dict[str, str]:
        action = normalize_action(payload.get("action", {}), 0)
        config = normalize_config(payload.get("config", self.config))
        validate_config({**config, "actions": [action]})
        previous_config = self.config
        self.config = config
        self.driver.update_resolution(Resolution(**config["resolution"]))
        self.driver.update_mode(config.get("inputBackend", "cursor"))
        try:
            self.run_once(action, lambda: self.stop_event.is_set())
        finally:
            self.config = previous_config
        return {"status": "ready", "message": "宏测试完成"}

    def listen_loop(self) -> None:
        actions = [action for action in self.config["actions"] if action.get("enabled", True)]
        states = {action["id"]: False for action in actions}
        emit("log", {"level": "info", "message": f"已加载 {len(actions)} 条指令"})
        try:
            while not self.stop_event.is_set():
                if self.is_pressed(EMERGENCY_EXIT_KEY):
                    self.stop_event.set()
                    break
                for action in actions:
                    pressed = self.is_pressed(action["hotkey"])
                    was_pressed = states[action["id"]]
                    if pressed and not was_pressed:
                        states[action["id"]] = True
                        self.on_key_down(action)
                    elif not pressed and was_pressed:
                        states[action["id"]] = False
                        self.on_key_up(action)
                time.sleep(0.01)
        except Exception as exc:
            emit("error", {"message": str(exc)})
        finally:
            self.release_points()
            self.driver.release_all()
            self.unblock_keys()
            emit("status", {"status": "stopped", "message": "监听已停止"})

    def on_key_down(self, action: dict[str, Any]) -> None:
        emit("log", {"level": "info", "message": f"检测到热键：{action['hotkey']} -> {action['name']} ({action['type']}) foreground={foreground_window_title()}"})
        if action["type"] == "point":
            self.start_point(action)
            return
        runtime_action = dict(action)
        thread = threading.Thread(target=self.run_while_pressed, args=(runtime_action,), daemon=True)
        self.worker_threads.append(thread)
        thread.start()

    def on_key_up(self, action: dict[str, Any]) -> None:
        if action["type"] == "point":
            self.release_point(action)

    def run_while_pressed(self, action: dict[str, Any]) -> None:
        emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "start"})
        try:
            if action["type"] == "drag":
                while not self.stop_event.is_set() and self.is_pressed(action["hotkey"]):
                    self.run_once(action, lambda: self.stop_event.is_set() or not self.is_pressed(action["hotkey"]))
                    sleep_cancelable(float(action.get("loopGap", 0.005)), self.stop_event)
                return
            if action["type"] == "click" and normalize_key(action.get("cardKey", "")):
                while not self.stop_event.is_set() and self.is_pressed(action["hotkey"]):
                    self.run_once(action, lambda: self.stop_event.is_set() or not self.is_pressed(action["hotkey"]))
                    sleep_cancelable(float(action.get("loopGap", 0.005)), self.stop_event)
                return
            if action["type"] == "click":
                self.run_once(action, lambda: self.stop_event.is_set())
                return
            while not self.stop_event.is_set() and self.is_pressed(action["hotkey"]):
                self.run_once(action, lambda: self.stop_event.is_set() or not self.is_pressed(action["hotkey"]))
                if action["type"] == "autoClick":
                    sleep_cancelable(float(action["clickGap"]), self.stop_event)
        except Exception as exc:
            emit("error", {"message": f"瀹忔墽琛屽け璐ワ細{action['name']} backend={self.driver.mode} error={exc}"})
        finally:
            emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "end"})

    def run_once(self, action: dict[str, Any], cancel: Callable[[], bool]) -> None:
        if action["type"] == "point":
            self.start_point(action)
            sleep_cancelable(0.15, self.stop_event)
            self.release_point(action)
        elif action["type"] == "click":
            self.click_action(action)
        elif action["type"] == "drag":
            self.drag(action, cancel)
        elif action["type"] == "autoClick":
            self.click_at(action["targetX"], action["targetY"])
        elif action["type"] == "script":
            self.run_script(action, cancel)
        else:
            raise ValueError(f"未知指令类型：{action['type']}")

    def start_point(self, action: dict[str, Any]) -> None:
        if action["id"] in self.active_points:
            return
        original = self.driver.position()
        emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "start"})
        try:
            self.driver.move_to(action["targetX"], action["targetY"])
            time.sleep(0.02)
            self.driver.left_down()
            self.active_points[action["id"]] = original
        except Exception:
            self.active_points.pop(action["id"], None)
            emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "end"})
            raise

    def release_point(self, action: dict[str, Any]) -> None:
        original = self.active_points.pop(action["id"], None)
        if original is None:
            return
        self.driver.left_up()
        time.sleep(0.02)
        self.driver.move_to(*original)
        emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "end"})

    def release_points(self) -> None:
        for original in list(self.active_points.values()):
            try:
                self.driver.left_up()
            except OSError as exc:
                emit("log", {"level": "warn", "message": "release touch failed: " + str(exc)})
            self.driver.move_to(*original)
        self.active_points.clear()

    def click_action(self, action: dict[str, Any]) -> None:
        card_key = normalize_key(action.get("cardKey", ""))
        if card_key:
            self.card_key_click(card_key, action)
            return
        self.click_at(action["targetX"], action["targetY"])

    def card_key_click(self, card_key: str, action: dict[str, Any]) -> None:
        # One click-macro cycle: tap 1/2/3, then click the current cursor position.
        # run_while_pressed repeats this function while the hotkey is held.
        with self.mouse_lock:
            self.driver.tap_key(card_key, 0.004)
            time.sleep(max(0.0, min(0.2, float(action.get("cardClickGap", 0.005)))))
            self.driver.click_current(0.006)

    def click_at(self, x: int, y: int) -> None:
        with self.mouse_lock:
            original = self.driver.position()
            self.driver.move_to(x, y)
            time.sleep(0.02)
            self.driver.click()
            time.sleep(0.02)
            self.driver.move_to(*original)


    def drag(self, action: dict[str, Any], cancel: Callable[[], bool]) -> None:
        with self.mouse_lock:
            start_x = int(action["targetX"])
            start_y = int(action["targetY"])
            end_x, end_y = self.driver.position()
            up_x = start_x
            up_y = clamp(start_y - int(action["dragDistance"]), 0, self.driver.resolution.height - 1)
            duration = max(0.01, float(action["dragDuration"]))
            self.driver.move_to(start_x, start_y)
            time.sleep(0.01)
            self.driver.left_down()
            self.smooth_move(start_x, start_y, up_x, up_y, duration * 0.3, cancel)
            self.smooth_move(up_x, up_y, end_x, end_y, duration * 0.7, cancel)
            self.driver.left_up()
            self.driver.move_to(end_x, end_y)

    def sample_release_point(self) -> tuple[int, int]:
        # High-frequency mode: sample once immediately, then keep cursor ownership as short as possible.
        return self.driver.position()

    def run_script(self, action: dict[str, Any], cancel: Callable[[], bool]) -> None:
        program = parse_macro_script(str(action.get("script", "")))
        with self.mouse_lock:
            context = {"mouse": self.driver.position()}
            try:
                self.execute_script_block(program["main"], context, cancel)
            finally:
                if program["release"]:
                    self.execute_script_block(program["release"], context, lambda: False)
                self.driver.release_all()

    def execute_script_block(self, commands: list[dict[str, Any]], context: dict[str, tuple[int, int]], cancel: Callable[[], bool]) -> None:
        for command in commands:
            if cancel() and command["op"] != "release":
                break
            self.execute_script_command(command, context, cancel)

    def execute_script_command(self, command: dict[str, Any], context: dict[str, tuple[int, int]], cancel: Callable[[], bool]) -> None:
        op = command["op"]
        args = command.get("args", [])
        if op == "sleep":
            sleep_cancelable(float(args[0]) / 1000, self.stop_event)
            return
        if op == "loop":
            while not cancel():
                self.execute_script_block(command["body"], context, cancel)
                time.sleep(0.005)
            return
        if op == "move":
            x, y = script_point(args, context)
            duration = float(args[2]) / 1000 if len(args) >= 3 else 0
            if duration > 0:
                sx, sy = self.driver.position()
                self.smooth_move(sx, sy, x, y, duration, cancel)
            else:
                self.driver.move_to(x, y)
            return
        if op == "click":
            x, y = script_point(args, context)
            def do_script_click() -> None:
                original = self.driver.position()
                self.driver.move_to(x, y)
                self.driver.click(float(args[2]) / 1000 if len(args) >= 3 else 0.035)
                self.driver.move_to(*original)
            do_script_click()
            return
        if op == "press":
            x, y = script_point(args, context)
            self.driver.move_to(x, y)
            time.sleep(0.006)
            self.driver.left_down()
            return
        if op == "release":
            x, y = script_point(args, context) if args else self.driver.position()
            self.driver.move_to(x, y)
            time.sleep(0.006)
            self.driver.left_up()
            return
        if op == "drag":
            sx, sy = script_point(args, context)
            ex, ey = script_point(args[2:], context)
            duration = float(args[4]) / 1000 if len(args) >= 5 else 80 / 1000

            def do_script_drag() -> None:
                self.driver.move_to(sx, sy)
                time.sleep(0.006)
                self.driver.left_down()
                try:
                    self.smooth_move(sx, sy, ex, ey, duration, cancel)
                finally:
                    self.driver.left_up()
            do_script_drag()
            return
        if op == "curve":
            points = script_curve_points(args, context)
            duration = float(args[-1]) / 1000 if len(args) % 2 == 1 else 120 / 1000
            if not points:
                return

            def do_script_curve() -> None:
                self.driver.move_to(*points[0])
                self.driver.left_down()
                try:
                    for start, end in zip(points, points[1:]):
                        self.smooth_move(start[0], start[1], end[0], end[1], max(0.01, duration / max(1, len(points) - 1)), cancel)
                finally:
                    self.driver.left_up()
            do_script_curve()
            return
        raise ValueError(f"未知脚本命令：{op}")


    def smooth_move(self, sx: int, sy: int, ex: int, ey: int, duration: float, cancel: Callable[[], bool]) -> None:
        min_steps = clamp(to_int(self.config.get("smoothMoveMinSteps"), DEFAULT_SMOOTH_MOVE_MIN_STEPS), 1, 60)
        step_rate = clamp(to_int(self.config.get("smoothMoveStepRate"), DEFAULT_SMOOTH_MOVE_STEP_RATE), 1, 600)
        steps = max(min_steps, int(duration * step_rate))
        delay = duration / steps
        for step in range(1, steps + 1):
            if cancel():
                break
            progress = step / steps
            self.driver.move_to(int(sx + (ex - sx) * progress), int(sy + (ey - sy) * progress))
            time.sleep(delay)

    def block_keys(self) -> None:
        self.blocked_keys.clear()
        if keyboard is None:
            if KEYBOARD_IMPORT_ERROR:
                emit("log", {"level": "warn", "message": "keyboard module unavailable: " + str(KEYBOARD_IMPORT_ERROR)})
            return
        if not self.config.get("inputTakeoverEnabled", False):
            return
        keys = set(TAKEOVER_KEYS)
        keys.discard(EMERGENCY_EXIT_KEY)
        for action in self.config["actions"]:
            if action.get("enabled", True):
                keys.discard(normalize_key(action.get("hotkey", "")))
        for key in keys:
            if not key or key.startswith("mouse") or key == EMERGENCY_EXIT_KEY:
                continue
            try:
                keyboard.block_key(key)
                self.blocked_keys.add(key)
            except Exception as exc:
                emit("log", {"level": "warn", "message": "Cannot block " + key + ": " + str(exc)})

    def unblock_keys(self) -> None:
        if keyboard is None:
            return
        for key in list(self.blocked_keys):
            try:
                keyboard.unblock_key(key)
            except Exception as exc:
                emit("log", {"level": "warn", "message": f"无法解除屏蔽 {key}: {exc}"})
        self.blocked_keys.clear()

    def is_pressed(self, key_name: str) -> bool:
        key = normalize_key(key_name)
        vk = VK_MAP.get(key)
        if vk is not None:
            if self.keyboard_state.is_pressed_vk(vk):
                return True
            return bool(ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000)
        if keyboard is None:
            return False
        try:
            return keyboard.is_pressed(key)
        except Exception:
            return False

    def load_config(self) -> dict[str, Any]:
        candidates = [self.config_path]
        if self.legacy_config_path:
            candidates.append(self.legacy_config_path)
        for candidate in candidates:
            if candidate.exists():
                try:
                    return normalize_config(json.loads(candidate.read_text(encoding="utf-8")))
                except Exception as exc:
                    emit("log", {"level": "warn", "message": f"配置读取失败 {candidate}: {exc}"})
        return default_config()

    def save_config(self, config: dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.config_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(self.config_path)




def default_script_macro() -> str:
    return "\n".join([
        "# BAMT macro script",
        "loop until_release",
        "  drag 1792 1373 1792 1050 80",
        "  move mouse 45",
        "  sleep 50",
        "end",
    ])


def script_number(value: Any) -> int:
    return int(float(str(value)))


def script_point(args: list[Any], context: dict[str, tuple[int, int]]) -> tuple[int, int]:
    if len(args) == 1 and str(args[0]).lower() == "mouse":
        return context["mouse"]
    if len(args) >= 2 and str(args[0]).lower() == "mouse":
        return context["mouse"]
    if len(args) < 2:
        raise ValueError("脚本命令缺少坐标")
    return script_number(args[0]), script_number(args[1])


def script_curve_points(args: list[Any], context: dict[str, tuple[int, int]]) -> list[tuple[int, int]]:
    values = args[:-1] if len(args) % 2 == 1 else args
    if len(values) == 1 and str(values[0]).lower() == "mouse":
        return [context["mouse"]]
    points = []
    index = 0
    while index + 1 < len(values):
        if str(values[index]).lower() == "mouse":
            points.append(context["mouse"])
            index += 1
        else:
            points.append((script_number(values[index]), script_number(values[index + 1])))
            index += 2
    return points


def parse_macro_script(script: str) -> dict[str, list[dict[str, Any]]]:
    lines = script.replace("\r\n", "\n").split("\n")
    main: list[dict[str, Any]] = []
    release: list[dict[str, Any]] = []
    stack: list[list[dict[str, Any]]] = [main]
    target = main
    for line_no, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//") or line.startswith(";"):
            continue
        lower = line.lower()
        if lower in {"release_actions", "release_actions:"}:
            if len(stack) != 1:
                raise ValueError(f"脚本第 {line_no} 行：release_actions 不能写在 loop 内")
            target = release
            stack = [release]
            continue
        if lower in {"end", "}" }:
            if len(stack) == 1:
                raise ValueError(f"脚本第 {line_no} 行：多余的 end")
            stack.pop()
            continue
        parts = line.replace(",", " ").split()
        op = parts[0].lower()
        args = parts[1:]
        if op == "sleep":
            if not args:
                raise ValueError(f"脚本第 {line_no} 行：sleep 需要毫秒数")
            stack[-1].append({"op": "sleep", "args": [float(args[0])]})
        elif op == "loop":
            if "until_release" not in [arg.lower() for arg in args]:
                raise ValueError(f"脚本第 {line_no} 行：目前只支持 loop until_release")
            command = {"op": "loop", "body": []}
            stack[-1].append(command)
            stack.append(command["body"])
        elif op in {"click", "press", "release", "move", "drag", "curve"}:
            stack[-1].append({"op": op, "args": args})
        else:
            raise ValueError(f"脚本第 {line_no} 行：不支持命令 {op}")
    if len(stack) != 1:
        raise ValueError("脚本缺少 end")
    return {"main": main, "release": release}


def normalize_skill_slot_x_offsets(value: Any) -> list[float]:
    source = value if isinstance(value, list) and len(value) >= 3 else DEFAULT_SKILL_SLOT_X_OFFSETS
    offsets: list[float] = []
    for index, fallback in enumerate(DEFAULT_SKILL_SLOT_X_OFFSETS):
        try:
            offsets.append(max(-0.45, min(0.45, float(source[index]))))
        except Exception:
            offsets.append(fallback)
    return offsets


def calculate_skill_slots(resolution: Dict[str, int], tuning: Dict[str, Any] | None = None) -> List[Dict[str, int]]:
    tuning = tuning or {}
    x_offsets = normalize_skill_slot_x_offsets(tuning.get("skillSlotXOffsets"))
    bottom_ratio = max(0.03, min(0.16, to_float(tuning.get("skillSlotBottomOffsetRatio"), DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO)))
    y = round(resolution["height"] - resolution["width"] * bottom_ratio)
    return [{"x": round(resolution["width"] * (0.5 + offset)), "y": y} for offset in x_offsets]


def create_skill_drag_actions(resolution: Dict[str, int], tuning: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    slots = calculate_skill_slots(resolution, tuning)
    actions: List[Dict[str, Any]] = []
    for index, slot in enumerate(slots, start=1):
        actions.append({
            "id": "skill-drag-" + str(index),
            "name": "Skill Drag " + str(index),
            "hotkey": ["q", "w", "e"][index - 1],
            "type": "drag",
            "cardKey": "",
            "targetX": slot["x"],
            "targetY": slot["y"],
            "dragDistance": 300,
            "dragDuration": 0.02,
            "clickGap": 0.1,
            "cardClickGap": 0.005,
            "loopGap": 0.005,
            "enabled": True,
            "script": default_script_macro(),
        })
    return actions

def default_config() -> Dict[str, Any]:
    return {
        "version": "2.2",
        "resolution": {"width": 2560, "height": 1600},
        "exitKey": EMERGENCY_EXIT_KEY,
        "inputTakeoverEnabled": False,
        "inputBackend": "cursor",
        "actions": create_skill_drag_actions({"width": 2560, "height": 1600}),
    }


def normalize_config(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    resolution = data.get("resolution") if isinstance(data.get("resolution"), dict) else {}
    normalized_resolution = {"width": to_int(resolution.get("width"), 2560), "height": to_int(resolution.get("height"), 1600)}
    tuning = {
        "skillSlotXOffsets": normalize_skill_slot_x_offsets(data.get("skillSlotXOffsets")),
        "skillSlotBottomOffsetRatio": max(0.03, min(0.16, to_float(data.get("skillSlotBottomOffsetRatio"), DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO))),
        "smoothMoveMinSteps": clamp(to_int(data.get("smoothMoveMinSteps"), DEFAULT_SMOOTH_MOVE_MIN_STEPS), 1, 60),
        "smoothMoveStepRate": clamp(to_int(data.get("smoothMoveStepRate"), DEFAULT_SMOOTH_MOVE_STEP_RATE), 1, 600),
    }
    actions = data.get("actions") if isinstance(data.get("actions"), list) else create_skill_drag_actions(normalized_resolution, tuning)
    return {
        "version": "2.6",
        "resolution": normalized_resolution,
        "exitKey": EMERGENCY_EXIT_KEY,
        "inputTakeoverEnabled": bool(data.get("inputTakeoverEnabled", False)),
        "inputBackend": normalize_input_backend(data.get("inputBackend", data.get("input_backend", "cursor"))),
        **tuning,
        "actions": [normalize_action(action, index) for index, action in enumerate(actions) if isinstance(action, dict)],
    }


def normalize_action(data: dict[str, Any], index: int) -> dict[str, Any]:
    type_map = {"鐐逛綅": "point", "鎷栧姩": "drag", "杩炵偣": "autoClick", "鐐瑰嚮": "click", "鑴氭湰": "script"}
    action_type = type_map.get(str(data.get("type")), data.get("type", "point"))
    slot_index = skill_slot_index(data)
    if action_type not in {"point", "drag", "autoClick", "click", "script"}:
        action_type = "point"
    hotkey = normalize_key(data.get("hotkey", "q"))
    card_key = normalize_card_key(data.get("cardKey", data.get("card_key", "")))
    return {
        "id": str(data.get("id") or f"macro-{index}-{hotkey or 'key'}"),
        "name": str(data.get("name") or f"鎸囦护{index + 1}"),
        "hotkey": hotkey,
        "type": action_type,
        "cardKey": card_key,
        "targetX": to_int(data.get("targetX", data.get("target_x")), 1280),
        "targetY": to_int(data.get("targetY", data.get("target_y")), 800),
        "dragDistance": to_int(data.get("dragDistance", data.get("drag_dist")), 300),
        "dragDuration": normalize_drag_duration(data, action_type),
        "clickGap": to_float(data.get("clickGap", data.get("click_gap")), 0.1),
        "cardClickGap": to_float(data.get("cardClickGap", data.get("card_click_gap")), 0.005),
        "loopGap": to_float(data.get("loopGap", data.get("loop_gap")), 0.005),
        "enabled": data.get("enabled", True) is not False,
        "script": str(data.get("script") or default_script_macro()),
    }


def skill_slot_index(data: dict[str, Any]) -> int:
    raw_id = str(data.get("id", ""))
    if raw_id.startswith("skill-drag-"):
        try:
            index = int(raw_id.rsplit("-", 1)[1]) - 1
            return index if 0 <= index <= 2 else -1
        except Exception:
            return -1
    return -1


def normalize_card_key(value: Any) -> str:
    key = normalize_key(value)
    return key if key in {"1", "2", "3"} else ""


def normalize_input_backend(value: Any) -> str:
    mode = str(value or "").strip()
    return mode if mode in {"cursor", "windowMessage", "touch"} else "cursor"


def normalize_drag_duration(data: dict[str, Any], action_type: str) -> float:
    value = to_float(data.get("dragDuration", data.get("drag_time")), 0.02 if action_type == "drag" else 0.03)
    if action_type == "drag" and value >= 0.079:
        return 0.02
    return value


def validate_config(config: dict[str, Any]) -> None:
    errors: list[str] = []
    resolution = config["resolution"]
    if resolution["width"] < 100 or resolution["height"] < 100:
        errors.append("分辨率需要大于 100 x 100")
    if not config["exitKey"]:
        errors.append("停止键不能为空")
    used: dict[str, str] = {}
    for action in config["actions"]:
        if not action.get("enabled", True):
            continue
        key = action["hotkey"]
        if not key:
            errors.append(f"{action['name']} 的热键不能为空")
        if key == config["exitKey"]:
            errors.append(f"{action['name']} 的热键不能与停止键相同")
        if key == EMERGENCY_EXIT_KEY:
            errors.append(f"{action['name']} 的热键不能使用固定强制停止键 X")
        if key in used:
            errors.append(f"{action['name']} 与 {used[key]} 使用了相同热键 {key}")
        used[key] = action["name"]
        if action["targetX"] < 0 or action["targetY"] < 0:
            errors.append(f"{action['name']} 的坐标不能为负数")
        if action["targetX"] > resolution["width"] or action["targetY"] > resolution["height"]:
            errors.append(f"{action['name']} 的坐标超出当前分辨率")
        if action["type"] == "script" and not str(action.get("script", "")).strip():
            errors.append(f"{action['name']} 的脚本内容不能为空")
        if action["dragDistance"] <= 0 or action["dragDuration"] <= 0 or action["clickGap"] <= 0 or action["cardClickGap"] < 0 or action["loopGap"] <= 0:
            errors.append(f"{action['name']} 的数值参数必须大于 0")
    if errors:
        raise ValueError("；".join(errors))


def normalize_key(value: Any) -> str:
    return str(value or "").strip().lower()


def to_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def to_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def sleep_cancelable(seconds: float, stop_event: threading.Event) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and not stop_event.is_set():
        time.sleep(min(0.02, max(0.0, deadline - time.monotonic())))


def main() -> None:
    service = MacroService()
    emit("status", {"status": "ready", "message": "宏服务已就绪"})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            result = service.handle(message.get("command", ""), message.get("payload"))
            send({"id": message.get("id"), "ok": True, "result": result})
            if message.get("command") == "shutdown":
                break
        except Exception as exc:
            send({"id": message.get("id"), "ok": False, "error": str(exc)})
            emit("error", {"message": str(exc)})


if __name__ == "__main__":
    main()



