import { BookOpen, FolderOpen } from "lucide-react";

const appDataRoot = "%APPDATA%/BAMT Next/data";
const paths = [
  ["当前宏配置", "%APPDATA%/BAMT Next/data/config/blue_archive_config.json"],
  ["全局宏预设库", "%APPDATA%/BAMT Next/data/presets/preset-library.json"],
  ["导入文件目录", "%APPDATA%/BAMT Next/data/imports/"],
  ["导出文件目录", "%APPDATA%/BAMT Next/data/exports/"],
  ["排轴自动保存", "%APPDATA%/BAMT Next/data/timelines/"],
  ["AHK 临时脚本", "%APPDATA%/BAMT Next/data/ahk/bamt-inline.ahk"],
  ["最速出牌诊断日志", "%APPDATA%/BAMT Next/data/logs/"],
  ["完整技术文档", "README.md"],
];

const dslSingleExample = `# 没有 loop：每次按下热键只执行一遍
click 1280,720 7ms
sleep 20
click 1600,900 7ms
restore`;

const dslExample = `# 依次点击两个位置，直到触发热键松开
loop until_release
  click 1280,720 7ms
  sleep 20
  click target offset 0 -200 7ms
  sleep 20
loop_end
restore`;

const dslDragExample = `# 从宏预设点向上拖动 300 像素，每轮后回原位
loop until_release
  drag target to target offset 0 -300 20ms
  restore 0ms
  wait 50ms
loop_end`;

const dslKeyExample = `# 选牌键按下 7ms，再点击触发宏时的光标位置
loop until_release
  key tap 1 7ms
  wait 7ms
  click origin 7ms
  wait 7ms
loop_end`;

export function ProjectManual({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="manual-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <p className="eyebrow">Manual</p>
        <h2><BookOpen size={24} /> BAMT Next 使用说明书</h2>

        <section>
          <h3>工具定位</h3>
          <p>BAMT Next 是《碧蓝档案》PC 端用的本地宏控制台和排轴工具。2.2.0 重构分支中，宏运行后端已切换为 Rust-only；Python 宏后端已移除。AHK 解释器仍保留，用来运行脚本、导入脚本宏和测试输入链路。</p>
        </section>

        <section>
          <h3>发布版数据目录</h3>
          <p>单 exe 发布版不会把玩家数据写在 exe 旁边。所有用户数据统一放在：</p>
          <pre>{appDataRoot}</pre>
          <div className="manual-paths">
            {paths.map(([label, value]) => (
              <p key={value}><FolderOpen size={16} /><strong>{label}</strong><code>{value}</code></p>
            ))}
          </div>
        </section>

        <section>
          <h3>快速开始</h3>
          <ol>
            <li>先确认游戏分辨率，点「应用并重算」。</li>
            <li>首次使用先校准 Q/W/E 三个基础手牌宏和常用点位。</li>
            <li>默认建议使用系统光标模式：兼容性最高，但会移动真实鼠标。</li>
            <li>修改宏、导入宏或切换分辨率后先保存，再点「开始」。</li>
            <li>固定紧急停止键是 X，异常时优先按 X。</li>
          </ol>
        </section>

        <section>
          <h3>最速出牌时序推荐</h3>
          <p>启动弹窗会根据屏幕刷新率、游戏帧率和垂直同步状态推荐四阶段时序。四个数字依次表示：选牌按下、选牌释放到鼠标按下、鼠标按住、下一轮间隔。</p>
          <p>当前对照测试中，160 Hz并开启垂直同步时推荐7/7/7/7ms；关闭垂直同步并以60FPS运行时推荐20/20/20/20ms。自动应用可以关闭，关闭后保留各条最速出牌宏的手动参数。</p>
        </section>

        <section>
          <h3>宏类型</h3>
          <p><strong>点位：</strong>移动到目标坐标点击，并回到原鼠标位置。</p>
          <p><strong>拖动：</strong>按住热键循环执行手牌拖动：到手牌位按下，竖直上拖，回到触发热键时的鼠标位置释放。</p>
          <p><strong>点击 / 连点：</strong>点击固定坐标，或按设定间隔连续点击。</p>
          <p><strong>最速出牌：</strong>按住热键循环执行「1/2/3 选牌键 + 当前鼠标位置点击」。</p>
          <p><strong>脚本：</strong>使用 BAMT DSL 编写键盘、鼠标、等待和循环动作。DSL 文件可直接导入；AHK 是另一种语言，应在 AHK 解释器页面单独运行。</p>
        </section>

        <section>
          <h3>坐标与分辨率</h3>
          <p>点位、点击、连点属于战场地图点位，使用中轴线缩放。拖动宏属于底部手牌 UI，使用底部 UI 锚定算法。Q/W/E 三个基础手牌宏有独立算法，不和普通点位混算。</p>
        </section>

        <section>
          <h3>拖动宏逻辑</h3>
          <ol>
            <li>热键触发时记录当前鼠标位置。</li>
            <li>光标移动到手牌位置并按下左键。</li>
            <li>竖直向上移动设定距离。</li>
            <li>移动回本轮记录的鼠标原始位置。</li>
            <li>在原始位置释放左键。</li>
            <li>如果热键仍按住，等待循环间隔后进入下一轮。</li>
          </ol>
          <p>系统光标模式一定会占用真实鼠标。循环间隔太短时，手动移动鼠标会感觉被抢。</p>
        </section>

        <section>
          <h3>AHK 与 Rust 输入链路</h3>
          <p>实测发现，AHK v2 的 SendInput / Click 在游戏内执行「1/2/3 选牌 + 当前鼠标点击」时更不容易卡牌。2.2.0 已把主线宏后端改为 Rust，减少早期 Python 手写 SendInput 事件链路带来的不稳定。AHK 解释器仍用于对照测试。</p>
        </section>

        <section>
          <h3>宏诊断日志</h3>
          <p>最速出牌运行时只在内存中记录时间戳，松开热键后才写入 logs 目录，避免实时写盘影响宏。日志逐轮记录选牌键按下/释放、鼠标按下/释放、实际间隔、SendInput 返回值、P95 和最大延迟。</p>
          <p>出现卡牌回弹时，先按住宏做一次短测试并松开，再点击「打开诊断日志」。若 inputFailures 或 orderViolations 不为 0，说明输入注入或执行顺序异常；二者为 0 时再检查实际延迟和游戏帧窗口。</p>
        </section>

        <section>
          <h3>脚本宏 DSL</h3>
          <p>BAMT DSL 是由 Rust 后端直接执行的宏语言，不是 AHK、Python 或 JavaScript。前端会即时检查语法；点击「开始」时 Rust 会再次严格编译，只有编译成功的指令才会进入高优先级宏线程。运行时执行的是预编译命令，不会逐行重新解析文本。</p>

          <h4>编辑器与代码补全</h4>
          <p>输入命令、坐标关键字和键盘操作时会自动显示候选。使用方向键选择，按 <code>Tab</code> 或 <code>Enter</code> 接受，按 <code>Esc</code> 关闭；任何时候都可以按 <code>Ctrl+Space</code> 主动唤出。补全只替换光标所在的当前词。错误列表可点击并跳转到对应行，语法通过后可使用「格式化」。</p>

          <h4>基本书写规则</h4>
          <ul>
            <li>一行一条命令，命令和参数使用空格分隔；命令不区分大小写，建议统一小写。</li>
            <li>空行会被忽略。<code>#</code>、<code>;</code>、<code>//</code> 后面的内容是注释。</li>
            <li><strong>没有写 loop 时不会循环：</strong>按下热键后，脚本从上到下完整执行一次。</li>
            <li>MuMu 风格循环以 <code>loop</code>、<code>loop N</code> 或 <code>loop until_release</code> 开始，以独占一行的 <code>loop_end</code> 结束。</li>
            <li>旧版 BAMT 的 <code>repeat N ... end</code> 和 <code>loop until_release ... end</code> 仍可导入。</li>
            <li>模块最多嵌套 8 层，单个 <code>repeat</code> 最多执行 100000 次。</li>
            <li>脚本为空、参数缺失、出现多余参数或未知命令时不会启动监听。</li>
          </ul>

          <h4>时间格式</h4>
          <table className="manual-table"><thead><tr><th>写法</th><th>含义</th><th>示例</th></tr></thead><tbody>
            <tr><td><code>us</code></td><td>微秒</td><td><code>wait 500us</code></td></tr>
            <tr><td><code>ms</code></td><td>毫秒</td><td><code>wait 7ms</code></td></tr>
            <tr><td><code>s</code></td><td>秒</td><td><code>wait 0.02s</code></td></tr>
            <tr><td>无单位</td><td>按毫秒处理</td><td><code>wait 7</code> 等价于 <code>wait 7ms</code></td></tr>
          </tbody></table>
          <p>单次时间必须处于 0 到 1 小时之间。点击、拖动和 <code>key tap</code> 的持续时间必须大于 0。短等待会复用 Rust 后端的高精度等待器和取消检查。</p>

          <h4>坐标表达式</h4>
          <table className="manual-table"><thead><tr><th>表达式</th><th>含义</th></tr></thead><tbody>
            <tr><td><code>1280,720</code> / <code>1280 720</code></td><td>当前配置分辨率坐标系中的绝对坐标，会映射到实际屏幕；两种写法等价。</td></tr>
            <tr><td><code>target</code></td><td>当前脚本宏表单中填写的 X/Y，是适合共享与分辨率转换的预设目标点。</td></tr>
            <tr><td><code>origin</code> / <code>mouse</code></td><td>本次热键触发瞬间记录的鼠标位置。</td></tr>
            <tr><td><code>here</code> / <code>current</code></td><td>执行到这一行时的当前鼠标位置。</td></tr>
            <tr><td><code>target offset 0 -300</code></td><td>在任意关键字坐标后追加相对偏移；X 向右为正，Y 向下为正。</td></tr>
          </tbody></table>

          <h4>鼠标命令</h4>
          <table className="manual-table"><thead><tr><th>语法</th><th>行为与默认值</th></tr></thead><tbody>
            <tr><td><code>move &lt;点&gt; [等待]</code></td><td>移动到指定位置；省略等待时立即继续。例如 <code>move target 1ms</code>。</td></tr>
            <tr><td><code>click [&lt;点&gt;] [按住]</code></td><td>移动、左键按下、等待、左键释放。点默认为 <code>here</code>，按住时间默认为 7ms。</td></tr>
            <tr><td><code>press &lt;点&gt;</code></td><td>移动到指定位置并按下左键，保持到后续 <code>release</code> 或脚本清理。</td></tr>
            <tr><td><code>release [&lt;点&gt;]</code></td><td>可先移动到指定位置，再释放左键；点默认为 <code>here</code>。</td></tr>
            <tr><td><code>drag &lt;起点&gt; to &lt;终点&gt; &lt;时间&gt;</code></td><td>移动到起点、按下、等待指定时间、移动到终点并释放。</td></tr>
            <tr><td><code>restore [等待]</code></td><td>释放仍按住的鼠标，再回到本轮触发时的 <code>origin</code>；可追加回位后的等待。</td></tr>
          </tbody></table>

          <h4>键盘与等待命令</h4>
          <table className="manual-table"><thead><tr><th>语法</th><th>行为与默认值</th></tr></thead><tbody>
            <tr><td><code>wait &lt;时间&gt;</code> / <code>sleep &lt;时间&gt;</code></td><td>高精度等待，并持续响应热键松开和强制停止。</td></tr>
            <tr><td><code>key tap &lt;键&gt; [按住]</code></td><td>按键按下、等待、释放；按住默认 7ms。</td></tr>
            <tr><td><code>key down &lt;键&gt;</code></td><td>保持键盘按键，重复 down 不会重复注入。</td></tr>
            <tr><td><code>key up &lt;键&gt;</code></td><td>释放键盘按键，并从脚本的已按下集合中移除。</td></tr>
            <tr><td><code>key_press &lt;键&gt;</code></td><td>MuMu 兼容写法，等价于 <code>key down</code>。</td></tr>
            <tr><td><code>key_release &lt;键&gt;</code></td><td>MuMu 兼容写法，等价于 <code>key up</code>。</td></tr>
            <tr><td><code>mouse_press left</code></td><td>在当前光标位置按下鼠标左键。</td></tr>
            <tr><td><code>mouse_release left</code></td><td>在当前光标位置释放鼠标左键。</td></tr>
            <tr><td><code>release_all</code></td><td>立即释放本脚本保持的鼠标左键和所有键盘按键。</td></tr>
          </tbody></table>
          <p>支持字母 A-Z、数字 0-9、<code>space</code>、<code>tab</code>、<code>enter</code>、<code>esc</code>、方向键和 F1-F12。脚本热键本身不要在脚本里长期 <code>key down</code>。</p>

          <h4>循环与触发语义</h4>
          <table className="manual-table"><thead><tr><th>语法</th><th>执行方式</th></tr></thead><tbody>
            <tr><td>普通命令序列</td><td>按下热键立即开始，仅完整执行一次；松开热键不会把一次性序列截断，紧急停止 X 仍可中止。</td></tr>
            <tr><td><code>loop ... loop_end</code></td><td>按住热键期间循环，等价于 <code>loop until_release</code>。</td></tr>
            <tr><td><code>loop N ... loop_end</code></td><td>固定执行 N 次，N 为 1 到 100000 的整数。</td></tr>
            <tr><td><code>loop until_release ... loop_end</code></td><td>明确循环到触发热键松开；轻点热键也会完整执行第一轮。</td></tr>
            <tr><td><code>release_actions</code></td><td>它之前的命令在按下热键后执行；后面的命令等待触发热键松开后再执行。只能在顶层出现一次。</td></tr>
          </tbody></table>
          <p>循环体必须包含 <code>wait</code>、<code>click</code>、<code>drag</code>、<code>key tap</code> 或带等待的移动，防止无等待空转占满 CPU。</p>

          <h4>MuMu 语法兼容范围</h4>
          <p>脚本编辑器优先兼容 MuMu 宏按键中适用于 Windows 原生单鼠标输入的语法，同时保留 BAMT 的坐标关键字和高精度时间单位。</p>
          <table className="manual-table"><thead><tr><th>类别</th><th>支持情况</th></tr></thead><tbody>
            <tr><td>直接支持</td><td><code>click x,y</code>、<code>sleep</code>、三种 <code>loop</code>、<code>loop_end</code>、<code>release_actions</code>、<code>key_press</code>、<code>key_release</code>、<code>mouse_press left</code>、<code>mouse_release left</code>、<code>release_all</code>。</td></tr>
            <tr><td>BAMT 扩展</td><td><code>target</code>、<code>origin</code>、<code>here</code>、<code>offset</code>、<code>drag</code>、<code>restore</code>、<code>us/ms/s</code>，以及旧版 <code>repeat/end</code>。</td></tr>
            <tr><td>不做伪兼容</td><td>MuMu 模拟器的多指同时触控、摇杆、准星模式和触控曲线保持命令依赖模拟器内部接口，Windows 原生单光标后端不会把它们错误地模拟成普通鼠标。</td></tr>
          </tbody></table>

          <h4>单次顺序模板</h4>
          <pre>{dslSingleExample}</pre>

          <h4>多点点击模板</h4>
          <pre>{dslExample}</pre>
          <h4>拖动模板</h4>
          <pre>{dslDragExample}</pre>
          <h4>选牌并点击模板</h4>
          <pre>{dslKeyExample}</pre>

          <h4>停止、异常与自动清理</h4>
          <p>热键松开会结束显式循环，并触发 <code>release_actions</code> 后的命令；固定紧急停止 X 会终止全部宏。无论是正常结束、松键取消、测试超时还是强制停止，Rust 输入会话都会释放脚本仍保持的左键和键盘键，并把光标恢复到触发位置，避免产生“按键粘住”或鼠标保持按下。若 Windows <code>SendInput</code> 返回失败，后端会停止当前动作并记录错误。</p>

          <h4>常见语法错误</h4>
          <ul>
            <li><code>click 100</code>：绝对坐标必须同时提供 X 和 Y。</li>
            <li><code>drag target target 20ms</code>：虽然兼容省略 <code>to</code>，仍建议写成完整形式以便阅读。</li>
            <li><code>loop until_release click target loop_end</code>：模块命令和 <code>loop_end</code> 必须各自独占一行。</li>
            <li><code>release_actions</code> 写在循环内部或重复出现：松键分界只能位于脚本顶层且只能有一个。</li>
            <li><code>key tap ctrl</code>：当前未提供组合键别名，应分别使用 <code>key down</code>、其他按键、<code>key up</code>。</li>
            <li>循环只有 <code>move target</code>：没有任何等待，会被拒绝以防 CPU 空转。</li>
          </ul>
        </section>

        <section>
          <h3>排轴编辑器</h3>
          <p>排轴按 P 完全独立。每个 P 都有自己的队伍、练度、牌序、视频参考和动作记录。新建轴前先填写文件名，工具会自动保存到 timelines 目录。</p>
          <p>牌序按 1 到 5 点选：前三张是初始牌，后两张是固定顺序牌，剩余角色自动补成第六张。送人只影响它之后的牌池，删除送人记录后会按时间线重新计算。</p>
        </section>

        <section>
          <h3>常见问题</h3>
          <p><strong>热键无反应：</strong>优先确认已点「开始」，并尝试管理员方式启动。状态记录应显示 Rust backend loaded actions。</p>
          <p><strong>坐标偏移：</strong>确认游戏分辨率、Windows DPI、窗口状态和宏类型。战场点位与手牌 UI 使用不同算法。</p>
          <p><strong>需要分享配置：</strong>使用全局宏预设导出；导入时会按当前分辨率换算坐标。</p>
        </section>
      </article>
    </div>
  );
}
