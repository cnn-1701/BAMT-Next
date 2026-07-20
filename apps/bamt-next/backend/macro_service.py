import ctypes
import json
import os
import sys
import threading
import time
from ctypes import POINTER, Structure, Union, byref, c_long, c_ulong, sizeof
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

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


class POINT(Structure):
    _fields_ = [("x", c_long), ("y", c_long)]


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


class InputDriver:
    def __init__(self, resolution: Resolution) -> None:
        self.resolution = resolution
        self.user32 = ctypes.windll.user32
        try:
            self.user32.SetProcessDPIAware()
        except Exception:
            pass
        self.left_is_down = False

    def update_resolution(self, resolution: Resolution) -> None:
        self.resolution = resolution

    def position(self) -> tuple[int, int]:
        point = POINT()
        if not self.user32.GetCursorPos(byref(point)):
            raise ctypes.WinError()
        return int(point.x), int(point.y)

    def move_to(self, x: int, y: int) -> None:
        width = max(1, self.resolution.width - 1)
        height = max(1, self.resolution.height - 1)
        x = clamp(int(x), 0, width)
        y = clamp(int(y), 0, height)
        abs_x = int(x * 65535 / width)
        abs_y = int(y * 65535 / height)
        self.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, abs_x, abs_y)

    def left_down(self) -> None:
        self.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0)
        self.left_is_down = True

    def left_up(self) -> None:
        self.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0)
        self.left_is_down = False

    def click(self, delay: float = 0.035) -> None:
        self.left_down()
        time.sleep(delay)
        self.left_up()

    def release_all(self) -> None:
        if self.left_is_down:
            self.left_up()

    def mouse_event(self, flags: int, dx: int, dy: int) -> None:
        extra = c_ulong(0)
        packet = INPUT(type=0, ii=INPUT_UNION(mi=MOUSEINPUT(dx, dy, 0, flags, 0, ctypes.pointer(extra))))
        if self.user32.SendInput(1, byref(packet), sizeof(INPUT)) != 1:
            raise ctypes.WinError()


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


class MacroService:
    def __init__(self) -> None:
        self.config_path = Path(os.environ.get("BAMT_CONFIG_PATH", "blue_archive_config.json"))
        legacy = os.environ.get("BAMT_LEGACY_CONFIG_PATH", "")
        self.legacy_config_path = Path(legacy) if legacy else None
        self.config = self.load_config()
        self.driver = InputDriver(Resolution(**self.config["resolution"]))
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.listen_thread: threading.Thread | None = None
        self.worker_threads: list[threading.Thread] = []
        self.blocked_keys: set[str] = set()
        self.active_points: dict[str, tuple[int, int]] = {}

    def handle(self, command: str, payload: Any) -> Any:
        if command == "get_initial_config":
            return self.config
        if command == "load_config":
            self.config = self.load_config()
            self.driver.update_resolution(Resolution(**self.config["resolution"]))
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
            self.stop_event.clear()
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
        action = normalize_action((payload or {}).get("action", {}), 0)
        config = normalize_config((payload or {}).get("config", self.config))
        validate_config({**config, "actions": [action]})
        self.driver.update_resolution(Resolution(**config["resolution"]))
        self.run_once(action, lambda: False)
        return {"status": "ready", "message": f"已测试 {action['name']}"}

    def listen_loop(self) -> None:
        actions = [action for action in self.config["actions"] if action.get("enabled", True)]
        states = {action["id"]: False for action in actions}
        emit("log", {"level": "info", "message": f"已加载 {len(actions)} 条指令"})
        try:
            while not self.stop_event.is_set():
                if self.is_pressed(self.config["exitKey"]):
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
        if action["type"] == "point":
            self.start_point(action)
            return
        thread = threading.Thread(target=self.run_while_pressed, args=(action,), daemon=True)
        self.worker_threads.append(thread)
        thread.start()

    def on_key_up(self, action: dict[str, Any]) -> None:
        if action["type"] == "point":
            self.release_point(action)

    def run_while_pressed(self, action: dict[str, Any]) -> None:
        emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "start"})
        try:
            if action["type"] == "click":
                self.run_once(action, lambda: self.stop_event.is_set())
                return
            while not self.stop_event.is_set() and self.is_pressed(action["hotkey"]):
                self.run_once(action, lambda: self.stop_event.is_set() or not self.is_pressed(action["hotkey"]))
                if action["type"] == "drag":
                    sleep_cancelable(0.05, self.stop_event)
                elif action["type"] == "autoClick":
                    sleep_cancelable(float(action["clickGap"]), self.stop_event)
        finally:
            emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "end"})

    def run_once(self, action: dict[str, Any], cancel: Callable[[], bool]) -> None:
        if action["type"] == "point":
            self.start_point(action)
            sleep_cancelable(0.15, self.stop_event)
            self.release_point(action)
        elif action["type"] == "click":
            self.click_at(action["targetX"], action["targetY"])
        elif action["type"] == "drag":
            self.drag(action, cancel)
        elif action["type"] == "autoClick":
            self.driver.click()
        else:
            raise ValueError(f"未知指令类型：{action['type']}")

    def start_point(self, action: dict[str, Any]) -> None:
        if action["id"] in self.active_points:
            return
        self.active_points[action["id"]] = self.driver.position()
        emit("execution", {"actionId": action["id"], "actionName": action["name"], "phase": "start"})
        self.driver.move_to(action["targetX"], action["targetY"])
        time.sleep(0.02)
        self.driver.left_down()

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
            self.driver.left_up()
            self.driver.move_to(*original)
        self.active_points.clear()

    def click_at(self, x: int, y: int) -> None:
        original = self.driver.position()
        self.driver.move_to(x, y)
        time.sleep(0.02)
        self.driver.click()
        time.sleep(0.02)
        self.driver.move_to(*original)

    def drag(self, action: dict[str, Any], cancel: Callable[[], bool]) -> None:
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

    def smooth_move(self, sx: int, sy: int, ex: int, ey: int, duration: float, cancel: Callable[[], bool]) -> None:
        steps = max(3, int(duration * 120))
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
                emit("log", {"level": "warn", "message": f"keyboard 模块不可用：{KEYBOARD_IMPORT_ERROR}"})
            return
        for key in {action["hotkey"] for action in self.config["actions"] if action.get("enabled", True)}:
            if key.startswith("mouse"):
                continue
            try:
                keyboard.block_key(key)
                self.blocked_keys.add(key)
            except Exception as exc:
                emit("log", {"level": "warn", "message": f"无法屏蔽热键 {key}: {exc}"})

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


def default_config() -> dict[str, Any]:
    return {
        "version": "2.1",
        "resolution": {"width": 2560, "height": 1600},
        "exitKey": "s",
        "actions": [{
            "id": "macro-q-drag", "name": "指令1", "hotkey": "q", "type": "drag",
            "targetX": 2038, "targetY": 1365, "dragDistance": 300, "dragDuration": 0.03,
            "clickGap": 0.1, "enabled": True,
        }],
    }


def normalize_config(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    resolution = data.get("resolution") if isinstance(data.get("resolution"), dict) else {}
    actions = data.get("actions") if isinstance(data.get("actions"), list) else default_config()["actions"]
    return {
        "version": "2.1",
        "resolution": {"width": to_int(resolution.get("width"), 2560), "height": to_int(resolution.get("height"), 1600)},
        "exitKey": normalize_key(data.get("exitKey", data.get("exit_key", "s"))),
        "actions": [normalize_action(action, index) for index, action in enumerate(actions) if isinstance(action, dict)],
    }


def normalize_action(data: dict[str, Any], index: int) -> dict[str, Any]:
    type_map = {"点位": "point", "拖动": "drag", "连点": "autoClick", "点击": "click"}
    action_type = type_map.get(str(data.get("type")), data.get("type", "point"))
    if action_type not in {"point", "drag", "autoClick", "click"}:
        action_type = "point"
    hotkey = normalize_key(data.get("hotkey", "q"))
    return {
        "id": str(data.get("id") or f"macro-{index}-{hotkey or 'key'}"),
        "name": str(data.get("name") or f"指令{index + 1}"),
        "hotkey": hotkey,
        "type": action_type,
        "targetX": to_int(data.get("targetX", data.get("target_x")), 1280),
        "targetY": to_int(data.get("targetY", data.get("target_y")), 800),
        "dragDistance": to_int(data.get("dragDistance", data.get("drag_dist")), 300),
        "dragDuration": to_float(data.get("dragDuration", data.get("drag_time")), 0.03),
        "clickGap": to_float(data.get("clickGap", data.get("click_gap")), 0.1),
        "enabled": data.get("enabled", True) is not False,
    }


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
        if key in used:
            errors.append(f"{action['name']} 与 {used[key]} 使用了相同热键 {key}")
        used[key] = action["name"]
        if action["targetX"] < 0 or action["targetY"] < 0:
            errors.append(f"{action['name']} 的坐标不能为负数")
        if action["targetX"] > resolution["width"] or action["targetY"] > resolution["height"]:
            errors.append(f"{action['name']} 的坐标超出当前分辨率")
        if action["dragDistance"] <= 0 or action["dragDuration"] <= 0 or action["clickGap"] <= 0:
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
