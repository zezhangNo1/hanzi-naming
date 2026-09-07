# INTENT-T01：工程骨架与环境初始化

## 1. 背景与目标
全部后续任务依赖同一套小程序工程与云开发底座。目标：**半天内让仓库可编译、真机可预览、前端可调用云函数并按统一错误码协议处理返回**。

## 2. 范围
**做**：miniprogram + cloudfunctions 双目录、8 个页面占位、全局组件占位、request 封装、云开发环境初始化、4+1 云函数空壳、环境变量声明、database/ 目录。
**不做**：任何页面真实 UI（占位文本即可）、任何业务逻辑、词库数据。

## 3. 输入
- 交接包第一节「工程结构建议」、第三节「错误码表」、环境变量清单
- PRD 第 7 节技术架构
- 原型：宣纸+墨+朱砂配色、名字衬线字体（本任务只把色板与字体写进 app.wxss 变量）

## 4. 产出
```
project.config.json
miniprogram/app.json            （8 页面注册：index/result/detail/vote/poster/folder/inspiration/mine；inspiration 可后注册）
miniprogram/app.js              （wx.cloud.init，env 从配置读取）
miniprogram/app.wxss            （色板变量：宣纸 #F7F4EC / 墨 #1C1C1C / 朱砂 #B03A2E；衬线字体名定义）
miniprogram/config/env.js       （云环境 ID、版本号、FREE_BATCH_LIMIT 前端展示常量）
miniprogram/utils/request.js    （callFunction 封装）
miniprogram/pages/index|result|detail|vote|poster|folder|mine/  （各 4 件套占位）
cloudfunctions/generate|vote|order|user|admin/ （各含 index.js 空壳 action 路由 + package.json + config.json 权限声明）
database/README.md              （词库文件清单与构建脚本说明，占位）
docs/deploy.md                  （环境变量配置步骤：LLM_API_KEY、LLM_BASE_URL、LLM_MODEL、FREE_BATCH_LIMIT=2、AD_BATCH_LIMIT=1）
```

## 5. 实现要点
- `request.js` 约定：`call(name, action, data) -> Promise<data>`；统一解析 `{code, msg, data}`；code≠0 时按错误码表映射 UI 行为（1001 toast、2001 抛给解锁卡、2002 保留 reconcile 重试、3001 正常展示并标记 degraded、3002 toast 重试、4001 toast）；网络失败统一 code=-1。
- 鉴权约定：前端**绝不传 openid**，云函数内取 `context.OPENID`（云开发自动注入 `_openid`）。
- admin 云函数：`config.json` 中不开放前端调用权限，仅云开发控制台/其他云函数调用。
- app.json 需声明 `wx.requestVirtualPayment` 无需特殊声明，但 `requiredPrivateInfos` 按需最小化；本任务只预留。

## 6. 验收标准
- [ ] `npm run lint`（或微信开发者工具）0 错误；真机预览所有占位页可打开
- [ ] 临时 echo action：前端 `call('user','ping')` 返回 `{code:0}`，错误码 mock（返回 2001）能触发解锁卡回调分支
- [ ] `LLM_API_KEY` 等变量已写入云函数配置且**不在前端任何文件中出现**（grep 验证）
- [ ] git 仓库初始化，.gitignore 排除 node_modules 与任何密钥文件

## 7. 依赖与风险
- 依赖：无（第一个任务）。外部依赖：微信小程序 AppID、个体户主体（可先用测试号开发，提审前切换）。
- 风险：云开发环境配额不足 → 开发/生产分两个 env，成本可控。

## 8. 预估人天
1.5
