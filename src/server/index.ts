import express from 'express';
import cors from 'cors';
import * as path from 'path';
import gameRouter from './routes/gameRouter';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', gameRouter);

const clientDistPath = path.join(__dirname, '../../client');
app.use(express.static(clientDistPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// 仅在被直接运行时监听端口；被测试等模块 import 时只导出 app，避免占用端口。
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🌱 外星植物杂交服务器启动中...`);
    console.log(`📍 服务器地址: http://localhost:${PORT}`);
    console.log(`🎮 API端点: http://localhost:${PORT}/api`);
  });
}

export { app };
export default app;
