/**
 * ============================================================================
 * NEXA SENAI - SERVIDOR WEB E API REST
 * Desenvolvido em JavaScript (Node.js + Express) para TCC de Curso Técnico SENAI.
 * ============================================================================
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Garante que o diretório de uploads exista
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configuração do Multer para upload seguro de fotos e currículos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Middlewares essenciais
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('nexa-senai-chave-secreta-tcc-2024'));

// Servir arquivos estáticos (HTML, CSS, JS, Imagens, Uploads)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de Autenticação baseado em Cookie seguro
app.use((req, res, next) => {
  const userId = req.cookies.nexa_user_id;
  if (userId) {
    req.user = db.getUserById(parseInt(userId, 10));
  } else {
    req.user = null;
  }
  next();
});

// Helper de proteção de rotas
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
    }
    return res.redirect('/login');
  }
  next();
}

// -----------------------------------------------------------------------------
// ROTAS DE API: AUTENTICAÇÃO
// -----------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { login_type, identifier, password, cnpj, access_code, email } = req.body;

  try {
    let user = null;

    if (login_type === 'aluno') {
      const term = (identifier || '').trim();
      // Pode buscar por CPF ou por Email institucional
      user = db.getUserByCpf(term) || db.getUserByEmail(term);

      if (!user || user.role !== 'aluno') {
        return res.status(401).json({ success: false, message: 'CPF ou e-mail de aluno não encontrado.' });
      }

      if (!db.verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ success: false, message: 'Senha incorreta.' });
      }
    } else if (login_type === 'empresa') {
      const company = db.getCompanyByCnpj(cnpj);
      if (!company) {
        return res.status(401).json({ success: false, message: 'Empresa com este CNPJ não encontrada.' });
      }

      if (company.is_blocked) {
        return res.status(403).json({ success: false, message: 'Acesso desta empresa está temporariamente bloqueado pela administração SENAI.' });
      }

      if (!company.is_authorized) {
        return res.status(403).json({ success: false, message: 'Empresa ainda aguardando homologação do SENAI.' });
      }

      if (company.access_code !== (access_code || '').trim()) {
        return res.status(401).json({ success: false, message: 'Código de acesso corporativo inválido.' });
      }

      user = db.getUserById(company.user_id);
    } else if (login_type === 'admin') {
      user = db.getUserByEmail(email);
      if (!user || user.role !== 'admin') {
        return res.status(401).json({ success: false, message: 'Conta de administrador não encontrada.' });
      }

      if (!db.verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ success: false, message: 'Senha administrativa incorreta.' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Tipo de login inválido.' });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }

    // Define cookie HTTP-only válido por 7 dias
    res.cookie('nexa_user_id', user.id, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    });

    const fullUser = db.getUserById(user.id);
    return res.json({
      success: true,
      message: `Bem-vindo(a), ${fullUser.displayName}!`,
      user: fullUser,
      redirectUrl: fullUser.role === 'admin' ? '/admin' : '/feed'
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ success: false, message: 'Erro interno ao realizar login.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('nexa_user_id');
  return res.json({ success: true, redirectUrl: '/login' });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false, user: null });
  }
  const unread = db.getUnreadCounts(req.user.id);
  const notifications = db.getUserNotifications(req.user.id);
  return res.json({
    authenticated: true,
    user: req.user,
    unread,
    notifications
  });
});

app.post('/api/auth/cadastro-aluno', (req, res) => {
  const { full_name, email, cpf, password, senai_course, professional_area, city, state } = req.body;

  if (!full_name || !email || !cpf || !password) {
    return res.status(400).json({ success: false, message: 'Preencha todos os campos obrigatórios.' });
  }

  // Verifica duplicações
  const existingEmail = db.getUserByEmail(email);
  if (existingEmail) {
    return res.status(400).json({ success: false, message: 'Este e-mail já está em uso na plataforma.' });
  }

  const existingCpf = db.getUserByCpf(cpf);
  if (existingCpf) {
    return res.status(400).json({ success: false, message: 'Este CPF já foi cadastrado.' });
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const passHash = db.hashPassword(password);

  try {
    const userRes = db.db.prepare(`
      INSERT INTO users (role, email, password_hash, is_active, created_at)
      VALUES ('aluno', ?, ?, 1, ?)
    `).run(email.trim().toLowerCase(), passHash, now);

    const userId = userRes.lastInsertRowid;

    db.db.prepare(`
      INSERT INTO student_profiles (
        user_id, full_name, cpf, city, state, senai_course, course_status,
        professional_area, headline, about_me, avatar_url, banner_url, connections_count
      ) VALUES (?, ?, ?, ?, ?, ?, 'Em andamento', ?, ?, '', '/images/default_student.png', '/images/default_banner.jpg', 0)
    `).run(
      userId,
      full_name.trim(),
      cpf.trim(),
      city || 'São Paulo',
      state || 'SP',
      senai_course || 'Técnico em Desenvolvimento de Sistemas',
      professional_area || 'Desenvolvimento de software',
      `Estudante SENAI - ${senai_course || 'Desenvolvimento de Sistemas'}`
    );

    // Login automático
    res.cookie('nexa_user_id', userId, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    });

    return res.json({ success: true, message: 'Conta criada com sucesso!', redirectUrl: '/feed' });
  } catch (err) {
    console.error('Erro ao cadastrar aluno:', err);
    return res.status(500).json({ success: false, message: 'Erro ao criar conta no banco de dados.' });
  }
});

// -----------------------------------------------------------------------------
// ROTAS DE API: SISTEMA DE CONEXÕES (BUG CORRIGIDO)
// -----------------------------------------------------------------------------
// Status entre o usuário logado e outro usuário
app.get('/api/conexoes/status/:targetUserId', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.targetUserId, 10);
  const status = db.getConnectionStatus(req.user.id, targetId);
  return res.json({ success: true, ...status });
});

// Conectar ou desconectar com 1 clique (AJAX instantâneo)
app.post('/api/conexoes/:targetUserId', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.targetUserId, 10);
  const result = db.toggleConnection(req.user.id, targetId);
  return res.json(result);
});

// Rota legada POST /conectar/:targetUserId suportando tanto formulários clássicos quanto AJAX
app.post('/conectar/:targetUserId', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.targetUserId, 10);
  const result = db.toggleConnection(req.user.id, targetId);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json(result);
  }

  // Redireciona de volta de forma segura
  const referer = req.get('Referer') || '/feed';
  return res.redirect(referer);
});

// Sugestões de networking para o usuário atual (filtra quem já é conexão)
app.get('/api/conexoes/sugestoes', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 5;
  const students = db.getSuggestedStudents(req.user.id, limit);
  const companies = db.getSuggestedCompanies(4);
  return res.json({ success: true, students, companies });
});

// -----------------------------------------------------------------------------
// ROTAS DE API: FEED, POSTS, CURTIDAS E COMENTÁRIOS
// -----------------------------------------------------------------------------
app.get('/api/posts', (req, res) => {
  const currentUserId = req.user ? req.user.id : null;
  const category = req.query.categoria || null;
  const posts = db.getFeedPosts(currentUserId, category);
  return res.json({ success: true, posts });
});

app.post('/api/posts', requireAuth, upload.single('image'), (req, res) => {
  const { title, content, category } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, message: 'O conteúdo da publicação é obrigatório.' });
  }

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const postId = db.createPost(req.user.id, {
    title: title ? title.trim() : null,
    content: content.trim(),
    category: category || 'novidades',
    imageUrl
  });

  return res.json({ success: true, message: 'Publicação compartilhada com sucesso!', postId });
});

app.post('/api/posts/:id/curtir', requireAuth, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const result = db.toggleLike(postId, req.user.id);
  return res.json({ success: true, ...result });
});

app.post('/api/posts/:id/comentar', requireAuth, (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, message: 'Comentário vazio.' });
  }

  db.addComment(postId, req.user.id, content.trim());
  return res.json({ success: true, message: 'Comentário publicado!' });
});

// -----------------------------------------------------------------------------
// ROTAS DE API: VAGAS E CANDIDATURAS
// -----------------------------------------------------------------------------
app.get('/api/vagas', (req, res) => {
  const { area, type, modality, search } = req.query;
  const jobs = db.getJobs({ area, type, modality, search });
  return res.json({ success: true, jobs });
});

app.get('/api/vagas/:id', (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const job = db.getJobById(jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Vaga não encontrada.' });
  }

  let isSaved = false;
  let hasApplied = false;

  if (req.user && req.user.role === 'aluno' && req.user.student) {
    const saved = db.db.prepare('SELECT id FROM saved_jobs WHERE job_id = ? AND student_id = ?').get(jobId, req.user.student.id);
    isSaved = !!saved;
    const applied = db.db.prepare('SELECT id, status FROM applications WHERE job_id = ? AND student_id = ?').get(jobId, req.user.student.id);
    hasApplied = !!applied;
  }

  return res.json({ success: true, job, isSaved, hasApplied });
});

app.post('/api/vagas/:id/candidatar', requireAuth, (req, res) => {
  if (req.user.role !== 'aluno' || !req.user.student) {
    return res.status(403).json({ success: false, message: 'Apenas alunos do SENAI podem se candidatar a vagas.' });
  }

  const jobId = parseInt(req.params.id, 10);
  const { notes } = req.body;
  const result = db.applyToJob(jobId, req.user.student.id, notes);
  return res.json(result);
});

app.post('/api/vagas/:id/salvar', requireAuth, (req, res) => {
  if (req.user.role !== 'aluno' || !req.user.student) {
    return res.status(403).json({ success: false, message: 'Apenas alunos podem salvar vagas favoritas.' });
  }

  const jobId = parseInt(req.params.id, 10);
  const result = db.toggleSaveJob(jobId, req.user.student.id);
  return res.json({ success: true, ...result });
});

// Candidaturas do aluno logado
app.get('/api/minhas-candidaturas', requireAuth, (req, res) => {
  if (req.user.role !== 'aluno' || !req.user.student) {
    return res.status(403).json({ success: false, message: 'Acesso exclusivo para alunos.' });
  }

  const applications = db.db.prepare(`
    SELECT a.*, j.title as job_title, j.area as job_area, j.modality as job_modality,
           j.location as job_location, c.name as company_name, c.logo_url as company_logo
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    JOIN company_profiles c ON j.company_id = c.id
    WHERE a.student_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.student.id);

  return res.json({ success: true, applications });
});

// -----------------------------------------------------------------------------
// ROTAS DE API: PERFIS (ALUNO E EMPRESA)
// -----------------------------------------------------------------------------
app.get('/api/perfil/aluno/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const student = db.getStudentFullProfile(studentId);
  if (!student) {
    return res.status(404).json({ success: false, message: 'Perfil de aluno não encontrado.' });
  }

  let connectionStatus = { connected: false, status: null, isSelf: false };
  if (req.user) {
    connectionStatus = db.getConnectionStatus(req.user.id, student.user_id);
  }

  return res.json({
    success: true,
    student,
    connectionStatus,
    isOwner: req.user ? req.user.id === student.user_id : false
  });
});

app.put('/api/perfil/aluno/:id', requireAuth, upload.single('avatar'), (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  if (req.user.role !== 'aluno' || !req.user.student || req.user.student.id !== studentId) {
    return res.status(403).json({ success: false, message: 'Permissão negada para editar este perfil.' });
  }

  const { full_name, headline, about_me, phone, city, state, senai_course, professional_area } = req.body;
  let avatarUrl = req.user.student.avatar_url;

  if (req.file) {
    avatarUrl = `/uploads/${req.file.filename}`;
  }

  db.db.prepare(`
    UPDATE student_profiles SET
      full_name = COALESCE(?, full_name),
      headline = COALESCE(?, headline),
      about_me = COALESCE(?, about_me),
      phone = COALESCE(?, phone),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      senai_course = COALESCE(?, senai_course),
      professional_area = COALESCE(?, professional_area),
      avatar_url = ?
    WHERE id = ?
  `).run(
    full_name || null,
    headline || null,
    about_me || null,
    phone || null,
    city || null,
    state || null,
    senai_course || null,
    professional_area || null,
    avatarUrl,
    studentId
  );

  return res.json({ success: true, message: 'Perfil atualizado com sucesso!', avatarUrl });
});

// Adicionar experiência, competência, projeto
app.post('/api/perfil/aluno/:id/experiencias', requireAuth, (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  if (req.user.student?.id !== studentId) return res.status(403).json({ success: false, message: 'Negado.' });

  const { company, role, period, description } = req.body;
  db.db.prepare(`
    INSERT INTO experiences (student_id, company, role, period, description, is_current)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(studentId, company, role, period || 'Atual', description || '');

  return res.json({ success: true, message: 'Experiência adicionada!' });
});

app.post('/api/perfil/aluno/:id/competencias', requireAuth, (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  if (req.user.student?.id !== studentId) return res.status(403).json({ success: false, message: 'Negado.' });

  const { name, level } = req.body;
  db.db.prepare('INSERT INTO skills (student_id, name, level) VALUES (?, ?, ?)').run(studentId, name, level || 'Intermediário');
  return res.json({ success: true, message: 'Competência adicionada!' });
});

// Perfil Empresa
app.get('/api/perfil/empresa/:id', (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  const company = db.db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(companyId);
  if (!company) {
    return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });
  }

  const jobs = db.db.prepare('SELECT * FROM jobs WHERE company_id = ? ORDER BY created_at DESC').all(companyId);
  return res.json({ success: true, company, jobs });
});

// -----------------------------------------------------------------------------
// ROTAS DE API: MENSAGENS E CHAT
// -----------------------------------------------------------------------------
app.get('/api/mensagens/conversas', requireAuth, (req, res) => {
  const conversations = db.getConversations(req.user.id);
  return res.json({ success: true, conversations });
});

app.get('/api/mensagens/:targetUserId', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.targetUserId, 10);
  const targetUser = db.getUserById(targetId);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'Destinatário não encontrado.' });
  }

  const messages = db.getChatMessages(req.user.id, targetId);
  return res.json({ success: true, targetUser, messages });
});

app.post('/api/mensagens', requireAuth, (req, res) => {
  const { receiver_id, content } = req.body;
  if (!receiver_id || !content || !content.trim()) {
    return res.status(400).json({ success: false, message: 'Dados de mensagem incompletos.' });
  }

  const msg = db.sendMessage(req.user.id, parseInt(receiver_id, 10), content);
  return res.json({ success: true, message: msg });
});

// -----------------------------------------------------------------------------
// ROTAS DE API: ADMINISTRAÇÃO E GOVERNANÇA SENAI
// -----------------------------------------------------------------------------
app.get('/api/admin/metricas', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Acesso restrito ao Administrador.' });
  }

  const totalUsers = db.db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalStudents = db.db.prepare('SELECT COUNT(*) as c FROM student_profiles').get().c;
  const totalCompanies = db.db.prepare('SELECT COUNT(*) as c FROM company_profiles').get().c;
  const totalJobs = db.db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
  const totalApplications = db.db.prepare('SELECT COUNT(*) as c FROM applications').get().c;
  const totalConnections = db.db.prepare('SELECT COUNT(*) as c FROM connections WHERE status = "aceita"').get().c;

  const companies = db.db.prepare('SELECT * FROM company_profiles ORDER BY id DESC').all();

  return res.json({
    success: true,
    metrics: {
      totalUsers,
      totalStudents,
      totalCompanies,
      totalJobs,
      totalApplications,
      totalConnections
    },
    companies
  });
});

app.post('/api/admin/empresas/autorizar', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false });

  const { name, cnpj, email, sector, location } = req.body;
  if (!name || !cnpj || !email) {
    return res.status(400).json({ success: false, message: 'Razão social, CNPJ e e-mail são obrigatórios.' });
  }

  // Gera código único ex: NEXA-8F42-BR
  const accessCode = `NEXA-${crypto.randomBytes(2).toString('hex').toUpperCase()}-BR`;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  try {
    const userRes = db.db.prepare(`
      INSERT INTO users (role, email, password_hash, is_active, created_at)
      VALUES ('empresa', ?, '', 1, ?)
    `).run(email.trim().toLowerCase(), now);

    db.db.prepare(`
      INSERT INTO company_profiles (
        user_id, name, cnpj, access_code, is_authorized, is_blocked,
        logo_url, banner_url, headline, sector, location, contact_email, created_at
      ) VALUES (?, ?, ?, ?, 1, 0, '/images/default_company.png', '/images/default_company_banner.jpg',
        'Empresa Parceira Homologada pelo SENAI', ?, ?, ?, ?)
    `).run(
      userRes.lastInsertRowid,
      name.trim(),
      cnpj.trim(),
      accessCode,
      sector || 'Indústria e Tecnologia',
      location || 'São Paulo - SP',
      email.trim(),
      now
    );

    return res.json({ success: true, message: 'Empresa homologada com sucesso!', accessCode });
  } catch (err) {
    console.error('Erro ao homologar empresa:', err);
    return res.status(500).json({ success: false, message: 'Erro ao cadastrar empresa.' });
  }
});

app.post('/api/admin/empresas/:id/toggle-bloqueio', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false });
  const compId = parseInt(req.params.id, 10);
  const comp = db.db.prepare('SELECT is_blocked FROM company_profiles WHERE id = ?').get(compId);
  if (!comp) return res.status(404).json({ success: false, message: 'Empresa não encontrada.' });

  const newStatus = comp.is_blocked ? 0 : 1;
  db.db.prepare('UPDATE company_profiles SET is_blocked = ? WHERE id = ?').run(newStatus, compId);

  return res.json({ success: true, is_blocked: newStatus });
});

// -----------------------------------------------------------------------------
// ROTAS DE FRONTEND (PÁGINAS HTML)
// -----------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get(['/', '/feed'], (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/vagas', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'vagas.html'));
});

app.get('/vagas/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'vaga-detalhe.html'));
});

app.get('/perfil/aluno', requireAuth, (req, res) => {
  if (req.user.role === 'aluno' && req.user.student) {
    return res.redirect(`/perfil/aluno/${req.user.student.id}`);
  }
  // Se for admin ou empresa, abre o primeiro aluno
  return res.redirect('/perfil/aluno/1');
});

app.get('/perfil/aluno/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'perfil-aluno.html'));
});

app.get('/perfil/aluno/editar', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'editar-perfil.html'));
});

app.get('/perfil/empresa/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'perfil-empresa.html'));
});

app.get('/mensagens', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'mensagens.html'));
});

app.get('/minhas-candidaturas', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'minhas-vagas.html'));
});

app.get('/empresa/vagas', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'empresa-vagas.html'));
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/feed');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/cadastro', (req, res) => {
  if (req.user) return res.redirect('/feed');
  res.sendFile(path.join(PUBLIC_DIR, 'cadastro.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/feed');
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Tratamento de 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`===================================================================`);
  console.log(`   NEXA SENAI - SERVIDOR ATIVO EM NODE.JS / JAVASCRIPT`);
  console.log(`   Acesse no navegador: http://localhost:${PORT}`);
  console.log(`===================================================================`);
});
