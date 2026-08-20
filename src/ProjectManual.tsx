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

const dslExample = `loop until_release
  press 2688 1853
  move 2688 1553 20
  release mouse
  sleep 50
end`;

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
          <p><strong>脚本：</strong>使用 BAMT DSL 编写鼠标动作序列，或导入 AHK 脚本文本作为宏素材。</p>
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
          <p>脚本宏不是 Python，也不是完整 AHK。它是 BAMT Rust 后端解析的固定语法。坐标使用当前分辨率下的屏幕坐标，时间单位为毫秒，mouse 表示触发热键瞬间的鼠标位置。</p>
          <pre>{dslExample}</pre>
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
