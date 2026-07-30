use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::mem::{size_of, zeroed};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

type Bool = i32;
type Dword = u32;
type Uint = u32;
type Word = u16;
type Long = i32;
type Wparam = usize;
type Lparam = isize;
type Lresult = isize;
type Hhook = isize;
type Hwnd = isize;

const INPUT_MOUSE: Dword = 0;
const INPUT_KEYBOARD: Dword = 1;
const KEYEVENTF_KEYUP: Dword = 0x0002;
const MOUSEEVENTF_MOVE: Dword = 0x0001;
const MOUSEEVENTF_LEFTDOWN: Dword = 0x0002;
const MOUSEEVENTF_LEFTUP: Dword = 0x0004;
const MOUSEEVENTF_ABSOLUTE: Dword = 0x8000;
const MOUSEEVENTF_VIRTUALDESK: Dword = 0x4000;
const WH_KEYBOARD_LL: i32 = 13;
const WH_MOUSE_LL: i32 = 14;
const WM_MOUSEMOVE: Wparam = 0x0200;
const WM_KEYDOWN: Wparam = 0x0100;
const WM_KEYUP: Wparam = 0x0101;
const WM_SYSKEYDOWN: Wparam = 0x0104;
const WM_SYSKEYUP: Wparam = 0x0105;
const WM_QUIT: Uint = 0x0012;
const VK_X: u32 = b'X' as u32;
const SM_XVIRTUALSCREEN: i32 = 76;
const SM_YVIRTUALSCREEN: i32 = 77;
const SM_CXVIRTUALSCREEN: i32 = 78;
const SM_CYVIRTUALSCREEN: i32 = 79;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
struct Point { x: Long, y: Long }

#[repr(C)]
#[derive(Clone, Copy)]
struct Msg { hwnd: Hwnd, message: Uint, w_param: Wparam, l_param: Lparam, time: Dword, pt: Point }

#[repr(C)]
#[derive(Clone, Copy)]
struct KbdLlHookStruct { vk_code: Dword, scan_code: Dword, flags: Dword, time: Dword, dw_extra_info: usize }

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseLlHookStruct { pt: Point, mouse_data: Dword, flags: Dword, time: Dword, dw_extra_info: usize }

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput { dx: Long, dy: Long, mouse_data: Dword, dw_flags: Dword, time: Dword, dw_extra_info: usize }

#[repr(C)]
#[derive(Clone, Copy)]
struct KeybdInput { w_vk: Word, w_scan: Word, dw_flags: Dword, time: Dword, dw_extra_info: usize }

#[repr(C)]
union InputUnion { mi: MouseInput, ki: KeybdInput }

#[repr(C)]
struct Input { r#type: Dword, u: InputUnion }

type HookProc = Option<unsafe extern "system" fn(i32, Wparam, Lparam) -> Lresult>;

#[link(name = "user32")]
extern "system" {
    fn SendInput(c_inputs: Uint, p_inputs: *mut Input, cb_size: i32) -> Uint;
    fn GetCursorPos(lp_point: *mut Point) -> Bool;
    fn GetSystemMetrics(n_index: i32) -> i32;
    fn SetWindowsHookExW(id_hook: i32, lpfn: HookProc, hmod: isize, dw_thread_id: Dword) -> Hhook;
    fn CallNextHookEx(hhk: Hhook, n_code: i32, w_param: Wparam, l_param: Lparam) -> Lresult;
    fn UnhookWindowsHookEx(hhk: Hhook) -> Bool;
    fn GetMessageW(lp_msg: *mut Msg, hwnd: Hwnd, w_msg_filter_min: Uint, w_msg_filter_max: Uint) -> Bool;
    fn PostThreadMessageW(id_thread: Dword, msg: Uint, w_param: Wparam, l_param: Lparam) -> Bool;
}

#[link(name = "kernel32")]
extern "system" { fn GetCurrentThreadId() -> Dword; }

#[derive(Clone, Copy, Debug)]
struct Resolution { width: i32, height: i32 }

#[derive(Clone, Debug)]
struct Action {
    id: String,
    name: String,
    hotkey: String,
    action_type: String,
    card_key: String,
    target_x: i32,
    target_y: i32,
    drag_distance: i32,
    drag_duration: f64,
    card_click_gap: f64,
    click_gap: f64,
    loop_gap: f64,
    script: String,
}

struct Request { id: String, command: String, payload: String }

struct Runtime {
    stop: AtomicBool,
    hook_alive: AtomicBool,
    hook_thread_id: AtomicU32,
    mouse_hook_alive: AtomicBool,
    mouse_hook_thread_id: AtomicU32,
    drag_active: AtomicBool,
    intended_cursor: Mutex<Point>,
    actions: Mutex<Vec<Action>>,
    resolution: Mutex<Resolution>,
    active: Mutex<HashMap<u32, Arc<AtomicBool>>>,
    out: Mutex<()>,
}

static RUNTIME: OnceLock<Arc<Runtime>> = OnceLock::new();

fn runtime() -> Arc<Runtime> {
    RUNTIME.get_or_init(|| Arc::new(Runtime {
        stop: AtomicBool::new(false),
        hook_alive: AtomicBool::new(false),
        hook_thread_id: AtomicU32::new(0),
        mouse_hook_alive: AtomicBool::new(false),
        mouse_hook_thread_id: AtomicU32::new(0),
        drag_active: AtomicBool::new(false),
        intended_cursor: Mutex::new(Point::default()),
        actions: Mutex::new(Vec::new()),
        resolution: Mutex::new(Resolution { width: 2560, height: 1600 }),
        active: Mutex::new(HashMap::new()),
        out: Mutex::new(()),
    })).clone()
}

fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

fn compact_json(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escape = false;
    for ch in value.chars() {
        if in_string {
            out.push(ch);
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else if ch == '"' {
            in_string = true;
            out.push(ch);
        } else if !ch.is_whitespace() {
            out.push(ch);
        }
    }
    out
}
fn write_line(line: &str) {
    let rt = runtime();
    let _guard = rt.out.lock().ok();
    println!("{}", line);
    let _ = io::stdout().flush();
}

fn emit(event_type: &str, payload: &str) {
    write_line(&format!("{{\"event\":{{\"type\":\"{}\",\"payload\":{}}}}}", json_escape(event_type), payload));
}

fn emit_log(level: &str, message: &str) {
    emit("log", &format!("{{\"level\":\"{}\",\"message\":\"{}\"}}", json_escape(level), json_escape(message)));
}

fn respond_ok(id: &str, result: &str) { write_line(&format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", id, compact_json(result))); }
fn respond_err(id: &str, error: &str) {
    write_line(&format!("{{\"id\":{},\"ok\":false,\"error\":\"{}\"}}", id, json_escape(error)));
    emit("error", &format!("{{\"message\":\"{}\"}}", json_escape(error)));
}

fn config_path() -> PathBuf {
    env::var_os("BAMT_CONFIG_PATH").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("blue_archive_config.json"))
}

fn default_config() -> String {
    format!("{{\"version\":\"rust-0.2\",\"resolution\":{{\"width\":2560,\"height\":1600}},\"exitKey\":\"x\",\"inputTakeoverEnabled\":false,\"inputBackend\":\"cursor\",\"skillSlotXOffsets\":[0.2,0.28,0.362],\"skillSlotBottomOffsetRatio\":0.071,\"smoothMoveMinSteps\":2,\"smoothMoveStepRate\":80,\"actions\":{}}}", default_actions())
}

fn default_actions() -> String {
    let mut parts = Vec::new();
    for (idx, (key, offset)) in [("q", 0.200_f64), ("w", 0.280_f64), ("e", 0.362_f64)].iter().enumerate() {
        let x = (2560.0 * (0.5 + offset)).round() as i32;
        let y = (1600.0_f64 - 2560.0_f64 * 0.071_f64).round() as i32;
        parts.push(format!("{{\"id\":\"skill-drag-{}\",\"name\":\"Rust Drag {}\",\"hotkey\":\"{}\",\"type\":\"drag\",\"cardKey\":\"{}\",\"targetX\":{},\"targetY\":{},\"dragDistance\":300,\"dragDuration\":0.02,\"clickGap\":0.1,\"cardClickGap\":0.010,\"loopGap\":0.05,\"enabled\":true,\"script\":\"\"}}", idx + 1, idx + 1, key, idx + 1, x, y));
    }
    format!("[{}]", parts.join(","))
}

fn load_config() -> String { fs::read_to_string(config_path()).unwrap_or_else(|_| default_config()) }

fn load_config_and_sync_resolution() -> String {
    let config = load_config();
    if let Ok(mut resolution) = runtime().resolution.lock() { *resolution = resolution_from_config(&config); }
    config
}

fn save_config(payload: &str) -> Result<String, String> {
    let path = config_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let text = if payload.trim().is_empty() || payload.trim() == "null" { default_config() } else { payload.trim().to_string() };
    fs::write(path, &text).map_err(|e| e.to_string())?;
    if let Ok(mut resolution) = runtime().resolution.lock() { *resolution = resolution_from_config(&text); }
    Ok(text)
}

fn find_key_colon(src: &str, key: &str) -> Option<usize> {
    let quoted = format!("\"{}\"", key);
    let start = src.find(&quoted)? + quoted.len();
    src[start..].find(':').map(|i| start + i + 1)
}

fn scan_json_value(src: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = src.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
    if i >= bytes.len() { return None; }
    let begin = i;
    if bytes[i] == b'"' {
        i += 1;
        while i < bytes.len() {
            if bytes[i] == b'\\' { i += 2; continue; }
            if bytes[i] == b'"' { return Some((begin, i + 1)); }
            i += 1;
        }
        return None;
    }
    if bytes[i] == b'{' || bytes[i] == b'[' {
        let open = bytes[i];
        let close = if open == b'{' { b'}' } else { b']' };
        let mut depth = 0_i32;
        let mut in_string = false;
        while i < bytes.len() {
            let b = bytes[i];
            if in_string {
                if b == b'\\' { i += 2; continue; }
                if b == b'"' { in_string = false; }
            } else if b == b'"' { in_string = true; }
            else if b == open { depth += 1; }
            else if b == close {
                depth -= 1;
                if depth == 0 { return Some((begin, i + 1)); }
            }
            i += 1;
        }
        return None;
    }
    while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b']' { i += 1; }
    Some((begin, i))
}

fn raw_value(src: &str, key: &str) -> Option<String> {
    let colon = find_key_colon(src, key)?;
    let (a, b) = scan_json_value(src, colon)?;
    Some(src[a..b].trim().to_string())
}

fn string_value(src: &str, key: &str) -> Option<String> {
    let raw = raw_value(src, key)?;
    if !raw.starts_with('"') || !raw.ends_with('"') { return None; }
    Some(raw[1..raw.len() - 1].replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\"))
}

fn number_value(src: &str, key: &str, fallback: f64) -> f64 {
    raw_value(src, key).and_then(|v| v.parse::<f64>().ok()).unwrap_or(fallback)
}

fn bool_value(src: &str, key: &str, fallback: bool) -> bool {
    match raw_value(src, key).as_deref() { Some("true") => true, Some("false") => false, _ => fallback }
}

fn parse_request(line: &str) -> Result<Request, String> {
    let id = raw_value(line, "id").unwrap_or_else(|| "null".to_string());
    let command = string_value(line, "command").ok_or_else(|| "Missing command".to_string())?;
    let payload = raw_value(line, "payload").unwrap_or_else(|| "null".to_string());
    Ok(Request { id, command, payload })
}

fn split_objects(array: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(pos) = array[i..].find('{') {
        let start = i + pos;
        if let Some((_, end)) = scan_json_value(array, start) {
            out.push(array[start..end].to_string());
            i = end;
        } else { break; }
    }
    out
}

fn resolution_from_config(config: &str) -> Resolution {
    let raw = raw_value(config, "resolution").unwrap_or_default();
    Resolution { width: number_value(&raw, "width", 2560.0).max(100.0) as i32, height: number_value(&raw, "height", 1600.0).max(100.0) as i32 }
}

fn actions_from_config(config: &str) -> Vec<Action> {
    let Some(actions_raw) = raw_value(config, "actions") else { return Vec::new(); };
    split_objects(&actions_raw).into_iter().filter_map(|obj| {
        if !bool_value(&obj, "enabled", true) { return None; }
        let action_type = string_value(&obj, "type").unwrap_or_else(|| "point".to_string());
        if !matches!(action_type.as_str(), "fastPlay" | "drag" | "point" | "click" | "rapid" | "script") { return None; }
        let hotkey = string_value(&obj, "hotkey").unwrap_or_default();
        if key_to_vk(&hotkey).is_none() { return None; }
        let card_key = string_value(&obj, "cardKey").unwrap_or_default();
        if action_type == "fastPlay" && key_to_vk(&card_key).is_none() { return None; }
        let default_loop_gap = if action_type == "drag" { 0.05 } else { 0.001 };
        Some(Action {
            id: string_value(&obj, "id").unwrap_or_else(|| hotkey.clone()),
            name: string_value(&obj, "name").unwrap_or_else(|| format!("Rust {}", action_type)),
            hotkey,
            action_type: action_type.clone(),
            card_key,
            target_x: number_value(&obj, "targetX", 1280.0) as i32,
            target_y: number_value(&obj, "targetY", 800.0) as i32,
            drag_distance: number_value(&obj, "dragDistance", 300.0) as i32,
            drag_duration: number_value(&obj, "dragDuration", 0.03),
            card_click_gap: number_value(&obj, "cardClickGap", 0.010),
            click_gap: number_value(&obj, "clickGap", 0.015),
            loop_gap: number_value(&obj, "loopGap", default_loop_gap),
            script: string_value(&obj, "script").unwrap_or_default(),
        })
    }).collect()
}

fn key_to_vk(key: &str) -> Option<u32> {
    let lowered = key.trim().to_ascii_lowercase();
    if lowered.len() == 1 {
        let b = lowered.as_bytes()[0];
        if b.is_ascii_lowercase() { return Some((b - 32) as u32); }
        if b.is_ascii_digit() { return Some(b as u32); }
    }
    match lowered.as_str() { "space" => Some(0x20), "tab" => Some(0x09), "enter" => Some(0x0D), "esc" | "escape" => Some(0x1B), _ => None }
}

fn current_resolution() -> Resolution { *runtime().resolution.lock().unwrap_or_else(|e| e.into_inner()) }

fn virtual_screen_bounds() -> (i32, i32, i32, i32) {
    unsafe {
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1);
        (left, top, width, height)
    }
}

fn cursor_pos() -> Point {
    let mut point = Point::default();
    unsafe { GetCursorPos(&mut point); }
    point
}

fn logical_to_screen(x: i32, y: i32) -> Point {
    let res = current_resolution();
    let (left, top, sw, sh) = virtual_screen_bounds();
    let lw = (res.width - 1).max(1);
    let lh = (res.height - 1).max(1);
    let lx = x.clamp(0, lw);
    let ly = y.clamp(0, lh);
    Point { x: left + ((lx as f64) * ((sw - 1) as f64) / (lw as f64)).round() as i32, y: top + ((ly as f64) * ((sh - 1) as f64) / (lh as f64)).round() as i32 }
}

fn screen_to_logical(point: Point) -> Point {
    let res = current_resolution();
    let (left, top, sw, sh) = virtual_screen_bounds();
    let lw = (res.width - 1).max(1);
    let lh = (res.height - 1).max(1);
    let sx = (point.x - left).clamp(0, (sw - 1).max(0));
    let sy = (point.y - top).clamp(0, (sh - 1).max(0));
    Point {
        x: (((sx as f64) * (lw as f64) / ((sw - 1).max(1) as f64)).round() as i32).clamp(0, lw),
        y: (((sy as f64) * (lh as f64) / ((sh - 1).max(1) as f64)).round() as i32).clamp(0, lh),
    }
}

fn move_screen(point: Point) {
    let (left, top, sw, sh) = virtual_screen_bounds();
    let abs_x = (((point.x - left) as f64) * 65535.0 / ((sw - 1).max(1) as f64)).round() as i32;
    let abs_y = (((point.y - top) as f64) * 65535.0 / ((sh - 1).max(1) as f64)).round() as i32;
    let mut input = Input { r#type: INPUT_MOUSE, u: InputUnion { mi: MouseInput { dx: abs_x, dy: abs_y, mouse_data: 0, dw_flags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, time: 0, dw_extra_info: 0 } } };
    unsafe { SendInput(1, &mut input, size_of::<Input>() as i32); }
}

fn move_logical(x: i32, y: i32) { move_screen(logical_to_screen(x, y)); }

fn clamp_seconds(value: f64, fallback: f64, min: f64, max: f64) -> Duration {
    let seconds = if value.is_finite() { value } else { fallback };
    Duration::from_secs_f64(seconds.clamp(min, max))
}

fn sleep_cancelable(duration: Duration, cancel: &AtomicBool) {
    let start = Instant::now();
    while start.elapsed() < duration {
        if cancel.load(Ordering::Relaxed) || runtime().stop.load(Ordering::Relaxed) { break; }
        thread::sleep(Duration::from_millis(1));
    }
}

fn send_keyboard(vk: u16, key_up: bool) {
    let mut input = Input { r#type: INPUT_KEYBOARD, u: InputUnion { ki: KeybdInput { w_vk: vk, w_scan: 0, dw_flags: if key_up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dw_extra_info: 0 } } };
    unsafe { SendInput(1, &mut input, size_of::<Input>() as i32); }
}

fn send_key_press(vk: u16) {
    send_keyboard(vk, false);
    thread::sleep(Duration::from_millis(2));
    send_keyboard(vk, true);
}

fn send_mouse_left(down: bool) {
    let mut input = Input { r#type: INPUT_MOUSE, u: InputUnion { mi: MouseInput { dx: 0, dy: 0, mouse_data: 0, dw_flags: if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, time: 0, dw_extra_info: 0 } } };
    unsafe { SendInput(1, &mut input, size_of::<Input>() as i32); }
}

fn click_current(delay: Duration) {
    send_mouse_left(true);
    thread::sleep(delay);
    send_mouse_left(false);
}

fn execute_fast_play_once(action: &Action) {
    if let Some(vk) = key_to_vk(&action.card_key) {
        send_key_press(vk as u16);
        thread::sleep(clamp_seconds(action.card_click_gap, 0.010, 0.0, 0.3));
        click_current(clamp_seconds(action.drag_duration, 0.03, 0.001, 0.3));
    }
}

fn execute_drag_once(action: &Action, cancel: &AtomicBool) {
    let start_release = cursor_pos();
    if let Ok(mut intended) = runtime().intended_cursor.lock() { *intended = start_release; }
    runtime().drag_active.store(true, Ordering::SeqCst);

    let up_y = (action.target_y - action.drag_distance).max(0);
    move_logical(action.target_x, action.target_y);
    thread::sleep(Duration::from_millis(5));
    send_mouse_left(true);
    thread::sleep(Duration::from_millis(6));
    move_logical(action.target_x, up_y);
    sleep_cancelable(clamp_seconds(action.drag_duration, 0.02, 0.001, 0.3), cancel);

    let release = runtime().intended_cursor.lock().map(|p| *p).unwrap_or(start_release);
    move_screen(release);
    thread::sleep(Duration::from_millis(8));
    send_mouse_left(false);
    move_screen(release);
    runtime().drag_active.store(false, Ordering::SeqCst);
}

fn execute_point_once(action: &Action) {
    let original = cursor_pos();
    emit_log("info", &format!("Rust point immediate {} -> {},{}", action.name, action.target_x, action.target_y));
    move_logical(action.target_x, action.target_y);
    thread::sleep(Duration::from_millis(1));
    send_mouse_left(true);
    thread::sleep(clamp_seconds(action.click_gap, 0.012, 0.001, 0.2));
    send_mouse_left(false);
    thread::sleep(Duration::from_millis(1));
    move_screen(original);
}

#[derive(Clone, Debug)]
enum ScriptCommand {
    Sleep(u64),
    Loop(Vec<ScriptCommand>),
    Move(i32, i32, u64),
    Click(i32, i32, u64),
    Press(i32, i32),
    Release(Option<(i32, i32)>),
    Drag(i32, i32, i32, i32, u64),
}

fn parse_i32(value: Option<&str>, fallback: i32) -> i32 { value.and_then(|v| v.parse::<i32>().ok()).unwrap_or(fallback) }
fn parse_u64(value: Option<&str>, fallback: u64) -> u64 { value.and_then(|v| v.parse::<u64>().ok()).unwrap_or(fallback) }

fn parse_script_block(lines: &[(usize, String)], index: &mut usize) -> Result<Vec<ScriptCommand>, String> {
    let mut out = Vec::new();
    while *index < lines.len() {
        let (line_no, line) = &lines[*index];
        let parts: Vec<&str> = line.split_whitespace().collect();
        *index += 1;
        if parts.is_empty() { continue; }
        match parts[0].to_ascii_lowercase().as_str() {
            "end" => return Ok(out),
            "sleep" => out.push(ScriptCommand::Sleep(parse_u64(parts.get(1).copied(), 0))),
            "loop" => {
                if parts.get(1).map(|v| v.to_ascii_lowercase()) != Some("until_release".to_string()) { return Err(format!("script line {}: only loop until_release is supported", line_no)); }
                let body = parse_script_block(lines, index)?;
                out.push(ScriptCommand::Loop(body));
            }
            "move" => out.push(ScriptCommand::Move(parse_i32(parts.get(1).copied(), 0), parse_i32(parts.get(2).copied(), 0), parse_u64(parts.get(3).copied(), 0))),
            "click" => out.push(ScriptCommand::Click(parse_i32(parts.get(1).copied(), 0), parse_i32(parts.get(2).copied(), 0), parse_u64(parts.get(3).copied(), 35))),
            "press" => out.push(ScriptCommand::Press(parse_i32(parts.get(1).copied(), 0), parse_i32(parts.get(2).copied(), 0))),
            "release" => {
                let point = if parts.len() >= 3 { Some((parse_i32(parts.get(1).copied(), 0), parse_i32(parts.get(2).copied(), 0))) } else { None };
                out.push(ScriptCommand::Release(point));
            }
            "drag" => out.push(ScriptCommand::Drag(parse_i32(parts.get(1).copied(), 0), parse_i32(parts.get(2).copied(), 0), parse_i32(parts.get(3).copied(), 0), parse_i32(parts.get(4).copied(), 0), parse_u64(parts.get(5).copied(), 80))),
            other => return Err(format!("script line {}: unsupported command {}", line_no, other)),
        }
    }
    Ok(out)
}

fn parse_script(script: &str) -> Result<Vec<ScriptCommand>, String> {
    let lines: Vec<(usize, String)> = script.lines().enumerate().filter_map(|(i, line)| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") || trimmed.starts_with(';') { None } else { Some((i + 1, trimmed.to_string())) }
    }).collect();
    let mut index = 0;
    parse_script_block(&lines, &mut index)
}

fn execute_script_commands(commands: &[ScriptCommand], cancel: &AtomicBool) {
    for command in commands {
        if cancel.load(Ordering::Relaxed) || runtime().stop.load(Ordering::Relaxed) { break; }
        match command {
            ScriptCommand::Sleep(ms) => sleep_cancelable(Duration::from_millis(*ms), cancel),
            ScriptCommand::Loop(body) => while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) { execute_script_commands(body, cancel); thread::sleep(Duration::from_millis(5)); },
            ScriptCommand::Move(x, y, ms) => { move_logical(*x, *y); if *ms > 0 { sleep_cancelable(Duration::from_millis(*ms), cancel); } }
            ScriptCommand::Click(x, y, ms) => { let original = cursor_pos(); move_logical(*x, *y); click_current(Duration::from_millis(*ms)); move_screen(original); }
            ScriptCommand::Press(x, y) => { move_logical(*x, *y); thread::sleep(Duration::from_millis(5)); send_mouse_left(true); }
            ScriptCommand::Release(point) => { if let Some((x, y)) = point { move_logical(*x, *y); } thread::sleep(Duration::from_millis(5)); send_mouse_left(false); }
            ScriptCommand::Drag(sx, sy, ex, ey, ms) => { move_logical(*sx, *sy); thread::sleep(Duration::from_millis(5)); send_mouse_left(true); sleep_cancelable(Duration::from_millis(*ms), cancel); move_logical(*ex, *ey); thread::sleep(Duration::from_millis(5)); send_mouse_left(false); }
        }
    }
}

fn execute_script_once(action: &Action, cancel: &AtomicBool) -> Result<(), String> {
    let commands = parse_script(&action.script)?;
    execute_script_commands(&commands, cancel);
    send_mouse_left(false);
    Ok(())
}

fn execute_action_loop(action: Action, cancel: Arc<AtomicBool>) {
    match action.action_type.as_str() {
        "fastPlay" => while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) { execute_fast_play_once(&action); sleep_cancelable(clamp_seconds(action.loop_gap, 0.001, 0.0, 0.5), &cancel); },
        "drag" => while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) { execute_drag_once(&action, &cancel); sleep_cancelable(clamp_seconds(action.loop_gap, 0.08, 0.05, 0.8), &cancel); },
        "point" | "click" | "rapid" => execute_point_once(&action),
        "script" => { if let Err(error) = execute_script_once(&action, &cancel) { emit_log("error", &format!("Rust script failed: {}", error)); } },
        _ => {}
    }
}

fn start_worker(action: Action, vk: u32) {
    let rt = runtime();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = rt.active.lock().unwrap();
        if active.contains_key(&vk) { return; }
        active.insert(vk, cancel.clone());
    }
    thread::spawn(move || {
        emit("execution", &format!("{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"start\"}}", json_escape(&action.id), json_escape(&action.name)));
        execute_action_loop(action.clone(), cancel.clone());
        send_mouse_left(false);
        emit("execution", &format!("{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"end\"}}", json_escape(&action.id), json_escape(&action.name)));
        let _ = runtime().active.lock().map(|mut active| { active.remove(&vk); });
    });
}

unsafe extern "system" fn keyboard_proc(code: i32, w_param: Wparam, l_param: Lparam) -> Lresult {
    if code >= 0 {
        let data = *(l_param as *const KbdLlHookStruct);
        let vk = data.vk_code;
        if vk == VK_X && (w_param == WM_KEYDOWN || w_param == WM_SYSKEYDOWN) {
            let rt = runtime();
            rt.stop.store(true, Ordering::SeqCst);
            let thread_id = rt.hook_thread_id.load(Ordering::SeqCst);
            if thread_id != 0 { PostThreadMessageW(thread_id, WM_QUIT, 0, 0); }
            let mouse_thread_id = rt.mouse_hook_thread_id.load(Ordering::SeqCst);
            if mouse_thread_id != 0 { PostThreadMessageW(mouse_thread_id, WM_QUIT, 0, 0); }
            return 1;
        }
        let is_down = w_param == WM_KEYDOWN || w_param == WM_SYSKEYDOWN;
        let is_up = w_param == WM_KEYUP || w_param == WM_SYSKEYUP;
        if is_down {
            let matched = runtime().actions.lock().ok().and_then(|actions| actions.iter().find(|a| key_to_vk(&a.hotkey) == Some(vk)).cloned());
            if let Some(action) = matched {
                emit_log("info", &format!("Rust backend hotkey {} -> {} ({})", action.hotkey, action.name, action.action_type));
                start_worker(action, vk);
                return 1;
            }
        } else if is_up {
            if let Ok(active) = runtime().active.lock() {
                if let Some(cancel) = active.get(&vk) { cancel.store(true, Ordering::SeqCst); return 1; }
            }
        }
    }
    CallNextHookEx(0, code, w_param, l_param)
}

unsafe extern "system" fn mouse_proc(code: i32, w_param: Wparam, l_param: Lparam) -> Lresult {
    if code >= 0 && w_param == WM_MOUSEMOVE && runtime().drag_active.load(Ordering::Relaxed) {
        let data = *(l_param as *const MouseLlHookStruct);
        if data.flags & 0x00000001 == 0 {
            if let Ok(mut intended) = runtime().intended_cursor.lock() { *intended = data.pt; }
        }
    }
    CallNextHookEx(0, code, w_param, l_param)
}

fn start_mouse_hook_thread() {
    let rt = runtime();
    if rt.mouse_hook_alive.swap(true, Ordering::SeqCst) { return; }
    thread::spawn(move || unsafe {
        let thread_id = GetCurrentThreadId();
        runtime().mouse_hook_thread_id.store(thread_id, Ordering::SeqCst);
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), 0, 0);
        if hook == 0 {
            runtime().mouse_hook_alive.store(false, Ordering::SeqCst);
            emit("error", "{\"message\":\"Rust backend failed to install mouse hook\"}");
            return;
        }
        let mut msg: Msg = zeroed();
        while !runtime().stop.load(Ordering::SeqCst) && GetMessageW(&mut msg, 0, 0, 0) > 0 {}
        UnhookWindowsHookEx(hook);
        runtime().mouse_hook_thread_id.store(0, Ordering::SeqCst);
        runtime().mouse_hook_alive.store(false, Ordering::SeqCst);
    });
}

fn start_hook_thread() {
    let rt = runtime();
    if rt.hook_alive.swap(true, Ordering::SeqCst) { return; }
    rt.stop.store(false, Ordering::SeqCst);
    thread::spawn(move || unsafe {
        let thread_id = GetCurrentThreadId();
        runtime().hook_thread_id.store(thread_id, Ordering::SeqCst);
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), 0, 0);
        if hook == 0 {
            runtime().hook_alive.store(false, Ordering::SeqCst);
            emit("error", "{\"message\":\"Rust backend failed to install keyboard hook\"}");
            return;
        }
        emit("status", "{\"status\":\"listening\",\"message\":\"Rust backend listening\"}");
        let mut msg: Msg = zeroed();
        while !runtime().stop.load(Ordering::SeqCst) && GetMessageW(&mut msg, 0, 0, 0) > 0 {}
        UnhookWindowsHookEx(hook);
        runtime().hook_thread_id.store(0, Ordering::SeqCst);
        runtime().hook_alive.store(false, Ordering::SeqCst);
        if let Ok(active) = runtime().active.lock() { for cancel in active.values() { cancel.store(true, Ordering::SeqCst); } }
        emit("status", "{\"status\":\"stopped\",\"message\":\"Rust backend stopped\"}");
    });
}

fn stop_listening() -> String {
    let rt = runtime();
    rt.stop.store(true, Ordering::SeqCst);
    let thread_id = rt.hook_thread_id.load(Ordering::SeqCst);
    if thread_id != 0 { unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0); } }
    let mouse_thread_id = rt.mouse_hook_thread_id.load(Ordering::SeqCst);
    if mouse_thread_id != 0 { unsafe { PostThreadMessageW(mouse_thread_id, WM_QUIT, 0, 0); } }
    if let Ok(active) = rt.active.lock() { for cancel in active.values() { cancel.store(true, Ordering::SeqCst); } }
    "{\"status\":\"stopped\",\"message\":\"Rust backend stopped\"}".to_string()
}

fn capture_position(payload: &str) -> String {
    let delay_ms = number_value(payload, "delayMs", 2000.0).max(0.0) as u64;
    thread::sleep(Duration::from_millis(delay_ms));
    let point = screen_to_logical(cursor_pos());
    let result = format!("{{\"x\":{},\"y\":{}}}", point.x, point.y);
    emit("capture", &result);
    result
}

fn test_action(action_raw: &str) {
    if let Some(action) = actions_from_config(&format!("{{\"actions\":[{}]}}", action_raw)).into_iter().next() {
        let cancel = Arc::new(AtomicBool::new(false));
        match action.action_type.as_str() {
            "fastPlay" => execute_fast_play_once(&action),
            "drag" => execute_drag_once(&action, &cancel),
            "point" | "click" | "rapid" => execute_point_once(&action),
            "script" => { let _ = execute_script_once(&action, &cancel); },
            _ => {}
        }
    }
}

fn handle(command: &str, payload: &str) -> Result<String, String> {
    match command {
        "get_initial_config" | "load_config" => Ok(load_config_and_sync_resolution()),
        "save_config" => save_config(payload),
        "start_listening" => {
            let resolution = resolution_from_config(payload);
            *runtime().resolution.lock().map_err(|e| e.to_string())? = resolution;
            let actions = actions_from_config(payload);
            let count = actions.len();
            let summary = actions.iter().map(|a| format!("{}:{}:{}", a.hotkey, a.action_type, a.name)).collect::<Vec<_>>().join(", ");
            *runtime().actions.lock().map_err(|e| e.to_string())? = actions;
            emit_log("info", &format!("Rust backend loaded {} supported actions: {}", count, summary));
            start_mouse_hook_thread();
            start_hook_thread();
            Ok("{\"status\":\"listening\",\"message\":\"Rust backend listening\"}".to_string())
        }
        "stop_listening" => Ok(stop_listening()),
        "test_macro" => {
            let action_raw = raw_value(payload, "action").unwrap_or_default();
            let config_raw = raw_value(payload, "config").unwrap_or_default();
            if !config_raw.is_empty() { *runtime().resolution.lock().map_err(|e| e.to_string())? = resolution_from_config(&config_raw); }
            test_action(&action_raw);
            Ok("{\"status\":\"ready\",\"message\":\"Rust backend test complete\"}".to_string())
        }
        "capture_position" => Ok(capture_position(payload)),
        "shutdown" => Ok(stop_listening()),
        other => Err(format!("Unknown Rust backend command: {}", other)),
    }
}

fn main() {
    emit("status", "{\"status\":\"ready\",\"message\":\"Rust backend ready\"}");
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { continue; };
        if line.trim().is_empty() { continue; }
        match parse_request(&line) {
            Ok(req) => {
                let should_exit = req.command == "shutdown";
                match handle(&req.command, &req.payload) {
                    Ok(result) => respond_ok(&req.id, &result),
                    Err(error) => respond_err(&req.id, &error),
                }
                if should_exit { break; }
            }
            Err(error) => respond_err("null", &error),
        }
    }
}

