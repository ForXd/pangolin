# Pangolin

[![Validate](https://github.com/ForXd/pangolin/actions/workflows/validate.yml/badge.svg)](https://github.com/ForXd/pangolin/actions/workflows/validate.yml)
[![npm](https://img.shields.io/npm/v/@zllling/pangolin)](https://www.npmjs.com/package/@zllling/pangolin)

零运行时依赖的 Node.js TCP 反向隧道，用一条客户端主动建立的连接，将服务端端口转发到内网服务。源码使用 TypeScript 7，发布包包含 JavaScript 和类型声明，支持 CommonJS 和 ESM。

```text
用户 → Server:8080 ⇄ TCP 隧道 ⇄ Client → 内网服务:3000
                         ↑
               Client 主动连接 Server:9000
```

## 安装

```sh
npm install @zllling/pangolin
```

需要 Node.js >=22.18。开发版本使用 `.node-version` 中的 Node 26，CI 覆盖 Node 22、24、26。TypeScript 使用方还需要 `@types/node`，并在 tsconfig 中设置 `"types": ["node"]`。

## 使用

公网/中转服务器：

```js
import { Server } from '@zllling/pangolin';

const server = new Server({
  listenPort: 9000,
  host: '0.0.0.0',
  forwardHost: '0.0.0.0',
  allowedPorts: [8080],
});
server.on('tunnelError', console.error);
server.on('forwarding', address => console.log('转发端口已就绪', address.port));
await server.init();
// 退出时：await server.close();
```

内网客户端：

```js
import { Client } from '@zllling/pangolin';

const client = new Client({
  serverIP: 'your-server.example.com',
  serverPort: 9000,
  targetIP: '127.0.0.1',
  targetPort: 3000,
  listenPort: 8080,
});
client.on('ready', port => console.log('远端监听已就绪', port));
client.on('connectionError', console.error);
client.init();
// 退出时：await client.close();
```

CommonJS 使用 `const { Server, Client } = require('@zllling/pangolin')`。`ready` 表示服务端成功绑定转发端口，而不只是 TCP 控制连接成功。

## 配置与生命周期

| Server 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `listenPort` | 必填 | 控制连接端口，0 表示系统分配 |
| `host` / `forwardHost` | `0.0.0.0` | 控制端口 / 转发端口绑定地址 |
| `allowedPorts` | 不限制 | 允许客户端申请的转发端口；空数组拒绝全部 |
| `maxConnections` | 256 | 每条隧道的通道上限，范围 1–256 |
| `maxTunnels` | 100 | 客户端隧道连接上限 |
| `handshakeTimeout` | 10000 | 等待端口申请的超时，毫秒 |

Client 的五个地址/端口选项必填。`listenPort: 0` 允许服务端分配端口，可在 `ready` 事件或 `client.listenPort` 中读取。`reconnectDelay` 默认 1000 毫秒，`connectTimeout` 默认 10000 毫秒（包括等待端口确认），`maxConnections` 默认 256。目标端口与控制服务端口必须是 1–65535。

- `server.init()` 返回 Promise；绑定失败会拒绝，重复调用不重复创建监听器。`server.address` 返回当前控制端口地址或 null。
- `client.init()` 启动连接与重连；重复调用无副作用。`client.connected` 仅在收到端口确认后为 true。
- `close()` 返回 Promise，关闭现有连接和监听器；客户端停止重连。关闭完成后可以再次 `init()`。
- Server 事件：`listening(address)`、`forwarding(address)`、`tunnelError(error)`、`serverError(error)`、`close()`。
- Client 事件：`ready(port)`、`connectionError(error)`、`disconnect()`。库不会向 stdout 写日志。

## 传输与部署边界

支持二进制流、TCP 分片与粘包、目标服务先发数据、双向半关闭和连接 ID 复用。每帧最大 64 KiB，解析器在分配内存前验证长度。写入拥塞会暂停读取，避免无限累积应用层队列。因为通道复用同一 TCP 流，一个慢通道可能阻塞其他通道；需要隔离时使用不同 Client。

这是一个原始 TCP 隧道，**不提供身份认证或传输加密**。控制端口应只允许可信客户端访问，例如通过 VPN、私网或防火墙白名单；`allowedPorts` 只约束端口，不代替身份认证。按需限制 `forwardHost`，避免把内部服务意外公开。

## 从 1.x 升级

2.0 的协议新增 OPEN / END 及端口确认，**客户端和服务端必须同时升级**，不能与 1.x 混用。保留顶层 `Server` / `Client` 导出和构造参数，新增可等待的服务端启动和双方关闭方法。深层 `lib/*` 导入不再受支持。捕获 `server.init()` 的拒绝，而不是依赖旧版本吞掉监听错误。

## 开发

```sh
npm ci
npm run check       # Biome + TS7 构建 + TCP/协议/发布测试 + 独立安装验证
npm run typecheck
npm run format
npm run package:pack
```

测试使用 Node 内置测试运行器和本地回环网络，不需要公网服务器。打包验证会在临时目录安装产物，验证 CommonJS、ESM、真实 TCP 往返及 TypeScript 声明。`dist/` 和 `.artifacts/` 为生成文件，不提交。

自动发布见 [发布说明](https://github.com/ForXd/pangolin/blob/main/docs/releasing.md)，协议见 [协议文档](https://github.com/ForXd/pangolin/blob/main/docs/protocol.md)，历史设计记录见 [早期实现说明](https://github.com/ForXd/pangolin/blob/main/docs/history.md)。

## License

ISC
