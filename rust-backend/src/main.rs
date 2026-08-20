use std::collections::HashMap;
use std::env;
use std::ffi::c_void;
use std::fs;
use std::hint::spin_loop;
use std::io::{self, BufRead, BufWriter, Write};
use std::mem::{size_of, zeroed};
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
type Handle = isize;

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
const THREAD_PRIORITY_HIGHEST: i32 = 2;
const WORKER_COUNT: usize = 4;
const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: Dword = 0x00000002;
const TIMER_MODIFY_STATE: Dword = 0x0002;
const SYNCHRONIZE: Dword = 0x00100000;
const WAIT_OBJECT_0: Dword = 0;
const INFINITE: Dword = 0xffffffff;

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
extern "system" {
    fn GetCurrentThreadId() -> Dword;
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(h_thread: isize, priority: i32) -> Bool;
    fn CreateWaitableTimerExW(attributes: *const c_void, name: *const u16, flags: Dword, access: Dword) -> Handle;
    fn SetWaitableTimer(timer: Handle, due_time: *const i64, period: Long, completion: *const c_void, argument: *const c_void, resume: Bool) -> Bool;
    fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
    fn CloseHandle(handle: Handle) -> Bool;
}

#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: Uint) -> Uint;
    fn timeEndPeriod(period: Uint) -> Uint;
}

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
    card_hold_duration: f64,
    drag_duration: f64,
    card_click_gap: f64,
    click_gap: f64,
    loop_gap: f64,
    script: String,
}

struct Request { id: String, command: String, payload: String }

struct WorkerJob {
    action: Action,
    vk: u32,
    cancel: Arc<AtomicBool>,
    queued_at: Instant,
}

#[derive(Clone, Debug)]
struct FastPlayCycleTrace {
    cycle: u64,
    cycle_start_us: u64,
    key_down_us: u64,
    key_up_us: u64,
    mouse_down_us: u64,
    mouse_up_us: u64,
    cycle_end_us: u64,
    key_down_ok: bool,
    key_up_ok: bool,
    mouse_down_ok: bool,
    mouse_up_ok: bool,
}

struct FastPlayTrace {
    action_id: String,
    action_name: String,
    hotkey: String,
    card_key: String,
    started_wall_ms: u128,
    started: Instant,
    queue_delay_us: u64,
    requested_key_hold_us: u64,
    requested_card_gap_us: u64,
    requested_click_hold_us: u64,
    requested_loop_gap_us: u64,
    cycles: Vec<FastPlayCycleTrace>,
    dropped_cycles: u64,
}

const MAX_TRACE_CYCLES: usize = 4096;

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
    timer_resolution_active: AtomicBool,
    out: Mutex<()>,
}

static RUNTIME: OnceLock<Arc<Runtime>> = OnceLock::new();
static EVENT_TX: OnceLock<mpsc::Sender<String>> = OnceLock::new();
static WORKER_TX: OnceLock<mpsc::Sender<WorkerJob>> = OnceLock::new();

struct HighResTimer(Handle);

impl HighResTimer {
    fn new() -> Option<Self> {
        let access = TIMER_MODIFY_STATE | SYNCHRONIZE;
        let mut handle = unsafe {
            CreateWaitableTimerExW(ptr::null(), ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, access)
        };
        if handle == 0 {
            handle = unsafe { CreateWaitableTimerExW(ptr::null(), ptr::null(), 0, access) };
        }
        (handle != 0).then_some(Self(handle))
    }

    fn sleep(&self, duration: Duration) -> bool {
        let ticks_100ns = ((duration.as_nanos() + 99) / 100).max(1).min(i64::MAX as u128) as i64;
        let due_time = -ticks_100ns;
        unsafe {
            SetWaitableTimer(self.0, &due_time, 0, ptr::null(), ptr::null(), 0) != 0
                && WaitForSingleObject(self.0, INFINITE) == WAIT_OBJECT_0
        }
    }
}

impl Drop for HighResTimer {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0); }
    }
}

thread_local! {
    static HIGH_RES_TIMER: Option<HighResTimer> = HighResTimer::new();
}

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
        timer_resolution_active: AtomicBool::new(false),
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

fn event_sender() -> &'static mpsc::Sender<String> {
    EVENT_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<String>();
        thread::Builder::new().name("bamt-events".to_string()).spawn(move || {
            while let Ok(line) = rx.recv() { write_line(&line); }
        }).expect("failed to start event writer");
        tx
    })
}

fn emit(event_type: &str, payload: &str) {
    let line = format!("{{\"event\":{{\"type\":\"{}\",\"payload\":{}}}}}", json_escape(event_type), payload);
    if event_sender().send(line.clone()).is_err() { write_line(&line); }
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

fn log_dir() -> PathBuf {
    env::var_os("BAMT_LOG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("data").join("logs"))
}

fn duration_us(duration: Duration) -> u64 {
    duration.as_micros().min(u64::MAX as u128) as u64
}

fn wall_clock_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn safe_log_name(value: &str) -> String {
    let cleaned: String = value.chars().map(|ch| {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' }
    }).collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() { "macro".to_string() } else { trimmed.chars().take(48).collect() }
}

fn percentile(values: &[u64], percentile: f64) -> u64 {
    if values.is_empty() { return 0; }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) as f64 * percentile).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

impl FastPlayTrace {
    fn new(action: &Action, queue_delay: Duration) -> Self {
        Self {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            hotkey: action.hotkey.clone(),
            card_key: action.card_key.clone(),
            started_wall_ms: wall_clock_ms(),
            started: Instant::now(),
            queue_delay_us: duration_us(queue_delay),
            requested_key_hold_us: duration_us(clamp_seconds(action.card_hold_duration, 0.007, 0.001, 0.3)),
            requested_card_gap_us: duration_us(clamp_seconds(action.card_click_gap, 0.007, 0.0, 0.3)),
            requested_click_hold_us: duration_us(clamp_seconds(action.drag_duration, 0.007, 0.001, 0.3)),
            requested_loop_gap_us: duration_us(clamp_seconds(action.loop_gap, 0.007, 0.0, 0.5)),
            cycles: Vec::with_capacity(MAX_TRACE_CYCLES),
            dropped_cycles: 0,
        }
    }

    fn elapsed_us(&self) -> u64 { duration_us(self.started.elapsed()) }

    fn push(&mut self, cycle: FastPlayCycleTrace) {
        if self.cycles.len() < MAX_TRACE_CYCLES { self.cycles.push(cycle); }
        else { self.dropped_cycles += 1; }
    }
}

fn write_fast_play_trace(trace: &FastPlayTrace) -> Result<(PathBuf, String), String> {
    let dir = log_dir();
    fs::create_dir_all(&dir).map_err(|error| format!("create log directory failed: {}", error))?;
    let file_name = format!("fast-play-{}-{}.jsonl", trace.started_wall_ms, safe_log_name(&trace.action_id));
    let path = dir.join(file_name);
    let file = fs::File::create(&path).map_err(|error| format!("create trace file failed: {}", error))?;
    let mut writer = BufWriter::new(file);

    writeln!(writer,
        "{{\"type\":\"header\",\"schema\":1,\"startedWallMs\":{},\"actionId\":\"{}\",\"actionName\":\"{}\",\"hotkey\":\"{}\",\"cardKey\":\"{}\",\"queueDelayUs\":{},\"requested\":{{\"keyHoldUs\":{},\"cardGapUs\":{},\"clickHoldUs\":{},\"loopGapUs\":{}}}}}",
        trace.started_wall_ms, json_escape(&trace.action_id), json_escape(&trace.action_name),
        json_escape(&trace.hotkey), json_escape(&trace.card_key), trace.queue_delay_us,
        trace.requested_key_hold_us, trace.requested_card_gap_us, trace.requested_click_hold_us,
        trace.requested_loop_gap_us
    ).map_err(|error| error.to_string())?;

    let mut key_holds = Vec::with_capacity(trace.cycles.len());
    let mut card_gaps = Vec::with_capacity(trace.cycles.len());
    let mut click_holds = Vec::with_capacity(trace.cycles.len());
    let mut active_times = Vec::with_capacity(trace.cycles.len());
    let mut loop_gaps = Vec::with_capacity(trace.cycles.len().saturating_sub(1));
    let mut input_failures = 0_u64;
    let mut order_violations = 0_u64;

    for (index, cycle) in trace.cycles.iter().enumerate() {
        let key_hold = cycle.key_up_us.saturating_sub(cycle.key_down_us);
        let card_gap = cycle.mouse_down_us.saturating_sub(cycle.key_up_us);
        let click_hold = cycle.mouse_up_us.saturating_sub(cycle.mouse_down_us);
        let active = cycle.mouse_up_us.saturating_sub(cycle.cycle_start_us);
        let loop_gap = if index == 0 { 0 } else { cycle.cycle_start_us.saturating_sub(trace.cycles[index - 1].cycle_end_us) };
        key_holds.push(key_hold);
        card_gaps.push(card_gap);
        click_holds.push(click_hold);
        active_times.push(active);
        if index > 0 { loop_gaps.push(loop_gap); }
        input_failures += [cycle.key_down_ok, cycle.key_up_ok, cycle.mouse_down_ok, cycle.mouse_up_ok].iter().filter(|ok| !**ok).count() as u64;
        if !(cycle.cycle_start_us <= cycle.key_down_us
            && cycle.key_down_us <= cycle.key_up_us
            && cycle.key_up_us <= cycle.mouse_down_us
            && cycle.mouse_down_us <= cycle.mouse_up_us
            && cycle.mouse_up_us <= cycle.cycle_end_us) {
            order_violations += 1;
        }
        writeln!(writer,
            "{{\"type\":\"cycle\",\"cycle\":{},\"timeUs\":{{\"start\":{},\"keyDown\":{},\"keyUp\":{},\"mouseDown\":{},\"mouseUp\":{},\"end\":{}}},\"actualUs\":{{\"keyHold\":{},\"cardGap\":{},\"clickHold\":{},\"active\":{},\"loopGap\":{}}},\"sendInputOk\":{{\"keyDown\":{},\"keyUp\":{},\"mouseDown\":{},\"mouseUp\":{}}}}}",
            cycle.cycle, cycle.cycle_start_us, cycle.key_down_us, cycle.key_up_us,
            cycle.mouse_down_us, cycle.mouse_up_us, cycle.cycle_end_us,
            key_hold, card_gap, click_hold, active, loop_gap,
            cycle.key_down_ok, cycle.key_up_ok, cycle.mouse_down_ok, cycle.mouse_up_ok
        ).map_err(|error| error.to_string())?;
    }

    let late_threshold = 1_000_u64;
    let late_count = key_holds.iter().filter(|value| **value > trace.requested_key_hold_us + late_threshold).count()
        + card_gaps.iter().filter(|value| **value > trace.requested_card_gap_us + late_threshold).count()
        + click_holds.iter().filter(|value| **value > trace.requested_click_hold_us + late_threshold).count()
        + loop_gaps.iter().filter(|value| **value > trace.requested_loop_gap_us + late_threshold).count();
    let summary = format!(
        "{}轮 | 队列{}us | 选牌P95 {}us | 牌到点击P95 {}us | 点击P95 {}us | 循环间隔P95 {}us | >目标1ms {}次 | 输入失败{} | 乱序{}",
        trace.cycles.len() + trace.dropped_cycles as usize, trace.queue_delay_us,
        percentile(&key_holds, 0.95), percentile(&card_gaps, 0.95), percentile(&click_holds, 0.95),
        percentile(&loop_gaps, 0.95), late_count, input_failures, order_violations
    );
    writeln!(writer,
        "{{\"type\":\"summary\",\"cycles\":{},\"droppedCycles\":{},\"inputFailures\":{},\"orderViolations\":{},\"lateOverTargetBy1ms\":{},\"p95Us\":{{\"keyHold\":{},\"cardGap\":{},\"clickHold\":{},\"active\":{},\"loopGap\":{}}},\"maxUs\":{{\"keyHold\":{},\"cardGap\":{},\"clickHold\":{},\"active\":{},\"loopGap\":{}}},\"summary\":\"{}\"}}",
        trace.cycles.len(), trace.dropped_cycles, input_failures, order_violations, late_count,
        percentile(&key_holds, 0.95), percentile(&card_gaps, 0.95), percentile(&click_holds, 0.95),
        percentile(&active_times, 0.95), percentile(&loop_gaps, 0.95),
        key_holds.iter().copied().max().unwrap_or(0), card_gaps.iter().copied().max().unwrap_or(0),
        click_holds.iter().copied().max().unwrap_or(0), active_times.iter().copied().max().unwrap_or(0),
        loop_gaps.iter().copied().max().unwrap_or(0), json_escape(&summary)
    ).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())?;
    Ok((path, summary))
}

fn default_config() -> String {
    format!("{{\"version\":\"rust-0.2\",\"resolution\":{{\"width\":2560,\"height\":1600}},\"exitKey\":\"x\",\"inputTakeoverEnabled\":false,\"inputBackend\":\"cursor\",\"displayRefreshRate\":160,\"gameFrameRate\":60,\"verticalSyncEnabled\":true,\"autoTuneFastPlayTiming\":true,\"skillSlotXOffsets\":[0.2,0.28,0.362],\"skillSlotBottomOffsetRatio\":0.071,\"smoothMoveMinSteps\":2,\"smoothMoveStepRate\":80,\"actions\":{}}}", default_actions())
}

fn default_actions() -> String {
    let mut parts = Vec::new();
    for (idx, (key, offset)) in [("q", 0.200_f64), ("w", 0.280_f64), ("e", 0.362_f64)].iter().enumerate() {
        let x = (2560.0 * (0.5 + offset)).round() as i32;
        let y = (1600.0_f64 - 2560.0_f64 * 0.071_f64).round() as i32;
        parts.push(format!("{{\"id\":\"skill-fast-play-{}\",\"name\":\"最速出牌 {}\",\"hotkey\":\"{}\",\"type\":\"fastPlay\",\"cardKey\":\"{}\",\"targetX\":{},\"targetY\":{},\"dragDistance\":300,\"cardHoldDuration\":0.007,\"dragDuration\":0.007,\"clickGap\":0.1,\"cardClickGap\":0.007,\"loopGap\":0.007,\"enabled\":true,\"script\":\"\"}}", idx + 1, idx + 1, key, idx + 1, x, y));
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
        let default_loop_gap = if action_type == "drag" { 0.05 } else if action_type == "fastPlay" { 0.007 } else { 0.001 };
        let default_drag_duration = if action_type == "fastPlay" { 0.007 } else { 0.03 };
        let default_card_click_gap = if action_type == "fastPlay" { 0.007 } else { 0.010 };
        Some(Action {
            id: string_value(&obj, "id").unwrap_or_else(|| hotkey.clone()),
            name: string_value(&obj, "name").unwrap_or_else(|| format!("Rust {}", action_type)),
            hotkey,
            action_type: action_type.clone(),
            card_key,
            target_x: number_value(&obj, "targetX", 1280.0) as i32,
            target_y: number_value(&obj, "targetY", 800.0) as i32,
            drag_distance: number_value(&obj, "dragDistance", 300.0) as i32,
            card_hold_duration: number_value(&obj, "cardHoldDuration", 0.007),
            drag_duration: number_value(&obj, "dragDuration", default_drag_duration),
            card_click_gap: number_value(&obj, "cardClickGap", default_card_click_gap),
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

fn wait_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel
        .map(|flag| {
            runtime().stop.load(Ordering::Relaxed) || flag.load(Ordering::Relaxed)
        })
        .unwrap_or(false)
}

fn high_res_sleep(duration: Duration) -> bool {
    HIGH_RES_TIMER.with(|timer| timer.as_ref().map(|timer| timer.sleep(duration)).unwrap_or(false))
}

fn wait_until(deadline: Instant, cancel: Option<&AtomicBool>) -> bool {
    const CANCEL_SLICE: Duration = Duration::from_millis(1);
    const SPIN_TAIL: Duration = Duration::from_micros(200);

    loop {
        if wait_cancelled(cancel) { return false; }

        let now = Instant::now();
        if now >= deadline { return true; }

        let remaining = deadline.duration_since(now);
        if remaining > SPIN_TAIL {
            let sleep_time = remaining - SPIN_TAIL;
            let sleep_slice = if cancel.is_some() { sleep_time.min(CANCEL_SLICE) } else { sleep_time };
            if !high_res_sleep(sleep_slice) { thread::sleep(sleep_slice); }
        } else {
            spin_loop();
        }
    }
}

fn sleep_precise(duration: Duration) {
    if !duration.is_zero() {
        let _ = wait_until(Instant::now() + duration, None);
    }
}

fn sleep_cancelable(duration: Duration, cancel: &AtomicBool) {
    if !duration.is_zero() {
        let _ = wait_until(Instant::now() + duration, Some(cancel));
    }
}

fn send_keyboard(vk: u16, key_up: bool) -> bool {
    let mut input = Input { r#type: INPUT_KEYBOARD, u: InputUnion { ki: KeybdInput { w_vk: vk, w_scan: 0, dw_flags: if key_up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dw_extra_info: 0 } } };
    unsafe { SendInput(1, &mut input, size_of::<Input>() as i32) == 1 }
}

fn send_key_press(vk: u16, duration: Duration) {
    send_keyboard(vk, false);
    sleep_precise(duration);
    send_keyboard(vk, true);
}

fn send_mouse_left(down: bool) -> bool {
    let mut input = Input { r#type: INPUT_MOUSE, u: InputUnion { mi: MouseInput { dx: 0, dy: 0, mouse_data: 0, dw_flags: if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, time: 0, dw_extra_info: 0 } } };
    unsafe { SendInput(1, &mut input, size_of::<Input>() as i32) == 1 }
}

fn click_current(delay: Duration) {
    send_mouse_left(true);
    sleep_precise(delay);
    send_mouse_left(false);
}

fn execute_fast_play_once(action: &Action) {
    if let Some(vk) = key_to_vk(&action.card_key) {
        send_key_press(vk as u16, clamp_seconds(action.card_hold_duration, 0.007, 0.001, 0.3));
        sleep_precise(clamp_seconds(action.card_click_gap, 0.007, 0.0, 0.3));
        click_current(clamp_seconds(action.drag_duration, 0.007, 0.001, 0.3));
    }
}

fn execute_fast_play_once_traced(action: &Action, trace: &mut FastPlayTrace, cycle: u64) {
    let Some(vk) = key_to_vk(&action.card_key) else { return; };
    let cycle_start_us = trace.elapsed_us();
    let key_down_us = trace.elapsed_us();
    let key_down_ok = send_keyboard(vk as u16, false);
    sleep_precise(clamp_seconds(action.card_hold_duration, 0.007, 0.001, 0.3));
    let key_up_us = trace.elapsed_us();
    let key_up_ok = send_keyboard(vk as u16, true);
    sleep_precise(clamp_seconds(action.card_click_gap, 0.007, 0.0, 0.3));
    let mouse_down_us = trace.elapsed_us();
    let mouse_down_ok = send_mouse_left(true);
    sleep_precise(clamp_seconds(action.drag_duration, 0.007, 0.001, 0.3));
    let mouse_up_us = trace.elapsed_us();
    let mouse_up_ok = send_mouse_left(false);
    let cycle_end_us = trace.elapsed_us();
    trace.push(FastPlayCycleTrace {
        cycle,
        cycle_start_us,
        key_down_us,
        key_up_us,
        mouse_down_us,
        mouse_up_us,
        cycle_end_us,
        key_down_ok,
        key_up_ok,
        mouse_down_ok,
        mouse_up_ok,
    });
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

    move_screen(start_release);
    thread::sleep(Duration::from_millis(8));
    send_mouse_left(false);
    move_screen(start_release);
    runtime().drag_active.store(false, Ordering::SeqCst);
}

fn execute_point_hold(action: &Action, cancel: &AtomicBool) {
    let original = cursor_pos();
    emit_log("info", &format!("Rust point hold {} -> {},{}", action.name, action.target_x, action.target_y));
    move_logical(action.target_x, action.target_y);
    thread::sleep(Duration::from_millis(1));
    send_mouse_left(true);
    thread::sleep(clamp_seconds(action.click_gap, 0.012, 0.001, 0.2));
    send_mouse_left(false);
    while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(10));
    }
    thread::sleep(Duration::from_millis(50));
    move_screen(original);
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

fn execute_action_loop(action: Action, cancel: Arc<AtomicBool>, queue_delay: Duration) -> Option<FastPlayTrace> {
    match action.action_type.as_str() {
        "fastPlay" => {
            let mut trace = FastPlayTrace::new(&action, queue_delay);
            let mut cycle = 0_u64;
            while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) {
                cycle += 1;
                execute_fast_play_once_traced(&action, &mut trace, cycle);
                sleep_cancelable(clamp_seconds(action.loop_gap, 0.007, 0.0, 0.5), &cancel);
            }
            return Some(trace);
        }
        "drag" => while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) { execute_drag_once(&action, &cancel); sleep_cancelable(clamp_seconds(action.loop_gap, 0.08, 0.05, 0.8), &cancel); },
        "point" => execute_point_hold(&action, &cancel),
        "click" | "rapid" => execute_point_once(&action),
        "script" => { if let Err(error) = execute_script_once(&action, &cancel) { emit_log("error", &format!("Rust script failed: {}", error)); } },
        _ => {}
    }
    None
}

fn run_worker_job(job: WorkerJob) {
    let action = job.action;
    let queue_delay = job.queued_at.elapsed();
    emit_log("info", &format!("Rust backend hotkey {} -> {} ({})", action.hotkey, action.name, action.action_type));
    emit("execution", &format!("{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"start\"}}", json_escape(&action.id), json_escape(&action.name)));
    let trace = execute_action_loop(action.clone(), job.cancel, queue_delay);
    send_mouse_left(false);
    emit("execution", &format!("{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"end\"}}", json_escape(&action.id), json_escape(&action.name)));
    let _ = runtime().active.lock().map(|mut active| { active.remove(&job.vk); });
    if let Some(trace) = trace {
        match write_fast_play_trace(&trace) {
            Ok((path, summary)) => emit_log("info", &format!("宏诊断 {}：{}；日志 {}", action.name, summary, path.display())),
            Err(error) => emit_log("error", &format!("宏诊断日志写入失败：{}", error)),
        }
    }
}

fn worker_sender() -> &'static mpsc::Sender<WorkerJob> {
    WORKER_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<WorkerJob>();
        let receiver = Arc::new(Mutex::new(rx));
        for index in 0..WORKER_COUNT {
            let receiver = receiver.clone();
            thread::Builder::new().name(format!("bamt-macro-{}", index + 1)).spawn(move || {
                unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST); }
                loop {
                    let job = match receiver.lock() {
                        Ok(rx) => rx.recv(),
                        Err(_) => return,
                    };
                    match job {
                        Ok(job) => run_worker_job(job),
                        Err(_) => return,
                    }
                }
            }).expect("failed to start macro worker");
        }
        tx
    })
}

fn enable_timer_resolution() {
    let rt = runtime();
    if !rt.timer_resolution_active.swap(true, Ordering::SeqCst) {
        let result = unsafe { timeBeginPeriod(1) };
        if result != 0 {
            rt.timer_resolution_active.store(false, Ordering::SeqCst);
            emit_log("warn", "Windows 1 ms timer resolution is unavailable; using waitable timer fallback");
        }
    }
}

fn disable_timer_resolution() {
    let rt = runtime();
    if rt.timer_resolution_active.swap(false, Ordering::SeqCst) {
        unsafe { timeEndPeriod(1); }
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
    if worker_sender().send(WorkerJob { action, vk, cancel, queued_at: Instant::now() }).is_err() {
        let _ = rt.active.lock().map(|mut active| { active.remove(&vk); });
        emit_log("error", "Rust macro worker pool is unavailable");
    }
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
            return 1;
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
            disable_timer_resolution();
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
        disable_timer_resolution();
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
            let _ = event_sender();
            let _ = worker_sender();
            enable_timer_resolution();
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

