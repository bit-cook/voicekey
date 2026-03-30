# refine/

文本润色模块，负责将 `llmRefine` 配置解析为统一的 OpenAI Chat Completions 请求，并执行润色与连接校验。

## 文件

- `index.ts` - 统一导出润色服务、OpenAI-compatible client 与配置解析工具。
- `service.ts` - 无状态 `RefineService`，每次调用都读取最新 `llmRefine` 配置，使用固定 transcript 包装、静态术语表感知与结构化 prompt 执行润色和连接校验。
- `config-resolver.ts` - 将手动填写的 OpenAI-compatible 配置解析成统一请求参数，并补全 `/chat/completions` endpoint。
- `openai-client.ts` - OpenAI Chat Completions HTTP client，负责 endpoint 规范化、请求发送、错误与消息内容解析。
