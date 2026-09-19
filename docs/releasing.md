# npm 自动发布

发布流程参考同一维护者的 react-previewer：PR 验证、main / v* tag / 手动触发发布、OIDC Trusted Publishing、校验制品完整性、恢复 GitHub Release。

## 首次配置

在 npm 的 `@zllling/pangolin` 包 Settings → Trusted Publisher 中设置：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `ForXd` |
| Repository | `pangolin` |
| Workflow filename | `npm-publish.yml` |
| Environment | 留空（workflow 未配置 environment） |
| Allowed actions | 勾选 `Allow npm publish`（仅 stage publish 不足以运行本工作流） |

这是 npm 账户侧的设置，不随 Git 提交生效。使用 GitHub 托管的 runner，发布 job 具有 `id-token: write`，无需在仓库中存储 `NPM_TOKEN`。首次绑定可能要求维护者完成 npm 登录与二次验证。官方要求见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

GitHub Actions 必须启用。建议将 `Required checks` 设为 main 的合并检查。不要将有权修改 main 的人员视为无发布权限：main 的稳定版本升级会自动发布。

## 每次发布

1. 修改源码，运行 `npm run check`。
2. 使用 `npm version patch --no-git-tag-version`（或 minor / major）同步 manifest 和 lockfile。
3. 通过 PR 将改动合入 main。所有检查通过后自动发布新版本；不需要手工打 tag。

也可推送与 package.json 严格一致的 `vX.Y.Z` tag，或在 main 上手动运行 Publish Package。发布提交必须已属于 main。预发布版本会被拒绝，避免误用 stable 流程。

## 检查与恢复

- 源码检查覆盖 Node 22.18、24.21 和 26.9。
- Node 26 的构建只打包一次，安装消费矩阵在 Linux / macOS 上检查同一个 tarball。
- 发布下载并使用这个已测试 tarball，关闭生命周期脚本，附带 provenance。
- 打包时写入 `gitHead`，因为从 tarball 发布不会像目录发布一样自动推导源提交。
- 发布后核对 registry 的 SHA-512 integrity 和 gitHead，再创建 GitHub Release。
- npm 已有该版本时跳过发布，GitHub Release 使用 registry 中的原始 gitHead 恢复。registry 401/429/5xx 会使流程失败，不会被误认为“尚未发布”。

若发布成功但后续步骤失败，重新运行工作流即可。若 npm 身份验证失败，先检查 Trusted Publisher 的仓库名、workflow 文件名是否完全一致，而不是添加长期 token。

本地 `npm run package:pack` 写入的是当前 HEAD；发布用产物由 CI 从干净 checkout 创建。不要直接发布从未提交的工作区打出的包。
