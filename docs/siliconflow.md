# 在言中使用硅基流动

更新于 2026-10-15

## 1. 关于言

[言](https://github.com/Master-Norna/yan)是一个在本机运行的开源 AI 对话与轻量 Agent 应用，以 Apache-2.0 发布，Windows 与 macOS 可用。它不用安装包，也不连任何云端账号：装好 Node.js 18+，下载源码，双击即可启动；对话、文件与配置只存在自己电脑上。

同一段对话有两种用法：

- **对谈**：照常聊天、读论文、分析材料；需要产出表格、文档、PDF 时，言把文件直接存进本机的「卷宗」目录。
- **执事**：给对话绑定一个工作目录，它就成了只做代码工作的轻量 Agent，在这个目录里检索、读写、修改文件并执行命令；每条命令默认先请你点头，外面还套了一层沙箱。

另外还有：在回复里划选一段即可就地追问的「旁注」、模型直接画出可交互图表的页内可视化、模型操作浏览器时看得见也接得过手的「游目」、记忆、MCP、子 Agent 等。

言在模型接口里把**硅基流动**单列为第一项：选它会自动填好地址，模型列表只列对话模型，各模型的思考档位也替你换算好，填上自己的 API Key 就能用 DeepSeek、Qwen、GLM、Kimi 等模型。

觉得好用的话，欢迎到 [GitHub](https://github.com/Master-Norna/yan) 点个 Star。

### 1.1 下载与启动

1. 装好 [Node.js](https://nodejs.org) 18 或更新的版本。
2. 在 [GitHub](https://github.com/Master-Norna/yan) 页面点「Code → Download ZIP」下载并解压，或用 `git clone https://github.com/Master-Norna/yan.git`。
3. Windows 双击 `start.cmd`；macOS 双击 `start.command`（头一回被系统拦下时，在访达里右键选「打开」）。
4. 浏览器会自动打开 `http://127.0.0.1:8787`。启动时弹出的窗口是言的本机服务，用的时候请保持开着。

## 2. 在言中使用硅基流动

### 2.1 获取 API Key

1. 打开 [硅基流动](https://cloud.siliconflow.cn) 并登录，没有账号的先注册一个。
2. 进入 [API 密钥](https://cloud.siliconflow.cn/account/ak) 页面，新建一个密钥并复制。

### 2.2 在言中配置

1. 点左下角头像旁的设置按钮，进入「设置 → 模型」，点「＋ 接入模型」。
2. 「接口」选第一项**硅基流动**，Base URL 会自动填成 `https://api.siliconflow.cn/v1`（国际站账号改成 `https://api.siliconflow.com/v1`）。
3. 把 API Key 粘贴进去。
4. 点「获取列表」，从下拉框里挑一个模型，比如 `deepseek-ai/DeepSeek-V4-Flash`。列表只列对话模型，画图、向量、语音模型不会混进来。
5. 点「测试连接」，状态行显示通过即可。「显示名称」可以改成好认的名字，它会出现在对话框的模型菜单里。

![在设置里接入硅基流动](https://raw.githubusercontent.com/Master-Norna/yan/main/assets/siliconflow/1-settings.webp)

### 2.3 开始对话

回到首页，对话框右下角就是刚才接入的模型。点开它可以切换模型、调「思考深度」：言会替每个模型选对的参数，DeepSeek-V4、GLM-5.2 送 `reasoning_effort`（只有「高」「最高」两档），Qwen3 之类换成 `enable_thinking` 与思考预算，你只管挑档位。

![模型菜单与思考深度](https://raw.githubusercontent.com/Master-Norna/yan/main/assets/siliconflow/2-model-menu.webp)

输入问题，按「寄」发送即可：

![用 DeepSeek-V4-Flash 对话](https://raw.githubusercontent.com/Master-Norna/yan/main/assets/siliconflow/3-chat.webp)

### 2.4 小技巧

#### 2.4.1 同一个 Key 接多个模型

在「设置 → 模型」里多点几次「＋ 接入模型」，接口都选硅基流动、填同一个 Key，各挑一个模型，比如日常用 DeepSeek-V4-Flash，难题换 DeepSeek-V4-Pro，写代码用 Kimi-K2.7-Code。对话中途可以在模型菜单里随时换，每段对话记得自己用的是哪个。点某张卡片上的「设为默认」，新对话就从它开始。

#### 2.4.2 让模型动手做事

言内置联网检索、读网页与 PDF、生成表格与文档等工具，给对话绑定工作目录还能读写代码、执行命令。这些都要靠工具调用（function calling），请选支持它的模型，如 DeepSeek-V4、GLM-5 系列、Qwen3 系列、Kimi。模型不支持时，可以在这个模型的「高级配置」里把「本机联网与文档工具」关掉，当作纯聊天模型用。

#### 2.4.3 给用量设上限

模型卡片上的「用量上限」可以填一个 token 数（支持 k、m 等单位）。设了之后右上角的「余墨」会随用量递减，用完就暂停，免得长任务一口气跑超预算；留空则不限，只记已用多少。

## 3. 参考

- 言 · GitHub：<https://github.com/Master-Norna/yan>
- 言 · 模型接入说明：<https://github.com/Master-Norna/yan/blob/main/docs/models.md>
- 硅基流动 · 模型广场：<https://cloud.siliconflow.cn/models>
- 硅基流动 · API 密钥：<https://cloud.siliconflow.cn/account/ak>
