# ncm-player5 — 网易云音乐浮窗（完整继承 ncm-player4 + 自动跳过不可播放的歌曲）

[ncm-player](https://github.com/WolfGenerals/ncm-player) 的衍生版本，基于 **ncm-player4 1.3.1 原样派生**。全部功能与 ncm-player4 一致，**只改一处**：

> 🚫 **检测到因为下架或没有版权而无法播放的歌曲时，自动跳过这首歌，直接播放下一首。**

本仓库 `Doctor-Pan-code/ncm-player5` 是 ncm-player5 的发布仓库；上游原始实现见 [WolfGenerals/ncm-player](https://github.com/WolfGenerals/ncm-player)，自动跳过等改动在本仓库维护。

### 衍生基线与版本出处

上游 [WolfGenerals/ncm-player](https://github.com/WolfGenerals/ncm-player) 公开的 `package.json` 是 **1.2.0**（无 tag、无 release）。ncm-player2 / 3 都基于它派生，ncm-player4 在此基础上继续演进到 **1.3.1**，但 ncm-player4 从未公开发布，所以「ncm-player4 1.3.1」此前没有公开出处。

为了让这条派生链可以公开核对，ncm-player4 1.3.1 的**完整源码原样公开在本仓库的 `baseline/ncm-player4-1.3.1` 分支**（tag `ncm-player4-v1.3.1`，与该分支同 commit，根目录结构与 ncm-player5 一致）：

- 分支：<https://github.com/Doctor-Pan-code/ncm-player5/tree/baseline/ncm-player4-1.3.1>
- 对照：`git diff baseline/ncm-player4-1.3.1 main` 即 ncm-player5 相对基线的全部改动（自动跳过不可播放的歌曲 + 包名 scope 调整）

> 包名说明：本插件早期沿用了上游作者的 `@wolfgenerals/` scope，但该 scope 属于上游作者，且 `@wolfgenerals/ncm-player5` 从未发布到 npm。**自 1.4.1 起包名改为 `@doctor-pan-code/ncm-player5`**（投稿人自己的 scope）。cordis 加载 id 仍是 `ncm-player5`，profile 里的 `id:` 不受影响。

原有能力全部保留：

1. **点击播放窗口以外的任意区域，播放窗口会自动收起成迷你条**（继承自 ncm-player2）
2. **播放界面最小化（收起为迷你条）后，3 秒内没有任何鼠标点击或移动，自动触发 `×` 退出按钮**，界面隐藏为右下角音符按钮，播放不中断（继承自 ncm-player3）
3. **退出为音符按钮后若仍在播放，右下角图标随音乐节奏（低频鼓点）跳动**（继承自 ncm-player4）
4. **右下角图标支持左键长按拖动**，位置自动记住（继承自 ncm-player4）

## ncm-player5 新增功能：自动跳过不可播放的歌曲

### 为什么要单独做一个版本
ncm-player4 遇到下架/无版权歌曲时只弹一个提示「播放出错(可能无版权或需会员)」，然后停在那里不动——用户得手动点下一首。歌单一长，这种歌一多就很难受。

### 检测方式（两道关卡）
1. **地址获取阶段（主判据）**：host 半部调 `/api/song/enhance/player/url`，网易云对不可播放的歌曲返回 `url: null` 且 `code: -110`。
   host 现在把这个信号透传给前端（`songUrl` 返回 `{ url, playable, reason, code }`，并新增 `songStatus` op）。
   - `playable === false` 且 `reason === 'copyright'` → 判定为「无版权/已下架」，直接跳过，**不发起任何音频请求**。
   - 另外做了 **多档音质降级**（请求码率 → 320k → 192k → 128k → 96k），某一档拿不到地址时自动尝试更低码率，只有全部失败才算不可播——避免把「只是没有高音质」误判为「不能播」。
2. **播放出错阶段（兜底）**：`<audio>` 元素的 `error` 事件里，先走原有的两条重试分支（Web Audio 接管后换新元素、CORS 兜底重载一次）；只有当重试也用尽、或错误码是 `MEDIA_ERR_SRC_NOT_SUPPORTED(4)` / `MEDIA_ERR_DECODE(3)` 时，才判定为不可播并跳过。

**网络异常不算不可播**：请求接口本身失败（超时/断网/解析失败）时一律按「未知」处理，不跳歌，只是照旧弹提示。

### 跳过规则
- 按当前播放模式推进：**顺序模式**走下一首，到队尾回到队首循环找可播放的；**随机模式**随机换一首（避开当前这首）；**单曲循环模式下遇到坏歌也会跳出到下一首**（否则会一直重播同一首坏歌）。
- 跳过时提示「已跳过《歌名》：无版权/已下架」，2.8 秒后自动消失。
- **防死循环**：连续跳过次数达到队列长度（上限 30）仍没有一首能播时，停止播放并只提示一次「队列中没有可播放的歌曲」。队列只有 1 首坏歌时直接停止，不会反复重试。
- **自动跳过开关**：设置页 → 播放 → 「自动跳过不可播放的歌曲」，默认**开启**；关闭后行为与 ncm-player4 完全一致。
- 判定结果在 host 侧缓存 5 分钟，避免连跳时对同一首歌反复请求。

## 功能特性（继承自 ncm-player4）

- 🎵 **播放**：播放/暂停、上一首/下一首、进度拖拽、音量与静音；顺序、单曲循环、随机三种模式
- 📃 **发现**：搜索单曲 / 歌单 / 专辑，热门歌单推荐；登录后查看「我的」歌单与收藏的专辑
- 📝 **歌词**：逐行同步高亮、点击跳转、歌词翻译；迷你模式显示当前歌词，超长歌词横向滚动，字号可调
- 🔄 **队列**：添加、移除、清空；自动持久化——重启后恢复队列、进度、播放模式、音量
- 👤 **账号**：网易云 App 扫码登录，或粘贴 Cookie
- 🪟 **浮窗**：展开 / 迷你条 / 隐藏三种形态，均可拖拽；颜色跟随 DSH 皮肤主题
- ⚙️ **设置**：音质、歌词翻译、迷你歌词开关/滚动/字号、无操作自动退出、**自动跳过不可播放的歌曲**

## 安装

包名 `@doctor-pan-code/ncm-player5`，cordis 加载 id 为 `ncm-player5`。

**与 ncm-player2/3/4 不能同时启用**：host 半部都注册 `/ncm/api` 前缀路由，同时启用会互相抢占。
安装本插件时应停用 ncm-player4（在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中为 `ncm-player4` 加 `disabled: true`），并重启 DSH。

从 GitHub 安装：

```bash
dsh plugin add Doctor-Pan-code/ncm-player5
```

本地 / 手动安装（link 方式，与 profile 内其他本地插件一致）：

1. 把本目录放到插件目录，如 `$DSH_HOME/plugins/ncm-player5`
2. 在 `$DSH_HOME/profiles/<profile>/package.json` 中：

   ```json
   "dependencies": { "@doctor-pan-code/ncm-player5": "link:C:/Users/<你>/.dsh/plugins/ncm-player5" }
   ```

   并把 `@doctor-pan-code/ncm-player5` 追加进 `dsh.profile.bundles`
3. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中追加：

   ```yaml
   - insert:
       - id: ncm-player5
         name: '@doctor-pan-code/ncm-player5'
   - id: ncm-player4
     disabled: true
   ```
4. 完全退出并重启 DSH

## 数据保存（沿用 ncm-player4，升级无感）

登录态与播放队列存放在**本机浏览器 localStorage**，key 仍是 `ncmply2-settings`；右下角音符按钮位置 key 仍是 `ncmply4-disc-pos`。
因此从 ncm-player4 升级到 ncm-player5 时，**登录态、播放队列、各项设置、图标位置全部自动沿用**，不需要重新登录，也不需要重新拖动图标。

ncm-player5 在 `state` 里新增一个字段 `autoSkip`（自动跳过开关，默认 `true`）：

```json
{
  "account": { "cookie": "...", "uid": 123, "nickname": "..." },
  "state": {
    "queue": [ { "id": 1, "name": "...", "artists": "...", "album": "...", "cover": "...", "duration": 0 } ],
    "index": -1, "mode": "order", "vol": 0.8, "quality": 320000, "time": 0,
    "showTrans": true, "showMiniLrc": true, "miniLrcScroll": true, "miniLrcSize": 11,
    "autoExit": true, "autoSkip": true
  }
}
```

## host 半部新增的 API

| op | 入参 | 返回 |
|---|---|---|
| `songUrl` | `{ id, br }` | `{ url, playable, reason, code }`——多个码率依次尝试，全部失败时 `url` 仍按旧行为返回 `song/media/outer/url` 兜底地址以兼容旧前端 |
| `songStatus` | `{ id, br }` | `{ playable, reason, code, fee, freeTrial }`——纯查询，不返回地址；结果缓存 5 分钟 |

`reason` 取值：`copyright`（code -110，无版权/下架）、`error`（code -200）、`unavailable`（其它）、`null`（可播放或未知）。

其余 op（`search` / `playlistDetail` / `albumDetail` / `lyric` / `like` / 登录相关 / `saveState` 等）行为与 ncm-player4 完全一致。

## 注意事项

- 依赖本机可用的 Node.js 运行时，以及可访问 `music.163.com` 的网络
- 登录 Cookie 只用于请求 music.163.com，不发送给任何第三方
- VIP 专享歌曲在未登录/非会员时网易云同样返回 `-110`，会被当作「不可播放」跳过；登录会员账号后这些歌就能正常播放
- 收藏（点 ❤）受网易云账号风控影响，失败时会有提示，属正常现象
- 仅供个人学习使用，请遵守网易云音乐服务条款与当地法律法规

## 更新记录

### 1.4.1（包名与基线公开）
- **包名改为 `@doctor-pan-code/ncm-player5`**：不再占用上游作者的 `@wolfgenerals/` scope。cordis 加载 id 仍是 `ncm-player5`，profile 里 `- id: ncm-player5` 不变，只需把 `package.json` 的依赖键与 `name:` 改成新包名（见「安装」）。本地 profile 已按此迁移，`node_modules` 里的 junction 也指向新 scope。
- **公开派生基线**：ncm-player4 1.3.1 的完整源码原样发布到 `baseline/ncm-player4-1.3.1` 分支与 `ncm-player4-v1.3.1` tag，`git diff baseline/ncm-player4-1.3.1 main` 就是本插件相对基线的全部改动。
- 功能无变化，与 1.4.0 完全一致。

### 1.4.0（ncm-player5）
- **新增**：检测到因下架/无版权而无法播放的歌曲时，自动跳过并播放下一首
  - host 半部新增可播性判定（读 `url: null` + `code: -110`），`songUrl` 增加多档音质降级，新增 `songStatus` op，判定结果缓存 5 分钟
  - client 半部在「取地址」与「音频元素出错」两处触发跳过，跳过时提示被跳过的歌名；按播放模式推进；连续跳过达到队列长度即停止并提示「队列中没有可播放的歌曲」
  - 设置页新增「自动跳过不可播放的歌曲」开关（默认开启），关闭后行为与 ncm-player4 一致
  - 网络异常不视为不可播，避免断网时把整张歌单跳过
- 其余功能、数据 key、UI 与 ncm-player4 1.3.1 完全一致

## License

MIT

## 致谢

原实现来自 [WolfGenerals/ncm-player](https://github.com/WolfGenerals/ncm-player)，并借鉴了 [sanwuhundun/dsh-netease-music](https://github.com/sanwuhundun/dsh-netease-music) 的网易云音乐 API 对接与登录方案。
