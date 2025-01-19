# AI ContentCraft

AI ContentCraft 是一个多功能的内容创作工具，集成了文本生成、语音合成、图像生成等功能。它可以帮助创作者快速生成故事、播客脚本和配套的音视频内容。

## 功能特点

- 🎯 故事生成：基于主题自动生成短篇故事
- 📝 脚本转换：将故事转换为标准剧本格式
- 🎙️ 播客内容：生成播客大纲和对话脚本
- 🗣️ 语音合成：支持多种声音的文本转语音
- 🎨 图像生成：为故事场景生成配图
- 🌐 双语支持：支持内容的中英文转换
- 📊 批量处理：支持批量生成和下载内容

## 技术栈

- Frontend: HTML/JavaScript
- Backend: Node.js + Express
- AI Services:
  - DeepSeek AI: 文本生成
  - Kokoro TTS: 语音合成
  - Replicate: 图像生成
- 其他工具：FFmpeg (音频处理)

## 前置条件

- Node.js 16+
- FFmpeg
- 各 AI 服务的 API 密钥
  - DeepSeek AI 账号和 API 密钥
  - Replicate 账号和 API Token
- 稳定的网络连接

## 快速开始

1. 克隆项目并安装依赖：
```bash
git clone https://github.com/nicekate/AI-ContentCraft.git
cd AI-ContentCraft

# 安装项目依赖
npm install dotenv express kokoro-js openai replicate

# 安装开发依赖
npm install -D nodemon
```

2. 配置环境变量：
创建 `.env` 文件并添加以下配置：
```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
REPLICATE_API_TOKEN=your_replicate_token
```

3. 安装 FFmpeg：
确保系统中已安装 FFmpeg，并更新 `server.js` 中的 FFmpeg 路径：
```javascript
const ffmpegPath = 'your_ffmpeg_path';
```

4. 启动服务器：
```bash
npm run dev
```

5. 访问应用：
打开浏览器访问 `http://localhost:3000`

## 使用说明

### 故事生成
1. 输入故事主题
2. 点击生成故事
3. 可选择转换为脚本格式
4. 支持生成配套的场景图片

### 播客内容
1. 输入播客主题
2. 生成播客大纲
3. 转换为对话脚本
4. 选择不同声音进行配音

### 音频处理
1. 支持多段文本分别配音
2. 自动合并多个音频片段
3. 提供音频预览和下载

### 图片生成
1. 自动为场景生成提示词
2. 批量生成场景图片
3. 提供图片预览和批量下载
4. 自动生成图片展示页面

## API 接口

主要接口包括：
- `/generate-story`: 生成故事
- `/generate-script`: 转换脚本
- `/generate-podcast`: 生成播客内容
- `/generate`: 单段文本转语音
- `/generate-and-merge`: 多段文本转语音并合并
- `/generate-image`: 生成图片
- `/translate-podcast`: 播客脚本翻译
- `/translate-story-script`: 故事脚本翻译

## 注意事项

- 需要有效的 API 密钥才能使用 AI 服务
- 音频合并功能需要正确配置 FFmpeg
- 建议在本地开发环境中使用
- 注意 API 调用限制和费用

## 错误处理

常见问题及解决方案：

1. API 调用失败
   - 检查 API 密钥是否正确
   - 确认 API 调用限额
   - 查看具体错误信息

2. 音频处理问题
   - 确认 FFmpeg 安装正确
   - 检查音频文件格式
   - 查看服务器日志

3. 图片生成失败
   - 检查 Replicate API 配额
   - 确认提示词是否合规
   - 查看错误响应

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交变更
4. 发起 Pull Request

## License

MIT
