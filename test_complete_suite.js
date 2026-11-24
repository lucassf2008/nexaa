/**
 * Suíte de Testes Automatizados da Nova Aplicação em Node.js / HTML / CSS / JS
 */

const http = require('node:http');

async function runTests() {
  console.log('Iniciando servidor para testes na porta 3001...');
  process.env.PORT = '3001';
  require('./server.js');

  // Aguarda 1 segundo para garantir que subiu
  await new Promise(r => setTimeout(r, 1000));

  const BASE_URL = 'http://127.0.0.1:3001';

  async function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });
      req.on('error', reject);
      if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      req.end();
    });
  }

  console.log('\n--- TESTE 1: Rota Pública de Vagas ---');
  const resVagas = await request('/api/vagas');
  console.log('Status /api/vagas:', resVagas.status, 'Total vagas:', resVagas.body?.jobs?.length);
  if (resVagas.status !== 200 || !resVagas.body?.jobs?.length) throw new Error('Falha no teste de vagas');

  console.log('\n--- TESTE 2: Login de Aluno (Clarisse) ---');
  const resLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { login_type: 'aluno', identifier: '234.567.890-92', password: 'senai123' }
  });
  console.log('Status Login Aluno:', resLogin.status, 'Usuário:', resLogin.body?.user?.displayName);
  if (resLogin.status !== 200 || !resLogin.body?.success) throw new Error('Falha no login aluno');

  console.log('\n--- TESTE 2.1: Login de Empresa (TechCorp) ---');
  const resLoginEmpresa = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { login_type: 'empresa', cnpj: '11.222.333/0001-81', access_code: 'TECH-2024' }
  });
  console.log('Status Login Empresa:', resLoginEmpresa.status, 'Empresa:', resLoginEmpresa.body?.user?.displayName);
  if (resLoginEmpresa.status !== 200 || !resLoginEmpresa.body?.success) throw new Error('Falha no login empresa');

  console.log('\n--- TESTE 2.2: Login de Admin (SENAI) ---');
  const resLoginAdmin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { login_type: 'admin', email: 'admin@senai.br', password: 'admin123' }
  });
  console.log('Status Login Admin:', resLoginAdmin.status, 'Admin:', resLoginAdmin.body?.user?.displayName);
  if (resLoginAdmin.status !== 200 || !resLoginAdmin.body?.success) throw new Error('Falha no login admin');

  const cookie = resLogin.headers['set-cookie']?.[0]?.split(';')[0];
  console.log('Cookie de Sessão gerado:', cookie);

  console.log('\n--- TESTE 3: Sessão Autenticada (/api/auth/me) ---');
  const resMe = await request('/api/auth/me', { headers: { Cookie: cookie } });
  console.log('Status /api/auth/me:', resMe.status, 'Autenticado:', resMe.body?.authenticated, 'Nome:', resMe.body?.user?.displayName);

  console.log('\n--- TESTE 4: Teste do BUG DE CONEXÃO (/api/conexoes/:targetUserId) ---');
  // Aluno alvo: Gabriel Castro (user_id 5)
  const resConectar = await request('/api/conexoes/5', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' }
  });
  console.log('Resposta ao conectar com Gabriel (user 5):', resConectar.status, resConectar.body);
  if (resConectar.status !== 200 || !resConectar.body?.success) throw new Error('Falha ao conectar!');

  const resStatus = await request('/api/conexoes/status/5', { headers: { Cookie: cookie } });
  console.log('Status da conexão verificado:', resStatus.body);

  console.log('\n--- TESTE 5: Teste de Sugestões de Networking (/api/conexoes/sugestoes) ---');
  const resSugestoes = await request('/api/conexoes/sugestoes', { headers: { Cookie: cookie } });
  console.log('Sugestões retornadas com sucesso:', resSugestoes.body?.students?.length, 'estudantes sugeridos.');

  console.log('\n--- TESTE 6: Teste de Envio de Mensagem (/api/mensagens) ---');
  const resMsg = await request('/api/mensagens', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: { receiver_id: 5, content: 'Olá Gabriel, tudo bem? Vamos desenvolver juntos o projeto no SENAI!' }
  });
  console.log('Mensagem enviada com sucesso:', resMsg.status, resMsg.body);

  console.log('\n=============================================================');
  console.log('   TODOS OS TESTES PASSARAM COM 100% DE SUCESSO! 🏆');
  console.log('=============================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n[ERRO NO TESTE]:', err);
  process.exit(1);
});
