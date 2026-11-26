# Rotina PMSC — app pessoal

App para acompanhar a rotina do plano: checklist do dia, estudo, questões, treino, calorias, água/café, peso e check-in para o coach.

- **Sem dependências**: só Node 18+ (não precisa de `npm install`).
- **Dados criptografados** no servidor (`DATA_DIR`) e na cópia do celular: funciona offline e sincroniza quando a internet volta.
- **PIN + verificação em duas etapas** no primeiro acesso de cada aparelho. Veja [Segurança](#segurança).

## Rodar no computador (opcional)

```bash
APP_PIN=<seu PIN> DATA_KEY=<chave de teste com 32+ caracteres> node server.js
# abra http://localhost:3000
```

## Publicar no Railway

1. Crie um repositório no GitHub e envie esta pasta (`server.js`, `package.json`, `public/`).
2. No Railway: **New Project → Deploy from GitHub repo** e escolha o repositório. Ele detecta o Node e roda `npm start` sozinho.
3. Na aba **Variables** do serviço, crie:
   - `APP_PIN` = um PIN só seu, com **pelo menos 6 dígitos** (de preferência 8). Sem ele, o app não abre.
   - `DATA_KEY` = chave de criptografia dos dados. Gere uma no computador com:
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
     **Guarde essa chave num gerenciador de senhas: sem ela, os dados não podem ser lidos.**
   - `DATA_DIR` = `/data`
4. Adicione um **Volume** ao serviço com o caminho de montagem (mount path) `/data`.
   **Sem volume, os dados do servidor somem a cada novo deploy.** O celular reenvia a cópia dele, mas não conte com isso.
5. Em **Settings → Networking**, clique em **Generate Domain** para ter o link `https://...up.railway.app`.

Alternativa sem GitHub (Railway CLI):

```bash
npm i -g @railway/cli
railway login
railway init        # dentro desta pasta
railway up
```
Depois faça os passos 3 a 5 no painel.

## Instalar no iPhone

1. Abra o link do Railway no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra pelo ícone "Rotina", digite o PIN e deixe marcado **Lembrar neste aparelho**.
   O login feito no Safari não vale para o ícone (o iPhone separa os dois).
4. **Primeiro acesso:** o app pede para ativar a verificação em duas etapas. Toque em **Adicionar ao autenticador**
   (abre Ajustes › Senhas no iPhone; também funciona com Google Authenticator ou Authy), digite o código de 6 dígitos
   e **guarde os 8 códigos de recuperação** mostrados em seguida.
5. Nas próximas vezes, esse aparelho pede só o PIN (ou nada, enquanto a sessão lembrada estiver ativa).

## Como usar

| Aba | Para quê |
| --- | --- |
| **Hoje** | Checklist hora a hora do plano. O tipo de dia (útil, terça, sábado, domingo, serviço) é escolhido sozinho e pode ser trocado. As refeições aparecem no horário, com kcal aproximadas. Registre questões/acertos, água e café. |
| **Peso** | Pese-se toda segunda em jejum. Gráfico, ritmo semanal e o ajuste de calorias que o coach recomenda. |
| **Semana** | Cumprimento por dia, horas de estudo, questões, treinos, leitura, refeições no horário e dias com tempo de família. |
| **Check-in** | Preencha antes de dormir e toque em **Copiar check-in** para colar na conversa com o Claude. |
| **⚙︎ Ajustes** | Metas de kcal (aprox.)/água/café, data da próxima prova (troque para a PRF depois de 13/12), backup, sair deste aparelho ou de todos. |

O ponto no topo indica a sincronização: verde = salvo no servidor, laranja = enviando, vermelho = offline (salvo no celular).

## Segurança

| Camada | Como funciona |
| --- | --- |
| **Configuração obrigatória** | Sem `APP_PIN` ou `DATA_KEY` (32+ caracteres), a API fica bloqueada (falha fechada). |
| **Criptografia no servidor** | Rotina, sessões, chave do 2FA e códigos de recuperação são gravados com AES-256-GCM. Arquivo adulterado ou chave errada: o app recusa e **não sobrescreve** nada. |
| **Criptografia no celular** | A cópia offline é criptografada com AES-GCM. A chave fica no IndexedDB como não-exportável. |
| **2FA (TOTP)** | Todo aparelho novo precisa do PIN + código de 6 dígitos do autenticador. Um código não pode ser usado duas vezes. |
| **Aparelho confiável** | Depois do 2FA, o aparelho recebe um cookie de 1 ano (`HttpOnly`, só em `/api/`). Nele, novos logins pedem só o PIN. A confiança é do **aparelho**, não do IP (o IP do celular muda o tempo todo e é compartilhado com outras pessoas pela operadora). |
| **Lembrar neste aparelho** | Sessão de 90 dias renovada com o uso. Desmarcado, some ao fechar o app (máx. 12 h). |
| **Bloqueio de tentativas** | 5 erros (PIN ou código) bloqueiam o IP por 15 min, e o tempo dobra a cada novo bloqueio (até 24 h). 20 erros em 1 h, somando todos os IPs, bloqueiam novos logins por 30 min. |
| **Cookies e cabeçalhos** | Sessão `HttpOnly`/`Secure`/`SameSite=Strict`, checagem de origem, CSP sem script inline, HSTS, sem iframe, `no-referrer`, `noindex` e `robots.txt`. |
| **Saneamento** | Dados do servidor, do celular e de backups importados são validados antes de aparecer na tela (impede injeção de script). |

**Emergências**
- **Perdeu o celular ou acha que viram seu PIN:** em outro aparelho, use "Sair de todos os aparelhos" (derruba sessões e aparelhos confiáveis) e troque o `APP_PIN` no Railway.
- **Perdeu o autenticador:** entre com um código de recuperação. Sem nenhum código, crie no Railway a variável `RESET_2FA=1`, configure o 2FA de novo no app e **apague a variável em seguida**.
- **Perdeu a `DATA_KEY`:** os dados do servidor não podem ser recuperados. Restaure um backup exportado pelo app.
- O backup exportado em Ajustes **não** é criptografado: guarde em local seguro.

## Atualizar o app

Altere os arquivos, faça commit/push (ou `railway up`). Ao reabrir o app no iPhone, ele carrega a versão nova. Os dados ficam no volume e não são apagados.
