# ncm-player — 网易云音乐浮窗

一个运行在 DeepSeek Harness (DSH) Web 界面里的网易云音乐浮窗播放器：可拖拽、可折叠、可隐藏，支持单曲/歌单/专辑浏览与搜索、逐行同步歌词与翻译、播放队列、扫码/Cookie 登录，界面颜色自动跟随 DSH 皮肤主题。

## 预览

| 播放 | 歌词 |
|---|---|
| ![播放](doc/screenshot-1.png) | ![歌词](doc/screenshot-2.png) |

| 发现 · 热门 | 发现 · 我的 |
|---|---|
| ![发现-热门](doc/screenshot-3.png) | ![发现-我的](doc/screenshot-4.png) |

| 专辑浏览 | 播放队列 | 迷你模式 |
|---|---|---|
| ![专辑内容浏览](doc/screenshot-5.png) | ![队列](doc/screenshot-6.png) | ![mini窗口](doc/screenshot-7.png) |

## 功能特性

- 🎵 **播放**：播放/暂停、上一首/下一首、进度拖拽、音量与静音；支持顺序、单曲循环、随机三种模式（图标 + 文字标识，单曲循环带 "1" 角标）
- 📃 **发现**：搜索单曲 / 歌单 / 专辑（三种分类），热门歌单推荐；登录后进入「我的」，查看创建、收藏、喜欢的歌单与收藏的专辑
- 📝 **歌词**：逐行同步高亮、点击歌词跳转进度、歌词翻译（有翻译时显示）；迷你模式同样显示当前歌词，超长歌词自动横向滚动，字号可调
- 🔄 **队列**：添加、移除、清空管理；自动持久化——重启后恢复队列、进度、播放模式、音量
- 👤 **账号**：网易云 App 扫码登录，或粘贴 Cookie；登录后可查看「我的音乐」并使用收藏功能
- 🪟 **浮窗**：展开 / 迷你条 / 隐藏三种形态，均可拖拽；隐藏后为右下角音符按钮，页面打开时默认隐藏于此；颜色跟随 DSH 皮肤主题
- ⚙️ **设置**：音质（标准 128k / 高品质 320k）、歌词翻译开关、迷你歌词开关 / 滚动 / 字号；所有设置自动持久化

## 安装

### 方式一：从 npm 安装（推荐）

```bash
dsh plugin --profile web add @wolfgenerals/ncm-player
```

该命令会在 web profile 中安装依赖，并把 `@wolfgenerals/ncm-player` 加入 `dsh.profile.bundles`
列表（见 `$DSH_HOME/profiles/web/package.json`）。重启 DSH Web 后生效。

### 方式二：从 GitHub 安装

```bash
dsh plugin --profile web add github:WolfGenerals/ncm-player
```

同样会把 `@wolfgenerals/ncm-player` 加入 `dsh.profile.bundles` 列表，重启 DSH Web 后生效。

### 本地开发

```bash
git clone https://github.com/WolfGenerals/ncm-player.git
```

## 快速上手

1. 安装插件并重启 DSH Web 后，页面右下角出现音符按钮，点击展开播放器
2. 「发现」页搜索或选择热门歌单，点任意一首歌开始播放
3. 「播放」页可切歌、拖进度、调音量、切换播放模式；「歌词」页查看逐行歌词与翻译
4. 在「设置」页扫码登录（网易云 App 扫一扫）或粘贴 Cookie，解锁「我的音乐」与收藏
5. 点击窗口右上角 `-` 收起为迷你条，`×` 隐藏；再次打开点击右下角音符按钮

## 数据保存（浏览器 localStorage）

登录态与播放队列保存在**本机浏览器 localStorage**（key：`ncmply-settings`），不写入磁盘文件：

```json
{
  "account": { "cookie": "...", "uid": 123, "nickname": "..." },
  "state": {
    "queue": [ { "id": 1, "name": "...", "artists": "...", "album": "...", "cover": "...", "duration": 0 } ],
    "index": -1, "mode": "order", "vol": 0.8, "quality": 320000, "time": 0,
    "showTrans": true, "showMiniLrc": true, "miniLrcScroll": true, "miniLrcSize": 11
  }
}
```

- 换浏览器或清除站点数据会丢失登录态 / 队列（需重新登录）
- 升级自 ≤1.0.7 的用户：旧文件 `~/.dsh/ncmply-settings` 会在启动时被**只读**读取一次并自动迁入 localStorage，随后不再写入（文件保留但不更新）
- 浏览器隐私模式下 localStorage 不可用时，功能照常、仅不持久化

## 注意事项

- 依赖本机 PATH 上的 Node.js 运行时，以及可访问 `music.163.com` 的网络
- 登录 Cookie 只用于请求 music.163.com，不发送给任何第三方
- 收藏（点 ❤）受网易云账号风控影响，失败时会有提示，属正常现象
- 部分歌曲受版权 / 会员限制无法播放；歌词翻译仅当歌曲有翻译数据时显示
- 仅供个人学习使用，请遵守网易云音乐服务条款与当地法律法规

## License

MIT

## 致谢

实现借鉴了 [sanwuhundun/dsh-netease-music](https://github.com/sanwuhundun/dsh-netease-music)
的网易云音乐 API 对接与登录方案。
