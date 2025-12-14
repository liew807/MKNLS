require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL 连接
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 超级管理员密钥
const SUPER_ADMIN_KEY = 'Liew1201@';

// =================================================================
// 数据库修复函数 - 确保表结构完整
// =================================================================
async function fixMissingColumns() {
    try {
        console.log('🔍 检查数据库表结构...');
        
        // 定义需要检查的字段
        const columnsToCheck = [
            { name: 'is_password_card', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'is_telegram_generated', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'kuaishou_code', type: 'VARCHAR(100) DEFAULT NULL' },
            { name: 'applied_via', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'original_key', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'copied_times', type: 'INTEGER DEFAULT 0' }
        ];
        
        for (const column of columnsToCheck) {
            try {
                const checkResult = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='access_keys' AND column_name='${column.name}'
                `);
                
                if (checkResult.rows.length === 0) {
                    console.log(`   ➕ 添加缺失字段: ${column.name}`);
                    await pool.query(`
                        ALTER TABLE access_keys 
                        ADD COLUMN ${column.name} ${column.type}
                    `);
                    console.log(`   ✅ ${column.name} 字段已添加`);
                } else {
                    console.log(`   ✅ ${column.name} 字段已存在`);
                }
            } catch (error) {
                console.error(`   ❌ 检查/添加 ${column.name} 字段失败:`, error.message);
            }
        }
        
        console.log('✅ 数据库表结构检查完成');
    } catch (error) {
        console.error('❌ 数据库表结构修复失败:', error);
    }
}

// =================================================================
// 数据库初始化
// =================================================================
async function initDatabase() {
    try {
        console.log('🔄 初始化数据库表...');
        
        // 创建访问密钥表（基础结构）
        await pool.query(`
            CREATE TABLE IF NOT EXISTS access_keys (
                id SERIAL PRIMARY KEY,
                key VARCHAR(50) UNIQUE NOT NULL,
                remark TEXT,
                expiry_time TIMESTAMP NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                is_admin BOOLEAN DEFAULT FALSE,
                is_super_admin BOOLEAN DEFAULT FALSE,
                is_test_card BOOLEAN DEFAULT FALSE,
                duration_hours INTEGER DEFAULT 24,
                max_bind INTEGER DEFAULT 3,
                bound_emails TEXT[] DEFAULT '{}',
                added_by VARCHAR(100),
                added_by_name VARCHAR(100),
                added_by_email VARCHAR(100),
                card_type VARCHAR(50) DEFAULT 'FULL',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                activation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                bound_accounts JSONB DEFAULT '[]',
                telegram_user JSONB DEFAULT NULL,
                application_info JSONB DEFAULT NULL
            )
        `);
        
        console.log('✅ 基础表结构创建完成');
        
        // 修复缺失字段
        await fixMissingColumns();
        
        // 创建操作日志表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS operation_logs (
                id SERIAL PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                user_email VARCHAR(100) NOT NULL,
                key_used VARCHAR(50),
                details TEXT,
                log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 创建管理员操作记录表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_operations (
                id SERIAL PRIMARY KEY,
                admin_email VARCHAR(100) NOT NULL,
                admin_name VARCHAR(100) NOT NULL,
                operation_type VARCHAR(50) NOT NULL,
                target_key VARCHAR(50),
                target_admin VARCHAR(100),
                details TEXT,
                ip_address VARCHAR(50),
                user_agent TEXT,
                operation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ 所有数据库表初始化完成');
        
        // 检查是否已有超级管理员密钥
        const superAdminCheck = await pool.query(
            'SELECT * FROM access_keys WHERE key = $1', 
            [SUPER_ADMIN_KEY]
        );
        
        if (superAdminCheck.rows.length === 0) {
            const expiryTime = new Date();
            expiryTime.setFullYear(expiryTime.getFullYear() + 10);
            
            await pool.query(`
                INSERT INTO access_keys (
                    key, remark, expiry_time, status, is_admin, is_super_admin,
                    is_test_card, is_password_card, duration_hours, max_bind,
                    added_by, added_by_name, added_by_email, card_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [
                SUPER_ADMIN_KEY,
                '系统超级管理员密钥',
                expiryTime.toISOString(),
                'active',
                true,
                true,
                false,
                false,
                24 * 365 * 10,
                999,
                'system',
                '系统管理员',
                'admin@mknls.com',
                'DIAMOND'
            ]);
            
            console.log('✅ 超级管理员密钥已创建');
        } else {
            console.log('✅ 超级管理员密钥已存在');
        }

    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
    }
}

// =================================================================
// 数据库操作函数
// =================================================================

async function getAllAccessKeys() {
    const result = await pool.query('SELECT * FROM access_keys ORDER BY created_at DESC');
    return result.rows;
}

async function getAccessKey(key) {
    const result = await pool.query('SELECT * FROM access_keys WHERE key = $1', [key]);
    const row = result.rows[0];
    
    // 确保所有字段都有默认值
    if (row) {
        // 处理可能不存在的字段
        row.is_password_card = row.is_password_card || false;
        row.is_telegram_generated = row.is_telegram_generated || false;
        row.kuaishou_code = row.kuaishou_code || null;
        row.applied_via = row.applied_via || null;
        row.original_key = row.original_key || null;
        row.copied_times = row.copied_times || 0;
    }
    
    return row;
}

async function createAccessKey(keyData) {
    // 确保所有字段都有值
    const fullKeyData = {
        key: keyData.key,
        remark: keyData.remark || '无',
        expiryTime: keyData.expiryTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: keyData.status || 'active',
        isAdmin: keyData.isAdmin || false,
        isSuperAdmin: keyData.isSuperAdmin || false,
        isTestCard: keyData.isTestCard || false,
        isPasswordCard: keyData.isPasswordCard || false,
        durationHours: keyData.durationHours || 24,
        maxBind: keyData.maxBind || 3,
        boundEmails: keyData.boundEmails || [],
        addedBy: keyData.addedBy || 'unknown',
        addedByName: keyData.addedByName || '未知',
        addedByEmail: keyData.addedByEmail || 'unknown@mknls.com',
        cardType: keyData.cardType || 'FULL',
        boundAccounts: keyData.boundAccounts || [],
        activationTime: keyData.activationTime || new Date().toISOString(),
        originalKey: keyData.originalKey || null,
        copiedTimes: keyData.copiedTimes || 0,
        isTelegramGenerated: keyData.isTelegramGenerated || false,
        kuaishouCode: keyData.kuaishouCode || null,
        appliedVia: keyData.appliedVia || null
    };
    
    // 构建查询字段和值
    const fields = [
        'key', 'remark', 'expiry_time', 'status', 'is_admin', 'is_super_admin',
        'is_test_card', 'is_password_card', 'duration_hours', 'max_bind',
        'added_by', 'added_by_name', 'added_by_email', 'card_type',
        'bound_emails', 'bound_accounts', 'activation_time',
        'original_key', 'copied_times', 'is_telegram_generated',
        'kuaishou_code', 'applied_via', 'created_at'
    ];
    
    const values = [
        fullKeyData.key,
        fullKeyData.remark,
        fullKeyData.expiryTime,
        fullKeyData.status,
        fullKeyData.isAdmin,
        fullKeyData.isSuperAdmin,
        fullKeyData.isTestCard,
        fullKeyData.isPasswordCard,
        fullKeyData.durationHours,
        fullKeyData.maxBind,
        fullKeyData.addedBy,
        fullKeyData.addedByName,
        fullKeyData.addedByEmail,
        fullKeyData.cardType,
        fullKeyData.boundEmails,
        JSON.stringify(fullKeyData.boundAccounts),
        fullKeyData.activationTime,
        fullKeyData.originalKey,
        fullKeyData.copiedTimes,
        fullKeyData.isTelegramGenerated,
        fullKeyData.kuaishouCode,
        fullKeyData.appliedVia,
        new Date().toISOString()
    ];
    
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const query = `
        INSERT INTO access_keys (${fields.join(', ')})
        VALUES (${placeholders})
        RETURNING *
    `;
    
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function updateAccessKey(key, updates) {
    // 构建更新字段
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [field, value] of Object.entries(updates)) {
        let dbField;
        let dbValue = value;
        
        switch (field) {
            case 'boundAccounts':
                dbField = 'bound_accounts';
                dbValue = JSON.stringify(value);
                break;
            case 'boundEmails':
                dbField = 'bound_emails';
                dbValue = JSON.stringify(value);
                break;
            case 'expiryTime':
                dbField = 'expiry_time';
                break;
            case 'durationHours':
                dbField = 'duration_hours';
                break;
            case 'maxBind':
                dbField = 'max_bind';
                break;
            case 'isTestCard':
                dbField = 'is_test_card';
                break;
            case 'isPasswordCard':
                dbField = 'is_password_card';
                break;
            case 'cardType':
                dbField = 'card_type';
                break;
            case 'isAdmin':
                dbField = 'is_admin';
                break;
            case 'isSuperAdmin':
                dbField = 'is_super_admin';
                break;
            case 'activationTime':
                dbField = 'activation_time';
                break;
            case 'originalKey':
                dbField = 'original_key';
                break;
            case 'copiedTimes':
                dbField = 'copied_times';
                break;
            case 'isTelegramGenerated':
                dbField = 'is_telegram_generated';
                break;
            case 'kuaishouCode':
                dbField = 'kuaishou_code';
                break;
            case 'appliedVia':
                dbField = 'applied_via';
                break;
            default:
                // 自动转换驼峰为下划线
                dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        }
        
        fields.push(`${dbField} = $${paramCount}`);
        values.push(dbValue);
        paramCount++;
    }

    values.push(key);
    
    const query = `UPDATE access_keys SET ${fields.join(', ')} WHERE key = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function deleteAccessKey(key) {
    const result = await pool.query('DELETE FROM access_keys WHERE key = $1 RETURNING *', [key]);
    return result.rows[0];
}

async function addOperationLog(action, user, key, details = '') {
    const query = `
        INSERT INTO operation_logs (action, user_email, key_used, details)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `;
    
    const result = await pool.query(query, [action, user, key, details]);
    return result.rows[0];
}

async function cleanupExpiredKeys() {
    const result = await pool.query(
        'DELETE FROM access_keys WHERE expiry_time < NOW() RETURNING *'
    );
    return result.rows;
}

// 格式化秘钥数据 - 确保所有字段都有默认值
function formatKeyData(keyData) {
    return {
        key: keyData.key,
        isActivated: keyData.status === 'active',
        expiryTime: keyData.expiry_time,
        boundEmails: keyData.bound_emails || [],
        maxBind: keyData.max_bind || 3,
        isTestCard: keyData.is_test_card || false,
        isPasswordCard: keyData.is_password_card || false,
        remark: keyData.remark || '无',
        addedByName: keyData.added_by_name || '未知',
        telegramUser: keyData.telegram_user,
        applicationInfo: keyData.application_info,
        boundAccounts: keyData.bound_accounts || [],
        durationHours: keyData.duration_hours,
        cardType: keyData.card_type,
        isAdmin: keyData.is_admin,
        isSuperAdmin: keyData.is_super_admin,
        activationTime: keyData.activation_time,
        addedBy: keyData.added_by,
        originalKey: keyData.original_key || null,
        copiedTimes: keyData.copied_times || 0,
        isTelegramGenerated: keyData.is_telegram_generated || false,
        kuaishouCode: keyData.kuaishou_code || null,
        appliedVia: keyData.applied_via || null,
        createdAt: keyData.created_at,
        status: keyData.status
    };
}

// 密钥生成函数
function generateAccessKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 15; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// =================================================================
// API 接口
// =================================================================

// 1. 检查秘钥接口 - 修复版
app.post('/api/check-key', async (req, res) => {
    try {
        const { key, email } = req.body;

        console.log('检查秘钥请求:', { key: key ? '有秘钥' : '无秘钥', email });

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 请输入秘钥"
            });
        }

        // 检查是否是超级管理员秘钥
        if (key === SUPER_ADMIN_KEY) {
            await addOperationLog('super_admin_login', 'super_admin', key, '超级管理员登录');

            return res.json({
                success: true,
                message: "超级管理员登录成功",
                isAdmin: true,
                isSuperAdmin: true,
                needsChoice: true,
                isTestCard: false,
                isPasswordCard: false
            });
        }

        // 检查普通秘钥
        const keyData = await getAccessKey(key);
        
        if (!keyData) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥不存在');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥不存在"
            });
        }
        
        if (keyData.status !== 'active') {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥未激活');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥未激活"
            });
        }
        
        if (new Date(keyData.expiry_time) < new Date()) {
            await updateAccessKey(key, { status: 'expired' });
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 秘钥已过期');
            return res.status(400).json({
                success: false,
                message: "验证失败: 秘钥已过期"
            });
        }

        // 检查绑定状态
        const boundEmails = keyData.bound_emails || [];
        const isEmailBound = email && boundEmails.includes(email);
        const bindCount = boundEmails.length;
        const maxBind = keyData.max_bind || 3;
        const remainingBinds = Math.max(0, maxBind - bindCount);

        console.log('秘钥状态:', {
            key,
            isAdmin: keyData.is_admin,
            isTestCard: keyData.is_test_card,
            isPasswordCard: keyData.is_password_card,
            boundCount: bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            expiry: keyData.expiry_time
        });

        // 如果是管理员秘钥
        if (keyData.is_admin) {
            await addOperationLog('admin_login', keyData.added_by || 'admin', key, '管理员登录');

            return res.json({
                success: true,
                message: "管理员登录成功",
                isAdmin: true,
                isSuperAdmin: keyData.is_super_admin || false,
                needsChoice: true,
                isTestCard: keyData.is_test_card || false,
                isPasswordCard: keyData.is_password_card || false
            });
        }

        // 检查是否测试卡或改密卡
        const isTestCard = keyData.is_test_card || false;
        const isPasswordCard = keyData.is_password_card || false;

        // 普通用户秘钥 - 检查绑定限制
        if (remainingBinds <= 0 && !isEmailBound) {
            await addOperationLog('key_verification', email || 'unknown', key, '验证失败: 绑定已满');
            return res.status(400).json({
                success: false,
                message: "该秘钥绑定数量已达上限",
                bindCount,
                maxBind,
                remainingBinds: 0,
                isEmailBound: false,
                isTestCard,
                isPasswordCard
            });
        }

        await addOperationLog('key_verification', email || 'unknown', key, '秘钥验证成功');

        res.json({
            success: true,
            message: "秘钥验证成功",
            expiryTime: keyData.expiry_time,
            isAdmin: false,
            isTestCard: isTestCard,
            isPasswordCard: isPasswordCard,
            bindCount,
            maxBind,
            remainingBinds,
            isEmailBound,
            durationHours: keyData.duration_hours,
            cardType: keyData.card_type
        });

    } catch (error) {
        console.error('检查秘钥错误:', error);
        await addOperationLog('key_verification', 'unknown', 'unknown', '验证失败: 服务器错误');
        res.status(400).json({
            success: false,
            message: "验证失败: 服务器错误"
        });
    }
});

// 2. 管理员添加秘钥接口 - 修复版
app.post('/api/admin/keys', async (req, res) => {
    try {
        const adminKey = req.query.key;
        const { durationHours, maxBind, remark, isTestCard, isPasswordCard } = req.body;

        console.log('生成秘钥请求:', { adminKey, durationHours, maxBind, remark, isTestCard, isPasswordCard });

        if (!adminKey) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        let isSuperAdmin = false;
        let adminInfo = null;

        if (adminKey === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY, 
                email: 'super_admin@mknls.com' 
            };
        } else {
            const keyData = await getAccessKey(adminKey);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        // 普通管理员只能生成测试卡和改密卡
        if (!isSuperAdmin) {
            // 如果既不是测试卡也不是改密卡，则不允许生成
            if (!isTestCard && !isPasswordCard) {
                return res.status(403).json({
                    success: false,
                    message: "普通管理员只能生成测试卡和改密卡"
                });
            }
        }

        // 生成新秘钥
        const newKey = generateAccessKey();
        const now = new Date();
        
        // 设置参数
        let actualDuration = 24;
        let actualMaxBind = 3;
        let actualCardType = 'FULL';
        let actualRemark = remark;
        
        if (isTestCard) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'TEST';
            actualRemark = actualRemark || '测试卡';
        } else if (isPasswordCard) {
            actualDuration = 1;
            actualMaxBind = 1;
            actualCardType = 'PASSWORD';
            actualRemark = actualRemark || '改密卡';
        } else {
            // 全功能卡
            actualDuration = durationHours || 24;
            actualMaxBind = maxBind || 3;
            actualCardType = 'FULL';
            actualRemark = actualRemark || '全功能卡';
            
            // 根据时长设置卡类型
            if (actualDuration >= 24 * 90) {
                actualCardType = 'DIAMOND';
            } else if (actualDuration >= 24 * 30) {
                actualCardType = 'PLATINUM';
            } else if (actualDuration >= 24 * 7) {
                actualCardType = 'GOLD';
            } else if (actualDuration >= 24 * 3) {
                actualCardType = 'SILVER';
            } else {
                actualCardType = 'BRONZE';
            }
        }
        
        const expiryTime = new Date(now);
        expiryTime.setHours(expiryTime.getHours() + actualDuration);

        // 创建秘钥数据 - 确保包含所有字段
        const keyData = {
            key: newKey,
            remark: actualRemark,
            expiryTime: expiryTime.toISOString(),
            status: 'active',
            isAdmin: false,
            isSuperAdmin: false,
            isTestCard: isTestCard || false,
            isPasswordCard: isPasswordCard || false,
            durationHours: actualDuration,
            maxBind: actualMaxBind,
            boundEmails: [],
            boundAccounts: [],
            addedBy: adminInfo.key,
            addedByName: adminInfo.name,
            addedByEmail: adminInfo.email,
            cardType: actualCardType,
            activationTime: now.toISOString(),
            originalKey: null,
            copiedTimes: 0,
            isTelegramGenerated: false,
            kuaishouCode: null,
            appliedVia: null
        };
        
        const createdKey = await createAccessKey(keyData);
        
        let cardName = '';
        if (isTestCard) {
            cardName = '测试卡';
        } else if (isPasswordCard) {
            cardName = '改密卡';
        } else {
            cardName = actualCardType + '卡';
        }
        
        await addOperationLog('generate_key', adminInfo.name, newKey, 
               `生成${cardName}成功：${actualRemark}`);
        
        // 记录管理员操作
        await addAdminOperation({
            adminEmail: adminInfo.email,
            adminName: adminInfo.name,
            operationType: 'generate_key',
            targetKey: newKey,
            targetAdmin: null,
            details: `生成秘钥: ${newKey}, 类型: ${cardName}, 时长: ${actualDuration}小时, 绑定: ${actualMaxBind}个`
        });

        res.json({
            success: true,
            key: newKey,
            message: `${cardName}生成成功`,
            cardInfo: {
                type: actualCardType,
                duration: actualDuration,
                maxBind: actualMaxBind,
                isTestCard: isTestCard,
                isPasswordCard: isPasswordCard
            }
        });

    } catch (error) {
        console.error('生成秘钥错误:', error);
        await addOperationLog('generate_key', 'unknown', 'unknown', `生成秘钥失败: ${error.message}`);
        res.status(400).json({
            success: false,
            message: "验证失败: " + error.message
        });
    }
});

// 3. 获取秘钥详情接口
app.get('/api/admin/key-details', async (req, res) => {
    try {
        const { key, targetKey } = req.query;

        if (!key || !targetKey) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥和目标秘钥"
            });
        }

        // 验证管理员权限
        if (key !== SUPER_ADMIN_KEY) {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
        }

        const keyData = await getAccessKey(targetKey);
        if (!keyData) {
            return res.status(404).json({
                success: false,
                message: "秘钥不存在"
            });
        }

        // 格式化详情数据
        const detailedData = formatKeyData(keyData);
        
        res.json({
            success: true,
            keyData: detailedData,
            message: "获取秘钥详情成功"
        });

    } catch (error) {
        console.error('获取秘钥详情错误:', error);
        res.status(400).json({
            success: false,
            message: "获取详情失败: " + error.message
        });
    }
});

// 4. 管理员获取分类秘钥列表
app.get('/api/admin/keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        let isSuperAdmin = false;
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            isSuperAdmin = true;
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY,
                email: 'super_admin@mknls.com'
            };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
            isSuperAdmin = keyData.is_super_admin || false;
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        // 获取所有秘钥
        const allKeys = await getAllAccessKeys();
        
        // 格式化所有秘钥数据
        const formattedKeys = allKeys.map(formatKeyData);
        
        // Telegram机器人生成的秘钥
        const tgKeys = formattedKeys.filter(k => k.isTelegramGenerated);
        
        // 超级管理人生成的秘钥
        const superAdminKeys = formattedKeys.filter(k => k.isSuperAdmin && k.addedBy === SUPER_ADMIN_KEY);
        
        // 普通管理人生成的秘钥（按管理员分组）
        const normalAdminKeys = formattedKeys.filter(k => k.isAdmin && !k.isSuperAdmin && !k.isTelegramGenerated);
        
        const normalAdmins = {};
        
        normalAdminKeys.forEach(keyData => {
            const adminKey = keyData.addedBy;
            if (!normalAdmins[adminKey]) {
                normalAdmins[adminKey] = {
                    adminKey: adminKey,
                    adminName: keyData.addedByName || '未知管理员',
                    keys: []
                };
            }
            normalAdmins[adminKey].keys.push(keyData);
        });

        await addOperationLog('fetch_keys', adminInfo.name, key, '获取分类秘钥列表成功');

        res.json({
            success: true,
            keys: {
                telegram: tgKeys,
                superAdmin: superAdminKeys,
                normalAdmins: normalAdmins
            },
            adminInfo: {
                name: adminInfo.name,
                key: adminInfo.key,
                isSuperAdmin: isSuperAdmin
            }
        });

    } catch (error) {
        console.error('获取秘钥列表错误:', error);
        await addOperationLog('fetch_keys', 'unknown', 'unknown', '获取秘钥列表失败');
        res.status(400).json({
            success: false,
            message: "验证失败: 服务器错误"
        });
    }
});

// 5. 管理员删除秘钥
app.delete('/api/admin/keys', async (req, res) => {
    try {
        const { key, keyToDelete } = req.query;

        if (!key || !keyToDelete) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥和目标秘钥"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY, 
                email: 'super_admin@mknls.com' 
            };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        const keyDataToDelete = await getAccessKey(keyToDelete);
        if (!keyDataToDelete) {
            return res.status(400).json({
                success: false,
                message: "要删除的秘钥不存在"
            });
        }

        // 检查删除权限（超级管理员可以删除任何秘钥，普通管理员只能删除自己生成的秘钥）
        if (key !== SUPER_ADMIN_KEY && keyDataToDelete.added_by !== adminInfo.key) {
            return res.status(403).json({
                success: false,
                message: "只能删除自己生成的秘钥"
            });
        }

        const deletedKey = await deleteAccessKey(keyToDelete);
        
        await addOperationLog('delete_key', adminInfo.name, keyToDelete, 
               `删除秘钥成功：${keyDataToDelete.remark || '无备注'}`);
        
        res.json({
            success: true,
            message: "秘钥删除成功",
            deletedKey: formatKeyData(deletedKey)
        });

    } catch (error) {
        console.error('删除秘钥错误:', error);
        await addOperationLog('delete_key', 'unknown', 'unknown', '删除秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败: " + error.message
        });
    }
});

// 6. 清理过期秘钥
app.post('/api/admin/cleanup-expired-keys', async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "验证失败: 需要提供管理员密钥"
            });
        }

        // 验证管理员权限
        let adminInfo = null;

        if (key === SUPER_ADMIN_KEY) {
            adminInfo = { 
                name: '超级管理员', 
                key: SUPER_ADMIN_KEY, 
                email: 'super_admin@mknls.com' 
            };
        } else {
            const keyData = await getAccessKey(key);
            if (!keyData || !keyData.is_admin) {
                return res.status(403).json({
                    success: false,
                    message: "验证失败: 非管理员密钥或无权限"
                });
            }
            adminInfo = { 
                name: keyData.added_by_name || '管理员', 
                key: keyData.added_by || 'unknown',
                email: keyData.added_by_email || 'unknown@mknls.com'
            };
        }

        const deletedKeys = await cleanupExpiredKeys();
        
        await addOperationLog('cleanup_keys', adminInfo.name, 'SYSTEM', 
               `清理过期秘钥成功，共删除 ${deletedKeys.length} 个`);
        
        res.json({
            success: true,
            message: `成功清理 ${deletedKeys.length} 个过期秘钥`,
            deletedCount: deletedKeys.length,
            deletedKeys: deletedKeys.map(formatKeyData)
        });

    } catch (error) {
        console.error('清理过期秘钥错误:', error);
        await addOperationLog('cleanup_keys', 'unknown', 'SYSTEM', '清理过期秘钥失败');
        res.status(400).json({
            success: false,
            message: "验证失败: " + error.message
        });
    }
});

// 7. 其他核心接口（简化版）
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, key } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "请提供邮箱和密码"
            });
        }

        // 验证Firebase账号
        const firebaseResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            }
        );

        const firebaseData = await firebaseResponse.json();

        if (!firebaseResponse.ok) {
            const errorMsg = firebaseData.error?.message || '登录失败';
            await addOperationLog('user_login', email, key || 'N/A', `登录失败: ${errorMsg}`);
            
            return res.status(400).json({
                success: false,
                message: errorMsg
            });
        }

        await addOperationLog('user_login', email, key || 'N/A', '用户登录成功');

        res.json({
            success: true,
            data: {
                email: firebaseData.email,
                userId: firebaseData.localId,
                idToken: firebaseData.idToken,
                role: 'user',
                expiresIn: firebaseData.expiresIn
            },
            message: "登录成功"
        });

    } catch (error) {
        console.error('登录接口错误:', error);
        await addOperationLog('user_login', 'unknown', 'N/A', '登录接口错误');
        res.status(400).json({
            success: false,
            message: "登录失败"
        });
    }
});

// 8. 健康检查接口
app.get('/api/health', async (req, res) => {
    try {
        const keysCount = await pool.query('SELECT COUNT(*) FROM access_keys');
        const logsCount = await pool.query('SELECT COUNT(*) FROM operation_logs');
        
        res.json({ 
            status: 'ok', 
            message: 'MKNLS 后端服务运行正常',
            database: 'connected',
            accessKeys: parseInt(keysCount.rows[0].count),
            operationLogs: parseInt(logsCount.rows[0].count),
            superAdminKey: SUPER_ADMIN_KEY,
            features: [
                '支持测试卡和改密卡',
                '分类秘钥管理',
                '管理员操作记录',
                '详情查看功能',
                '自动数据库修复'
            ]
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: '数据库连接失败: ' + error.message
        });
    }
});

// 启动服务
app.listen(PORT, async () => {
    console.log(`🚀 MKNLS 后端服务启动中，端口：${PORT}`);
    console.log('🔍 正在初始化数据库...');
    
    try {
        await initDatabase();
        console.log('✅ 数据库初始化完成');
        console.log('✅ 环境变量验证通过');
        console.log('✅ 数据库连接成功');
        console.log('🎯 已修复功能：');
        console.log('   • 自动检测和修复缺失数据库字段');
        console.log('   • 支持测试卡和改密卡');
        console.log('   • 分类秘钥管理');
        console.log('   • 详情查看功能');
        console.log('🔑 超级管理员密钥:', SUPER_ADMIN_KEY);
        console.log('🎯 服务已就绪，等待请求...');
    } catch (error) {
        console.error('❌ 服务启动失败:', error);
        process.exit(1);
    }
});
