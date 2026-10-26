# claude-mods

几个 Claude Code 的 mod（hooks 插件），作为一个插件市场发布，按需安装。

| Mod | 作用 | 入口 |
|---|---|---|
| `token-usage` | Token 用量实时面板：上下文占用与构成、累计用量、缓存命中率、每轮趋势与耗时、工具和技能调用统计、费用、5 小时 / 7 天限额与耗尽预测、一键压缩 | 会话开始自动打开，`/tokens` 重新打开 |
| `command-guard` | 危险命令守卫：递归删除 `/`、`~` 直接拒绝；强推、`reset --hard`、`clean -f`、`DROP`/`TRUNCATE`、无 `WHERE` 的 `DELETE`、修改 `*-prod` 配置先弹窗确认 | 自动生效 |
| `tldr` | 600 字以上的回答下方自动附一句中文 TL;DR（只把回答发给 Haiku，成本与上下文长短无关） | 自动生效 |
| `snippets` | 输入 `#` 弹出常用提示词片段，选中后整段填入输入框；片段在 `snippets/snippets.json`，保存即生效 | `#名字`，`/snippets` 列出全部 |

## 安装

在终端的 Claude Code 输入框里，每个 mod 一行，装哪个写哪个：

```
/plugin install token-usage --marketplace xiaoleige0611/claude-mods
/plugin install command-guard --marketplace xiaoleige0611/claude-mods
/plugin install tldr --marketplace xiaoleige0611/claude-mods
/plugin install snippets --marketplace xiaoleige0611/claude-mods
```

第一次会问 `Add marketplace?`，输入 `y`；再选安装范围，直接回车选 user（所有项目都生效）。装好即用，无需重启。

也可以在 shell 里：

```
claude plugin install token-usage --marketplace xiaoleige0611/claude-mods
```

桌面版里 `/plugin` 不可用：点输入框旁的 **+** → Plugins → Add marketplace，填 `xiaoleige0611/claude-mods`，再 Add plugin。

## 更新

```
claude plugin marketplace update local-mods
claude plugin update <mod>@local-mods
```

然后在会话里执行 `/reload-plugins`。
