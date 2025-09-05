
// bot.js
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Configurações
const config = {
    token: process.env.DISCORD_TOKEN,
    port: process.env.PORT || 3001,
    allowedUsers: process.env.ADMIN_USERS?.split(',') || [],
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    jwtSecret: process.env.JWT_SECRET || '25f9ccdb67836faffc3a99f7bcdb34d5',
    environment: process.env.NODE_ENV || 'development'
};

// Cliente Discord com intents básicos
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers // <--- Código CORRETO
    ]
});

// Express app para API
const app = express();

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' }
});

app.use(limiter);
app.use(cors({
  origin: config.environment === 'production'
    ? 'https://anuncisoverceljojos.vercel.app'
    : '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso necessário' });
    }

    jwt.verify(token, config.jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        }
        req.user = user;
        next();
    });
};

// Armazenamento de dados
let botData = {
    announcements: [],
    channels: [],
    templates: [],
    stats: {
        totalAnnouncements: 0,
        lastActivity: new Date().toISOString()
    }
};

// Carregar dados salvos
async function loadData() {
    try {
        const data = await fs.readFile('botData.json', 'utf8');
        const loadedData = JSON.parse(data);
        botData = { ...botData, ...loadedData };
        console.log('✅ Dados carregados com sucesso');
    } catch (error) {
        console.log('⚠️ Arquivo de dados não encontrado, criando novo arquivo');
        await saveData();
    }
}

// Salvar dados
async function saveData() {
    try {
        await fs.writeFile('botData.json', JSON.stringify(botData, null, 2));
    } catch (error) {
        console.error('❌ Erro ao salvar dados:', error);
    }
}

// Backup automático dos dados
setInterval(async () => {
    await saveData();
}, 5 * 60 * 1000); // Backup a cada 5 minutos

// Eventos do Discord Bot
client.once('ready', async () => {
    console.log(`🤖 Bot conectado como ${client.user.tag}`);
    console.log(`📊 Conectado a ${client.guilds.cache.size} servidores`);
    
    await loadData();
    
    // Coletar canais disponíveis
    botData.channels = [];
    client.guilds.cache.forEach(guild => {
        console.log(`📋 Coletando canais do servidor: ${guild.name}`);
        guild.channels.cache.forEach(channel => {
            if (channel.type === 0) { // Canal de texto
                botData.channels.push({
                    id: channel.id,
                    name: channel.name,
                    guild: guild.name,
                    guildId: guild.id,
                    category: channel.parent?.name || 'Sem categoria'
                });
            }
        });
    });
    
    console.log(`📊 ${botData.channels.length} canais coletados`);
    await saveData();
    
    // Definir status do bot
    client.user.setActivity('Gerenciando anúncios 📢', { type: 'WATCHING' });
});

client.on('guildCreate', async (guild) => {
    console.log(`➕ Bot adicionado ao servidor: ${guild.name}`);
    await loadChannels();
});

client.on('channelCreate', async (channel) => {
    if (channel.type === 0) {
        console.log(`📢 Novo canal criado: #${channel.name}`);
        await loadChannels();
    }
});

client.on('channelDelete', async (channel) => {
    if (channel.type === 0) {
        console.log(`🗑️ Canal removido: #${channel.name}`);
        await loadChannels();
    }
});

async function loadChannels() {
    botData.channels = [];
    client.guilds.cache.forEach(guild => {
        guild.channels.cache.forEach(channel => {
            if (channel.type === 0) {
                botData.channels.push({
                    id: channel.id,
                    name: channel.name,
                    guild: guild.name,
                    guildId: guild.id,
                    category: channel.parent?.name || 'Sem categoria'
                });
            }
        });
    });
    await saveData();
}

// Comando básico sem dependência do MessageContent intent
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Comando simplificado - funciona mesmo sem MessageContent intent em alguns casos
    try {
        if (message.content && message.content.startsWith('!ping')) {
            message.reply('🏓 Pong! Bot está funcionando!');
        }
        
        if (message.content && message.content.startsWith('!status')) {
            const embed = new EmbedBuilder()
                .setTitle('📊 Status do Bot')
                .setColor('#5865f2')
                .addFields(
                    { name: '🔧 Status', value: 'Online', inline: true },
                    { name: '📺 Canais', value: botData.channels.length.toString(), inline: true },
                    { name: '📢 Anúncios', value: botData.stats.totalAnnouncements.toString(), inline: true },
                    { name: '🏛️ Servidores', value: client.guilds.cache.size.toString(), inline: true }
                )
                .setTimestamp();
            
            message.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.log('⚠️ Comando pode não funcionar sem privileged intents habilitados');
    }
});

// Tratamento de erros do Discord
client.on('error', error => {
    console.error('❌ Erro do cliente Discord:', error);
});

client.on('warn', warn => {
    console.warn('⚠️ Aviso do Discord:', warn);
});

client.on('shardError', error => {
    console.error('❌ Erro de shard:', error);
});

// Função melhorada para enviar anúncios
async function sendAnnouncement(channelId, content, authorId = null, authorTag = 'Sistema') {
    try {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            return { success: false, error: 'Canal não encontrado' };
        }
        
        // Verificar se é canal de texto
        if (channel.type !== 0) {
            return { success: false, error: 'Canal deve ser de texto' };
        }
        
        // Verificar permissões do bot no canal
        if (!channel.permissionsFor(client.user).has([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks
        ])) {
            return { success: false, error: 'Bot não tem permissões necessárias neste canal' };
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📢 Anúncio')
            .setDescription(content)
            .setColor('#5865f2')
            .setTimestamp()
            .setFooter({ 
                text: `Sistema de Anúncios • Por ${authorTag}`,
                iconURL: client.user.displayAvatarURL()
            });
        
        await channel.send({ embeds: [embed] });
        
        // Salvar no histórico
        const announcement = {
            id: Date.now(),
            channelId,
            channelName: channel.name,
            guildName: channel.guild.name,
            content,
            authorId,
            authorTag,
            timestamp: new Date().toISOString()
        };
        
        botData.announcements.unshift(announcement);
        botData.stats.totalAnnouncements++;
        botData.stats.lastActivity = new Date().toISOString();
        
        // Manter apenas os últimos 100 anúncios
        if (botData.announcements.length > 100) {
            botData.announcements = botData.announcements.slice(0, 100);
        }
        
        await saveData();
        
        console.log(`📢 Anúncio enviado para #${channel.name} (${channel.guild.name}) por ${authorTag}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Erro ao enviar anúncio:', error);
        return { success: false, error: error.message };
    }
}

// Rotas da API

// Rota de login
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ error: 'Senha é obrigatória' });
    }
    
    if (password === config.adminPassword) {
        const token = jwt.sign(
            { admin: true, loginTime: new Date().toISOString() },
            config.jwtSecret,
            { expiresIn: '24h' }
        );
        
        console.log('🔑 Login realizado com sucesso');
        
        res.json({ 
            success: true, 
            token,
            message: 'Login realizado com sucesso!' 
        });
    } else {
        console.log('🔒 Tentativa de login falhada');
        res.status(401).json({ error: 'Senha incorreta' });
    }
});

// Verificar se está autenticado
app.get('/api/verify', authenticateToken, (req, res) => {
    res.json({ authenticated: true, user: req.user });
});

// Rotas protegidas
app.get('/api/channels', authenticateToken, (req, res) => {
    const channelsGrouped = botData.channels.reduce((groups, channel) => {
        const guild = channel.guild;
        if (!groups[guild]) {
            groups[guild] = [];
        }
        groups[guild].push(channel);
        return groups;
    }, {});
    
    res.json({
        channels: botData.channels,
        channelsGrouped,
        total: botData.channels.length,
        lastUpdate: new Date().toISOString()
    });
});

app.get('/api/announcements', authenticateToken, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const paginatedAnnouncements = botData.announcements.slice(offset, offset + limit);
    
    res.json({
        announcements: paginatedAnnouncements,
        pagination: {
            page,
            limit,
            total: botData.announcements.length,
            totalPages: Math.ceil(botData.announcements.length / limit)
        }
    });
});

app.get('/api/templates', authenticateToken, (req, res) => {
    res.json(botData.templates);
});

app.get('/api/stats', authenticateToken, (req, res) => {
    res.json({
        ...botData.stats,
        botOnline: client.readyTimestamp ? true : false,
        guilds: client.guilds.cache.size,
        channels: botData.channels.length,
        templates: botData.templates.length,
        botUser: client.user ? client.user.tag : 'Offline',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    });
});

// Endpoint para listar cargos (roles) - Mude para authenticateToken
app.get('/api/roles', authenticateToken, async (req, res) => {
    try {
        const guild = client.guilds.cache.first(); // ou o guild específico
        if (!guild) {
            return res.status(404).json({ error: 'Servidor não encontrado' });
        }
        const roles = guild.roles.cache
            .filter(role => role.name !== '@everyone')
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.color,
                hoist: role.hoist
            }));
        res.json({ success: true, roles });
    } catch (error) {
        console.error('❌ Erro ao buscar cargos:', error);
        res.status(500).json({ error: 'Erro interno ao buscar cargos.' });
    }
});

// Endpoint para listar categorias - Mude para authenticateToken
app.get('/api/categories', authenticateToken, async (req, res) => {
    try {
        const guild = client.guilds.cache.first(); // ou o guild específico
        if (!guild) {
            return res.status(404).json({ error: 'Servidor não encontrado' });
        }
        const categories = guild.channels.cache
            .filter(channel => channel.type === 4) // Canal de Categoria
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                position: channel.position
            }));
        res.json({ success: true, categories });
    } catch (error) {
        console.error('❌ Erro ao buscar categorias:', error);
        res.status(500).json({ error: 'Erro interno ao buscar categorias.' });
    }
});

// Endpoint para criar um canal - Mude para authenticateToken
app.post('/api/create-channel', express.json(), authenticateToken, async (req, res) => {
    try {
        const guild = client.guilds.cache.first(); // ou guild específico
        if (!guild) {
            return res.status(404).json({ error: 'Servidor não encontrado' });
        }
        const { name, categoryId, type } = req.body; // Adicione type se necessário
        if (!name) {
            return res.status(400).json({ error: 'Nome do canal é obrigatório' });
        }
        const newChannel = await guild.channels.create({
            name,
            type: type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
            parent: categoryId || null
        });
        res.json({ success: true, channelId: newChannel.id });
    } catch (error) {
        console.error('Erro ao criar canal:', error);
        res.status(500).json({ error: 'Erro interno ao criar canal' });
    }
});

app.post('/api/announcement', authenticateToken, async (req, res) => {
    const { channelId, content } = req.body;
    
    if (!channelId || !content) {
        return res.status(400).json({ error: 'Canal e conteúdo são obrigatórios' });
    }
    
    if (content.length > 2000) {
        return res.status(400).json({ error: 'Mensagem muito longa (máximo 2000 caracteres)' });
    }
    
    if (!client.readyTimestamp) {
        return res.status(503).json({ error: 'Bot Discord não está conectado' });
    }
    
    const result = await sendAnnouncement(channelId, content, 'web-panel', 'Painel Web');
    
    if (result.success) {
        res.json({ success: true, message: 'Anúncio enviado com sucesso!' });
    } else {
        res.status(500).json({ error: result.error });
    }
});

app.post('/api/template', authenticateToken, async (req, res) => {
    const { name, content, category } = req.body;
    
    if (!name || !content) {
        return res.status(400).json({ error: 'Nome e conteúdo são obrigatórios' });
    }
    
    // Verificar se já existe template com esse nome
    const existingTemplate = botData.templates.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existingTemplate) {
        return res.status(400).json({ error: 'Já existe um template com esse nome' });
    }
    
    const newTemplate = {
        id: Date.now(),
        name: name.trim(),
        content: content.trim(),
        category: category || 'Geral',
        createdAt: new Date().toISOString(),
        usageCount: 0
    };
    
    botData.templates.push(newTemplate);
    await saveData();
    
    res.json({ success: true, message: 'Template salvo com sucesso!', template: newTemplate });
});

app.put('/api/template/:id', authenticateToken, async (req, res) => {
    const templateId = parseInt(req.params.id);
    const { name, content, category } = req.body;
    
    const templateIndex = botData.templates.findIndex(t => t.id === templateId);
    if (templateIndex === -1) {
        return res.status(404).json({ error: 'Template não encontrado' });
    }
    
    botData.templates[templateIndex] = {
        ...botData.templates[templateIndex],
        name: name.trim(),
        content: content.trim(),
        category: category || 'Geral',
        updatedAt: new Date().toISOString()
    };
    
    await saveData();
    res.json({ success: true, message: 'Template atualizado com sucesso!' });
});

app.delete('/api/template/:id', authenticateToken, async (req, res) => {
    const templateId = parseInt(req.params.id);
    const templateIndex = botData.templates.findIndex(t => t.id === templateId);
    
    if (templateIndex === -1) {
        return res.status(404).json({ error: 'Template não encontrado' });
    }
    
    botData.templates.splice(templateIndex, 1);
    await saveData();
    
    res.json({ success: true, message: 'Template removido com sucesso!' });
});

// Endpoint de refresh dos canais
app.post('/api/refresh-channels', authenticateToken, async (req, res) => {
    try {
        await loadChannels();
        res.json({ 
            success: true, 
            message: 'Canais atualizados com sucesso!',
            channels: botData.channels.length 
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar canais' });
    }
});

// Endpoint de status público
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'connecting...',
        botOnline: client.readyTimestamp ? true : false,
        uptime: process.uptime(),
        guilds: client.guilds.cache.size,
        channels: botData.channels.length,
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        bot_online: client.readyTimestamp ? true : false,
        bot_user: client.user ? client.user.tag : 'Connecting',
        guilds: client.guilds.cache.size,
        channels: botData.channels.length,
        announcements_sent: botData.stats.totalAnnouncements,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: config.environment
    });
});

// Middleware de erro
app.use((error, req, res, next) => {
    console.error('❌ Erro na API:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Keep alive para Render
if (config.environment === 'production') {
    setInterval(() => {
        const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
        fetch(`https://${hostname}/api/health`)
            .then(res => console.log(`💓 Keep alive: ${res.status}`))
            .catch(err => console.log('⚠️ Keep alive error:', err.message));
    }, 14 * 60 * 1000); // 14 minutos
}

// Iniciar servidor
const server = app.listen(config.port, () => {
    console.log(`🚀 Servidor rodando na porta ${config.port}`);
    console.log(`🔐 Senha de admin: ${config.adminPassword}`);
    console.log(`🌐 Ambiente: ${config.environment}`);
    
    if (config.environment === 'development') {
        console.log(`📱 Painel: http://localhost:${config.port}`);
        console.log(`🔍 Status: http://localhost:${config.port}/api/health`);
    }
});

// Iniciar bot Discord com melhor tratamento de erros
if (config.token) {
    console.log('🔄 Iniciando bot Discord...');
    
    client.login(config.token)
        .then(() => {
            console.log('✅ Bot Discord conectado com sucesso');
        })
        .catch(error => {
            console.error('❌ Erro ao conectar bot Discord:', error.message);
            
            if (error.message.includes('disallowed intents')) {
                console.log('');
                console.log('🔧 SOLUÇÃO PARA INTENTS:');
                console.log('1. Vá para: https://discord.com/developers/applications');
                console.log('2. Selecione sua aplicação');
                console.log('3. Vá na aba "Bot"');
                console.log('4. Na seção "Privileged Gateway Intents", habilite:');
                console.log('   • Message Content Intent (se quiser comandos)');
                console.log('   • Server Members Intent (opcional)');
                console.log('5. Salve as alterações');
                console.log('6. Reinicie o bot');
                console.log('');
                console.log('⚠️  O painel web continuará funcionando mesmo com o bot offline!');
            }
            
            // Não encerrar o processo - deixar o servidor web rodar
            console.log('🌐 Servidor web continua rodando para o painel administrativo');
        });
} else {
    console.error('❌ DISCORD_TOKEN não configurado!');
    console.log('🌐 Servidor web funcionando apenas no modo painel (sem bot Discord)');
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🔄 Encerrando aplicação...');
    await saveData();
    if (client.readyTimestamp) {
        client.destroy();
    }
    server.close(() => {
        console.log('👋 Aplicação encerrada');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('🔄 Recebido SIGTERM, fazendo shutdown graceful...');
    await saveData();
    if (client.readyTimestamp) {
        client.destroy();
    }
    server.close(() => {
        process.exit(0);
    });
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

module.exports = { app, client };
