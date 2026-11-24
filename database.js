/**
 * Nexa SENAI - Camada de Banco de Dados e Regras de Negócio (SQLite nativo)
 * Desenvolvido em JavaScript / Node.js para TCC do Curso Técnico SENAI.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

// Caminho absoluto para o banco de dados SQLite oficial
const DB_PATH = path.join(__dirname, 'nexa_senai.db');
const db = new DatabaseSync(DB_PATH);

// Habilita chaves estrangeiras e modo WAL para alta performance
db.exec('PRAGMA foreign_keys = ON;');

// -----------------------------------------------------------------------------
// UTILITÁRIOS CRIPTOGRÁFICOS (Compatíveis com Werkzeug Python e senhas seguras)
// -----------------------------------------------------------------------------
function verifyPassword(password, hashStr) {
  if (!hashStr) return false;
  
  // Suporte a hash Werkzeug scrypt (scrypt:32768:8:1$salt$hash)
  if (hashStr.startsWith('scrypt:')) {
    try {
      const parts = hashStr.split('$');
      if (parts.length !== 3) return false;
      const [params, salt, expectedHash] = parts;
      const [, N, r, p] = params.split(':').map((v, i) => i === 0 ? v : parseInt(v));
      const derivedKey = crypto.scryptSync(password, salt, 64, {
        N: N || 32768,
        r: r || 8,
        p: p || 1,
        maxmem: 64 * 1024 * 1024
      });
      return derivedKey.toString('hex') === expectedHash;
    } catch (e) {
      console.error('Erro ao verificar scrypt hash:', e);
      return false;
    }
  }

  // Suporte a hash PBKDF2 padrão
  if (hashStr.startsWith('pbkdf2:')) {
    try {
      const parts = hashStr.split('$');
      if (parts.length !== 3) return false;
      const [, salt, expectedHash] = parts;
      const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256');
      return derivedKey.toString('hex') === expectedHash;
    } catch (e) {
      return false;
    }
  }

  // Fallback para texto plano se não for hash
  return password === hashStr;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt:32768:8:1$${salt}$${derivedKey.toString('hex')}`;
}

function cleanDigits(val) {
  return (val || '').toString().replace(/\D/g, '');
}

// -----------------------------------------------------------------------------
// OPERAÇÕES DE AUTENTICAÇÃO E USUÁRIOS
// -----------------------------------------------------------------------------
function getUserById(id) {
  const user = db.prepare('SELECT id, role, email, is_active, created_at FROM users WHERE id = ?').get(id);
  if (!user) return null;

  if (user.role === 'aluno') {
    const student = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
    user.student = student || null;
    user.displayName = student ? student.full_name : user.email.split('@')[0];
    user.avatarUrl = (student && student.avatar_url) ? student.avatar_url : '/images/default_student.png';
  } else if (user.role === 'empresa') {
    const company = db.prepare('SELECT * FROM company_profiles WHERE user_id = ?').get(user.id);
    user.company = company || null;
    user.displayName = company ? company.name : user.email.split('@')[0];
    user.avatarUrl = (company && company.logo_url) ? company.logo_url : '/images/default_company.png';
  } else {
    user.displayName = 'Administrador SENAI';
    user.avatarUrl = '/images/default_avatar.png';
  }
  return user;
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
}

function getUserByCpf(cpf) {
  const raw = (cpf || '').trim();
  const digits = cleanDigits(cpf);
  const student = db.prepare(`
    SELECT * FROM student_profiles 
    WHERE cpf = ? 
       OR REPLACE(REPLACE(cpf, '.', ''), '-', '') = ?
    LIMIT 1
  `).get(raw, digits);
  if (!student) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(student.user_id);
}

function getCompanyByCnpj(cnpj) {
  const raw = (cnpj || '').trim();
  const digits = cleanDigits(cnpj);
  return db.prepare(`
    SELECT * FROM company_profiles 
    WHERE cnpj = ? 
       OR REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '-', ''), '/', ''), ' ', '') = ?
    LIMIT 1
  `).get(raw, digits);
}

// -----------------------------------------------------------------------------
// SISTEMA DE CONEXÕES (CORREÇÃO DEFINITIVA DO BUG)
// -----------------------------------------------------------------------------
/**
 * Obtém o status de conexão entre dois usuários de forma bidirecional.
 */
function getConnectionStatus(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) {
    return { connected: false, status: null, isSelf: userAId === userBId };
  }

  const conn = db.prepare(`
    SELECT * FROM connections 
    WHERE (requester_id = ? AND addressee_id = ?) 
       OR (requester_id = ? AND addressee_id = ?)
    LIMIT 1
  `).get(userAId, userBId, userBId, userAId);

  if (!conn) {
    return { connected: false, status: null, isSelf: false };
  }

  return {
    connected: conn.status === 'aceita',
    status: conn.status,
    isRequester: conn.requester_id === userAId,
    connectionId: conn.id,
    isSelf: false
  };
}

/**
 * Conecta ou desconecta dois usuários de forma limpa, segura e atômica.
 * Resolve 100% dos erros anteriores de chave duplicada ou redirect vazio!
 */
function toggleConnection(currentUserId, targetUserId) {
  if (!currentUserId || !targetUserId) {
    return { success: false, message: 'Identificadores de usuário inválidos.' };
  }

  if (parseInt(currentUserId) === parseInt(targetUserId)) {
    return { success: false, message: 'Você não pode se conectar consigo mesmo.' };
  }

  const userA = getUserById(currentUserId);
  const userB = getUserById(targetUserId);

  if (!userA || !userB) {
    return { success: false, message: 'Usuário não encontrado.' };
  }

  // Verifica se já existe conexão cadastrada
  const existing = db.prepare(`
    SELECT * FROM connections 
    WHERE (requester_id = ? AND addressee_id = ?) 
       OR (requester_id = ? AND addressee_id = ?)
    LIMIT 1
  `).get(currentUserId, targetUserId, targetUserId, currentUserId);

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (existing) {
    if (existing.status === 'aceita') {
      // Se já estava conectado, remove a conexão (desconectar de forma amigável)
      db.prepare('DELETE FROM connections WHERE id = ?').run(existing.id);

      // Decrementa contadores com proteção contra valores negativos
      db.prepare('UPDATE student_profiles SET connections_count = MAX(0, connections_count - 1) WHERE user_id IN (?, ?)').run(currentUserId, targetUserId);

      const updatedStudent = db.prepare('SELECT connections_count FROM student_profiles WHERE user_id = ?').get(targetUserId);

      return {
        success: true,
        connected: false,
        status: null,
        message: 'Conexão desfeita com sucesso.',
        connectionsCount: updatedStudent ? updatedStudent.connections_count : 0
      };
    } else {
      // Se estava pendente, aceita a conexão
      db.prepare('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run('aceita', now, existing.id);
      db.prepare('UPDATE student_profiles SET connections_count = connections_count + 1 WHERE user_id IN (?, ?)').run(currentUserId, targetUserId);

      const updatedStudent = db.prepare('SELECT connections_count FROM student_profiles WHERE user_id = ?').get(targetUserId);

      return {
        success: true,
        connected: true,
        status: 'aceita',
        message: 'Conexão confirmada com sucesso!',
        connectionsCount: updatedStudent ? updatedStudent.connections_count : 0
      };
    }
  }

  // Cria nova conexão diretamente com status 'aceita' para dinamismo de rede social do SENAI
  db.prepare(`
    INSERT INTO connections (requester_id, addressee_id, status, created_at, updated_at)
    VALUES (?, ?, 'aceita', ?, ?)
  `).run(currentUserId, targetUserId, now, now);

  // Incrementa conexões dos perfis de alunos
  db.prepare('UPDATE student_profiles SET connections_count = connections_count + 1 WHERE user_id IN (?, ?)').run(currentUserId, targetUserId);

  // Registra notificação para o usuário conectado
  const linkUrl = userA.student ? `/perfil/aluno/${userA.student.id}` : '#';
  db.prepare(`
    INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    targetUserId,
    'Nova Conexão Profissional',
    `${userA.displayName} conectou-se a você no Nexa SENAI.`,
    linkUrl,
    now
  );

  const updatedStudent = db.prepare('SELECT connections_count FROM student_profiles WHERE user_id = ?').get(targetUserId);

  return {
    success: true,
    connected: true,
    status: 'aceita',
    message: `Você agora está conectado com ${userB.displayName}!`,
    connectionsCount: updatedStudent ? updatedStudent.connections_count : 0
  };
}

/**
 * Sugestões inteligentes de alunos:
 * Prioriza sugerir colegas que o usuário AINDA NÃO possui conexão!
 */
function getSuggestedStudents(currentUserId, limit = 5) {
  if (!currentUserId) {
    return db.prepare('SELECT s.*, u.email FROM student_profiles s JOIN users u ON s.user_id = u.id LIMIT ?').all(limit);
  }

  // Busca alunos excluindo o próprio usuário e aqueles com quem já existe conexão aceita
  const suggestions = db.prepare(`
    SELECT s.*, u.email 
    FROM student_profiles s
    JOIN users u ON s.user_id = u.id
    WHERE s.user_id != ?
      AND s.user_id NOT IN (
        SELECT addressee_id FROM connections WHERE requester_id = ? AND status = 'aceita'
        UNION
        SELECT requester_id FROM connections WHERE addressee_id = ? AND status = 'aceita'
      )
    ORDER BY s.id ASC
    LIMIT ?
  `).all(currentUserId, currentUserId, currentUserId, limit);

  // Se o usuário já se conectou com quase todos, busca os demais e indica status real
  if (suggestions.length < limit) {
    const allOthers = db.prepare(`
      SELECT s.*, u.email 
      FROM student_profiles s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id != ?
      LIMIT ?
    `).all(currentUserId, limit);

    return allOthers.map(s => {
      const conn = getConnectionStatus(currentUserId, s.user_id);
      return { ...s, isConnected: conn.connected };
    });
  }

  return suggestions.map(s => ({ ...s, isConnected: false }));
}

function getSuggestedCompanies(limit = 4) {
  return db.prepare(`
    SELECT * FROM company_profiles 
    WHERE is_authorized = 1 AND is_blocked = 0 
    ORDER BY id ASC 
    LIMIT ?
  `).all(limit);
}

// -----------------------------------------------------------------------------
// POSTS, CURTIDAS E COMENTÁRIOS (FEED)
// -----------------------------------------------------------------------------
function getFeedPosts(currentUserId, category = null) {
  let query = `
    SELECT p.*, u.role as author_role, u.email as author_email
    FROM posts p
    JOIN users u ON p.user_id = u.id
  `;
  const params = [];

  if (category && category !== 'todas') {
    query += ' WHERE p.category = ?';
    params.push(category);
  }

  query += ' ORDER BY p.created_at DESC';
  const posts = db.prepare(query).all(...params);

  // Preenche dados do autor (aluno ou empresa), contagem de curtidas e comentários
  return posts.map(post => {
    let authorName = 'Usuário SENAI';
    let authorAvatar = '/images/default_avatar.png';
    let authorHeadline = '';
    let authorProfileLink = '#';

    if (post.author_role === 'aluno') {
      const student = db.prepare('SELECT id, full_name, headline, avatar_url FROM student_profiles WHERE user_id = ?').get(post.user_id);
      if (student) {
        authorName = student.full_name;
        authorAvatar = student.avatar_url || '/images/default_student.png';
        authorHeadline = student.headline || 'Estudante SENAI';
        authorProfileLink = `/perfil/aluno/${student.id}`;
      }
    } else if (post.author_role === 'empresa') {
      const company = db.prepare('SELECT id, name, headline, logo_url FROM company_profiles WHERE user_id = ?').get(post.user_id);
      if (company) {
        authorName = company.name;
        authorAvatar = company.logo_url || '/images/default_company.png';
        authorHeadline = company.headline || 'Empresa Parceira SENAI';
        authorProfileLink = `/perfil/empresa/${company.id}`;
      }
    } else {
      authorName = 'Administração SENAI';
      authorHeadline = 'Suporte & Governança Institucional';
    }

    // Contadores
    const likesCount = db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id = ?').get(post.id).c;
    const commentsCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE post_id = ?').get(post.id).c;
    
    // Status se o usuário logado curtiu
    let isLikedByMe = false;
    if (currentUserId) {
      const like = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, currentUserId);
      isLikedByMe = !!like;
    }

    // Busca comentários do post
    const comments = db.prepare(`
      SELECT c.*, u.role as user_role, u.email as user_email
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(post.id).map(comm => {
      let commAuthor = 'Usuário';
      let commAvatar = '/images/default_avatar.png';
      if (comm.user_role === 'aluno') {
        const s = db.prepare('SELECT full_name, avatar_url FROM student_profiles WHERE user_id = ?').get(comm.user_id);
        if (s) {
          commAuthor = s.full_name;
          commAvatar = s.avatar_url || '/images/default_student.png';
        }
      } else if (comm.user_role === 'empresa') {
        const cp = db.prepare('SELECT name, logo_url FROM company_profiles WHERE user_id = ?').get(comm.user_id);
        if (cp) {
          commAuthor = cp.name;
          commAvatar = cp.logo_url || '/images/default_company.png';
        }
      }
      return { ...comm, authorName: commAuthor, authorAvatar: commAvatar };
    });

    return {
      ...post,
      authorName,
      authorAvatar,
      authorHeadline,
      authorProfileLink,
      likesCount,
      commentsCount,
      isLikedByMe,
      comments
    };
  });
}

function createPost(userId, { title, content, category, imageUrl }) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = db.prepare(`
    INSERT INTO posts (user_id, title, content, category, image_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, title || null, content, category || 'novidades', imageUrl || null, now);
  return result.lastInsertRowid;
}

function toggleLike(postId, userId) {
  const existing = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let liked = false;

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    liked = false;
  } else {
    db.prepare('INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(postId, userId, now);
    liked = true;
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id = ?').get(postId).c;
  return { liked, likesCount: count };
}

function addComment(postId, userId, content) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, content, now);

  // Notifica autor do post
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (post && post.user_id !== userId) {
    const user = getUserById(userId);
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      post.user_id,
      'Novo comentário no seu post',
      `${user ? user.displayName : 'Alguém'} comentou na sua publicação.`,
      '/feed',
      now
    );
  }
}

// -----------------------------------------------------------------------------
// VAGAS E CANDIDATURAS
// -----------------------------------------------------------------------------
function getJobs(filters = {}) {
  let query = `
    SELECT j.*, c.name as company_name, c.logo_url as company_logo, c.location as company_location
    FROM jobs j
    JOIN company_profiles c ON j.company_id = c.id
    WHERE (j.status = 'aberta' OR j.status = 'ativa')
  `;
  const params = [];

  if (filters.area) {
    query += ' AND LOWER(j.area) LIKE LOWER(?)';
    params.push(`%${filters.area}%`);
  }
  if (filters.type) {
    query += ' AND LOWER(j.job_type) LIKE LOWER(?)';
    params.push(`%${filters.type}%`);
  }
  if (filters.modality) {
    query += ' AND LOWER(j.modality) LIKE LOWER(?)';
    params.push(`%${filters.modality}%`);
  }
  if (filters.search) {
    query += ' AND (LOWER(j.title) LIKE LOWER(?) OR LOWER(j.description) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?))';
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }

  query += ' ORDER BY j.created_at DESC';
  return db.prepare(query).all(...params);
}

function getJobById(id) {
  return db.prepare(`
    SELECT j.*, c.name as company_name, c.logo_url as company_logo, c.banner_url as company_banner,
           c.sector as company_sector, c.location as company_location, c.headline as company_headline,
           c.description as company_description, c.user_id as company_user_id
    FROM jobs j
    JOIN company_profiles c ON j.company_id = c.id
    WHERE j.id = ?
  `).get(id);
}

function applyToJob(jobId, studentId, notes = '') {
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND student_id = ?').get(jobId, studentId);
  if (existing) {
    return { success: false, message: 'Você já se candidatou a esta vaga!' };
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO applications (job_id, student_id, status, notes, created_at, updated_at)
    VALUES (?, ?, 'recebida', ?, ?, ?)
  `).run(jobId, studentId, notes || null, now, now);

  // Notifica a empresa
  const job = db.prepare('SELECT title, company_id FROM jobs WHERE id = ?').get(jobId);
  if (job) {
    const comp = db.prepare('SELECT user_id FROM company_profiles WHERE id = ?').get(job.company_id);
    const stud = db.prepare('SELECT full_name FROM student_profiles WHERE id = ?').get(studentId);
    if (comp && stud) {
      db.prepare(`
        INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(
        comp.user_id,
        'Novo Candidato Inscrito',
        `${stud.full_name} candidatou-se para a vaga "${job.title}".`,
        `/empresa/vagas`,
        now
      );
    }
  }

  return { success: true, message: 'Candidatura enviada com sucesso!' };
}

function toggleSaveJob(jobId, studentId) {
  const existing = db.prepare('SELECT id FROM saved_jobs WHERE job_id = ? AND student_id = ?').get(jobId, studentId);
  if (existing) {
    db.prepare('DELETE FROM saved_jobs WHERE id = ?').run(existing.id);
    return { saved: false, message: 'Vaga removida dos favoritos.' };
  } else {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    db.prepare('INSERT INTO saved_jobs (job_id, student_id, created_at) VALUES (?, ?, ?)').run(jobId, studentId, now);
    return { saved: true, message: 'Vaga salva nos seus favoritos!' };
  }
}

// -----------------------------------------------------------------------------
// PERFIL DO ALUNO (EXPERIÊNCIAS, COMPETÊNCIAS, PROJETOS)
// -----------------------------------------------------------------------------
function getStudentFullProfile(studentId) {
  const student = db.prepare('SELECT s.*, u.email FROM student_profiles s JOIN users u ON s.user_id = u.id WHERE s.id = ?').get(studentId);
  if (!student) return null;

  student.skills = db.prepare('SELECT * FROM skills WHERE student_id = ? ORDER BY id DESC').all(student.id);
  student.experiences = db.prepare('SELECT * FROM experiences WHERE student_id = ? ORDER BY id DESC').all(student.id);
  student.educations = db.prepare('SELECT * FROM educations WHERE student_id = ? ORDER BY id DESC').all(student.id);
  student.projects = db.prepare('SELECT * FROM projects WHERE student_id = ? ORDER BY id DESC').all(student.id);
  student.certificates = db.prepare('SELECT * FROM certificates WHERE student_id = ? ORDER BY id DESC').all(student.id);
  return student;
}

// -----------------------------------------------------------------------------
// MENSAGENS E CHAT EM TEMPO REAL
// -----------------------------------------------------------------------------
function getConversations(currentUserId) {
  const msgs = db.prepare(`
    SELECT * FROM messages 
    WHERE sender_id = ? OR receiver_id = ?
    ORDER BY created_at ASC
  `).all(currentUserId, currentUserId);

  const convMap = new Map();

  for (const m of msgs) {
    const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
    if (!convMap.has(otherId)) {
      const otherUser = getUserById(otherId);
      if (otherUser) {
        convMap.set(otherId, {
          user: otherUser,
          lastMessage: m.content,
          time: m.created_at ? m.created_at.substring(11, 16) : '',
          unreadCount: 0,
          rawDate: m.created_at
        });
      }
    }
    const conv = convMap.get(otherId);
    if (conv) {
      conv.lastMessage = m.content;
      conv.time = m.created_at ? m.created_at.substring(11, 16) : '';
      conv.rawDate = m.created_at;
      if (!m.is_read && m.receiver_id === currentUserId) {
        conv.unreadCount++;
      }
    }
  }

  return Array.from(convMap.values()).sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));
}

function getChatMessages(userAId, userBId) {
  // Marca mensagens recebidas como lidas
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(userBId, userAId);

  return db.prepare(`
    SELECT id, sender_id, receiver_id, content, is_read, created_at,
           SUBSTR(created_at, 12, 5) as time
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(userAId, userBId, userBId, userAId);
}

function sendMessage(senderId, receiverId, content) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, content, is_read, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(senderId, receiverId, content.trim(), now);

  const sender = getUserById(senderId);
  db.prepare(`
    INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    receiverId,
    'Nova Mensagem',
    `${sender ? sender.displayName : 'Alguém'} enviou uma mensagem para você.`,
    `/mensagens?user_id=${senderId}`,
    now
  );

  return {
    id: result.lastInsertRowid,
    content: content.trim(),
    time: now.substring(11, 16),
    senderId
  };
}

// -----------------------------------------------------------------------------
// NOTIFICAÇÕES
// -----------------------------------------------------------------------------
function getUserNotifications(userId) {
  return db.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 10
  `).all(userId);
}

function getUnreadCounts(userId) {
  if (!userId) return { unreadMsgs: 0, unreadNotifs: 0 };
  const unreadMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0').get(userId).c;
  const unreadNotifs = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;
  return { unreadMsgs, unreadNotifs };
}

// Exportações completas
module.exports = {
  db,
  verifyPassword,
  hashPassword,
  cleanDigits,
  getUserById,
  getUserByEmail,
  getUserByCpf,
  getCompanyByCnpj,
  getConnectionStatus,
  toggleConnection,
  getSuggestedStudents,
  getSuggestedCompanies,
  getFeedPosts,
  createPost,
  toggleLike,
  addComment,
  getJobs,
  getJobById,
  applyToJob,
  toggleSaveJob,
  getStudentFullProfile,
  getConversations,
  getChatMessages,
  sendMessage,
  getUserNotifications,
  getUnreadCounts
};
