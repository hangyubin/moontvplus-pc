# MoonTVPlus PC

MoonTVPlus PC 客户端 — 基于 Electron + React + TypeScript 构建的跨平台桌面影视播放应用,支持观看历史多端同步。

## 功能特性

### 影视播放
- **多源聚合搜索**: 同时搜索多个影视源,进度实时显示
- **播放器**: 基于 Artplayer + hls.js,支持 HLS/MP4 流媒体播放
- **播放记忆**: 自动恢复上次播放进度、选集、播放速度
- **开灯/关灯模式**: 关灯时全屏遮罩聚焦播放器,沉浸观影
- **选集面板**: 侧边栏显示剧集列表,快速切换

### 直播电视
- **直播源管理**: 支持多个直播源,Tab 切换直播源/频道列表
- **频道分组**: 按 group 分组显示,支持折叠/展开
- **频道搜索**: 实时搜索频道名称和分组
- **线路切换**: 同一频道多线路,鼠标左右滑动 / 方向键 ← → 切换
- **频道切换**: 方向键 ↑ ↓ 快速切换上一个/下一个频道
- **播放记忆**: 自动恢复上次的直播源、频道和线路
- **播放器**: 支持 m3u8/HLS 直播流,自动错误恢复

### 音乐播放
- **多音源搜索**: 支持酷我(kw)、网易(wy)、QQ(tx)、酷狗(kg)、咪咕(mg)等音源
- **榜单浏览**: 热门榜单歌曲浏览,一键播放
- **播放历史**: 自动记录播放历史,支持多端同步
- **歌词显示**:
  - **卡拉OK模式**: 逐字填充彩色进度,平滑过渡
  - **颜色自定义**: 5种高亮颜色可选(蓝/粉/青/橙/紫)
  - **字体大小**: 可调节歌词字体大小(12-24px)
  - **淡入淡出**: 歌词行根据距离当前行自动调整透明度
  - **翻译歌词**: 支持双语歌词显示
- **播放控制**: 播放/暂停、上一首/下一首、进度拖动、音量调节
- **自动播放**: 播放结束自动播放下一首

### 其他功能
- **观看历史**: 多端同步观看记录
- **收藏夹**: 收藏喜爱的影视内容
- **深色/浅色主题**: 支持主题切换
- **响应式布局**: 适配不同窗口大小
- **毛玻璃效果**: 现代化 UI 设计

## 技术栈

| 技术 | 用途 |
|------|------|
| Electron 31 | 桌面应用框架 |
| React 18 | UI 框架 |
| TypeScript 5 | 类型安全 |
| React Router 6 | 路由管理 |
| Zustand 4 | 状态管理 |
| Tailwind CSS 3 | 样式系统 |
| Artplayer 5 | 视频播放器 |
| hls.js 1 | HLS 流媒体支持 |
| Axios | HTTP 请求 |
| electron-vite | 构建工具 |
| electron-builder | 打包工具 |

## 项目结构

```
moontvplus-pc/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts       # 主进程入口
│   │   └── window.ts      # 窗口管理
│   ├── preload/           # 预加载脚本
│   │   └── index.ts
│   └── renderer/          # 渲染进程
│       ├── src/
│       │   ├── pages/     # 页面组件
│       │   │   ├── Home.tsx       # 首页
│       │   │   ├── Search.tsx     # 搜索页
│       │   │   ├── Detail.tsx     # 详情页
│       │   │   ├── Play.tsx       # 播放页
│       │   │   ├── Live.tsx       # 直播页
│       │   │   ├── Music.tsx      # 音乐页
│       │   │   ├── History.tsx    # 观看历史
│       │   │   ├── Favorites.tsx  # 收藏夹
│       │   │   └── Login.tsx      # 登录页
│       │   ├── components/ # 通用组件
│       │   ├── lib/        # 工具库
│       │   │   ├── api.ts          # API 客户端
│       │   │   ├── auth.ts         # 认证管理
│       │   │   ├── store.ts        # 状态管理
│       │   │   ├── live.ts         # 直播 API
│       │   │   ├── music.ts        # 音乐 API
│       │   │   └── image.ts        # 图片处理
│       │   └── App.tsx     # 应用入口
│       └── index.html
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

## 开发

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 类型检查

```bash
npm run typecheck
```

### 构建

```bash
# 构建 Windows 安装包
npm run dist:win

# 构建便携版
npm run dist:portable
```

## 配置

应用启动后需要配置服务端地址:

1. 首次启动进入登录页
2. 输入 MoonTVPlus 服务端地址(如 `http://192.168.1.100:3000`)
3. 输入用户名和密码登录

## 服务端

本客户端需要配合 [MoonTVPlus](https://github.com/hangyubin/moontvplus) 服务端使用,服务端提供影视搜索、直播源、音乐等 API。

## License

MIT
