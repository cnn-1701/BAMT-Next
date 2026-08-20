use std::collections::HashMap;
use std::collections::HashSet;
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
struct Point {
    x: Long,
    y: Long,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Msg {
    hwnd: Hwnd,
    message: Uint,
    w_param: Wparam,
    l_param: Lparam,
    time: Dword,
    pt: Point,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct KbdLlHookStruct {
    vk_code: Dword,
    scan_code: Dword,
    flags: Dword,
    time: Dword,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseLlHookStruct {
    pt: Point,
    mouse_data: Dword,
    flags: Dword,
    time: Dword,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput {
    dx: Long,
    dy: Long,
    mouse_data: Dword,
    dw_flags: Dword,
    time: Dword,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct KeybdInput {
    w_vk: Word,
    w_scan: Word,
    dw_flags: Dword,
    time: Dword,
    dw_extra_info: usize,
}

#[repr(C)]
union InputUnion {
    mi: MouseInput,
    ki: KeybdInput,
}

#[repr(C)]
struct Input {
    r#type: Dword,
    u: InputUnion,
}

type HookProc = Option<unsafe extern "system" fn(i32, Wparam, Lparam) -> Lresult>;

#[link(name = "user32")]
extern "system" {
    fn SendInput(c_inputs: Uint, p_inputs: *mut Input, cb_size: i32) -> Uint;
    fn GetCursorPos(lp_point: *mut Point) -> Bool;
    fn GetSystemMetrics(n_index: i32) -> i32;
    fn SetWindowsHookExW(id_hook: i32, lpfn: HookProc, hmod: isize, dw_thread_id: Dword) -> Hhook;
    fn CallNextHookEx(hhk: Hhook, n_code: i32, w_param: Wparam, l_param: Lparam) -> Lresult;
    fn UnhookWindowsHookEx(hhk: Hhook) -> Bool;
    fn GetMessageW(
        lp_msg: *mut Msg,
        hwnd: Hwnd,
        w_msg_filter_min: Uint,
        w_msg_filter_max: Uint,
    ) -> Bool;
    fn PostThreadMessageW(id_thread: Dword, msg: Uint, w_param: Wparam, l_param: Lparam) -> Bool;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentThreadId() -> Dword;
    fn GetCurrentThread() -> isize;
    fn SetThreadPriority(h_thread: isize, priority: i32) -> Bool;
    fn CreateWaitableTimerExW(
        attributes: *const c_void,
        name: *const u16,
        flags: Dword,
        access: Dword,
    ) -> Handle;
    fn SetWaitableTimer(
        timer: Handle,
        due_time: *const i64,
        period: Long,
        completion: *const c_void,
        argument: *const c_void,
        resume: Bool,
    ) -> Bool;
    fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
    fn CloseHandle(handle: Handle) -> Bool;
}

#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: Uint) -> Uint;
    fn timeEndPeriod(period: Uint) -> Uint;
}

#[derive(Clone, Copy, Debug)]
struct Resolution {
    width: i32,
    height: i32,
}

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
    script_program: Option<Arc<Vec<ScriptCommand>>>,
}

struct Request {
    id: String,
    command: String,
    payload: String,
}

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
            CreateWaitableTimerExW(
                ptr::null(),
                ptr::null(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                access,
            )
        };
        if handle == 0 {
            handle = unsafe { CreateWaitableTimerExW(ptr::null(), ptr::null(), 0, access) };
        }
        (handle != 0).then_some(Self(handle))
    }

    fn sleep(&self, duration: Duration) -> bool {
        let ticks_100ns = duration
            .as_nanos()
            .div_ceil(100)
            .max(1)
            .min(i64::MAX as u128) as i64;
        let due_time = -ticks_100ns;
        unsafe {
            SetWaitableTimer(self.0, &due_time, 0, ptr::null(), ptr::null(), 0) != 0
                && WaitForSingleObject(self.0, INFINITE) == WAIT_OBJECT_0
        }
    }
}

impl Drop for HighResTimer {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

thread_local! {
    static HIGH_RES_TIMER: Option<HighResTimer> = HighResTimer::new();
}

fn runtime() -> Arc<Runtime> {
    RUNTIME
        .get_or_init(|| {
            Arc::new(Runtime {
                stop: AtomicBool::new(false),
                hook_alive: AtomicBool::new(false),
                hook_thread_id: AtomicU32::new(0),
                mouse_hook_alive: AtomicBool::new(false),
                mouse_hook_thread_id: AtomicU32::new(0),
                drag_active: AtomicBool::new(false),
                intended_cursor: Mutex::new(Point::default()),
                actions: Mutex::new(Vec::new()),
                resolution: Mutex::new(Resolution {
                    width: 2560,
                    height: 1600,
                }),
                active: Mutex::new(HashMap::new()),
                timer_resolution_active: AtomicBool::new(false),
                out: Mutex::new(()),
            })
        })
        .clone()
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
        thread::Builder::new()
            .name("bamt-events".to_string())
            .spawn(move || {
                while let Ok(line) = rx.recv() {
                    write_line(&line);
                }
            })
            .expect("failed to start event writer");
        tx
    })
}

fn emit(event_type: &str, payload: &str) {
    let line = format!(
        "{{\"event\":{{\"type\":\"{}\",\"payload\":{}}}}}",
        json_escape(event_type),
        payload
    );
    if event_sender().send(line.clone()).is_err() {
        write_line(&line);
    }
}

fn emit_log(level: &str, message: &str) {
    emit(
        "log",
        &format!(
            "{{\"level\":\"{}\",\"message\":\"{}\"}}",
            json_escape(level),
            json_escape(message)
        ),
    );
}

fn respond_ok(id: &str, result: &str) {
    write_line(&format!(
        "{{\"id\":{},\"ok\":true,\"result\":{}}}",
        id,
        compact_json(result)
    ));
}
fn respond_err(id: &str, error: &str) {
    write_line(&format!(
        "{{\"id\":{},\"ok\":false,\"error\":\"{}\"}}",
        id,
        json_escape(error)
    ));
    emit(
        "error",
        &format!("{{\"message\":\"{}\"}}", json_escape(error)),
    );
}

fn config_path() -> PathBuf {
    env::var_os("BAMT_CONFIG_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("blue_archive_config.json"))
}

fn log_dir() -> PathBuf {
    env::var_os("BAMT_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data").join("logs"))
}

fn duration_us(duration: Duration) -> u64 {
    duration.as_micros().min(u64::MAX as u128) as u64
}

fn wall_clock_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn safe_log_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "macro".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn percentile(values: &[u64], percentile: f64) -> u64 {
    if values.is_empty() {
        return 0;
    }
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
            requested_key_hold_us: duration_us(clamp_seconds(
                action.card_hold_duration,
                0.007,
                0.001,
                0.3,
            )),
            requested_card_gap_us: duration_us(clamp_seconds(
                action.card_click_gap,
                0.007,
                0.0,
                0.3,
            )),
            requested_click_hold_us: duration_us(clamp_seconds(
                action.drag_duration,
                0.007,
                0.001,
                0.3,
            )),
            requested_loop_gap_us: duration_us(clamp_seconds(action.loop_gap, 0.007, 0.0, 0.5)),
            cycles: Vec::with_capacity(MAX_TRACE_CYCLES),
            dropped_cycles: 0,
        }
    }

    fn elapsed_us(&self) -> u64 {
        duration_us(self.started.elapsed())
    }

    fn push(&mut self, cycle: FastPlayCycleTrace) {
        if self.cycles.len() < MAX_TRACE_CYCLES {
            self.cycles.push(cycle);
        } else {
            self.dropped_cycles += 1;
        }
    }
}

fn write_fast_play_trace(trace: &FastPlayTrace) -> Result<(PathBuf, String), String> {
    let dir = log_dir();
    fs::create_dir_all(&dir).map_err(|error| format!("create log directory failed: {}", error))?;
    let file_name = format!(
        "fast-play-{}-{}.jsonl",
        trace.started_wall_ms,
        safe_log_name(&trace.action_id)
    );
    let path = dir.join(file_name);
    let file =
        fs::File::create(&path).map_err(|error| format!("create trace file failed: {}", error))?;
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
        let loop_gap = if index == 0 {
            0
        } else {
            cycle
                .cycle_start_us
                .saturating_sub(trace.cycles[index - 1].cycle_end_us)
        };
        key_holds.push(key_hold);
        card_gaps.push(card_gap);
        click_holds.push(click_hold);
        active_times.push(active);
        if index > 0 {
            loop_gaps.push(loop_gap);
        }
        input_failures += [
            cycle.key_down_ok,
            cycle.key_up_ok,
            cycle.mouse_down_ok,
            cycle.mouse_up_ok,
        ]
        .iter()
        .filter(|ok| !**ok)
        .count() as u64;
        if !(cycle.cycle_start_us <= cycle.key_down_us
            && cycle.key_down_us <= cycle.key_up_us
            && cycle.key_up_us <= cycle.mouse_down_us
            && cycle.mouse_down_us <= cycle.mouse_up_us
            && cycle.mouse_up_us <= cycle.cycle_end_us)
        {
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
    let late_count = key_holds
        .iter()
        .filter(|value| **value > trace.requested_key_hold_us + late_threshold)
        .count()
        + card_gaps
            .iter()
            .filter(|value| **value > trace.requested_card_gap_us + late_threshold)
            .count()
        + click_holds
            .iter()
            .filter(|value| **value > trace.requested_click_hold_us + late_threshold)
            .count()
        + loop_gaps
            .iter()
            .filter(|value| **value > trace.requested_loop_gap_us + late_threshold)
            .count();
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
    for (idx, (key, offset)) in [("q", 0.200_f64), ("w", 0.280_f64), ("e", 0.362_f64)]
        .iter()
        .enumerate()
    {
        let x = (2560.0 * (0.5 + offset)).round() as i32;
        let y = (1600.0_f64 - 2560.0_f64 * 0.071_f64).round() as i32;
        parts.push(format!("{{\"id\":\"skill-fast-play-{}\",\"name\":\"最速出牌 {}\",\"hotkey\":\"{}\",\"type\":\"fastPlay\",\"cardKey\":\"{}\",\"targetX\":{},\"targetY\":{},\"dragDistance\":300,\"cardHoldDuration\":0.007,\"dragDuration\":0.007,\"clickGap\":0.1,\"cardClickGap\":0.007,\"loopGap\":0.007,\"enabled\":true,\"script\":\"\"}}", idx + 1, idx + 1, key, idx + 1, x, y));
    }
    format!("[{}]", parts.join(","))
}

fn load_config() -> String {
    fs::read_to_string(config_path()).unwrap_or_else(|_| default_config())
}

fn load_config_and_sync_resolution() -> String {
    let config = load_config();
    if let Ok(mut resolution) = runtime().resolution.lock() {
        *resolution = resolution_from_config(&config);
    }
    config
}

fn save_config(payload: &str) -> Result<String, String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = if payload.trim().is_empty() || payload.trim() == "null" {
        default_config()
    } else {
        payload.trim().to_string()
    };
    fs::write(path, &text).map_err(|e| e.to_string())?;
    if let Ok(mut resolution) = runtime().resolution.lock() {
        *resolution = resolution_from_config(&text);
    }
    Ok(text)
}

fn find_key_colon(src: &str, key: &str) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'"' {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < bytes.len() {
            if bytes[index] == b'\\' {
                index += 2;
                continue;
            }
            if bytes[index] == b'"' {
                break;
            }
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        let end = index + 1;
        let mut colon = end;
        while colon < bytes.len() && bytes[colon].is_ascii_whitespace() {
            colon += 1;
        }
        if colon < bytes.len()
            && bytes[colon] == b':'
            && decode_json_string(&src[start..end]).as_deref() == Some(key)
        {
            return Some(colon + 1);
        }
        index = end;
    }
    None
}

fn decode_json_string(raw: &str) -> Option<String> {
    if !raw.starts_with('"') || !raw.ends_with('"') || raw.len() < 2 {
        return None;
    }
    let mut output = String::with_capacity(raw.len() - 2);
    let mut chars = raw[1..raw.len() - 1].chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next()? {
            '"' => output.push('"'),
            '\\' => output.push('\\'),
            '/' => output.push('/'),
            'b' => output.push('\u{0008}'),
            'f' => output.push('\u{000C}'),
            'n' => output.push('\n'),
            'r' => output.push('\r'),
            't' => output.push('\t'),
            'u' => {
                let hex: String = chars.by_ref().take(4).collect();
                if hex.len() != 4 {
                    return None;
                }
                let value = u32::from_str_radix(&hex, 16).ok()?;
                output.push(char::from_u32(value)?);
            }
            _ => return None,
        }
    }
    Some(output)
}

fn scan_json_value(src: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = src.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let begin = i;
    if bytes[i] == b'"' {
        i += 1;
        while i < bytes.len() {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                return Some((begin, i + 1));
            }
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
                if b == b'\\' {
                    i += 2;
                    continue;
                }
                if b == b'"' {
                    in_string = false;
                }
            } else if b == b'"' {
                in_string = true;
            } else if b == open {
                depth += 1;
            } else if b == close {
                depth -= 1;
                if depth == 0 {
                    return Some((begin, i + 1));
                }
            }
            i += 1;
        }
        return None;
    }
    while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b']' {
        i += 1;
    }
    Some((begin, i))
}

fn raw_value(src: &str, key: &str) -> Option<String> {
    let colon = find_key_colon(src, key)?;
    let (a, b) = scan_json_value(src, colon)?;
    Some(src[a..b].trim().to_string())
}

fn string_value(src: &str, key: &str) -> Option<String> {
    let raw = raw_value(src, key)?;
    decode_json_string(&raw)
}

fn number_value(src: &str, key: &str, fallback: f64) -> f64 {
    raw_value(src, key)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(fallback)
}

fn bool_value(src: &str, key: &str, fallback: bool) -> bool {
    match raw_value(src, key).as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => fallback,
    }
}

fn parse_request(line: &str) -> Result<Request, String> {
    let id = raw_value(line, "id").unwrap_or_else(|| "null".to_string());
    let command = string_value(line, "command").ok_or_else(|| "Missing command".to_string())?;
    let payload = raw_value(line, "payload").unwrap_or_else(|| "null".to_string());
    Ok(Request {
        id,
        command,
        payload,
    })
}

fn split_objects(array: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(pos) = array[i..].find('{') {
        let start = i + pos;
        if let Some((_, end)) = scan_json_value(array, start) {
            out.push(array[start..end].to_string());
            i = end;
        } else {
            break;
        }
    }
    out
}

fn resolution_from_config(config: &str) -> Resolution {
    let raw = raw_value(config, "resolution").unwrap_or_default();
    Resolution {
        width: number_value(&raw, "width", 2560.0).max(100.0) as i32,
        height: number_value(&raw, "height", 1600.0).max(100.0) as i32,
    }
}

fn actions_from_config(config: &str) -> Result<Vec<Action>, String> {
    let Some(actions_raw) = raw_value(config, "actions") else {
        return Ok(Vec::new());
    };
    let mut actions = Vec::new();
    let mut script_errors = Vec::new();
    for obj in split_objects(&actions_raw) {
        if !bool_value(&obj, "enabled", true) {
            continue;
        }
        let action_type = string_value(&obj, "type").unwrap_or_else(|| "point".to_string());
        if !matches!(
            action_type.as_str(),
            "fastPlay" | "drag" | "point" | "click" | "rapid" | "script"
        ) {
            continue;
        }
        let hotkey = string_value(&obj, "hotkey").unwrap_or_default();
        if key_to_vk(&hotkey).is_none() {
            continue;
        }
        let card_key = string_value(&obj, "cardKey").unwrap_or_default();
        if action_type == "fastPlay" && key_to_vk(&card_key).is_none() {
            continue;
        }
        let default_loop_gap = if action_type == "drag" {
            0.05
        } else if action_type == "fastPlay" {
            0.007
        } else {
            0.001
        };
        let default_drag_duration = if action_type == "fastPlay" {
            0.007
        } else {
            0.03
        };
        let default_card_click_gap = if action_type == "fastPlay" {
            0.007
        } else {
            0.010
        };
        let name = string_value(&obj, "name").unwrap_or_else(|| format!("Rust {}", action_type));
        let script = string_value(&obj, "script").unwrap_or_default();
        let script_program = if action_type == "script" {
            match parse_script(&script) {
                Ok(program) => Some(Arc::new(program)),
                Err(error) => {
                    script_errors.push(format!("{}: {}", name, error));
                    None
                }
            }
        } else {
            None
        };
        actions.push(Action {
            id: string_value(&obj, "id").unwrap_or_else(|| hotkey.clone()),
            name,
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
            script_program,
        });
    }
    if script_errors.is_empty() {
        Ok(actions)
    } else {
        Err(format!("DSL 编译失败：{}", script_errors.join("；")))
    }
}

fn key_to_vk(key: &str) -> Option<u32> {
    let lowered = key.trim().to_ascii_lowercase();
    if lowered.len() == 1 {
        let b = lowered.as_bytes()[0];
        if b.is_ascii_lowercase() {
            return Some((b - 32) as u32);
        }
        if b.is_ascii_digit() {
            return Some(b as u32);
        }
    }
    if let Some(number) = lowered
        .strip_prefix('f')
        .and_then(|value| value.parse::<u32>().ok())
    {
        if (1..=12).contains(&number) {
            return Some(0x6F + number);
        }
    }
    match lowered.as_str() {
        "space" => Some(0x20),
        "tab" => Some(0x09),
        "enter" => Some(0x0D),
        "esc" | "escape" => Some(0x1B),
        "left" => Some(0x25),
        "up" => Some(0x26),
        "right" => Some(0x27),
        "down" => Some(0x28),
        _ => None,
    }
}

fn current_resolution() -> Resolution {
    *runtime()
        .resolution
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

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
    unsafe {
        GetCursorPos(&mut point);
    }
    point
}

fn logical_to_screen(x: i32, y: i32) -> Point {
    let res = current_resolution();
    let (left, top, sw, sh) = virtual_screen_bounds();
    let lw = (res.width - 1).max(1);
    let lh = (res.height - 1).max(1);
    let lx = x.clamp(0, lw);
    let ly = y.clamp(0, lh);
    Point {
        x: left + ((lx as f64) * ((sw - 1) as f64) / (lw as f64)).round() as i32,
        y: top + ((ly as f64) * ((sh - 1) as f64) / (lh as f64)).round() as i32,
    }
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

#[derive(Clone, Copy)]
struct WindowsInputDriver;

impl WindowsInputDriver {
    fn inject(self, mut input: Input) -> bool {
        unsafe { SendInput(1, &mut input, size_of::<Input>() as i32) == 1 }
    }

    fn move_screen(self, point: Point) -> bool {
        let (left, top, sw, sh) = virtual_screen_bounds();
        let abs_x = (((point.x - left) as f64) * 65535.0 / ((sw - 1).max(1) as f64)).round() as i32;
        let abs_y = (((point.y - top) as f64) * 65535.0 / ((sh - 1).max(1) as f64)).round() as i32;
        self.inject(Input {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MouseInput {
                    dx: abs_x,
                    dy: abs_y,
                    mouse_data: 0,
                    dw_flags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        })
    }

    fn move_logical(self, x: i32, y: i32) -> bool {
        self.move_screen(logical_to_screen(x, y))
    }

    fn keyboard(self, vk: u16, key_up: bool) -> bool {
        self.inject(Input {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KeybdInput {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: if key_up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        })
    }

    fn mouse_left(self, down: bool) -> bool {
        self.inject(Input {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MouseInput {
                    dx: 0,
                    dy: 0,
                    mouse_data: 0,
                    dw_flags: if down {
                        MOUSEEVENTF_LEFTDOWN
                    } else {
                        MOUSEEVENTF_LEFTUP
                    },
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        })
    }
}

const INPUT_DRIVER: WindowsInputDriver = WindowsInputDriver;

fn move_screen(point: Point) -> bool {
    INPUT_DRIVER.move_screen(point)
}

fn move_logical(x: i32, y: i32) -> bool {
    INPUT_DRIVER.move_logical(x, y)
}

fn clamp_seconds(value: f64, fallback: f64, min: f64, max: f64) -> Duration {
    let seconds = if value.is_finite() { value } else { fallback };
    Duration::from_secs_f64(seconds.clamp(min, max))
}

fn wait_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel
        .map(|flag| runtime().stop.load(Ordering::Relaxed) || flag.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn high_res_sleep(duration: Duration) -> bool {
    HIGH_RES_TIMER.with(|timer| {
        timer
            .as_ref()
            .map(|timer| timer.sleep(duration))
            .unwrap_or(false)
    })
}

fn wait_until(deadline: Instant, cancel: Option<&AtomicBool>) -> bool {
    const CANCEL_SLICE: Duration = Duration::from_millis(1);
    const SPIN_TAIL: Duration = Duration::from_micros(200);

    loop {
        if wait_cancelled(cancel) {
            return false;
        }

        let now = Instant::now();
        if now >= deadline {
            return true;
        }

        let remaining = deadline.duration_since(now);
        if remaining > SPIN_TAIL {
            let sleep_time = remaining - SPIN_TAIL;
            let sleep_slice = if cancel.is_some() {
                sleep_time.min(CANCEL_SLICE)
            } else {
                sleep_time
            };
            if !high_res_sleep(sleep_slice) {
                thread::sleep(sleep_slice);
            }
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
    INPUT_DRIVER.keyboard(vk, key_up)
}

fn send_key_press(vk: u16, duration: Duration) {
    send_keyboard(vk, false);
    sleep_precise(duration);
    send_keyboard(vk, true);
}

fn send_mouse_left(down: bool) -> bool {
    INPUT_DRIVER.mouse_left(down)
}

fn click_current(delay: Duration) {
    send_mouse_left(true);
    sleep_precise(delay);
    send_mouse_left(false);
}

fn execute_fast_play_once(action: &Action) {
    if let Some(vk) = key_to_vk(&action.card_key) {
        send_key_press(
            vk as u16,
            clamp_seconds(action.card_hold_duration, 0.007, 0.001, 0.3),
        );
        sleep_precise(clamp_seconds(action.card_click_gap, 0.007, 0.0, 0.3));
        click_current(clamp_seconds(action.drag_duration, 0.007, 0.001, 0.3));
    }
}

fn execute_fast_play_once_traced(action: &Action, trace: &mut FastPlayTrace, cycle: u64) {
    let Some(vk) = key_to_vk(&action.card_key) else {
        return;
    };
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
    if let Ok(mut intended) = runtime().intended_cursor.lock() {
        *intended = start_release;
    }
    runtime().drag_active.store(true, Ordering::SeqCst);

    let up_y = (action.target_y - action.drag_distance).max(0);
    move_logical(action.target_x, action.target_y);
    thread::sleep(Duration::from_millis(5));
    send_mouse_left(true);
    thread::sleep(Duration::from_millis(6));
    move_logical(action.target_x, up_y);
    sleep_cancelable(
        clamp_seconds(action.drag_duration, 0.02, 0.001, 0.3),
        cancel,
    );

    move_screen(start_release);
    thread::sleep(Duration::from_millis(8));
    send_mouse_left(false);
    move_screen(start_release);
    runtime().drag_active.store(false, Ordering::SeqCst);
}

fn execute_point_hold(action: &Action, cancel: &AtomicBool) {
    let original = cursor_pos();
    emit_log(
        "info",
        &format!(
            "Rust point hold {} -> {},{}",
            action.name, action.target_x, action.target_y
        ),
    );
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
    emit_log(
        "info",
        &format!(
            "Rust point immediate {} -> {},{}",
            action.name, action.target_x, action.target_y
        ),
    );
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
    Wait(Duration),
    LoopUntilRelease(Vec<ScriptCommand>),
    Repeat(u32, Vec<ScriptCommand>),
    Move(ScriptPoint, Duration),
    Click(ScriptPoint, Duration),
    Press(ScriptPoint),
    Release(ScriptPoint),
    Drag(ScriptPoint, ScriptPoint, Duration),
    KeyTap(u16, Duration),
    KeyDown(u16),
    KeyUp(u16),
    Restore(Duration),
    ReleaseActions,
    ReleaseAll,
}

#[derive(Clone, Debug)]
enum ScriptPoint {
    Absolute(i32, i32),
    Origin(i32, i32),
    Target(i32, i32),
    Here(i32, i32),
}

#[derive(Clone, Debug)]
struct ScriptLine {
    number: usize,
    text: String,
}

struct ScriptParser {
    lines: Vec<ScriptLine>,
    index: usize,
    release_actions_seen: bool,
}

const SCRIPT_MAX_NESTING: usize = 8;
const SCRIPT_MAX_REPEAT: u32 = 100_000;

fn strip_script_comment(line: &str) -> String {
    let mut cut = line.len();
    for marker in ["#", ";", "//"] {
        if let Some(index) = line.find(marker) {
            cut = cut.min(index);
        }
    }
    line[..cut].trim().to_string()
}

fn parse_script_i32(token: Option<&&str>, line: usize, label: &str) -> Result<i32, String> {
    token
        .ok_or_else(|| format!("第 {} 行：缺少{}", line, label))?
        .parse::<i32>()
        .map_err(|_| format!("第 {} 行：{}必须是整数", line, label))
}

fn parse_script_duration(
    token: Option<&&str>,
    line: usize,
    label: &str,
    fallback: Option<Duration>,
) -> Result<Duration, String> {
    let Some(raw) = token.copied() else {
        return fallback.ok_or_else(|| format!("第 {} 行：缺少{}", line, label));
    };
    let lowered = raw.to_ascii_lowercase();
    let (number, multiplier) = if let Some(value) = lowered.strip_suffix("us") {
        (value, 0.000_001)
    } else if let Some(value) = lowered.strip_suffix("ms") {
        (value, 0.001)
    } else if let Some(value) = lowered.strip_suffix('s') {
        (value, 1.0)
    } else {
        (lowered.as_str(), 0.001)
    };
    let value = number.parse::<f64>().map_err(|_| {
        format!(
            "第 {} 行：{}格式无效，请使用 500us、7ms 或 0.02s",
            line, label
        )
    })?;
    if !value.is_finite() || value < 0.0 || value * multiplier > 3600.0 {
        return Err(format!("第 {} 行：{}必须在 0 到 1 小时之间", line, label));
    }
    Ok(Duration::from_secs_f64(value * multiplier))
}

fn parse_script_point(
    tokens: &[&str],
    index: &mut usize,
    line: usize,
) -> Result<ScriptPoint, String> {
    let first = tokens
        .get(*index)
        .ok_or_else(|| {
            format!(
                "第 {} 行：缺少坐标，可使用 x y、origin、target 或 here",
                line
            )
        })?
        .to_ascii_lowercase();
    if matches!(
        first.as_str(),
        "origin" | "mouse" | "target" | "here" | "current"
    ) {
        *index += 1;
        let mut offset = (0, 0);
        if tokens.get(*index).map(|value| value.to_ascii_lowercase()) == Some("offset".to_string())
        {
            offset.0 = parse_script_i32(tokens.get(*index + 1), line, "X 偏移")?;
            offset.1 = parse_script_i32(tokens.get(*index + 2), line, "Y 偏移")?;
            *index += 3;
        }
        return Ok(match first.as_str() {
            "origin" | "mouse" => ScriptPoint::Origin(offset.0, offset.1),
            "target" => ScriptPoint::Target(offset.0, offset.1),
            _ => ScriptPoint::Here(offset.0, offset.1),
        });
    }
    let x = parse_script_i32(tokens.get(*index), line, "X 坐标")?;
    let y = parse_script_i32(tokens.get(*index + 1), line, "Y 坐标")?;
    *index += 2;
    Ok(ScriptPoint::Absolute(x, y))
}

fn ensure_script_end(tokens: &[&str], index: usize, line: usize) -> Result<(), String> {
    if index == tokens.len() {
        Ok(())
    } else {
        Err(format!(
            "第 {} 行：多余参数 {}",
            line,
            tokens[index..].join(" ")
        ))
    }
}

impl ScriptParser {
    fn parse_block(
        &mut self,
        depth: usize,
        expects_end: bool,
    ) -> Result<Vec<ScriptCommand>, String> {
        if depth > SCRIPT_MAX_NESTING {
            return Err(format!("DSL 嵌套不能超过 {} 层", SCRIPT_MAX_NESTING));
        }
        let mut commands = Vec::new();
        while self.index < self.lines.len() {
            let source = self.lines[self.index].clone();
            self.index += 1;
            let normalized = source.text.replace(',', " ");
            let tokens: Vec<&str> = normalized.split_whitespace().collect();
            let line = source.number;
            let keyword = tokens[0].to_ascii_lowercase();
            match keyword.as_str() {
                "end" | "loop_end" => {
                    if !expects_end {
                        return Err(format!(
                            "第 {} 行：这里没有可结束的 loop 或 repeat 块",
                            line
                        ));
                    }
                    ensure_script_end(&tokens, 1, line)?;
                    return Ok(commands);
                }
                "loop" => {
                    if tokens.len() > 2 {
                        return Err(format!(
                            "第 {} 行：loop 后只能填写次数或 until_release",
                            line
                        ));
                    }
                    let mode = tokens.get(1).map(|value| value.to_ascii_lowercase());
                    let count = match mode.as_deref() {
                        None | Some("until_release") => None,
                        Some(value) => {
                            let count = value.parse::<u32>().map_err(|_| {
                                format!("第 {} 行：loop 参数必须是次数或 until_release", line)
                            })?;
                            if count == 0 || count > SCRIPT_MAX_REPEAT {
                                return Err(format!(
                                    "第 {} 行：循环次数必须在 1 到 {} 之间",
                                    line, SCRIPT_MAX_REPEAT
                                ));
                            }
                            Some(count)
                        }
                    };
                    let body = self.parse_block(depth + 1, true)?;
                    if body.is_empty() {
                        return Err(format!("第 {} 行：loop 循环体不能为空", line));
                    }
                    if !script_has_timing(&body) {
                        return Err(format!("第 {} 行：loop 循环体必须包含 wait、click、drag、key tap 或带等待的 move，避免空转占满 CPU", line));
                    }
                    commands.push(match count {
                        Some(count) => ScriptCommand::Repeat(count, body),
                        None => ScriptCommand::LoopUntilRelease(body),
                    });
                }
                "repeat" => {
                    ensure_script_end(&tokens, 2, line)?;
                    let count = tokens
                        .get(1)
                        .ok_or_else(|| format!("第 {} 行：缺少重复次数", line))?
                        .parse::<u32>()
                        .map_err(|_| format!("第 {} 行：重复次数必须是整数", line))?;
                    if count == 0 || count > SCRIPT_MAX_REPEAT {
                        return Err(format!(
                            "第 {} 行：重复次数必须在 1 到 {} 之间",
                            line, SCRIPT_MAX_REPEAT
                        ));
                    }
                    let body = self.parse_block(depth + 1, true)?;
                    if body.is_empty() {
                        return Err(format!("第 {} 行：repeat 循环体不能为空", line));
                    }
                    commands.push(ScriptCommand::Repeat(count, body));
                }
                "wait" | "sleep" => {
                    ensure_script_end(&tokens, 2, line)?;
                    commands.push(ScriptCommand::Wait(parse_script_duration(
                        tokens.get(1),
                        line,
                        "等待时间",
                        None,
                    )?));
                }
                "release_actions" => {
                    ensure_script_end(&tokens, 1, line)?;
                    if depth != 0 {
                        return Err(format!("第 {} 行：release_actions 只能位于脚本顶层", line));
                    }
                    if self.release_actions_seen {
                        return Err(format!(
                            "第 {} 行：每个脚本只能包含一个 release_actions",
                            line
                        ));
                    }
                    self.release_actions_seen = true;
                    commands.push(ScriptCommand::ReleaseActions);
                }
                "release_all" => {
                    ensure_script_end(&tokens, 1, line)?;
                    commands.push(ScriptCommand::ReleaseAll);
                }
                "move" => {
                    let mut next = 1;
                    let point = parse_script_point(&tokens, &mut next, line)?;
                    let delay = parse_script_duration(
                        tokens.get(next),
                        line,
                        "移动后等待时间",
                        Some(Duration::ZERO),
                    )?;
                    if tokens.get(next).is_some() {
                        next += 1;
                    }
                    ensure_script_end(&tokens, next, line)?;
                    commands.push(ScriptCommand::Move(point, delay));
                }
                "click" => {
                    let mut next = 1;
                    let point = if tokens.len() == 1 {
                        ScriptPoint::Here(0, 0)
                    } else {
                        parse_script_point(&tokens, &mut next, line)?
                    };
                    let hold = parse_script_duration(
                        tokens.get(next),
                        line,
                        "点击按住时间",
                        Some(Duration::from_millis(7)),
                    )?;
                    if hold.is_zero() {
                        return Err(format!("第 {} 行：点击按住时间必须大于 0", line));
                    }
                    if tokens.get(next).is_some() {
                        next += 1;
                    }
                    ensure_script_end(&tokens, next, line)?;
                    commands.push(ScriptCommand::Click(point, hold));
                }
                "press" | "release" => {
                    let mut next = 1;
                    let point = if keyword == "release" && tokens.len() == 1 {
                        ScriptPoint::Here(0, 0)
                    } else {
                        parse_script_point(&tokens, &mut next, line)?
                    };
                    ensure_script_end(&tokens, next, line)?;
                    commands.push(if keyword == "press" {
                        ScriptCommand::Press(point)
                    } else {
                        ScriptCommand::Release(point)
                    });
                }
                "drag" => {
                    let mut next = 1;
                    let from = parse_script_point(&tokens, &mut next, line)?;
                    if tokens.get(next).map(|value| value.to_ascii_lowercase())
                        == Some("to".to_string())
                    {
                        next += 1;
                    }
                    let to = parse_script_point(&tokens, &mut next, line)?;
                    let duration = parse_script_duration(tokens.get(next), line, "拖动时间", None)?;
                    if duration.is_zero() {
                        return Err(format!("第 {} 行：拖动时间必须大于 0", line));
                    }
                    next += 1;
                    ensure_script_end(&tokens, next, line)?;
                    commands.push(ScriptCommand::Drag(from, to, duration));
                }
                "key" => {
                    let operation = tokens
                        .get(1)
                        .ok_or_else(|| {
                            format!(
                                "第 {} 行：按键语法为 key tap|down|up <按键> [按住时间]",
                                line
                            )
                        })?
                        .to_ascii_lowercase();
                    let key = tokens
                        .get(2)
                        .ok_or_else(|| format!("第 {} 行：缺少按键名称", line))?;
                    let vk = key_to_vk(key)
                        .ok_or_else(|| format!("第 {} 行：不支持的按键 {}", line, key))?
                        as u16;
                    match operation.as_str() {
                        "tap" => {
                            let hold = parse_script_duration(
                                tokens.get(3),
                                line,
                                "按键按住时间",
                                Some(Duration::from_millis(7)),
                            )?;
                            if hold.is_zero() {
                                return Err(format!("第 {} 行：按键按住时间必须大于 0", line));
                            }
                            ensure_script_end(
                                &tokens,
                                if tokens.get(3).is_some() { 4 } else { 3 },
                                line,
                            )?;
                            commands.push(ScriptCommand::KeyTap(vk, hold));
                        }
                        "down" | "up" => {
                            ensure_script_end(&tokens, 3, line)?;
                            commands.push(if operation == "down" {
                                ScriptCommand::KeyDown(vk)
                            } else {
                                ScriptCommand::KeyUp(vk)
                            });
                        }
                        _ => return Err(format!("第 {} 行：按键操作只能是 tap、down 或 up", line)),
                    }
                }
                "key_press" | "key_release" => {
                    let key = tokens
                        .get(1)
                        .ok_or_else(|| format!("第 {} 行：缺少按键名称", line))?;
                    ensure_script_end(&tokens, 2, line)?;
                    let vk = key_to_vk(key)
                        .ok_or_else(|| format!("第 {} 行：不支持的按键 {}", line, key))?
                        as u16;
                    commands.push(if keyword == "key_press" {
                        ScriptCommand::KeyDown(vk)
                    } else {
                        ScriptCommand::KeyUp(vk)
                    });
                }
                "mouse_press" | "mouse_release" => {
                    let button = tokens
                        .get(1)
                        .ok_or_else(|| format!("第 {} 行：缺少鼠标按键名称", line))?;
                    ensure_script_end(&tokens, 2, line)?;
                    if !button.eq_ignore_ascii_case("left") {
                        return Err(format!(
                            "第 {} 行：Windows 原生后端目前仅支持 {} left",
                            line, keyword
                        ));
                    }
                    commands.push(if keyword == "mouse_press" {
                        ScriptCommand::Press(ScriptPoint::Here(0, 0))
                    } else {
                        ScriptCommand::Release(ScriptPoint::Here(0, 0))
                    });
                }
                "restore" => {
                    let duration = parse_script_duration(
                        tokens.get(1),
                        line,
                        "回原位后等待时间",
                        Some(Duration::ZERO),
                    )?;
                    ensure_script_end(&tokens, if tokens.get(1).is_some() { 2 } else { 1 }, line)?;
                    commands.push(ScriptCommand::Restore(duration));
                }
                _ => return Err(format!("第 {} 行：不支持的命令 {}", line, tokens[0])),
            }
        }
        if expects_end {
            Err("脚本结束前缺少 loop_end（也兼容 end）".to_string())
        } else {
            Ok(commands)
        }
    }
}

fn script_has_timing(commands: &[ScriptCommand]) -> bool {
    commands.iter().any(|command| match command {
        ScriptCommand::Wait(duration)
        | ScriptCommand::Move(_, duration)
        | ScriptCommand::Restore(duration) => !duration.is_zero(),
        ScriptCommand::Click(_, _) | ScriptCommand::Drag(_, _, _) | ScriptCommand::KeyTap(_, _) => {
            true
        }
        ScriptCommand::Repeat(_, body) | ScriptCommand::LoopUntilRelease(body) => {
            script_has_timing(body)
        }
        _ => false,
    })
}

fn parse_script(script: &str) -> Result<Vec<ScriptCommand>, String> {
    let lines = script
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let text = strip_script_comment(line);
            if text.is_empty() {
                None
            } else {
                Some(ScriptLine {
                    number: index + 1,
                    text,
                })
            }
        })
        .collect();
    let mut parser = ScriptParser {
        lines,
        index: 0,
        release_actions_seen: false,
    };
    let commands = parser.parse_block(0, false)?;
    if commands.is_empty() {
        Err("脚本不能为空".to_string())
    } else {
        Ok(commands)
    }
}

struct ScriptExecutionContext {
    origin_screen: Point,
    origin_logical: Point,
    target_logical: Point,
    mouse_down: bool,
    held_keys: HashSet<u16>,
}

impl ScriptExecutionContext {
    fn input_result(&self, success: bool, operation: &str) -> bool {
        if !success {
            emit_log("error", &format!("Rust DSL 输入失败：{}", operation));
        }
        success
    }

    fn move_to(&self, point: &ScriptPoint) -> bool {
        self.input_result(
            INPUT_DRIVER.move_screen(resolve_script_point(point, self)),
            "移动鼠标",
        )
    }

    fn release_mouse(&mut self) -> bool {
        let released = self.input_result(INPUT_DRIVER.mouse_left(false), "释放鼠标左键");
        self.mouse_down = false;
        released
    }

    fn click(&mut self, point: &ScriptPoint, hold: Duration, cancel: &AtomicBool) -> bool {
        if !self.move_to(point) {
            return false;
        }
        if self.mouse_down && !self.release_mouse() {
            return false;
        }
        if !self.input_result(INPUT_DRIVER.mouse_left(true), "按下鼠标左键") {
            return false;
        }
        self.mouse_down = true;
        let waited = script_wait(hold, cancel);
        let released = self.release_mouse();
        waited && released
    }

    fn press(&mut self, point: &ScriptPoint) -> bool {
        if !self.move_to(point) {
            return false;
        }
        if !self.mouse_down {
            if !self.input_result(INPUT_DRIVER.mouse_left(true), "按下鼠标左键") {
                return false;
            }
            self.mouse_down = true;
        }
        true
    }

    fn release(&mut self, point: &ScriptPoint) -> bool {
        self.move_to(point) && self.release_mouse()
    }

    fn drag(
        &mut self,
        from: &ScriptPoint,
        to: &ScriptPoint,
        duration: Duration,
        cancel: &AtomicBool,
    ) -> bool {
        if !self.move_to(from) {
            return false;
        }
        if self.mouse_down && !self.release_mouse() {
            return false;
        }
        if !self.input_result(INPUT_DRIVER.mouse_left(true), "拖动按下鼠标左键") {
            return false;
        }
        self.mouse_down = true;
        let waited = script_wait(duration, cancel);
        let moved = !waited || self.move_to(to);
        let released = self.release_mouse();
        waited && moved && released
    }

    fn key_tap(&mut self, vk: u16, hold: Duration, cancel: &AtomicBool) -> bool {
        if !self.input_result(INPUT_DRIVER.keyboard(vk, false), "按下键盘按键") {
            return false;
        }
        self.held_keys.insert(vk);
        let waited = script_wait(hold, cancel);
        let released = self.input_result(INPUT_DRIVER.keyboard(vk, true), "释放键盘按键");
        self.held_keys.remove(&vk);
        waited && released
    }

    fn key_down(&mut self, vk: u16) -> bool {
        if self.held_keys.contains(&vk) {
            return true;
        }
        if !self.input_result(INPUT_DRIVER.keyboard(vk, false), "按下键盘按键") {
            return false;
        }
        self.held_keys.insert(vk);
        true
    }

    fn key_up(&mut self, vk: u16) -> bool {
        let released = self.input_result(INPUT_DRIVER.keyboard(vk, true), "释放键盘按键");
        self.held_keys.remove(&vk);
        released
    }

    fn restore(&mut self, duration: Duration, cancel: &AtomicBool) -> bool {
        let released = !self.mouse_down || self.release_mouse();
        let moved = self.input_result(
            INPUT_DRIVER.move_screen(self.origin_screen),
            "恢复触发时鼠标位置",
        );
        released && moved && script_wait(duration, cancel)
    }

    fn release_all(&mut self) -> bool {
        let mut ok = true;
        if self.mouse_down {
            ok = self.release_mouse() && ok;
        }
        let held_keys: Vec<u16> = self.held_keys.drain().collect();
        for vk in held_keys {
            ok = self.input_result(INPUT_DRIVER.keyboard(vk, true), "释放全部键盘按键") && ok;
        }
        ok
    }

    fn cleanup(&mut self) {
        if self.mouse_down {
            let _ = self.release_mouse();
        }
        let held_keys: Vec<u16> = self.held_keys.drain().collect();
        for vk in held_keys {
            let _ = self.input_result(INPUT_DRIVER.keyboard(vk, true), "清理键盘按键");
        }
        let _ = self.input_result(
            INPUT_DRIVER.move_screen(self.origin_screen),
            "清理并恢复鼠标位置",
        );
    }
}

fn resolve_script_point(point: &ScriptPoint, context: &ScriptExecutionContext) -> Point {
    let logical = match point {
        ScriptPoint::Absolute(x, y) => Point { x: *x, y: *y },
        ScriptPoint::Origin(dx, dy) => Point {
            x: context.origin_logical.x + dx,
            y: context.origin_logical.y + dy,
        },
        ScriptPoint::Target(dx, dy) => Point {
            x: context.target_logical.x + dx,
            y: context.target_logical.y + dy,
        },
        ScriptPoint::Here(dx, dy) => {
            let current = screen_to_logical(cursor_pos());
            Point {
                x: current.x + dx,
                y: current.y + dy,
            }
        }
    };
    logical_to_screen(logical.x, logical.y)
}

fn script_cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::Relaxed) || runtime().stop.load(Ordering::Relaxed)
}

fn script_wait(duration: Duration, cancel: &AtomicBool) -> bool {
    duration.is_zero() || wait_until(Instant::now() + duration, Some(cancel))
}

fn execute_script_commands(
    commands: &[ScriptCommand],
    context: &mut ScriptExecutionContext,
    execution_cancel: &AtomicBool,
    trigger_cancel: &AtomicBool,
) -> bool {
    for command in commands {
        let completed = match command {
            ScriptCommand::Wait(duration) => script_wait(*duration, execution_cancel),
            ScriptCommand::Move(point, duration) => {
                context.move_to(point) && script_wait(*duration, execution_cancel)
            }
            ScriptCommand::Click(point, hold) => context.click(point, *hold, execution_cancel),
            ScriptCommand::Press(point) => context.press(point),
            ScriptCommand::Release(point) => context.release(point),
            ScriptCommand::Drag(from, to, duration) => {
                context.drag(from, to, *duration, execution_cancel)
            }
            ScriptCommand::KeyTap(vk, hold) => context.key_tap(*vk, *hold, execution_cancel),
            ScriptCommand::KeyDown(vk) => context.key_down(*vk),
            ScriptCommand::KeyUp(vk) => context.key_up(*vk),
            ScriptCommand::Restore(duration) => context.restore(*duration, execution_cancel),
            ScriptCommand::ReleaseActions => {
                while !trigger_cancel.load(Ordering::Relaxed)
                    && !runtime().stop.load(Ordering::Relaxed)
                {
                    thread::sleep(Duration::from_millis(1));
                }
                !runtime().stop.load(Ordering::Relaxed)
            }
            ScriptCommand::ReleaseAll => context.release_all(),
            ScriptCommand::Repeat(count, body) => {
                let mut ok = true;
                for _ in 0..*count {
                    if !execute_script_commands(body, context, execution_cancel, trigger_cancel) {
                        ok = false;
                        break;
                    }
                }
                ok
            }
            ScriptCommand::LoopUntilRelease(body) => {
                let mut ok = true;
                let mut first_cycle = true;
                while first_cycle || !script_cancelled(trigger_cancel) {
                    // A quick tap can release before the worker thread starts. The
                    // trigger must still complete one full cycle; X/global stop is
                    // still observed through runtime().stop inside script_wait.
                    let initial_cycle_cancel = AtomicBool::new(false);
                    let cycle_cancel = if first_cycle {
                        &initial_cycle_cancel
                    } else {
                        trigger_cancel
                    };
                    first_cycle = false;
                    if !execute_script_commands(body, context, cycle_cancel, trigger_cancel) {
                        ok = false;
                        break;
                    }
                }
                ok
            }
        };
        if !completed {
            return false;
        }
    }
    true
}

fn execute_script_once(action: &Action, cancel: &AtomicBool) -> Result<(), String> {
    let program = action
        .script_program
        .as_ref()
        .ok_or_else(|| "脚本尚未编译".to_string())?;
    let origin_screen = cursor_pos();
    let mut context = ScriptExecutionContext {
        origin_screen,
        origin_logical: screen_to_logical(origin_screen),
        target_logical: Point {
            x: action.target_x,
            y: action.target_y,
        },
        mouse_down: false,
        held_keys: HashSet::new(),
    };
    // MuMu-compatible top-level semantics: pressing the hotkey starts one
    // complete pass. Only an explicit loop observes hotkey release.
    let one_shot_cancel = AtomicBool::new(false);
    execute_script_commands(program, &mut context, &one_shot_cancel, cancel);
    context.cleanup();
    Ok(())
}

fn execute_action_loop(
    action: Action,
    cancel: Arc<AtomicBool>,
    queue_delay: Duration,
) -> Option<FastPlayTrace> {
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
        "drag" => {
            while !cancel.load(Ordering::Relaxed) && !runtime().stop.load(Ordering::Relaxed) {
                execute_drag_once(&action, &cancel);
                sleep_cancelable(clamp_seconds(action.loop_gap, 0.08, 0.05, 0.8), &cancel);
            }
        }
        "point" => execute_point_hold(&action, &cancel),
        "click" | "rapid" => execute_point_once(&action),
        "script" => {
            if let Err(error) = execute_script_once(&action, &cancel) {
                emit_log("error", &format!("Rust script failed: {}", error));
            }
        }
        _ => {}
    }
    None
}

fn run_worker_job(job: WorkerJob) {
    let action = job.action;
    let queue_delay = job.queued_at.elapsed();
    emit_log(
        "info",
        &format!(
            "Rust backend hotkey {} -> {} ({})",
            action.hotkey, action.name, action.action_type
        ),
    );
    emit(
        "execution",
        &format!(
            "{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"start\"}}",
            json_escape(&action.id),
            json_escape(&action.name)
        ),
    );
    let trace = execute_action_loop(action.clone(), job.cancel, queue_delay);
    send_mouse_left(false);
    emit(
        "execution",
        &format!(
            "{{\"actionId\":\"{}\",\"actionName\":\"{}\",\"phase\":\"end\"}}",
            json_escape(&action.id),
            json_escape(&action.name)
        ),
    );
    let _ = runtime().active.lock().map(|mut active| {
        active.remove(&job.vk);
    });
    if let Some(trace) = trace {
        match write_fast_play_trace(&trace) {
            Ok((path, summary)) => emit_log(
                "info",
                &format!(
                    "宏诊断 {}：{}；日志 {}",
                    action.name,
                    summary,
                    path.display()
                ),
            ),
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
            thread::Builder::new()
                .name(format!("bamt-macro-{}", index + 1))
                .spawn(move || {
                    unsafe {
                        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
                    }
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
                })
                .expect("failed to start macro worker");
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
            emit_log(
                "warn",
                "Windows 1 ms timer resolution is unavailable; using waitable timer fallback",
            );
        }
    }
}

fn disable_timer_resolution() {
    let rt = runtime();
    if rt.timer_resolution_active.swap(false, Ordering::SeqCst) {
        unsafe {
            timeEndPeriod(1);
        }
    }
}

fn start_worker(action: Action, vk: u32) {
    let rt = runtime();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = rt.active.lock().unwrap();
        if active.contains_key(&vk) {
            return;
        }
        active.insert(vk, cancel.clone());
    }
    if worker_sender()
        .send(WorkerJob {
            action,
            vk,
            cancel,
            queued_at: Instant::now(),
        })
        .is_err()
    {
        let _ = rt.active.lock().map(|mut active| {
            active.remove(&vk);
        });
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
            if thread_id != 0 {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
            let mouse_thread_id = rt.mouse_hook_thread_id.load(Ordering::SeqCst);
            if mouse_thread_id != 0 {
                PostThreadMessageW(mouse_thread_id, WM_QUIT, 0, 0);
            }
            return 1;
        }
        let is_down = w_param == WM_KEYDOWN || w_param == WM_SYSKEYDOWN;
        let is_up = w_param == WM_KEYUP || w_param == WM_SYSKEYUP;
        if is_down {
            let matched = runtime().actions.lock().ok().and_then(|actions| {
                actions
                    .iter()
                    .find(|a| key_to_vk(&a.hotkey) == Some(vk))
                    .cloned()
            });
            if let Some(action) = matched {
                start_worker(action, vk);
                return 1;
            }
        } else if is_up {
            if let Ok(active) = runtime().active.lock() {
                if let Some(cancel) = active.get(&vk) {
                    cancel.store(true, Ordering::SeqCst);
                    return 1;
                }
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
    if rt.mouse_hook_alive.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || unsafe {
        let thread_id = GetCurrentThreadId();
        runtime()
            .mouse_hook_thread_id
            .store(thread_id, Ordering::SeqCst);
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), 0, 0);
        if hook == 0 {
            runtime().mouse_hook_alive.store(false, Ordering::SeqCst);
            emit(
                "error",
                "{\"message\":\"Rust backend failed to install mouse hook\"}",
            );
            return;
        }
        let mut msg: Msg = zeroed();
        while !runtime().stop.load(Ordering::SeqCst) && GetMessageW(&mut msg, 0, 0, 0) > 0 {
            spin_loop();
        }
        UnhookWindowsHookEx(hook);
        runtime().mouse_hook_thread_id.store(0, Ordering::SeqCst);
        runtime().mouse_hook_alive.store(false, Ordering::SeqCst);
    });
}

fn start_hook_thread() {
    let rt = runtime();
    if rt.hook_alive.swap(true, Ordering::SeqCst) {
        return;
    }
    rt.stop.store(false, Ordering::SeqCst);
    thread::spawn(move || unsafe {
        let thread_id = GetCurrentThreadId();
        runtime().hook_thread_id.store(thread_id, Ordering::SeqCst);
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), 0, 0);
        if hook == 0 {
            runtime().hook_alive.store(false, Ordering::SeqCst);
            disable_timer_resolution();
            emit(
                "error",
                "{\"message\":\"Rust backend failed to install keyboard hook\"}",
            );
            return;
        }
        emit(
            "status",
            "{\"status\":\"listening\",\"message\":\"Rust backend listening\"}",
        );
        let mut msg: Msg = zeroed();
        while !runtime().stop.load(Ordering::SeqCst) && GetMessageW(&mut msg, 0, 0, 0) > 0 {
            spin_loop();
        }
        UnhookWindowsHookEx(hook);
        runtime().hook_thread_id.store(0, Ordering::SeqCst);
        runtime().hook_alive.store(false, Ordering::SeqCst);
        if let Ok(active) = runtime().active.lock() {
            for cancel in active.values() {
                cancel.store(true, Ordering::SeqCst);
            }
        }
        disable_timer_resolution();
        emit(
            "status",
            "{\"status\":\"stopped\",\"message\":\"Rust backend stopped\"}",
        );
    });
}

fn stop_listening() -> String {
    let rt = runtime();
    rt.stop.store(true, Ordering::SeqCst);
    let thread_id = rt.hook_thread_id.load(Ordering::SeqCst);
    if thread_id != 0 {
        unsafe {
            PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
        }
    }
    let mouse_thread_id = rt.mouse_hook_thread_id.load(Ordering::SeqCst);
    if mouse_thread_id != 0 {
        unsafe {
            PostThreadMessageW(mouse_thread_id, WM_QUIT, 0, 0);
        }
    }
    if let Ok(active) = rt.active.lock() {
        for cancel in active.values() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
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

fn test_action(action_raw: &str) -> Result<(), String> {
    let action = actions_from_config(&format!("{{\"actions\":[{}]}}", action_raw))?
        .into_iter()
        .next()
        .ok_or_else(|| "没有可测试的已启用宏，请检查热键和宏类型".to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    let timeout_cancel = cancel.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        timeout_cancel.store(true, Ordering::Relaxed);
    });
    match action.action_type.as_str() {
        "fastPlay" => execute_fast_play_once(&action),
        "drag" => execute_drag_once(&action, &cancel),
        "point" | "click" | "rapid" => execute_point_once(&action),
        "script" => execute_script_once(&action, &cancel)?,
        _ => return Err(format!("不支持测试宏类型 {}", action.action_type)),
    }
    cancel.store(true, Ordering::Relaxed);
    Ok(())
}

fn handle(command: &str, payload: &str) -> Result<String, String> {
    match command {
        "get_initial_config" | "load_config" => Ok(load_config_and_sync_resolution()),
        "save_config" => save_config(payload),
        "start_listening" => {
            let resolution = resolution_from_config(payload);
            *runtime().resolution.lock().map_err(|e| e.to_string())? = resolution;
            let actions = actions_from_config(payload)?;
            let count = actions.len();
            let summary = actions
                .iter()
                .map(|a| format!("{}:{}:{}", a.hotkey, a.action_type, a.name))
                .collect::<Vec<_>>()
                .join(", ");
            *runtime().actions.lock().map_err(|e| e.to_string())? = actions;
            emit_log(
                "info",
                &format!(
                    "Rust backend loaded {} supported actions: {}",
                    count, summary
                ),
            );
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
            if !config_raw.is_empty() {
                *runtime().resolution.lock().map_err(|e| e.to_string())? =
                    resolution_from_config(&config_raw);
            }
            test_action(&action_raw)?;
            Ok("{\"status\":\"ready\",\"message\":\"Rust backend test complete\"}".to_string())
        }
        "capture_position" => Ok(capture_position(payload)),
        "shutdown" => Ok(stop_listening()),
        other => Err(format!("Unknown Rust backend command: {}", other)),
    }
}

fn main() {
    emit(
        "status",
        "{\"status\":\"ready\",\"message\":\"Rust backend ready\"}",
    );
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        match parse_request(&line) {
            Ok(req) => {
                let should_exit = req.command == "shutdown";
                match handle(&req.command, &req.payload) {
                    Ok(result) => respond_ok(&req.id, &result),
                    Err(error) => respond_err(&req.id, &error),
                }
                if should_exit {
                    break;
                }
            }
            Err(error) => respond_err("null", &error),
        }
    }
}

#[cfg(test)]
mod dsl_tests {
    use super::*;

    #[test]
    fn parses_complete_dsl_program() {
        let program = parse_script(
            r#"
            loop until_release
              key tap 1 7ms
              wait 500us
              click target offset 0 -200 7ms
              repeat 2
                move origin 1ms
                click here 3ms
              end
              drag target to target offset 0 -300 20ms
              restore 1ms
            end
            "#,
        )
        .expect("complete DSL should compile");

        assert_eq!(program.len(), 1);
        assert!(matches!(program[0], ScriptCommand::LoopUntilRelease(_)));
    }

    #[test]
    fn rejects_missing_coordinates_instead_of_using_zero() {
        let error = parse_script("click 1280").expect_err("missing Y must fail");
        assert!(error.contains("Y 坐标"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_unknown_command() {
        let error = parse_script("teleport 100 200").expect_err("unknown command must fail");
        assert!(error.contains("不支持的命令"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_unclosed_block() {
        let error = parse_script("repeat 2\n  wait 1ms").expect_err("missing end must fail");
        assert!(error.contains("缺少 loop_end"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_busy_loop_without_timing() {
        let error = parse_script("loop until_release\n  move target\nend")
            .expect_err("busy loop must fail");
        assert!(error.contains("避免空转"), "unexpected error: {error}");
    }

    #[test]
    fn accepts_duration_units_and_inline_comments() {
        let program = parse_script("wait 500us # half millisecond\nwait 7ms\nwait 0.02s")
            .expect("duration units should compile");
        assert_eq!(program.len(), 3);
        assert!(
            matches!(program[0], ScriptCommand::Wait(value) if value == Duration::from_micros(500))
        );
        assert!(
            matches!(program[1], ScriptCommand::Wait(value) if value == Duration::from_millis(7))
        );
        assert!(
            matches!(program[2], ScriptCommand::Wait(value) if value == Duration::from_millis(20))
        );
    }

    #[test]
    fn decodes_multiline_script_from_config_json() {
        let config = r#"{"resolution":{"width":3840,"height":2160},"actions":[{"id":"dsl-test","name":"DSL Test","hotkey":"r","type":"script","enabled":true,"targetX":1280,"targetY":800,"script":"loop until_release\n  wait 7ms\nend"}]}"#;
        let raw_actions = raw_value(config, "actions").expect("actions must exist");
        let objects = split_objects(&raw_actions);
        assert_eq!(objects.len(), 1, "objects: {objects:?}");
        assert_eq!(
            string_value(&objects[0], "script").as_deref(),
            Some("loop until_release\n  wait 7ms\nend")
        );
        let actions = actions_from_config(config).expect("multiline script JSON should compile");
        assert_eq!(actions.len(), 1);
        assert!(actions[0].script_program.is_some());
    }

    #[test]
    fn accepts_mumu_one_shot_coordinates_and_release_commands() {
        let program =
            parse_script("click 1280,720 7ms\nsleep 20\nkey_press 1\nkey_release 1\nrelease_all")
                .expect("MuMu-compatible one-shot syntax should compile");
        assert_eq!(program.len(), 5);
        assert!(matches!(program[0], ScriptCommand::Click(_, _)));
        assert!(matches!(program[4], ScriptCommand::ReleaseAll));
    }

    #[test]
    fn accepts_mumu_loop_forms() {
        let finite =
            parse_script("loop 3\n  sleep 1\nloop_end").expect("finite MuMu loop should compile");
        assert!(matches!(finite[0], ScriptCommand::Repeat(3, _)));

        let held =
            parse_script("loop\n  sleep 1\nloop_end").expect("bare MuMu loop should compile");
        assert!(matches!(held[0], ScriptCommand::LoopUntilRelease(_)));
    }

    #[test]
    fn validates_release_actions_position() {
        let program = parse_script("key_press 1\nrelease_actions\nkey_release 1")
            .expect("top-level release actions should compile");
        assert!(matches!(program[1], ScriptCommand::ReleaseActions));

        let error = parse_script("loop\n  sleep 1\n  release_actions\nloop_end")
            .expect_err("nested release_actions must fail");
        assert!(
            error.contains("只能位于脚本顶层"),
            "unexpected error: {error}"
        );
    }
}
