# Scalebox Demo

> Scalebox SDK 稳定性测试

## 环境要求

- Node.js ^20
- pnpm ^9

## 项目初始化

```bash
pnpm install
cp .env.example .env  # 配置 Scalebox API Key 和 S3 凭证
```

## 运行测试

```bash
# vitest UI（推荐）
pnpm test:ui

# vitest CLI
pnpm test

# 运行指定测试
pnpm test sdk.spec
```
