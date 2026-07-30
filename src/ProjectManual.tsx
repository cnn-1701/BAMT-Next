import { BookOpen, FolderOpen } from "lucide-react";

const appDataRoot = "%APPDATA%/BAMT Next/data";
const paths = [
  ["当前宏配置", "%APPDATA%/BAMT Next/data/config/blue_archive_config.json"],
  ["全局宏预设库", "%APPDATA%/BAMT Next/data/presets/preset-library.json"],
  ["导入文件目录", "%APPDATA%/BAMT Next/data/imports/"],
  ["导出文件目录", "%APPDATA%/BAMT Next/data/exports/"],
  ["排轴自动保存", "%APPDATA%/BAMT Next/data/timelines/"],
  ["AHK 临时脚本", "%APPDATA%/BAMT Next/data/ahk/bamt-inline.ahk"],
  ["随机背景素材", "程序内置资源 src/assets/backgrounds/"],
  ["完整技术文档", "README.md"],
];

const dslExample = `loop until_release
  press 2688 1853
  move 2688 1553 20
  move mouse 10
  release mouse
  sleep 50
end
release_actions
  release mouse`;

export function ProjectManual({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="manual-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <p className="eyebrow">Manual</p>
        <h2><BookOpen size={24} /> BAMT Next 使用说明书</h2>

        <section>
          <h3>工具定位</h3>
          <p>BAMT Next 是《碧蓝档案》PC 端总力战 / 大决战用的 Windows 本地宏控制台和排轴工具。它负责管理 Q/W/E 手牌拖动、战场点位、点击、连点、脚本宏、分辨率换算、全局宏预设、AHK 测试和排轴文本。</p>
        </section>

        <section>
          <h3>发布版数据目录</h3>
          <p>单 exe 发布版不会把配置写在 exe 旁边。所有用户数据统一放在：</p>
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
            <li>启动后先确认游戏分辨率。</li>
            <li>首次使用先校准 Q/W/E 三个基础手牌宏。</li>
            <li>默认使用系统光标模式，兼容性最高，但会移动真实鼠标。</li>
            <li>修改宏、导入宏或切换分辨率后先保存，再点“开始”。</li>
            <li>固定紧急停止键是 X，异常时优先按 X。</li>
          </ol>
        </section>

        <section>
          <h3>宏类型</h3>
          <p><strong>点位：</strong>按下热键后移动到目标坐标，松开热键后释放并回到原鼠标位置。</p>
          <p><strong>拖动：</strong>按住热键循环执行手牌拖动：到手牌位按下，竖直上拖，回到触发热键时的鼠标位置释放。</p>
          <p><strong>连点：</strong>按住热键期间连续点击目标坐标。</p>
          <p><strong>点击 / 最速出牌：</strong>普通点击可点固定坐标；配置选牌键 1/2/3 后，会循环执行“按 1/2/3，等待单轮内间隔，点击当前鼠标位置，等待循环间隔”。</p>
          <p><strong>脚本：</strong>使用 BAMT DSL 写鼠标动作序列，或保存 AHK 脚本文本。</p>
        </section>

        <section>
          <h3>AHK 与 Python 输入路线</h3>
          <p>实测发现，AHK v2 的 SendInput / Click 在游戏内执行“1/2/3 选牌 + 当前鼠标点击”时更不容易卡牌。Python 后端仍负责配置、坐标映射和普通宏；最速出牌如果遇到卡牌，可以先用 AHK 解释器默认脚本确认游戏是否接收 AHK 输入。</p>
          <p>原因大致是 AHK 的 SetMouseDelay(-1)、SetKeyDelay(-1, -1) 和 SendMode(Input) 形成的输入队列更短更连续；Python 路线要同时处理鼠标保护、回原位和多输入后端，更容易被游戏帧采样到中间态。</p>
        </section>

        <section>
          <h3>AHK 默认测试脚本</h3>
          <p>AHK 面板默认脚本是最速出牌测试：按住 Q 循环发送 1 并点击当前鼠标，按住 W 循环发送 2 并点击当前鼠标，按住 E 循环发送 3 并点击当前鼠标。F11 暂停 / 继续，F12 退出脚本。</p>
        </section>

        <section>
          <h3>脚本宏与 AHK 导入</h3>
          <p>脚本宏建议通过“新增脚本宏”创建，再由玩家自己命名、填写热键和脚本内容。已有 .ahk 文件可以用“导入 AHK 为脚本宏”保存进当前宏配置；导出的全局宏预设会保留脚本内容，合并导入时也会把脚本宏追加进当前配置。</p>
          <p>AHK 解释器是直接运行 AutoHotkey v2 脚本；AHK 导入宏是把外部脚本作为配置素材保存或转换。两者用途不同。</p>
        </section>

        <section>
          <h3>输入后端</h3>
          <p><strong>系统光标模式：</strong>默认推荐，适配度最高，通常能进原生游戏；缺点是会占用真实鼠标。</p>
          <p><strong>Win 窗口消息模式：</strong>不移动真实光标，但部分原生游戏聚焦后会拒收窗口消息。</p>
          <p><strong>Win 触控注入模式：</strong>实验功能，不抢鼠标，但兼容性不稳定。</p>
        </section>

        <section>
          <h3>坐标和分辨率</h3>
          <p>点位、点击、连点属于战场地图点位，使用中轴线缩放规则。拖动宏属于底部 UI 手牌，使用手牌 UI 算法。Q/W/E 三个基础手牌宏还有独立算法，不和普通点位混算。导入别人配置后，建议点“应用并重算”，再手动校准一次。</p>
        </section>

        <section>
          <h3>宏预设导入导出</h3>
          <p>全局宏是一整套点位、拖动、点击、连点和脚本配置。导入时会按当前分辨率换算坐标；合并导入会把外部宏加入当前配置；导出当前只导出当前配置；导出全部会连同预设库一起导出。</p>
        </section>

        <section>
          <h3>排轴编辑器</h3>
          <p>排轴按 P 完全独立。每个 P 都有自己的队伍、练度、视频参考、牌序、牌池状态和动作记录。新建轴前先填写文件名，工具会自动保存到 AppData 的 timelines 目录。</p>
          <p>牌序按 1 到 5 点选：前三张是初始牌，后两张是固定顺序牌，剩余角色自动补成第六张。出牌区只有前三张能释放。</p>
          <p>普通出牌会沉底；锁牌留在原位；复制牌显示为“被复制角色（复制）”，再次释放后恢复原名并沉底。转场、撤退、送人是结构事件，不算普通出牌。送人只影响它之后的牌池，删除送人记录后会按时间线重新计算。</p>
        </section>

        <section>
          <h3>脚本宏 DSL</h3>
          <p>一行一条命令；#、//、; 开头是注释；坐标是当前分辨率下的屏幕坐标；时间单位是毫秒；mouse 表示触发热键瞬间的鼠标位置。</p>
          <pre>{dslExample}</pre>
        </section>

        <section>
          <h3>常见问题</h3>
          <p><strong>后端进程已退出：</strong>发布版应内置 Python；如果仍报错，检查杀毒软件是否拦截 exe 启动子进程。</p>
          <p><strong>日服热键无反应：</strong>优先用系统光标模式，并尝试管理员方式启动。窗口消息模式不保证能进所有原生游戏。</p>
          <p><strong>坐标偏移：</strong>确认游戏分辨率、Windows DPI、窗口黑边和映射类型。战场点位和手牌 UI 使用不同算法。</p>
        </section>
      </article>
    </div>
  );
}
