const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 创建上传目录
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置multer用于文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // 生成唯一文件名：时间戳 + 随机数
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'photo-' + uniqueSuffix + '.jpg');
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 限制10MB
    },
    fileFilter: function (req, file, cb) {
        // 只接受图片文件
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传图片文件！'), false);
        }
    }
});

// 存储访问记录（在实际项目中应该使用数据库）
let accessRecords = [];

// 路由
app.get('/', (req, res) => {
    res.json({ 
        message: '摄像头访问系统后端服务',
        status: '运行中',
        endpoints: {
            upload: 'POST /api/upload',
            records: 'GET /api/records',
            stats: 'GET /api/stats'
        }
    });
});

// 上传图片接口
app.post('/api/upload', upload.single('photo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: '没有接收到图片文件' 
            });
        }

        // 获取客户端信息
        const clientInfo = {
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString(),
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        };

        // 添加到访问记录
        accessRecords.push(clientInfo);

        console.log('收到新图片上传:', clientInfo);

        res.json({
            success: true,
            message: '图片上传成功',
            data: {
                filename: req.file.filename,
                size: req.file.size,
                url: `/uploads/${req.file.filename}`,
                timestamp: clientInfo.timestamp
            }
        });

    } catch (error) {
        console.error('上传错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器处理图片时出错: ' + error.message
        });
    }
});

// 获取上传记录接口
app.get('/api/records', (req, res) => {
    try {
        // 返回最近的记录（最新的在前面）
        const recentRecords = accessRecords
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 50); // 只返回最近的50条记录

        res.json({
            success: true,
            data: recentRecords,
            total: accessRecords.length
        });
    } catch (error) {
        console.error('获取记录错误:', error);
        res.status(500).json({
            success: false,
            message: '获取记录时出错'
        });
    }
});

// 获取统计信息
app.get('/api/stats', (req, res) => {
    try {
        const stats = {
            totalUploads: accessRecords.length,
            totalSize: accessRecords.reduce((sum, record) => sum + record.size, 0),
            lastUpload: accessRecords.length > 0 ? accessRecords[accessRecords.length - 1].timestamp : null,
            uniqueIPs: [...new Set(accessRecords.map(record => record.ip))].length
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('获取统计错误:', error);
        res.status(500).json({
            success: false,
            message: '获取统计信息时出错'
        });
    }
});

// 提供上传文件的静态访问
app.use('/uploads', express.static('uploads'));

// 错误处理中间件
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: '文件大小超过限制（最大10MB）'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        message: error.message
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '接口不存在'
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log(`📁 上传文件将保存到: ${uploadsDir}`);
    console.log(`📊 管理界面: http://localhost:${PORT}/admin.html`);
});
