use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const WH_KEYBOARD_LL: i32 = 13;
const WM_KEYDOWN: u32 = 0x0100;
const WM_KEYUP: u32 = 0x0101;
const WM_SYSKEYDOWN: u32 = 0x0104;
const WM_SYSKEYUP: u32 = 0x0105;
const WM_QUIT: u32 = 0x0012;
const VK_Q: u32 = 0x51;
const VK_W: u32 = 0x57;
const VK_E: u32 = 0x45;
const VK_F12: u32 = 0x7B;
const INPUT_MOUSE: u32 = 0;
const INPUT_KEYBOARD: u32 = 1;
const KEYEVENTF_KEYUP: u32 = 0x0002;
const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
const MOUSEEVENTF_LEFTUP: u32 = 0x0004;

static Q_RUNNING: AtomicBool = AtomicBool::new(false);
static W_RUNNING: AtomicBool = AtomicBool::new(false);
static E_RUNNING: AtomicBool = AtomicBool::new(false);
static EXITING: AtomicBool = AtomicBool::new(false);

type Hhook = isize;
type Hinstance = isize;
type Hwnd = isize;
type Wparam = usize;
type Lparam = isize;
type Lresult = isize;

#[repr(C)]
struct KbdLlHookStruct {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput {
    dx: i32,
    dy: i32,
    mouse_data: u32,
    dw_flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct KeybdInput {
    w_vk: u16,
    w_scan: u16,
    dw_flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[repr(C)]
union InputUnion {
    mi: MouseInput,
    ki: KeybdInput,
}

#[repr(C)]
struct Input {
    input_type: u32,
    union: InputUnion,
}

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
struct Msg {
    hwnd: Hwnd,
    message: u32,
    w_param: Wparam,
    l_param: Lparam,
    time: u32,
    pt: Point,
}

type HookProc = Option<unsafe extern "system" fn(i32, Wparam, Lparam) -> Lresult>;

#[link(name = "user32")]
extern "system" {
    fn SetWindowsHookExW(id_hook: i32, lpfn: HookProc, hmod: Hinstance, dw_thread_id: u32) -> Hhook;
    fn UnhookWindowsHookEx(hhk: Hhook) -> i32;
    fn CallNextHookEx(hhk: Hhook, n_code: i32, w_param: Wparam, l_param: Lparam) -> Lresult;
    fn GetMessageW(lp_msg: *mut Msg, hwnd: Hwnd, msg_filter_min: u32, msg_filter_max: u32) -> i32;
    fn PostQuitMessage(exit_code: i32);
    fn SendInput(c_inputs: u32, p_inputs: *mut Input, cb_size: i32) -> u32;
}

fn key_input(vk: u16, flags: u32) -> Input {
    Input {
        input_type: INPUT_KEYBOARD,
        union: InputUnion {
            ki: KeybdInput { w_vk: vk, w_scan: 0, dw_flags: flags, time: 0, dw_extra_info: 0 },
        },
    }
}

fn mouse_input(flags: u32) -> Input {
    Input {
        input_type: INPUT_MOUSE,
        union: InputUnion {
            mi: MouseInput { dx: 0, dy: 0, mouse_data: 0, dw_flags: flags, time: 0, dw_extra_info: 0 },
        },
    }
}

fn send_key(vk: u16) {
    let mut inputs = [key_input(vk, 0), key_input(vk, KEYEVENTF_KEYUP)];
    unsafe {
        SendInput(inputs.len() as u32, inputs.as_mut_ptr(), size_of::<Input>() as i32);
    }
}

fn click_current() {
    let mut inputs = [mouse_input(MOUSEEVENTF_LEFTDOWN), mouse_input(MOUSEEVENTF_LEFTUP)];
    unsafe {
        SendInput(inputs.len() as u32, inputs.as_mut_ptr(), size_of::<Input>() as i32);
    }
}

fn start_loop(flag: &'static AtomicBool, vk: u16, name: &'static str) {
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    println!("start {name}");
    thread::spawn(move || {
        while flag.load(Ordering::SeqCst) && !EXITING.load(Ordering::SeqCst) {
            send_key(vk);
            thread::sleep(Duration::from_millis(8));
            click_current();
            thread::sleep(Duration::from_millis(15));
        }
        println!("stop {name}");
    });
}

fn stop_loop(flag: &'static AtomicBool) {
    flag.store(false, Ordering::SeqCst);
}

unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: Wparam, l_param: Lparam) -> Lresult {
    if n_code >= 0 {
        let info = &*(l_param as *const KbdLlHookStruct);
        let msg = w_param as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        if down {
            match info.vk_code {
                VK_Q => start_loop(&Q_RUNNING, b'1' as u16, "Q -> 1 + click"),
                VK_W => start_loop(&W_RUNNING, b'2' as u16, "W -> 2 + click"),
                VK_E => start_loop(&E_RUNNING, b'3' as u16, "E -> 3 + click"),
                VK_F12 => {
                    EXITING.store(true, Ordering::SeqCst);
                    stop_loop(&Q_RUNNING);
                    stop_loop(&W_RUNNING);
                    stop_loop(&E_RUNNING);
                    println!("exit by F12");
                    PostQuitMessage(0);
                }
                _ => {}
            }
        } else if up {
            match info.vk_code {
                VK_Q => stop_loop(&Q_RUNNING),
                VK_W => stop_loop(&W_RUNNING),
                VK_E => stop_loop(&E_RUNNING),
                _ => {}
            }
        }
    }
    CallNextHookEx(0, n_code, w_param, l_param)
}

fn main() {
    println!("BAMT Rust FastPlay Demo ready");
    println!("Hold Q/W/E: send 1/2/3 then click current mouse position. F12 exits.");

    unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), 0, 0);
        if hook == 0 {
            eprintln!("failed to install low-level keyboard hook");
            std::process::exit(1);
        }

        let mut msg = Msg { hwnd: 0, message: 0, w_param: 0, l_param: 0, time: 0, pt: Point { x: 0, y: 0 } };
        while GetMessageW(&mut msg as *mut Msg, 0, 0, 0) > 0 {
            if msg.message == WM_QUIT {
                break;
            }
        }

        EXITING.store(true, Ordering::SeqCst);
        stop_loop(&Q_RUNNING);
        stop_loop(&W_RUNNING);
        stop_loop(&E_RUNNING);
        UnhookWindowsHookEx(hook);
    }
}
