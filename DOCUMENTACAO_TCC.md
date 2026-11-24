# DOCUMENTAÇÃO TÉCNICA - TCC NEXA SENAI
## Sistema Web de Conexão Profissional e Oportunidades Industriais
**Curso Técnico em Desenvolvimento de Sistemas / Informática — SENAI**

---

### 1. Resumo do Projeto
O **Nexa SENAI** é uma plataforma web completa de networking profissional inspirada nas melhores práticas de redes corporativas (como o LinkedIn), desenvolvida para conectar estudantes, ex-alunos e empresas parceiras do ecossistema industrial SENAI.

O sistema foi concebido para atender às exigências de um **Trabalho de Conclusão de Curso (TCC)** técnico de excelência, utilizando a tríade fundamental da web: **HTML5 semântico, CSS3 com design system oficial SENAI e JavaScript moderno (ES6+)**, apoiado por um backend leve, eficiente e didático em **Node.js com Express e SQLite**.

---

### 2. Justificativa Tecnológica (HTML5, CSS3, JavaScript e Node.js)
No desenvolvimento para o curso técnico:
1. **Frontend Nativo (HTML5 + CSS3 + Vanilla JavaScript):**
   - Não depende de frameworks complexos de curva de aprendizado obscura que dificultam a defesa perante a banca.
   - Demonstra domínio direto dos fundamentos da web: manipulação do DOM, requisições assíncronas com `Fetch API`, arquitetura client-side responsiva e eventos.
2. **Backend em JavaScript (Node.js + Express):**
   - Unifica a linguagem do projeto em JavaScript de ponta a ponta (*Full Stack JS*).
   - Elimina problemas de dependências de compiladores externos, sendo executado de forma imediata em qualquer computador.
3. **Persistência de Dados (SQLite com node:sqlite):**
   - Banco de dados relacional oficial, integrado nativamente ao ambiente Node.js sem necessidade de serviços de banco pesados em segundo plano.

---

### 3. Diagnóstico e Resolução do Bug do Botão "Conectar"

#### ❌ Causa Raiz do Problema Original:
1. **Formulário Síncrono sem Tratamento de Estado:** O botão original utilizava submissão de formulário POST tradicional (`<form action="/conectar/..." method="POST">`), provocando recarregamento de tela e quebra de referência HTTP (`request.referrer` nulo gerava redirects inválidos).
2. **Ausência de Filtro de Conexões Existentes:** A lista de sugestões da barra lateral exibia usuários com os quais o aluno **já estava conectado**, mantendo o botão "+ Conectar" ativo. Ao clicar, o banco disparava violação de chave única ou bloqueio lógico.
3. **Incompatibilidade de Papéis:** Ao conectar com empresas ou administradores, o código anterior tentava acessar atributos exclusivos de alunos (`student_profile.id`), disparando exceção de servidor (HTTP 500).
4. **Falta de Sincronização de Contadores:** O número de conexões não era incrementado de forma atômica no banco de dados.

####  Solução Implementada (JavaScript + API REST):
1. **API REST Bidirecional (`/api/conexoes/:targetUserId`):**
   - Valida atômica e seguramente se a conexão já existe em qualquer sentido (`(requester_id = A AND addressee_id = B) OR (requester_id = B AND addressee_id = A)`).
   - Se já existe conexão aceita, permite alternar (desconectar de forma amigável ou manter) sem qualquer erro no banco.
   - Atualiza de forma segura o `connections_count` na tabela `student_profiles` de ambos os envolvidos.
2. **Sugestões Inteligentes de Networking (`/api/conexoes/sugestoes`):**
   - A lista de "Sugestões para você" filtra automaticamente e prioriza apenas alunos que **ainda não são conexões**, exibindo status correto.
3. **Frontend Reativo com Fetch API (`public/js/conexoes.js`):**
   - Intercepta cliques de forma assíncrona, desabilita temporariamente o botão exibindo `Conectando...`, e altera instantaneamente o visual para `✓ Conectado` sem recarregar a página.
   - Emite um feedback visual moderno em formato de *Toast Notification* no topo da tela.

---

### 4. Algoritmos Matemáticos Oficiais Implementados
O sistema conta com algoritmos reais de validação:
- **CPF (Módulo 11):** Validação matemática oficial dos dois dígitos verificadores estabelecidos pela Receita Federal, rejeitando sequências repetidas.
- **CNPJ:** Validação dos pesos de 2 a 9 e conferência estrita dos dois dígitos finais para homologação de empresas parceiras.

---

### 5. Guia Rápido de Apresentação para a Banca do TCC

#### Credenciais Pré-Cadastradas:
| Perfil | Identificador / E-mail | Senha / Código | Acessos |
|---|---|---|---|
| **Aluno (Clarisse)** | `234.567.890-92` ou `clarisse.moura@aluno.senai.br` | `senai123` | Feed, Conexões, Perfil, Vagas, Candidaturas |
| **Empresa (TechCorp)** | CNPJ: `11.222.333/0001-81` | Código: `TECH-2024` | Perfil Empresarial, Vagas, Visualização de Candidatos |
| **Admin SENAI** | `admin@senai.br` | `admin123` | Painel de Governança, Autorização de Empresas |

#### Como Iniciar o Projeto:
1. Dê um duplo clique no arquivo `iniciar.bat` na pasta do projeto.
2. O servidor subirá automaticamente e a página será aberta no navegador em `http://localhost:3000`.
