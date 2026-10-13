# Codex Office

> 看 AI 上班，算 Token 账。

中文 · [English](README.en.md) · [使用指南](docs/usage.zh-CN.md) · [版本下载](https://github.com/kjwlegend/codex-office/releases) · [MIT](LICENSE)

**在一个工作台里掌握 AI 协作、找到需要关注的任务、看清 Token 投入。**

Codex Office 将本机 Codex 的 Agent、会话与委派关系放进可交互的 3D 办公室，再把用量拆到项目、模型和时间。多个任务同时推进时，你可以快速定位相关工作，也能在复盘时了解资源主要花在哪里。

## 把分散的协作，变成看得见的办公室

![Codex Office 虚拟办公室，使用虚构项目与 Agent 演示](docs/images/office.zh-CN.png)

主 Agent、Subagents 和独立会话拥有对应的员工与工位。任务气泡、状态与关系连线将工作分布呈现在同一张画布上，帮助你理解一个任务的上下游，以及多个项目之间的协作结构。

- **快速定位相关工作**：搜索项目或员工，查看任务与关系链，再进入原会话继续处理。
- **集中查看需要关注的任务**：“需要我处理”汇总等待确认与异常记录，支持定位、已查看与稍后处理，方便重新回到工作时抓住重点。
- **让 AI 同事更易辨认，也更有趣**：人类、奶牛和马都可以成为办公室员工；外观、昵称、工位摆件与项目配色可以按你的习惯设置。
- **选择适合自己的观察方式**：休闲办公室、单人隔间与二维关系图，分别提供空间感、独立工位和清晰的组织结构。

## 看清投入去向，让用量复盘有依据

![Codex Office 用量总览，使用虚构数据演示](docs/images/overview.zh-CN.png)

Token、缓存命中与 API 等价估算使用同一组日期、项目和模型筛选。从总量到明细，你可以逐层查看一个项目用了哪些模型、用量如何变化，以及输入有多少得到缓存复用。

| 功能 | 使用价值 |
| --- | --- |
| 用量总览 | 在同一屏查看所选范围的 Token、估算金额、缓存命中和主要投入分布，快速了解整体使用情况。 |
| 项目排行与详情 | 比较项目之间的投入差异，进一步查看单个项目的日期与模型构成。 |
| 模型分析 | 对比各模型的 Token 用量、估算金额和缓存表现，掌握模型的使用占比。 |
| 时间趋势与每日明细 | 观察用量的高低变化，沿具体日期查看当天的投入来源。 |
| 多维探索 | 按时间、工作目录、Agent 角色、推理等级等维度分析，寻找用量变化的线索。 |

*两张预览图均使用虚构项目、Agent 与用量数据。*

## 复用现有记录，轻量接入日常工作

读取本机已有的 Codex 记录即可生成工作台，用量索引和报表保存在本地。无需额外 API Key、注册账号或独立数据库服务。启动时自动增量更新用量，运行期间也可在页面内更新；报表支持中英文切换与离线查看。

## 快速开始

需要 **Python 3.10+**、可用的时区数据、本机 Codex 记录与现代浏览器。3D 场景使用 WebGL2，也可选择二维关系图。

将[仓库链接](https://github.com/kjwlegend/codex-office)交给你的 Codex Agent，让它安装并启动；也可以手动完成首次安装：

```bash
git clone https://github.com/kjwlegend/codex-office.git
cd codex-office
cp config.example.json config.json
python3 codex_usage.py serve --port 8766
```

打开 [本地工作台](http://127.0.0.1:8766/codex-usage-report.html)。启动会先生成最近 30 天的报表，再提供工作台服务。首次扫描历史记录需要一些时间；保持终端运行，按 `Ctrl+C` 停止。

示例配置使用 `Asia/Shanghai` 时区，可按需要修改；再次启动时沿用已有的 `config.json`。macOS 用户完成配置后，也可双击 `run-workspace.command` 启动办公室，或用 `run-dashboard.command` 生成离线报表。

## 开发与贡献

项目使用 Python 标准库、原生 HTML / CSS / JavaScript 和本地打包的 Three.js。Blender 角色源文件可编辑，3D 资源随项目提供。欢迎改进协作可视化、报表分析、交互体验、双语支持与记录兼容性。

[测试与预览图生成](tests/README.md) · [Blender 资产制作](assets/blender/README.md) · [Three.js 构建](dashboard/vendor/README.md)

## 许可证

[MIT License](LICENSE)。Three.js 使用[上游 MIT 许可证](dashboard/vendor/three-LICENSE.txt)。Codex Office 是独立社区项目，与 OpenAI 无官方隶属关系。
