# 参与贡献

欢迎 Issue 和 Pull Request。

## 反馈入口

- Bug：GitHub Issues
- 功能建议：GitHub Discussions
- 安全问题：见 `SECURITY.md`，不要提交公开 Issue

## 开发环境

要求 Node.js 18+。

```bash
npm install
npm run desktop
```

## 提交规范

- feat: 新功能
- fix: 修复
- docs: 文档
- chore: 构建/依赖
- refactor: 重构
- test: 测试

## Pull Request 要求

- 描述动机与影响
- 包含复现步骤或截图
- 通过 `node --check server.js`、`node --check desktop/main.js`、`node --check public/app.js`
- 不提交 `release/`、`node_modules/`、`.cache/`
