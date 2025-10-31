const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务 - 服务根目录的所有文件
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// 创建上传目录
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer配置
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        cb(null, `photo-${timestamp}-${random}.jpg`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传图片文件！'), false);
        }
    }
});

// 内存存储访问记录
let accessRecords = [];

// 路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API状态检查
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: '摄像头系统API运行正常',
        environment: process.env.NODE_ENV || 'development',
        serverTime: new Date().toISOString(),
        totalUploads: accessRecords.length
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
            ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString(),
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            url: `/uploads/${req.file.filename}`
        };

        // 添加到访问记录
        accessRecords.push(clientInfo);

        console.log('📸 收到新图片上传:', {
            filename: clientInfo.filename,
            size: clientInfo.size,
            ip: clientInfo.ip
        });

        res.json({
            success: true,
            message: '图片上传成功',
            data: clientInfo
        });

    } catch (error) {
        console.error('上传错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器处理图片时出错: ' + error.message
        });
    }
});

// 获取上传记录
app.get('/api/records', (req, res) => {
    try {
        const recentRecords = accessRecords
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 100);

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
            uniqueIPs: [...new Set(accessRecords.map(record => record.ip))].length,
            serverUptime: process.uptime()
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

// 删除图片接口
app.delete('/api/records/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(uploadsDir, filename);

        // 从记录中移除
        accessRecords = accessRecords.filter(record => record.filename !== filename);

        // 删除文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({
            success: true,
            message: '删除成功'
        });
    } catch (error) {
        console.error('删除错误:', error);
        res.status(500).json({
            success: false,
            message: '删除文件时出错'
        });
    }
});

// 错误处理
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: '文件大小超过限制（最大5MB）'
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
    console.log(`📁 上传目录: ${uploadsDir}`);
    console.log(`📊 管理界面: http://localhost:${PORT}/admin`);
    console.log(`⏰ 启动时间: ${new Date().toLocaleString()}`);
});
